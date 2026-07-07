/**
 * Razorpay Orders API + signature verification (server-side only).
 * Keys are resolved by the caller via settings.getPaymentKeys() — admin-entered
 * values in D1 first, Cloudflare env secrets as fallback.
 */
import { hmacSha256Hex, safeEqual } from "./crypto";
import type { PaymentKeys } from "./settings";

const API = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** Create a Razorpay order. Amount must be in paise. */
export async function createRazorpayOrder(
  keys: PaymentKeys,
  amountPaise: number,
  currency: string,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  if (!keys.keyId || !keys.keySecret) {
    throw new Error("Razorpay keys are not configured (admin → Settings).");
  }
  const auth = btoa(`${keys.keyId}:${keys.keySecret}`);
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency,
      receipt,
      notes,
      payment_capture: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order creation failed (${res.status}): ${text}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/**
 * Verify a checkout success payload. The signature is
 * HMAC_SHA256(`${order_id}|${payment_id}`, key_secret).
 */
export async function verifyPaymentSignature(
  keys: PaymentKeys,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  if (!keys.keySecret) return false;
  const expected = await hmacSha256Hex(
    `${orderId}|${paymentId}`,
    keys.keySecret,
  );
  return safeEqual(expected, signature);
}

/** Verify a webhook body against X-Razorpay-Signature using the webhook secret. */
export async function verifyWebhookSignature(
  keys: PaymentKeys,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!keys.webhookSecret) return false;
  const expected = await hmacSha256Hex(rawBody, keys.webhookSecret);
  return safeEqual(expected, signature);
}
