/** POST: update an order's status from the dashboard, then redirect back. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { updateOrderStatus, getOrderByRef } from "../../_lib/db";
import { releaseOrderStock } from "../../_lib/paymentHold";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const orderRef = String(form.get("order_ref") ?? "");
  const status = String(form.get("status") ?? "");
  const filter = String(form.get("filter") ?? "all");

  const back = (params: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: new URL(`/admin?${params}`, request.url).toString() },
    });

  if (!orderRef || !status) return back(`status=${encodeURIComponent(filter)}`);

  try {
    // Confirming a manual-UPI payment has to go through /admin/orders/verify —
    // that path checks the evidence, spends the coupon and emails the customer.
    const before = await getOrderByRef(env, orderRef);
    if (before?.status === "awaiting_payment" && status !== "cancelled") {
      return back(
        `status=${encodeURIComponent(filter)}&error=${encodeURIComponent(
          "Use ✓ Money received / ✕ Not received to decide an unverified UPI payment.",
        )}`,
      );
    }

    await updateOrderStatus(env, orderRef, status);

    // A cancelled or failed order stops holding its stock.
    if (before && (status === "cancelled" || status === "failed")) {
      await releaseOrderStock(env, before);
    }

    return back(
      `status=${encodeURIComponent(filter)}&updated=${encodeURIComponent(orderRef)}`,
    );
  } catch {
    return back(`status=${encodeURIComponent(filter)}`);
  }
};
