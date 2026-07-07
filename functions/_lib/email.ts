/**
 * Owner notification email via Resend (https://resend.com) free tier.
 *
 * This is the notification "seam": if RESEND_API_KEY / OWNER_EMAIL are not set,
 * it no-ops gracefully (logs and returns) so orders still succeed in dev. Swap
 * the provider here without touching the order Functions.
 */
import type { Env } from "./env";

const RESEND_API = "https://api.resend.com/emails";

/** Minimal shape the email needs — satisfied by NewOrder and by verify's row. */
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
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    pincode: string;
  };
}

export async function notifyOwner(env: Env, order: OrderSummary): Promise<void> {
  if (!env.RESEND_API_KEY || !env.OWNER_EMAIL) {
    console.log(
      `[email] skipped (no RESEND_API_KEY/OWNER_EMAIL) — order ${order.orderRef}`,
    );
    return;
  }

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const itemsHtml = order.lines
    .map(
      (l) =>
        `<tr><td style="padding:4px 12px 4px 0">${l.name} × ${l.qty}</td>` +
        `<td align="right">${fmt(l.lineTotal)}</td></tr>`,
    )
    .join("");

  const methodLabel =
    order.method === "cod" ? "Cash on Delivery" : "Paid online (Razorpay)";

  const html = `
    <div style="font-family:Georgia,serif;color:#2b2724;max-width:560px">
      <h2 style="font-weight:normal">New order · ${order.orderRef}</h2>
      <p><strong>${methodLabel}</strong> — status: ${order.status}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        ${itemsHtml}
        <tr><td style="padding-top:8px">Subtotal</td><td align="right" style="padding-top:8px">${fmt(order.subtotal)}</td></tr>
        ${order.discount ? `<tr><td>Discount${order.couponCode ? ` (${order.couponCode})` : ""}</td><td align="right">−${fmt(order.discount)}</td></tr>` : ""}
        <tr><td>Shipping</td><td align="right">${order.shipping === 0 ? "Free" : fmt(order.shipping)}</td></tr>
        <tr><td style="font-weight:bold;padding-top:8px">Total</td><td align="right" style="font-weight:bold;padding-top:8px">${fmt(order.total)}</td></tr>
      </table>
      <h3 style="font-weight:normal">Deliver to</h3>
      <p style="line-height:1.6">
        ${order.customer.name}<br/>
        ${order.customer.address}<br/>
        PIN ${order.customer.pincode}<br/>
        ${order.customer.phone} · ${order.customer.email}
      </p>
    </div>`;

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${"Livira Orders"} <${env.FROM_EMAIL || "orders@example.com"}>`,
        to: [env.OWNER_EMAIL],
        reply_to: order.customer.email,
        subject: `New ${order.method.toUpperCase()} order ${order.orderRef} — ${fmt(order.total)}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend failed ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    // Never fail the order because the email failed.
    console.error("[email] error", err);
  }
}
