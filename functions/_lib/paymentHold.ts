/**
 * Stock held by unverified manual-UPI orders.
 *
 * An `awaiting_payment` order decrements stock so the piece cannot be sold
 * twice while the owner checks the money — but that hold is provisional. If the
 * payment is rejected, the order is cancelled, or the hold window lapses, the
 * units go straight back into the catalogue. `releaseStockHold` is the latch
 * that guarantees each order returns its units exactly once.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";
import {
  releaseStockHold,
  listExpiredAwaiting,
  expireAwaitingOrder,
  type OrderRow,
} from "./db";
import { restoreStock } from "./catalogDb";
import type { PricedLine } from "../../src/lib/types";

function linesOf(itemsJson: string): PricedLine[] {
  try {
    const parsed = JSON.parse(itemsJson);
    return Array.isArray(parsed) ? (parsed as PricedLine[]) : [];
  } catch {
    return [];
  }
}

/** Return this order's units to stock, at most once. */
export async function releaseOrderStock(env: Env, order: OrderRow): Promise<boolean> {
  if (!order.stock_held) return false;
  const released = await releaseStockHold(env, order.order_ref);
  if (!released) return false; // another request got there first
  await restoreStock(
    env,
    linesOf(order.items).map((l) => ({ slug: l.slug, qty: l.qty })),
  );
  return true;
}

/**
 * Cancel unverified orders past the hold window and free their stock.
 * Cloudflare Pages has no cron, so this runs lazily wherever it matters:
 * at checkout (so a real buyer can have the freed piece) and on the admin
 * dashboard. Returns the orders it cancelled, for notification.
 */
export async function sweepExpiredHolds(env: Env, holdHours: number): Promise<OrderRow[]> {
  let expired: OrderRow[] = [];
  try {
    expired = await listExpiredAwaiting(env, holdHours);
  } catch {
    return []; // migration 0008 not applied yet — never break checkout for this
  }

  const cancelled: OrderRow[] = [];
  for (const order of expired) {
    if (!(await expireAwaitingOrder(env, order.order_ref))) continue;
    await releaseOrderStock(env, order);
    cancelled.push(order);
  }
  return cancelled;
}
