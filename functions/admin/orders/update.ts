/** POST: update an order's status from the dashboard, then redirect back. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { updateOrderStatus } from "../../_lib/db";

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
    await updateOrderStatus(env, orderRef, status);
    return back(
      `status=${encodeURIComponent(filter)}&updated=${encodeURIComponent(orderRef)}`,
    );
  } catch {
    return back(`status=${encodeURIComponent(filter)}`);
  }
};
