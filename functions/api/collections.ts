/**
 * GET /api/collections — public category tree (mains + sub-categories).
 *
 * Consumed by the Astro build (content loader) so the shop and homepage can
 * render two-level category filters/tiles. Category data is public.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { json } from "../_lib/http";
import { listCollections } from "../_lib/catalogDb";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const cols = await listCollections(env);
  const hiddenMains = new Set(cols.filter((c) => !c.parent && c.hidden).map((c) => c.name));
  const visible = cols.filter((c) => !c.hidden && !(c.parent && hiddenMains.has(c.parent)));
  const payload = visible.map((c) => ({
    name: c.name,
    parent: c.parent,
    position: c.position,
    productCount: c.product_count ?? 0,
    imageId: c.image_id ?? null,
  }));
  return json(payload, 200, { "Cache-Control": "no-store" });
};
