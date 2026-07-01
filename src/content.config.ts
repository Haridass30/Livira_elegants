import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Product catalogue — local JSON, zod-validated, no CMS.
 *
 * These JSON files are the single source of truth for product display.
 * Pricing/stock used by the order Functions is mirrored in src/lib/catalog.ts
 * (which imports the very same JSON), so the server never trusts the client.
 *
 * The collection entry `id` (the filename without extension) is the slug.
 */
const products = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/products" }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      /** Price in whole rupees (INR). */
      price: z.number().int().positive(),
      /** Optional struck-through "was" price, in whole rupees. */
      compareAtPrice: z.number().int().positive().optional(),
      category: z.enum(["Rings", "Necklaces", "Earrings", "Bangles"]),
      material: z.string(),
      weightGrams: z.number().positive().optional(),
      dimensions: z.string().optional(),
      /** Short markdown-ish description; paragraphs split on blank lines. */
      description: z.string(),
      /** First image is the primary/hero shot. Paths relative to this file. */
      images: z.array(image()).min(1),
      inStock: z.boolean().default(true),
      featured: z.boolean().default(false),
      sku: z.string().optional(),
      tags: z.array(z.string()).default([]),
    }),
});

export const collections = { products };
