/**
 * Cart state — nanostores + persistent (localStorage), shared across every
 * React island and survives reloads. Display only: the server always re-prices.
 */
import { persistentAtom } from "@nanostores/persistent";
import { atom, computed } from "nanostores";
import type { CartLine } from "../lib/types";

/** Persisted cart lines. JSON-encoded under the `livira:cart` key. */
export const $cart = persistentAtom<CartLine[]>("livira:cart", [], {
  encode: JSON.stringify,
  decode: JSON.parse,
});

/** Drawer open/closed (not persisted). */
export const $cartOpen = atom(false);

export const $cartCount = computed($cart, (lines) =>
  lines.reduce((n, l) => n + l.qty, 0),
);

export const $cartSubtotal = computed($cart, (lines) =>
  lines.reduce((sum, l) => sum + l.price * l.qty, 0),
);

const MAX_QTY = 20;

export function addToCart(line: Omit<CartLine, "qty">, qty = 1) {
  const lines = [...$cart.get()];
  const existing = lines.find((l) => l.slug === line.slug);
  if (existing) {
    existing.qty = Math.min(MAX_QTY, existing.qty + qty);
  } else {
    lines.push({ ...line, qty: Math.min(MAX_QTY, qty) });
  }
  $cart.set(lines);
  $cartOpen.set(true);
}

export function setQty(slug: string, qty: number) {
  const clamped = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
  if (clamped === 0) return removeFromCart(slug);
  $cart.set($cart.get().map((l) => (l.slug === slug ? { ...l, qty: clamped } : l)));
}

export function removeFromCart(slug: string) {
  $cart.set($cart.get().filter((l) => l.slug !== slug));
}

export function clearCart() {
  $cart.set([]);
}

export function openCart() {
  $cartOpen.set(true);
}

export function closeCart() {
  $cartOpen.set(false);
}
