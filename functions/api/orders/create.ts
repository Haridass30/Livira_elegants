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

  const cfg = pricingFromEnv(env);
  const method: CheckoutMethod = body?.method === "cod" ? "cod" : "online";

  // 1) Customer details.
  const customerErrors = validateCustomer(body?.customer);
  if (customerErrors.length) return badRequest(customerErrors);

  // 2) Pincode serviceability (optional; allow-list/deny-list in config).
  if (!isPincodeServiceable(body.customer.pincode, cfg)) {
    return badRequest("Sorry, we don't deliver to that pincode yet.");
  }

  // 3) Cart — recompute everything from the catalogue.
  const cart = validateAndPriceCart(body?.items, cfg);
  if (!cart.ok) return badRequest(cart.errors);
  const { lines, totals } = cart;

  // 4) COD guard rail.
  if (method === "cod" && !isCodAllowed(totals.total, cfg)) {
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
    total: totals.total,
    currency: totals.currency,
    lines,
    customer: body.customer,
  };

  try {
    // ---------------- COD ----------------
    if (method === "cod") {
      await insertOrder(env, { ...baseOrder, status: "cod_pending" });
      // Fire owner notification (never blocks the response on failure).
      await notifyOwner(env, { ...baseOrder, status: "cod_pending" });
      return json({ ok: true, order_ref: orderRef, method: "cod" });
    }

    // ---------------- Online (Razorpay) ----------------
    const rzpOrder = await createRazorpayOrder(
      env,
      toPaise(totals.total),
      totals.currency,
      orderRef,
      { order_ref: orderRef },
    );

    await insertOrder(env, {
      ...baseOrder,
      status: "pending",
      razorpayOrderId: rzpOrder.id,
    });

    // Owner is notified only once payment is verified (see verify.ts).
    return json({
      ok: true,
      order_ref: orderRef,
      method: "online",
      razorpay_order_id: rzpOrder.id,
      razorpay_key_id: env.RAZORPAY_KEY_ID,
      amount: rzpOrder.amount, // paise
      currency: rzpOrder.currency,
    });
  } catch (err) {
    console.error("[create] error", err);
    return serverError("Could not place the order. Please try again.");
  }
};
