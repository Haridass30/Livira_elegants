import { defineCollection, z } from "astro:content";

/**
 * Product catalogue — loaded at BUILD TIME from the live store API
 * (/api/products, backed by D1). The owner manages products in /admin; the
 * "Publish site" button triggers a rebuild so these static pages refresh.
 *
 * CATALOG_API can override the source (e.g. for a staging store). If the API
 * is unreachable (very first build, offline dev), the build continues with an
 * empty catalogue rather than failing.
 */
const CATALOG_API =
  import.meta.env.CATALOG_API ??
  process.env.CATALOG_API ??
  "https://livira-store.pages.dev";

/**
 * Fetch JSON with a few retries. If the API is reachable and healthy we use its
 * data (even an empty list — that's a legitimately empty store). If it can't be
 * reached after retrying, we THROW: the build fails, and Cloudflare keeps the
 * previous good deployment live instead of publishing an empty shop.
 */
async function fetchJson<T>(url: string, label: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1)
      await new Promise((r) => setTimeout(r, 500 * (i + 1))); // 0.5s, 1s, 1.5s
  }
  throw new Error(
    `[${label}] Could not load ${url} after ${tries} attempts (${lastErr}). ` +
      `Aborting the build so the current live site is kept instead of publishing an empty page. ` +
      `Re-run "Publish site" once the store API is healthy.`,
  );
}

const products = defineCollection({
  loader: async () => {
    const items = await fetchJson<
      Array<{
        slug: string;
        images: { id: number; width: number; height: number }[];
        [k: string]: unknown;
      }>
    >(`${CATALOG_API}/api/products`, "products");
    console.log(`[products] loaded ${items.length} products from ${CATALOG_API}`);
    return items.map(({ slug, images, ...rest }) => ({
      id: slug,
      slug,
      ...rest,
      images: images.map((i) => ({
        url: `${CATALOG_API}/api/images/${i.id}`,
        width: i.width,
        height: i.height,
      })),
    }));
  },
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    /** Price in whole rupees (INR). */
    price: z.number().int().positive(),
    compareAtPrice: z.number().int().positive().nullable().optional(),
    category: z.string(),
    material: z.string(),
    weightGrams: z.number().positive().nullable().optional(),
    dimensions: z.string().nullable().optional(),
    /** Plain text; paragraphs split on blank lines. */
    description: z.string(),
    /** First image is the primary/hero shot. */
    images: z.array(
      z.object({
        url: z.string().url(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    ),
    inStock: z.boolean().default(true),
    stockQty: z.number().int().nullable().optional(),
    featured: z.boolean().default(false),
    sku: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

/**
 * Category tree — mains + sub-categories, loaded at BUILD TIME from
 * /api/collections (backed by D1). Drives the shop's two-level filters and the
 * homepage collection tiles. Falls back to empty on an unreachable API so the
 * storefront degrades to flat, product-derived filters rather than failing.
 */
const categories = defineCollection({
  loader: async () => {
    const items = await fetchJson<Array<{ name: string; [k: string]: unknown }>>(
      `${CATALOG_API}/api/collections`,
      "categories",
    );
    console.log(`[categories] loaded ${items.length} categories from ${CATALOG_API}`);
    return items.map((c) => ({ id: c.name, ...c }));
  },
  schema: z.object({
    name: z.string(),
    /** NULL for a main category; the main's name for a sub-category. */
    parent: z.string().nullable().default(null),
    position: z.number().default(0),
    productCount: z.number().default(0),
  }),
});

export const collections = { products, categories };
