/// <reference types="@cloudflare/workers-types" />
import type { PricingConfig } from "../../src/lib/pricing";

/** Bindings + vars available to every Pages Function (see wrangler.toml). */
export interface Env {
  /** D1 database binding. */
  DB: D1Database;

  /** Public Razorpay key id (also exposed to the client). */
  RAZORPAY_KEY_ID: string;
  /** SECRET — server only. Never sent to the browser. */
  RAZORPAY_KEY_SECRET: string;
  /** SECRET — only if webhooks are enabled. */
  RAZORPAY_WEBHOOK_SECRET?: string;

  /** SECRET — Resend API key for owner notifications (optional). */
  RESEND_API_KEY?: string;
  OWNER_EMAIL?: string;
  FROM_EMAIL?: string;

  COD_MAX_ORDER_VALUE?: string;
  CURRENCY?: string;

  /** SECRET — password for the /admin dashboard. */
  ADMIN_PASSWORD?: string;
  /** SECRET — random string used to sign admin session cookies. */
  ADMIN_SESSION_SECRET?: string;
}

/** Build the authoritative pricing config from env (mirrors src/config.ts). */
export function pricingFromEnv(env: Env): PricingConfig {
  return {
    currency: env.CURRENCY || "INR",
    freeShippingThreshold: 2500,
    flatShippingFee: 99,
    codMaxOrderValue: Number(env.COD_MAX_ORDER_VALUE ?? "20000") || 20000,
    // TODO(owner): populate these to enable pincode serviceability checks.
    serviceablePincodes: [],
    blockedPincodes: [],
  };
}
