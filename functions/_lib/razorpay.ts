/** Razorpay Orders API + signature verification (server-side only). */
import type { Env } from "./env";
import { hmacSha256Hex, safeEqual } from "./crypto";

const API = "https://api.razorpay.com/v1";

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** Create a Razorpay order. Amount must be in paise. */
export async function createRazorpayOrder(
  env: Env,
  amountPaise: number,
  currency: string,
  receipt: string,
  notes: Record<string, string>,
): Promise<RazorpayOrder> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
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
  env: Env,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(
    `${orderId}|${paymentId}`,
    env.RAZORPAY_KEY_SECRET,
  );
  return safeEqual(expected, signature);
}

/** Verify a webhook body against X-Razorpay-Signature using the webhook secret. */
export async function verifyWebhookSignature(
  env: Env,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = await hmacSha256Hex(rawBody, env.RAZORPAY_WEBHOOK_SECRET);
  return safeEqual(expected, signature);
}
