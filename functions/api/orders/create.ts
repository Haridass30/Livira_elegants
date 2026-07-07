/**
 * POST /api/orders/create
 *
 * Validates the cart + customer SERVER-SIDE, recomputes every total from the
 * canonical catalogue, then either:
 *   - method "cod":    records a `cod_pending` order + notifies the owner.
 *   - method "online": creates a Razorpay order, stores a `pending` order, and
 *                      returns the ids the client needs to open Checkout.
 *
 * The client's prices/totals are never trusted — only slugs + quantities.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { pricingFromEnv } from "../../_lib/env";
import { json, badRequest, serverError } from "../../_lib/http";
import { makeOrderRef } from "../../_lib/crypto";
import { createRazorpayOrder } from "../../_lib/razorpay";
import { insertOrder } from "../../_lib/db";
import { notifyOwner } from "../../_lib/email";
import {
  getSettings,
  getCoupon,
  evaluateCoupon,
  incrementCouponUse,
  getPaymentKeys,
} from "../../_lib/settings";
import { loadCatalog, decrementStock } from "../../_lib/catalogDb";
import {
  validateAndPriceCart,
  validateCustomer,
  isCodAllowed,
  isPincodeServiceable,
} from "../../../src/lib/pricing";
import { toPaise } from "../../../src/lib/format";
import type { CreateOrderRequest, CheckoutMethod } from "../../../src/lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: CreateOrderRequest;
  try {
    body = (await request.json()) as CreateOrderRequest;
  } catch {
    return badRequest("Invalid request body.");
  }

  // Admin-editable store settings (D1) override the env defaults live.
  const settings = await getSettings(env);
  const cfg = {
    ...pricingFromEnv(env),
    codMaxOrderValue: settings.codMaxOrderValue,
    freeShippingThreshold: settings.freeShippingThreshold,
    flatShippingFee: settings.flatShippingFee,
  };
  const method: CheckoutMethod = body?.method === "cod" ? "cod" : "online";

  // 0) Payment-method availability (toggled from /admin/settings).
  if (method === "cod" && !settings.codEnabled) {
    return badRequest("Cash on Delivery is currently unavailable. Please pay online.");
  }
  if (method === "online" && !settings.onlineEnabled) {
    return badRequest("Online payment is currently unavailable. Please choose Cash on Delivery.");
  }

  // 1) Customer details.
  const customerErrors = validateCustomer(body?.customer);
  if (customerErrors.length) return badRequest(customerErrors);

  // 2) Pincode serviceability (optional; allow-list/deny-list in config).
  if (!isPincodeServiceable(body.customer.pincode, cfg)) {
    return badRequest("Sorry, we don't deliver to that pincode yet.");
  }

  // 3) Cart — recompute everything from the D1 catalogue (price, stock, qty).
  const catalog = await loadCatalog(env);
  const cart = validateAndPriceCart(body?.items, catalog, cfg);
  if (!cart.ok) return badRequest(cart.errors);
  const { lines, totals } = cart;

  // 3c) Coupon (optional) — evaluated server-side against the recomputed subtotal.
  let discount = 0;
  let couponCode: string | undefined;
  const requestedCode =
    typeof body?.couponCode === "string" ? body.couponCode.trim() : "";
  if (requestedCode) {
    const coupon = await getCoupon(env, requestedCode);
    const check = evaluateCoupon(coupon, totals.subtotal);
    if (!check.ok) return badRequest(check.reason ?? "Invalid coupon.");
    discount = check.discount;
    couponCode = coupon!.code;
  }

  const grandTotal = Math.max(0, totals.subtotal - discount) + totals.shipping;

  // 4) COD guard rail.
  if (method === "cod" && !isCodAllowed(grandTotal, cfg)) {
    return badRequest(
      `Cash on Delivery isn't available above ₹${cfg.codMaxOrderValue.toLocaleString("en-IN")}. Please pay online.`,
    );
  }

  const orderRef = makeOrderRef();
  const baseOrder = {
    orderRef,
    method,
    subtotal: totals.subtotal,
    shipping: totals.shipping,
    total: grandTotal,
    currency: totals.currency,
    lines,
    customer: body.customer,
    couponCode,
    discount,
  };

  try {
    // ---------------- COD ----------------
    if (method === "cod") {
      await insertOrder(env, { ...baseOrder, status: "cod_pending" });
      await decrementStock(env, lines);
      if (couponCode) await incrementCouponUse(env, couponCode);
      // Fire owner notification (never blocks the response on failure).
      await notifyOwner(env, { ...baseOrder, status: "cod_pending" });
      return json({ ok: true, order_ref: orderRef, method: "cod" });
    }

    // ---------------- Online (Razorpay) ----------------
    const keys = await getPaymentKeys(env);
    const rzpOrder = await createRazorpayOrder(
      keys,
      toPaise(grandTotal),
      totals.currency,
      orderRef,
      { order_ref: orderRef },
    );

    await insertOrder(env, {
      ...baseOrder,
      status: "pending",
      razorpayOrderId: rzpOrder.id,
    });
    await decrementStock(env, lines);
    if (couponCode) await incrementCouponUse(env, couponCode);

    // Owner is notified only once payment is verified (see verify.ts).
    return json({
      ok: true,
      order_ref: orderRef,
      method: "online",
      razorpay_order_id: rzpOrder.id,
      razorpay_key_id: keys.keyId,
      amount: rzpOrder.amount, // paise
      currency: rzpOrder.currency,
    });
  } catch (err) {
    console.error("[create] error", err);
    return serverError("Could not place the order. Please try again.");
  }
};
