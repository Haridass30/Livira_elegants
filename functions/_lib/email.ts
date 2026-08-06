/**
 * Transactional email via Resend (https://resend.com) free tier.
 *
 * This is the notification "seam": if RESEND_API_KEY / OWNER_EMAIL are not set,
 * it no-ops gracefully (logs and returns) so orders still succeed in dev. Swap
 * the provider here without touching the order Functions.
 *
 * Two audiences:
 *   - notifyOwner    — the owner's work item ("verify this UPI reference").
 *   - notifyCustomer — the honest status of the customer's order. A manual-UPI
 *                      order is NEVER described as confirmed until the owner
 *                      has actually matched the money.
 */
import type { Env } from "./env";
import { formatUpiRef } from "./upi";

const RESEND_API = "https://api.resend.com/emails";

/** Minimal shape the email needs — satisfied by NewOrder and by admin rows. */
export interface OrderSummary {
  orderRef: string;
  status: string;
  method: "online" | "cod";
  subtotal: number;
  shipping: number;
  total: number;
  currency: string;
  lines: { name: string; qty: number; lineTotal: number }[];
  couponCode?: string;
  discount?: number;
  notes?: string;
  /** Manual-UPI reference the customer submitted (digits only). */
  upiRef?: string;
  /** True when a payment screenshot was attached. */
  hasProof?: boolean;
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    pincode: string;
  };
}

const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Adapt a stored order row into the shape these emails need. */
export function summariseOrderRow(row: {
  order_ref: string;
  status: string;
  method: string;
  amount_subtotal: number;
  amount_shipping: number;
  amount_total: number;
  currency: string;
  items: string;
  coupon_code: string | null;
  amount_discount: number;
  notes: string | null;
  upi_ref: string | null;
  payment_proof_id: number | null;
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
}): OrderSummary {
  let lines: OrderSummary["lines"] = [];
  try {
    const parsed = JSON.parse(row.items);
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    /* an unreadable snapshot must not stop the email */
  }
  return {
    orderRef: row.order_ref,
    status: row.status,
    method: row.method === "cod" ? "cod" : "online",
    subtotal: row.amount_subtotal,
    shipping: row.amount_shipping,
    total: row.amount_total,
    currency: row.currency,
    lines,
    couponCode: row.coupon_code ?? undefined,
    discount: row.amount_discount,
    notes: row.notes ?? undefined,
    upiRef: row.upi_ref ?? undefined,
    hasProof: !!row.payment_proof_id,
    customer: {
      name: row.customer_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      pincode: row.pincode,
    },
  };
}

async function send(
  env: Env,
  msg: { to: string; subject: string; html: string; replyTo?: string },
): Promise<void> {
  if (!env.RESEND_API_KEY || !msg.to) {
    console.log(`[email] skipped (no RESEND_API_KEY/recipient) — ${msg.subject}`);
    return;
  }
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Livira Orders <${env.FROM_EMAIL || "orders@example.com"}>`,
        to: [msg.to],
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        subject: msg.subject,
        html: msg.html,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend failed ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    // Never fail an order because the email failed.
    console.error("[email] error", err);
  }
}

function shell(inner: string): string {
  return `<div style="font-family:Georgia,serif;color:#2b2724;max-width:560px">${inner}</div>`;
}

function itemsTable(order: OrderSummary): string {
  const rows = order.lines
    .map(
      (l) =>
        `<tr><td style="padding:4px 12px 4px 0">${l.name} × ${l.qty}</td>` +
        `<td align="right">${fmt(l.lineTotal)}</td></tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${rows}
      <tr><td style="padding-top:8px">Subtotal</td><td align="right" style="padding-top:8px">${fmt(order.subtotal)}</td></tr>
      ${order.discount ? `<tr><td>Discount${order.couponCode ? ` (${order.couponCode})` : ""}</td><td align="right">−${fmt(order.discount)}</td></tr>` : ""}
      <tr><td>Shipping</td><td align="right">${order.shipping === 0 ? "Free" : fmt(order.shipping)}</td></tr>
      <tr><td style="font-weight:bold;padding-top:8px">Total</td><td align="right" style="font-weight:bold;padding-top:8px">${fmt(order.total)}</td></tr>
    </table>`;
}

/* ------------------------------------------------------------------ *
 * Owner
 * ------------------------------------------------------------------ */

export async function notifyOwner(env: Env, order: OrderSummary): Promise<void> {
  if (!env.OWNER_EMAIL) {
    console.log(`[email] no OWNER_EMAIL — order ${order.orderRef}`);
    return;
  }

  const awaiting = order.status === "awaiting_payment";
  const methodLabel =
    order.method === "cod" ? "Cash on Delivery" : "Online — manual UPI";

  // The whole point of the verification flow: the owner is told, in the mail
  // itself, that this reference proves nothing until they check the account.
  const verifyBlock = awaiting
    ? `<div style="background:#f6efdd;border-left:4px solid #b8893f;padding:12px 16px;margin:16px 0">
         <p style="margin:0 0 6px"><strong>Payment NOT verified yet — do not dispatch.</strong></p>
         <p style="margin:0 0 6px">Customer says they paid <strong>${fmt(order.total)}</strong>, reference
            <strong style="font-family:monospace;font-size:15px">${order.upiRef ? formatUpiRef(order.upiRef) : "—"}</strong>.</p>
         <p style="margin:0 0 6px">${order.hasProof ? "A payment screenshot is attached to the order in /admin." : "No screenshot was attached."}</p>
         <p style="margin:0">Open your bank / UPI app, find a credit of ${fmt(order.total)} with this
            reference, then <strong>Confirm</strong> or <strong>Reject</strong> the order under
            <strong>/admin → Awaiting payment</strong>.</p>
       </div>`
    : order.notes
      ? `<p style="background:#f6efdd;padding:8px 12px">${order.notes}</p>`
      : "";

  const html = shell(`
      <h2 style="font-weight:normal">${awaiting ? "Payment to verify" : "New order"} · ${order.orderRef}</h2>
      <p><strong>${methodLabel}</strong> — status: ${order.status.replace("_", " ")}</p>
      ${verifyBlock}
      ${itemsTable(order)}
      <h3 style="font-weight:normal">Deliver to</h3>
      <p style="line-height:1.6">
        ${order.customer.name}<br/>
        ${order.customer.address}<br/>
        PIN ${order.customer.pincode}<br/>
        ${order.customer.phone} · ${order.customer.email}
      </p>`);

  await send(env, {
    to: env.OWNER_EMAIL,
    replyTo: order.customer.email,
    subject: awaiting
      ? `VERIFY payment · ${order.orderRef} — ${fmt(order.total)}`
      : `New ${order.method.toUpperCase()} order ${order.orderRef} — ${fmt(order.total)}`,
    html,
  });
}

/* ------------------------------------------------------------------ *
 * Customer
 * ------------------------------------------------------------------ */

export type CustomerMailKind =
  /** Manual UPI reference received; nothing is confirmed yet. */
  | "awaiting"
  /** Owner matched the money — this is the real confirmation. */
  | "verified"
  /** Owner could not find the money. */
  | "rejected"
  /** Hold window lapsed with no verified payment. */
  | "expired"
  /** COD order recorded. */
  | "cod";

const COPY: Record<CustomerMailKind, { subject: string; heading: string; body: string }> = {
  awaiting: {
    subject: "We've received your order — verifying your payment",
    heading: "Order received — payment being verified",
    body:
      "Thank you. We have your order and the UPI reference you sent. Your items are held for you " +
      "while we match the payment against our account. <strong>Your order is not confirmed yet</strong> " +
      "— we'll email you as soon as it is, usually within a few hours.",
  },
  verified: {
    subject: "Payment confirmed — your order is on its way",
    heading: "Payment confirmed",
    body:
      "We've matched your payment against our account and your order is now confirmed. " +
      "We'll be in touch with dispatch details shortly.",
  },
  rejected: {
    subject: "We couldn't find your payment",
    heading: "We couldn't match your payment",
    body:
      "We checked our account and could not find a payment matching the reference you sent, so this " +
      "order has been released. If you did pay, reply to this email with a screenshot from your UPI app " +
      "showing the amount, date and reference — we'll sort it out straight away.",
  },
  expired: {
    subject: "Your order has been released",
    heading: "Order released",
    body:
      "We didn't receive a payment we could match for this order, so we've released the items back " +
      "into stock. Nothing has been charged by us. You're welcome to order again, or reply to this " +
      "email if you believe the payment did go through.",
  },
  cod: {
    subject: "Order received — Cash on Delivery",
    heading: "Order received",
    body: "Thank you. Your order is recorded and payable in cash when it arrives.",
  },
};

export async function notifyCustomer(
  env: Env,
  order: OrderSummary,
  kind: CustomerMailKind,
  extra?: string,
): Promise<void> {
  const copy = COPY[kind];
  const refLine =
    order.upiRef && (kind === "awaiting" || kind === "rejected")
      ? `<p style="margin:0 0 4px">UPI reference you sent: <strong style="font-family:monospace">${formatUpiRef(order.upiRef)}</strong></p>`
      : "";

  const html = shell(`
      <h2 style="font-weight:normal">${copy.heading}</h2>
      <p style="line-height:1.6">${copy.body}</p>
      ${extra ? `<p style="background:#f6efdd;padding:8px 12px;line-height:1.6">${extra}</p>` : ""}
      <p style="margin-top:18px">Order reference: <strong>${order.orderRef}</strong></p>
      ${refLine}
      ${itemsTable(order)}
      <p style="line-height:1.6">
        ${order.customer.name}<br/>
        ${order.customer.address}<br/>
        PIN ${order.customer.pincode}
      </p>`);

  await send(env, {
    to: order.customer.email,
    replyTo: env.OWNER_EMAIL,
    subject: `${copy.subject} · ${order.orderRef}`,
    html,
  });
}
