/**
 * Store settings, coupons and product availability — all editable from /admin
 * without a redeploy. Backed by D1 (see migrations/0002_admin_features.sql).
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface StoreSettings {
  codEnabled: boolean;
  onlineEnabled: boolean;
  codMaxOrderValue: number;
  freeShippingThreshold: number;
  flatShippingFee: number;
}

const SETTING_DEFAULTS: StoreSettings = {
  codEnabled: true,
  onlineEnabled: true,
  codMaxOrderValue: 20000,
  freeShippingThreshold: 2500,
  flatShippingFee: 99,
};

export async function getSettings(env: Env): Promise<StoreSettings> {
  try {
    const res = await env.DB.prepare(`SELECT key, value FROM settings`).all<{
      key: string;
      value: string;
    }>();
    const map = new Map((res.results ?? []).map((r) => [r.key, r.value]));
    const num = (k: string, fallback: number) => {
      const n = Number(map.get(k));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    return {
      codEnabled: map.get("cod_enabled") !== "0",
      onlineEnabled: map.get("online_enabled") !== "0",
      codMaxOrderValue: num("cod_max_order_value", SETTING_DEFAULTS.codMaxOrderValue),
      freeShippingThreshold: num("free_shipping_threshold", SETTING_DEFAULTS.freeShippingThreshold),
      flatShippingFee: num("flat_shipping_fee", SETTING_DEFAULTS.flatShippingFee),
    };
  } catch {
    // Settings table missing (migration not applied) — fall back to defaults.
    return { ...SETTING_DEFAULTS };
  }
}

export async function saveSettings(env: Env, s: StoreSettings): Promise<void> {
  const rows: [string, string][] = [
    ["cod_enabled", s.codEnabled ? "1" : "0"],
    ["online_enabled", s.onlineEnabled ? "1" : "0"],
    ["cod_max_order_value", String(Math.max(0, Math.floor(s.codMaxOrderValue)))],
    ["free_shipping_threshold", String(Math.max(0, Math.floor(s.freeShippingThreshold)))],
    ["flat_shipping_fee", String(Math.max(0, Math.floor(s.flatShippingFee)))],
  ];
  const stmt = env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  await env.DB.batch(rows.map(([k, v]) => stmt.bind(k, v)));
}

/* ------------------------------------------------------------------ *
 * Product availability overrides
 * ------------------------------------------------------------------ */

export async function getDisabledSlugs(env: Env): Promise<Set<string>> {
  try {
    const res = await env.DB.prepare(
      `SELECT slug FROM product_overrides WHERE disabled = 1`,
    ).all<{ slug: string }>();
    return new Set((res.results ?? []).map((r) => r.slug));
  } catch {
    return new Set();
  }
}

export async function setProductDisabled(
  env: Env,
  slug: string,
  disabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO product_overrides (slug, disabled) VALUES (?, ?)
     ON CONFLICT(slug) DO UPDATE SET disabled = excluded.disabled`,
  )
    .bind(slug, disabled ? 1 : 0)
    .run();
}

/* ------------------------------------------------------------------ *
 * Coupons
 * ------------------------------------------------------------------ */

export interface Coupon {
  code: string;
  type: "percent" | "flat";
  value: number;
  min_order: number;
  active: number;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  created_at: string;
}

export async function listCoupons(env: Env): Promise<Coupon[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM coupons ORDER BY created_at DESC`,
  ).all<Coupon>();
  return res.results ?? [];
}

export async function getCoupon(env: Env, code: string): Promise<Coupon | null> {
  return env.DB.prepare(`SELECT * FROM coupons WHERE code = ?`)
    .bind(code.trim().toUpperCase())
    .first<Coupon>();
}

export async function createCoupon(
  env: Env,
  c: {
    code: string;
    type: "percent" | "flat";
    value: number;
    minOrder: number;
    expiresAt: string | null;
    maxUses: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO coupons (code, type, value, min_order, expires_at, max_uses)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(
      c.code.trim().toUpperCase(),
      c.type,
      Math.floor(c.value),
      Math.max(0, Math.floor(c.minOrder)),
      c.expiresAt,
      c.maxUses,
    )
    .run();
}

export async function setCouponActive(
  env: Env,
  code: string,
  active: boolean,
): Promise<void> {
  await env.DB.prepare(`UPDATE coupons SET active = ? WHERE code = ?`)
    .bind(active ? 1 : 0, code)
    .run();
}

export async function deleteCoupon(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM coupons WHERE code = ?`).bind(code).run();
}

export async function incrementCouponUse(env: Env, code: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`,
  )
    .bind(code)
    .run();
}

export interface CouponCheck {
  ok: boolean;
  discount: number;
  reason?: string;
}

/** Server-side coupon evaluation against a recomputed subtotal (₹). */
export function evaluateCoupon(c: Coupon | null, subtotal: number): CouponCheck {
  if (!c) return { ok: false, discount: 0, reason: "Invalid coupon code." };
  if (!c.active) return { ok: false, discount: 0, reason: "This coupon is no longer active." };
  if (c.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (today > c.expires_at)
      return { ok: false, discount: 0, reason: "This coupon has expired." };
  }
  if (c.max_uses !== null && c.used_count >= c.max_uses)
    return { ok: false, discount: 0, reason: "This coupon has been fully redeemed." };
  if (subtotal < c.min_order)
    return {
      ok: false,
      discount: 0,
      reason: `This coupon needs a minimum order of ₹${c.min_order.toLocaleString("en-IN")}.`,
    };

  const raw =
    c.type === "percent"
      ? Math.floor((subtotal * Math.min(Math.max(c.value, 0), 90)) / 100)
      : c.value;
  const discount = Math.max(0, Math.min(raw, subtotal));
  return { ok: true, discount };
}
