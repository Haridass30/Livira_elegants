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
  created_at: string;
}

export async function insertOrder(env: Env, o: NewOrder): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orders (
       order_ref, status, method,
       amount_subtotal, amount_shipping, amount_total, currency,
       items, customer_name, phone, email, address, pincode,
       razorpay_order_id, razorpay_payment_id, notes
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    )
    .run();
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
}

/** Dashboard headline figures. Revenue counts paid + delivered orders. */
export async function getStats(env: Env): Promise<OrderStats> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*)                                                         AS totalOrders,
       COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0)       AS paidCount,
       COALESCE(SUM(CASE WHEN status='cod_pending' THEN 1 ELSE 0 END),0) AS codPendingCount,
       COALESCE(SUM(CASE WHEN status IN ('paid','delivered') THEN amount_total ELSE 0 END),0) AS revenue,
       COALESCE(SUM(CASE WHEN status='cod_pending' THEN amount_total ELSE 0 END),0)           AS codOutstanding
     FROM orders`,
  ).first<OrderStats>();
  return (
    row ?? {
      totalOrders: 0,
      paidCount: 0,
      codPendingCount: 0,
      revenue: 0,
      codOutstanding: 0,
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
  "paid",
  "cod_pending",
  "shipped",
  "delivered",
  "cancelled",
  "failed",
]);

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
