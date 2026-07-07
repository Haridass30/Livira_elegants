/**
 * POST /api/coupons/validate — check a coupon against the current cart.
 *
 * The subtotal is recomputed server-side from slugs+quantities (client totals
 * are never trusted). This is a preview only; /api/orders/create re-validates
 * the coupon at order time.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { pricingFromEnv } from "../../_lib/env";
import { json, badRequest } from "../../_lib/http";
import { getCoupon, evaluateCoupon } from "../../_lib/settings";
import { validateAndPriceCart } from "../../../src/lib/pricing";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { code?: string; items?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Invalid request body.");
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return badRequest("Enter a coupon code.");

  const cart = validateAndPriceCart(body?.items, pricingFromEnv(env));
  if (!cart.ok) return badRequest(cart.errors);

  const coupon = await getCoupon(env, code);
  const check = evaluateCoupon(coupon, cart.totals.subtotal);
  if (!check.ok) {
    return json({ ok: false, error: check.reason ?? "Invalid coupon." }, 400);
  }
  return json({ ok: true, code: coupon!.code, discount: check.discount });
};
