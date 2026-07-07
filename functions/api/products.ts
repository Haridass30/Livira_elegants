/**
 * GET /api/products — public product catalogue (active products only).
 *
 * Consumed by:
 *  - the Astro build (content loader) to generate the static shop pages,
 *  - anything else that needs live product data.
 * Product data is public by nature; no auth needed.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { json } from "../_lib/http";
import {
  listProducts,
  listAllImages,
  effectiveInStock,
} from "../_lib/catalogDb";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [products, images] = await Promise.all([
    listProducts(env),
    listAllImages(env),
  ]);

  const imagesBySlug = new Map<string, typeof images>();
  for (const img of images) {
    const arr = imagesBySlug.get(img.product_slug) ?? [];
    arr.push(img);
    imagesBySlug.set(img.product_slug, arr);
  }

  const payload = products.map((p) => ({
    slug: p.slug,
    name: p.name,
    price: p.price,
    compareAtPrice: p.compare_at_price,
    category: p.category,
    material: p.material,
    weightGrams: p.weight_grams,
    dimensions: p.dimensions,
    description: p.description,
    inStock: effectiveInStock(p),
    stockQty: p.stock_qty,
    featured: p.featured === 1,
    sku: p.sku,
    tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    images: (imagesBySlug.get(p.slug) ?? []).map((i) => ({
      id: i.id,
      width: i.width,
      height: i.height,
    })),
  }));

  return json(payload, 200, { "Cache-Control": "no-store" });
};
