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

const products = defineCollection({
  loader: async () => {
    try {
      const res = await fetch(`${CATALOG_API}/api/products`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const items = (await res.json()) as Array<{
        slug: string;
        images: { id: number; width: number; height: number }[];
        [k: string]: unknown;
      }>;
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
    } catch (err) {
      console.warn(
        `[products] WARNING: could not load catalogue from ${CATALOG_API} (${err}). Building with an empty catalogue.`,
      );
      return [];
    }
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
    try {
      const res = await fetch(`${CATALOG_API}/api/collections`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const items = (await res.json()) as Array<{ name: string; [k: string]: unknown }>;
      console.log(`[categories] loaded ${items.length} categories from ${CATALOG_API}`);
      return items.map((c) => ({ id: c.name, ...c }));
    } catch (err) {
      console.warn(
        `[categories] WARNING: could not load categories from ${CATALOG_API} (${err}). Building with flat filters.`,
      );
      return [];
    }
  },
  schema: z.object({
    name: z.string(),
    /** NULL for a main category; the main's name for a sub-category. */
    parent: z.string().nullable().default(null),
    /** 'direct' holds products; 'group' holds sub-categories. */
    kind: z.enum(["direct", "group"]).default("direct"),
    position: z.number().default(0),
    productCount: z.number().default(0),
  }),
});

export const collections = { products, categories };
