/** D1 access layer for orders. */
import type { Env } from "./env";
import type { PricedLine, OrderStatus, CheckoutMethod } from "../../src/lib/types";

export interface NewOrder {
  orderRef: string;
  status: OrderStatus;
  method: CheckoutMethod;
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  lines: PricedLine[];
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    pincode: string;
  };
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  notes?: string;
  couponCode?: string;
  discount?: number;
  /** Normalised UPI reference (manual online payment) — unique across orders. */
  upiRef?: string;
  /** payment_proofs.id of the screenshot the customer attached, if any. */
  paymentProofId?: number;
  /** 1 while this order still holds the stock it decremented. */
  stockHeld?: boolean;
}

export interface OrderRow {
  order_ref: string;
  status: OrderStatus;
  method: CheckoutMethod;
  amount_subtotal: number;
  amount_shipping: number;
  amount_total: number;
  currency: string;
  items: string;
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  notes: string | null;
  coupon_code: string | null;
  amount_discount: number;
  created_at: string;
  upi_ref: string | null;
  payment_proof_id: number | null;
  verified_at: string | null;
  verified_note: string | null;
  stock_held: number;
}

/** Raised when the UPI reference is already claimed by another order. */
export class DuplicateUpiRefError extends Error {
  constructor() {
    super("duplicate upi_ref");
    this.name = "DuplicateUpiRefError";
  }
}

export async function insertOrder(env: Env, o: NewOrder): Promise<void> {
  try {
    await insertOrderRow(env, o);
  } catch (err) {
    // The partial unique index on upi_ref is the last line of defence against a
    // reference being reused (two checkouts racing past the pre-check).
    if (o.upiRef && /UNIQUE constraint failed: orders.upi_ref/i.test(String(err))) {
      throw new DuplicateUpiRefError();
    }
    throw err;
  }
}

async function insertOrderRow(env: Env, o: NewOrder): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (
       order_ref, status, method,
       amount_subtotal, amount_shipping, amount_total, currency,
       items, customer_name, phone, email, address, pincode,
       razorpay_order_id, razorpay_payment_id, notes,
       coupon_code, amount_discount,
       upi_ref, payment_proof_id, stock_held
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      o.orderRef,
      o.status,
      o.method,
      o.subtotal,
      o.shipping,
      o.total,
      o.currency,
      JSON.stringify(o.lines),
      o.customer.name,
      o.customer.phone,
      o.customer.email,
      o.customer.address,
      o.customer.pincode,
      o.razorpayOrderId ?? null,
      o.razorpayPaymentId ?? null,
      o.notes ?? null,
      o.couponCode ?? null,
      o.discount ?? 0,
      o.upiRef ?? null,
      o.paymentProofId ?? null,
      o.stockHeld ? 1 : 0,
    )
    .run();
}

/* ------------------------------------------------------------------ *
 * Manual UPI payment verification
 * ------------------------------------------------------------------ */

/** Has this UPI reference already been claimed by an order? */
export async function findByUpiRef(env: Env, upiRef: string): Promise<OrderRow | null> {
  return env.DB.prepare(`SELECT * FROM orders WHERE upi_ref = ?`)
    .bind(upiRef)
    .first<OrderRow>();
}

/** Unverified manual-UPI orders this phone number has opened in the last N hours. */
export async function countAwaitingByPhone(
  env: Env,
  phone: string,
  hours: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM orders
      WHERE phone = ? AND status = 'awaiting_payment'
        AND created_at > datetime('now', ?)`,
  )
    .bind(phone, `-${Math.max(1, Math.floor(hours))} hours`)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Manual-UPI orders from this phone the owner has rejected as unpaid. */
export async function countRejectedByPhone(env: Env, phone: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM orders
      WHERE phone = ? AND method = 'online' AND status = 'failed'
        AND verified_at IS NOT NULL`,
  )
    .bind(phone)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * Give up this order's claim on the stock it decremented. Idempotent: returns
 * true only for the call that actually released it, so the caller adds the
 * units back exactly once.
 */
export async function releaseStockHold(env: Env, orderRef: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE orders SET stock_held = 0 WHERE order_ref = ? AND stock_held = 1`,
  )
    .bind(orderRef)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Owner confirmed the money landed: awaiting_payment → paid. Returns false if
 * the order was already decided (double-click, two admins), so the caller does
 * not send a second email or double-count the coupon.
 */
export async function confirmUpiPayment(
  env: Env,
  orderRef: string,
  note: string,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE orders
        SET status = 'paid', verified_at = datetime('now'), verified_note = ?
      WHERE order_ref = ? AND status = 'awaiting_payment'`,
  )
    .bind(note || null, orderRef)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Owner could not find the money: awaiting_payment → failed. */
export async function rejectUpiPayment(
  env: Env,
  orderRef: string,
  reason: string,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE orders
        SET status = 'failed', verified_at = datetime('now'), verified_note = ?
      WHERE order_ref = ? AND status = 'awaiting_payment'`,
  )
    .bind(reason || null, orderRef)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Unverified orders past the hold window — swept lazily (Pages has no cron). */
export async function listExpiredAwaiting(
  env: Env,
  hours: number,
): Promise<OrderListRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM orders
      WHERE status = 'awaiting_payment' AND created_at <= datetime('now', ?)
      ORDER BY created_at LIMIT 50`,
  )
    .bind(`-${Math.max(1, Math.floor(hours))} hours`)
    .all<OrderListRow>();
  return res.results ?? [];
}

export async function expireAwaitingOrder(env: Env, orderRef: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE orders
        SET status = 'cancelled', verified_at = datetime('now'),
            verified_note = 'Auto-cancelled — payment not verified in time.'
      WHERE order_ref = ? AND status = 'awaiting_payment'`,
  )
    .bind(orderRef)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/* -------------------- payment screenshots -------------------- */

export async function addPaymentProof(
  env: Env,
  orderRef: string,
  mime: string,
  bytes: ArrayBuffer,
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO payment_proofs (order_ref, mime, bytes) VALUES (?,?,?)`,
  )
    .bind(orderRef, mime, bytes)
    .run();
  return Number(res.meta.last_row_id);
}

export async function getPaymentProof(
  env: Env,
  id: number,
): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const row = await env.DB.prepare(
    `SELECT mime, bytes FROM payment_proofs WHERE id = ?`,
  )
    .bind(id)
    .first<{ mime: string; bytes: ArrayBuffer | number[] }>();
  if (!row) return null;
  const bytes = Array.isArray(row.bytes) ? new Uint8Array(row.bytes).buffer : row.bytes;
  return { mime: row.mime, bytes };
}

export async function findByRazorpayOrderId(
  env: Env,
  razorpayOrderId: string,
): Promise<OrderRow | null> {
  return env.DB.prepare(`SELECT * FROM orders WHERE razorpay_order_id = ?`)
    .bind(razorpayOrderId)
    .first<OrderRow>();
}

/** Idempotently mark an order paid; returns the affected row count. */
export async function markOrderPaid(
  env: Env,
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE orders
       SET status = 'paid', razorpay_payment_id = ?
     WHERE razorpay_order_id = ? AND status != 'paid'`,
  )
    .bind(razorpayPaymentId, razorpayOrderId)
    .run();
  return res.meta.changes ?? 0;
}

export async function markOrderFailed(
  env: Env,
  razorpayOrderId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE orders SET status = 'failed'
     WHERE razorpay_order_id = ? AND status = 'pending'`,
  )
    .bind(razorpayOrderId)
    .run();
}

/* ------------------------------------------------------------------ *
 * Admin queries
 * ------------------------------------------------------------------ */

export interface OrderStats {
  totalOrders: number;
  paidCount: number;
  codPendingCount: number;
  /** Sum of amount_total for completed revenue (paid + delivered COD). */
  revenue: number;
  /** Sum of amount_total for COD still to be collected. */
  codOutstanding: number;
  /** Manual-UPI orders waiting for the owner to verify the payment. */
  awaitingCount: number;
  /** Sum of amount_total claimed-but-unverified — NOT revenue. */
  awaitingValue: number;
}

/**
 * Dashboard headline figures. Revenue counts paid + delivered orders only —
 * `awaiting_payment` is money a customer *claims* to have sent, so it is
 * reported separately and never rolled into revenue.
 */
export async function getStats(env: Env): Promise<OrderStats> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*)                                                         AS totalOrders,
       COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0)       AS paidCount,
       COALESCE(SUM(CASE WHEN status='cod_pending' THEN 1 ELSE 0 END),0) AS codPendingCount,
       COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN amount_total ELSE 0 END),0) AS revenue,
       COALESCE(SUM(CASE WHEN status='cod_pending' THEN amount_total ELSE 0 END),0)           AS codOutstanding,
       COALESCE(SUM(CASE WHEN status='awaiting_payment' THEN 1 ELSE 0 END),0)                 AS awaitingCount,
       COALESCE(SUM(CASE WHEN status='awaiting_payment' THEN amount_total ELSE 0 END),0)      AS awaitingValue
     FROM orders`,
  ).first<OrderStats>();
  return (
    row ?? {
      totalOrders: 0,
      paidCount: 0,
      codPendingCount: 0,
      revenue: 0,
      codOutstanding: 0,
      awaitingCount: 0,
      awaitingValue: 0,
    }
  );
}

export type OrderListRow = OrderRow & { id: number };

/** Recent orders, optionally filtered by status. */
export async function listOrders(
  env: Env,
  status?: string,
  limit = 100,
): Promise<OrderListRow[]> {
  const clamp = Math.min(Math.max(limit, 1), 500);
  const stmt =
    status && status !== "all"
      ? env.DB.prepare(
          `SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        ).bind(status, clamp)
      : env.DB.prepare(
          `SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`,
        ).bind(clamp);
  const res = await stmt.all<OrderListRow>();
  return res.results ?? [];
}

export async function getOrderByRef(
  env: Env,
  orderRef: string,
): Promise<OrderListRow | null> {
  return env.DB.prepare(`SELECT * FROM orders WHERE order_ref = ?`)
    .bind(orderRef)
    .first<OrderListRow>();
}

const ALLOWED_STATUSES = new Set([
  "pending",
  "awaiting_payment",
  "paid",
  "cod_pending",
  "shipped",
  "delivered",
  "cancelled",
  "failed",
]);

export interface CustomerRow {
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
  order_count: number;
  total_spent: number;
  last_order_at: string;
}

/** Customers derived from orders, grouped by phone (excludes failed/cancelled). */
export async function listCustomers(env: Env): Promise<CustomerRow[]> {
  const res = await env.DB.prepare(
    `SELECT
       MAX(customer_name)  AS customer_name,
       phone,
       MAX(email)          AS email,
       MAX(address)        AS address,
       MAX(pincode)        AS pincode,
       COUNT(*)            AS order_count,
       COALESCE(SUM(amount_total),0) AS total_spent,
       MAX(created_at)     AS last_order_at
     FROM orders
     WHERE status NOT IN ('failed','cancelled')
     GROUP BY phone
     ORDER BY last_order_at DESC
     LIMIT 500`,
  ).all<CustomerRow>();
  return res.results ?? [];
}

/** Update an order's status from the admin dashboard. Returns rows changed. */
export async function updateOrderStatus(
  env: Env,
  orderRef: string,
  status: string,
): Promise<number> {
  if (!ALLOWED_STATUSES.has(status)) throw new Error("Invalid status");
  const res = await env.DB.prepare(
    `UPDATE orders SET status = ? WHERE order_ref = ?`,
  )
    .bind(status, orderRef)
    .run();
  return res.meta.changes ?? 0;
}

/** Correct a customer's delivery details on an order (e.g. a mistyped address). */
export async function updateOrderCustomer(
  env: Env,
  orderRef: string,
  c: { name: string; phone: string; email: string; address: string; pincode: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE orders SET customer_name=?, phone=?, email=?, address=?, pincode=? WHERE order_ref=?`,
  )
    .bind(c.name.trim(), c.phone.trim(), c.email.trim().toLowerCase(), c.address.trim(), c.pincode.trim(), orderRef)
    .run();
}
