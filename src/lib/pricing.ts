/**
 * Server-authoritative pricing & cart validation.
 *
 * This module is imported by the Cloudflare Pages Functions. It NEVER reads a
 * price, total or stock flag from the client — every figure is recomputed from
 * the canonical catalogue (loaded from D1 by the caller). The client may send
 * only slugs and quantities; anything else is ignored.
 */
import type {
  OrderItemInput,
  PricedLine,
  OrderTotals,
  CustomerInput,
} from "./types";

/** Canonical product data used for pricing (loaded from D1). */
export interface CatalogProduct {
  slug: string;
  name: string;
  /** Whole rupees (INR). */
  price: number;
  category: string;
  inStock: boolean;
  /** null/undefined = stock not tracked. */
  stockQty?: number | null;
  sku?: string;
}

export interface PricingConfig {
  currency: string;
  freeShippingThreshold: number;
  flatShippingFee: number;
  codMaxOrderValue: number;
  /** Allow-list; if non-empty only these pincodes are serviceable. */
  serviceablePincodes?: string[];
  /** Deny-list; used only when the allow-list is empty. */
  blockedPincodes?: string[];
}

/** Sensible defaults; functions override from env/D1 settings. */
export const DEFAULT_PRICING: PricingConfig = {
  currency: "INR",
  freeShippingThreshold: 2500,
  flatShippingFee: 99,
  codMaxOrderValue: 20000,
  serviceablePincodes: [],
  blockedPincodes: [],
};

export interface CartValidation {
  ok: boolean;
  errors: string[];
  lines: PricedLine[];
  totals: OrderTotals;
}

const MAX_QTY_PER_LINE = 20;

/** Validate a raw client cart and recompute every figure from the catalogue. */
export function validateAndPriceCart(
  rawItems: unknown,
  catalog: Record<string, CatalogProduct>,
  cfg: PricingConfig = DEFAULT_PRICING,
): CartValidation {
  const errors: string[] = [];
  const lines: PricedLine[] = [];

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return emptyResult(["Cart is empty."], cfg);
  }

  // Collapse duplicate slugs so a client can't split a line to dodge caps.
  const qtyBySlug = new Map<string, number>();
  for (const raw of rawItems as OrderItemInput[]) {
    const slug = typeof raw?.slug === "string" ? raw.slug : "";
    const qty = Number.isInteger(raw?.qty) ? Number(raw.qty) : NaN;
    if (!slug) {
      errors.push("An item is missing its product reference.");
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Invalid quantity for "${slug}".`);
      continue;
    }
    qtyBySlug.set(slug, (qtyBySlug.get(slug) ?? 0) + qty);
  }

  for (const [slug, rawQty] of qtyBySlug) {
    const product = catalog[slug];
    if (!product) {
      errors.push(`Product no longer available: "${slug}".`);
      continue;
    }
    if (!product.inStock) {
      errors.push(`"${product.name}" is out of stock.`);
      continue;
    }
    let qty = Math.min(rawQty, MAX_QTY_PER_LINE);
    // Tracked stock: cap at what's actually available.
    if (product.stockQty !== null && product.stockQty !== undefined) {
      if (product.stockQty <= 0) {
        errors.push(`"${product.name}" is out of stock.`);
        continue;
      }
      if (qty > product.stockQty) {
        errors.push(
          `Only ${product.stockQty} left of "${product.name}" — please reduce the quantity.`,
        );
        continue;
      }
    }
    lines.push({
      slug,
      name: product.name,
      unitPrice: product.price,
      qty,
      lineTotal: product.price * qty,
      sku: product.sku,
    });
  }

  if (lines.length === 0 && errors.length === 0) {
    errors.push("Cart is empty.");
  }

  const totals = computeTotals(lines, cfg);
  return { ok: errors.length === 0 && lines.length > 0, errors, lines, totals };
}

export function computeTotals(
  lines: PricedLine[],
  cfg: PricingConfig = DEFAULT_PRICING,
): OrderTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping =
    subtotal === 0 || subtotal >= cfg.freeShippingThreshold
      ? 0
      : cfg.flatShippingFee;
  return {
    subtotal,
    shipping,
    total: subtotal + shipping,
    currency: cfg.currency,
  };
}

/** COD guard rail: blocked above the configured order-value cap. */
export function isCodAllowed(total: number, cfg: PricingConfig): boolean {
  return total <= cfg.codMaxOrderValue;
}

/** Optional pincode serviceability (allow-list wins; else deny-list). */
export function isPincodeServiceable(
  pincode: string,
  cfg: PricingConfig,
): boolean {
  const allow = cfg.serviceablePincodes ?? [];
  const block = cfg.blockedPincodes ?? [];
  if (allow.length > 0) return allow.includes(pincode);
  return !block.includes(pincode);
}

/** Validate customer details. Returns a list of human-readable errors. */
export function validateCustomer(c: unknown): string[] {
  const errors: string[] = [];
  const cust = (c ?? {}) as Partial<CustomerInput>;
  if (!cust.name || cust.name.trim().length < 2)
    errors.push("Please enter a valid name.");
  if (!cust.phone || !/^[0-9]{10}$/.test(String(cust.phone).replace(/\D/g, "").slice(-10)))
    errors.push("Please enter a valid 10-digit phone number.");
  if (!cust.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cust.email))
    errors.push("Please enter a valid email address.");
  if (!cust.address || cust.address.trim().length < 8)
    errors.push("Please enter your full delivery address.");
  if (!cust.pincode || !/^[1-9][0-9]{5}$/.test(String(cust.pincode)))
    errors.push("Please enter a valid 6-digit pincode.");
  return errors;
}

function emptyResult(errors: string[], cfg: PricingConfig): CartValidation {
  return {
    ok: false,
    errors,
    lines: [],
    totals: { subtotal: 0, shipping: 0, total: 0, currency: cfg.currency },
  };
}
