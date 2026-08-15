/**
 * GET /product/<slug> — serve the static page when it exists, otherwise render
 * the product live from D1.
 *
 * Products are added in /admin (D1) but the product pages are generated at
 * build time, so a newly added product is linked from the live shop grid while
 * its page does not exist yet — a 404 until the owner hits "Publish site".
 * This function closes that window: it forwards to the static asset first and
 * only renders when the asset server has nothing, so published pages keep
 * their static performance and this path costs nothing for them.
 *
 * A catch-all ([[path]]) rather than [slug] so both /product/x and /product/x/
 * are covered.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import {
  effectiveInStock,
  getProduct,
  hiddenCategoryNames,
  listAllImages,
  listProducts,
  type ImageMeta,
  type ProductRow,
} from "../_lib/catalogDb";
import { loadShell, renderProductPage } from "../_lib/productPage";

const RELATED_COUNT = 4;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // Static page (or its trailing-slash redirect) always wins.
  const asset = await ctx.next();
  if (asset.status !== 404) return asset;

  const url = new URL(ctx.request.url);
  const segments = url.pathname.split("/").filter(Boolean); // ["product", slug]
  if (segments.length !== 2) return asset;

  let slug: string;
  try {
    slug = decodeURIComponent(segments[1]);
  } catch {
    return asset;
  }

  try {
    const product = await getProduct(ctx.env, slug);
    if (!product || product.active !== 1) return asset;

    const hidden = await hiddenCategoryNames(ctx.env);
    if (hidden.has(product.category)) return asset;

    const [allImages, allProducts] = await Promise.all([
      listAllImages(ctx.env),
      listProducts(ctx.env),
    ]);

    const imagesBySlug = new Map<string, ImageMeta[]>();
    for (const img of allImages) {
      const arr = imagesBySlug.get(img.product_slug) ?? [];
      arr.push(img);
      imagesBySlug.set(img.product_slug, arr);
    }

    const shell = await loadShell(
      ctx.env,
      url,
      allProducts.map((p) => p.slug).filter((s) => s !== slug),
    );
    if (!shell) {
      console.error("[product] no built product page to use as a shell");
      return asset;
    }

    // Same-category pieces first, topped up with the rest of the catalogue.
    const pool = allProducts.filter(
      (p) => p.slug !== slug && !hidden.has(p.category),
    );
    const sameCategory = pool.filter((p) => p.category === product.category);
    const related = [
      ...sameCategory,
      ...pool.filter((p) => p.category !== product.category),
    ]
      .slice(0, RELATED_COUNT)
      .map((p: ProductRow) => ({
        product: p,
        images: imagesBySlug.get(p.slug) ?? [],
        inStock: effectiveInStock(p),
      }));

    const html = renderProductPage(
      shell,
      {
        product,
        images: imagesBySlug.get(slug) ?? [],
        inStock: effectiveInStock(product),
        related,
      },
      url.origin,
    );

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Live catalogue data — never cache, the static page takes over on the
        // next publish anyway.
        "Cache-Control": "no-store",
        "X-Livira-Render": "live-fallback",
      },
    });
  } catch (e) {
    console.error("[product] live render failed", e);
    return asset;
  }
};
