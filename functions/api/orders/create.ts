/**
 * POST /api/orders/create
 *
 * Validates the cart + customer SERVER-SIDE, recomputes every total from the
 * canonical catalogue, then either:
 *   - method "cod":    records a `cod_pending` order + notifies the owner.
 *   - method "online": records an `awaiting_payment` order — the customer's UPI
 *                      reference is a *claim*, not a payment, so the order holds
 *                      stock but is not a sale until the owner matches the money
 *                      in /admin. Nothing here tells the customer it is confirmed.
 *
 * The client's prices/totals are never trusted — only slugs + quantities.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { pricingFromEnv } from "../../_lib/env";
import { json, badRequest, serverError } from "../../_lib/http";
import { makeOrderRef } from "../../_lib/crypto";
import {
  insertOrder,
  findByUpiRef,
  countAwaitingByPhone,
  countRejectedByPhone,
  addPaymentProof,
  DuplicateUpiRefError,
} from "../../_lib/db";
import { notifyOwner, notifyCustomer, summariseOrderRow } from "../../_lib/email";
import { checkUpiRef, decodePaymentProof, formatUpiRef } from "../../_lib/upi";
import { sweepExpiredHolds } from "../../_lib/paymentHold";
import {
  getSettings,
  getCoupon,
  evaluateCoupon,
  incrementCouponUse,
  getUpi,
} from "../../_lib/settings";
import { loadCatalog, decrementStock } from "../../_lib/catalogDb";
import {
  validateAndPriceCart,
  validateCustomer,
  isCodAllowed,
  isPincodeServiceable,
} from "../../../src/lib/pricing";
import type { CreateOrderRequest, CheckoutMethod } from "../../../src/lib/types";

/** Migration 0008 adds the columns the verification flow reads and writes. */
function isMissingSchema(err: unknown): boolean {
  return /no such (column|table)/i.test(String(err));
}

/**
 * Nothing may escape as a raw 500: the browser can only parse JSON, so an
 * uncaught throw here reaches the customer as "something went wrong" with no
 * clue what broke. Every failure leaves through this wrapper as JSON.
 */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    return await createOrder(ctx);
  } catch (err) {
    console.error("[create] unhandled", err);
    if (isMissingSchema(err)) {
      return serverError(
        "Online payment is temporarily unavailable (the store database needs its " +
          "latest update). Please choose Cash on Delivery or contact us — " +
          "owner: run `npm run db:remote:0008`.",
      );
    }
    return serverError("Could not place the order. Please try again.");
  }
};

const createOrder: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
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

  // Always (re)compose the stored address from the structured fields server-side.
  body.customer.address = [body.customer.street, body.customer.landmark, body.customer.city]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");

  // 2) Pincode serviceability (optional; allow-list/deny-list in config).
  if (!isPincodeServiceable(body.customer.pincode, cfg)) {
    return badRequest("Sorry, we don't deliver to that pincode yet.");
  }

  /* ------------------------------------------------------------------ *
   * 2b) Manual-UPI gate. None of this proves the money arrived — only the
   * owner can do that. It exists to keep junk out of the verification
   * queue: a value that cannot be a UTR, a reference already claimed by
   * another order, or a customer opening unverified orders in bulk.
   * ------------------------------------------------------------------ */
  let upiRef = "";
  let proofBytes: ArrayBuffer | null = null;
  let proofMime = "";

  if (method === "online") {
    const upi = await getUpi(env);
    if (!upi.id) {
      return badRequest(
        "Online payment isn't set up yet. Please choose Cash on Delivery or contact us.",
      );
    }

    const refCheck = checkUpiRef((body as { upiRef?: string }).upiRef ?? "");
    if (!refCheck.ok) return badRequest(refCheck.reason!);
    upiRef = refCheck.ref;

    const claimed = await findByUpiRef(env, upiRef);
    if (claimed) {
      return badRequest(
        "That UPI reference has already been used for another order. " +
          "Please enter the reference for this payment, or contact us if you think this is a mistake.",
      );
    }

    // A customer with rejected payments behind them doesn't get to keep trying.
    if ((await countRejectedByPhone(env, body.customer.phone)) >= 3) {
      return badRequest(
        "We couldn't verify previous payments from this number. Please contact us before ordering again.",
      );
    }

    const open = await countAwaitingByPhone(
      env,
      body.customer.phone,
      settings.upiHoldHours,
    );
    if (open >= settings.upiMaxOpenPerPhone) {
      return badRequest(
        `You already have ${open} order${open === 1 ? "" : "s"} waiting for payment verification. ` +
          "Please wait until we've verified them, or choose Cash on Delivery.",
      );
    }

    const rawProof = (body as { paymentProof?: string }).paymentProof ?? "";
    if (rawProof) {
      const decoded = decodePaymentProof(rawProof);
      if (!decoded.ok) return badRequest(decoded.reason!);
      proofBytes = decoded.bytes;
      proofMime = decoded.mime;
    } else if (settings.upiProofRequired) {
      return badRequest(
        "Please attach the payment screenshot from your UPI app so we can verify your payment.",
      );
    }
  }

  // 2c) Free the stock held by unverified orders that ran out of time, so this
  // buyer can have it. Pages has no cron — the sweep rides on checkout traffic.
  // Telling those customers happens after the response, not in their way.
  const expired = await sweepExpiredHolds(env, settings.upiHoldHours);
  if (expired.length) {
    waitUntil(
      Promise.all(
        expired.map((o) => notifyCustomer(env, summariseOrderRow(o), "expired")),
      ),
    );
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
      const codOrder = { ...baseOrder, status: "cod_pending" as const, stockHeld: true };
      await insertOrder(env, codOrder);
      await decrementStock(env, lines);
      if (couponCode) await incrementCouponUse(env, couponCode);
      // Notifications never block the response on failure.
      await notifyOwner(env, codOrder);
      await notifyCustomer(env, codOrder, "cod");
      return json({
        ok: true,
        order_ref: orderRef,
        method: "cod",
        status: "cod_pending",
      });
    }

    // ---------------- Online (manual UPI) ----------------
    // The reference is recorded as an unverified CLAIM. The order holds stock
    // so the piece can't be sold twice, but it is not a sale and the customer
    // is not told it is confirmed until the owner matches the money in /admin.
    let paymentProofId: number | undefined;
    if (proofBytes) {
      paymentProofId = await addPaymentProof(env, orderRef, proofMime, proofBytes);
    }

    const onlineOrder = {
      ...baseOrder,
      status: "awaiting_payment" as const,
      notes: `Unverified UPI ref: ${formatUpiRef(upiRef)}`,
      upiRef,
      paymentProofId,
      stockHeld: true,
      hasProof: !!paymentProofId,
    };

    try {
      await insertOrder(env, onlineOrder);
    } catch (err) {
      if (err instanceof DuplicateUpiRefError) {
        return badRequest(
          "That UPI reference has already been used for another order. " +
            "Please enter the reference for this payment, or contact us if you think this is a mistake.",
        );
      }
      throw err;
    }

    await decrementStock(env, lines);
    // The coupon is only spent once the payment is verified — an unverified
    // order must not be able to burn a limited-use code.
    await notifyOwner(env, onlineOrder);
    await notifyCustomer(env, onlineOrder, "awaiting");

    return json({
      ok: true,
      order_ref: orderRef,
      method: "online",
      status: "awaiting_payment",
    });
  } catch (err) {
    console.error("[create] error", err);
    if (isMissingSchema(err)) throw err; // let the wrapper name the real cause
    return serverError("Could not place the order. Please try again.");
  }
};
