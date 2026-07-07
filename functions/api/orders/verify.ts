/**
 * POST /api/orders/verify
 *
 * Called by the client after Razorpay Checkout succeeds. Verifies the payment
 * signature SERVER-SIDE; only on success is the order marked `paid` and the
 * owner notified. Tampered/forged payloads are rejected.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { json, badRequest, serverError } from "../../_lib/http";
import { verifyPaymentSignature } from "../../_lib/razorpay";
import { findByRazorpayOrderId, markOrderPaid, markOrderFailed } from "../../_lib/db";
import { notifyOwner } from "../../_lib/email";
import { getPaymentKeys } from "../../_lib/settings";
import type { VerifyOrderRequest, PricedLine } from "../../../src/lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: VerifyOrderRequest;
  try {
    body = (await request.json()) as VerifyOrderRequest;
  } catch {
    return badRequest("Invalid request body.");
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return badRequest("Missing payment verification fields.");
  }

  try {
    const keys = await getPaymentKeys(env);
    const valid = await verifyPaymentSignature(
      keys,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    if (!valid) {
      await markOrderFailed(env, razorpay_order_id);
      return json({ ok: false, status: "failed", error: "Invalid signature." }, 400);
    }

    // Idempotent: only the first verification flips status + emails the owner.
    const changed = await markOrderPaid(env, razorpay_order_id, razorpay_payment_id);
    const row = await findByRazorpayOrderId(env, razorpay_order_id);
    if (!row) return serverError("Order not found.");

    if (changed > 0) {
      const lines = JSON.parse(row.items) as PricedLine[];
      await notifyOwner(env, {
        orderRef: row.order_ref,
        status: "paid",
        method: row.method,
        subtotal: row.amount_subtotal,
        shipping: row.amount_shipping,
        total: row.amount_total,
        currency: row.currency,
        lines: lines.map((l) => ({ name: l.name, qty: l.qty, lineTotal: l.lineTotal })),
        customer: {
          name: row.customer_name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          pincode: row.pincode,
        },
      });
    }

    return json({ ok: true, status: "paid", order_ref: row.order_ref });
  } catch (err) {
    console.error("[verify] error", err);
    return serverError("Could not verify the payment.");
  }
};
