/**
 * POST /admin/orders/verify — the owner's decision on a manual-UPI payment.
 *
 * This is the only place an `awaiting_payment` order can become a sale. The
 * owner checks their bank/UPI app for a credit matching the amount and the
 * reference shown in the queue, then:
 *   confirm → paid   (coupon is spent here, stock stays sold, customer emailed)
 *   reject  → failed (stock goes back, customer emailed and told why)
 *
 * Both transitions are guarded on the current status, so a double-click or two
 * admins acting at once can't send two emails or double-count a coupon.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import {
  getOrderByRef,
  confirmUpiPayment,
  rejectUpiPayment,
} from "../../_lib/db";
import { releaseOrderStock } from "../../_lib/paymentHold";
import { incrementCouponUse } from "../../_lib/settings";
import { notifyCustomer, summariseOrderRow } from "../../_lib/email";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const orderRef = String(form.get("order_ref") ?? "").trim();
  const action = String(form.get("action") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 300);
  const filter = String(form.get("filter") ?? "awaiting_payment");

  const back = (params: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: new URL(`/admin?${params}`, request.url).toString() },
    });

  const base = `status=${encodeURIComponent(filter)}`;
  if (!orderRef) return back(base);

  const order = await getOrderByRef(env, orderRef);
  if (!order) return back(`${base}&error=${encodeURIComponent("Order not found.")}`);
  if (order.status !== "awaiting_payment") {
    return back(
      `${base}&error=${encodeURIComponent(`${orderRef} was already decided (${order.status}).`)}`,
    );
  }

  if (action === "confirm") {
    if (!(await confirmUpiPayment(env, orderRef, note))) return back(base);
    // The coupon is spent now, not at checkout — an unverified order never
    // gets to burn a limited-use code.
    if (order.coupon_code) await incrementCouponUse(env, order.coupon_code);
    await notifyCustomer(
      env,
      { ...summariseOrderRow(order), status: "paid" },
      "verified",
      note || undefined,
    );
    return back(`${base}&updated=${encodeURIComponent(orderRef)}&verified=1`);
  }

  if (action === "reject") {
    const reason = note || "Payment could not be matched to our account.";
    if (!(await rejectUpiPayment(env, orderRef, reason))) return back(base);
    await releaseOrderStock(env, order); // items go back on sale
    await notifyCustomer(
      env,
      { ...summariseOrderRow(order), status: "failed" },
      "rejected",
      note || undefined,
    );
    return back(`${base}&updated=${encodeURIComponent(orderRef)}&rejected=1`);
  }

  return back(base);
};
