/**
 * POST /api/webhooks/razorpay  (optional, for reliability)
 *
 * Razorpay can call this independently of the browser, so a payment is still
 * reconciled even if the customer closes the tab before /verify runs. The body
 * is verified against RAZORPAY_WEBHOOK_SECRET (HMAC over the RAW body).
 *
 * Configure in the Razorpay dashboard → Webhooks:
 *   URL:     https://<your-domain>/api/webhooks/razorpay
 *   Events:  payment.captured, order.paid
 *   Secret:  same value as RAZORPAY_WEBHOOK_SECRET
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, serverError } from "../../_lib/http";
import { verifyWebhookSignature } from "../../_lib/razorpay";
import { findByRazorpayOrderId, markOrderPaid } from "../../_lib/db";
import { notifyOwner } from "../../_lib/email";
import { getPaymentKeys } from "../../_lib/settings";
import type { PricedLine } from "../../../src/lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Must read the RAW body for an exact HMAC match.
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  const keys = await getPaymentKeys(env);
  const valid = await verifyWebhookSignature(keys, raw, signature);
  if (!valid) return json({ ok: false, error: "Invalid signature." }, 401);

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Bad payload." }, 400);
  }

  try {
    const type = event?.event as string | undefined;
    if (type !== "payment.captured" && type !== "order.paid") {
      return json({ ok: true, ignored: type ?? "unknown" });
    }

    const payment = event?.payload?.payment?.entity;
    const orderEntity = event?.payload?.order?.entity;
    const razorpayOrderId: string | undefined =
      payment?.order_id ?? orderEntity?.id;
    const paymentId: string = payment?.id ?? "webhook";
    if (!razorpayOrderId) return json({ ok: true, ignored: "no-order-id" });

    const changed = await markOrderPaid(env, razorpayOrderId, paymentId);
    if (changed > 0) {
      const row = await findByRazorpayOrderId(env, razorpayOrderId);
      if (row) {
        const lines = JSON.parse(row.items) as PricedLine[];
        await notifyOwner(env, {
          orderRef: row.order_ref,
          status: "paid",
          method: row.method,
          subtotal: row.amount_subtotal,
          shipping: row.amount_shipping,
          total: row.amount_total,
          currency: row.currency,
          lines: lines.map((l) => ({
            name: l.name,
            qty: l.qty,
            lineTotal: l.lineTotal,
          })),
          customer: {
            name: row.customer_name,
            phone: row.phone,
            email: row.email,
            address: row.address,
            pincode: row.pincode,
          },
        });
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[webhook] error", err);
    return serverError("Webhook handling failed.");
  }
};
