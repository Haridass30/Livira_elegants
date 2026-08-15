/**
 * Live product-page renderer — the fallback behind /product/<slug>.
 *
 * The storefront is statically built: `src/pages/product/[slug].astro` only
 * emits pages for the products that existed at build time. The shop grid, by
 * contrast, renders from live D1 (/api/products), so any product added in
 * /admin is linked from the grid but has no page until the next publish.
 *
 * Rather than duplicating the layout, this module takes an already-built
 * product page as a SHELL — head, header, footer, cart drawer, hashed CSS and
 * island scripts all come from it — and swaps in the new product's <main>,
 * <head> metadata and AddToBag island props. The page is therefore always in
 * sync with the current design; only the data is injected.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";
import type { ImageMeta, ProductRow } from "./catalogDb";

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Mirrors src/lib/format.ts — ₹12,499, Indian digit grouping, no paise. */
export const formatINR = (rupees: number): string => inr.format(rupees);

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* ------------------------------------------------------------------ *
 * Shell — an existing static product page, reused as the page chrome
 * ------------------------------------------------------------------ */

export interface Shell {
  html: string;
  /** The opening <astro-island> tag of the AddToBag island. */
  islandOpen: string;
  /** Origin the static pages were built with (from <link rel="canonical">). */
  siteOrigin: string;
}

/**
 * Cached per isolate. Isolates do not survive a deployment, so the cache is
 * implicitly invalidated whenever a new build goes live — which is exactly
 * when the shell's hashed asset URLs change.
 */
let shellCache: Shell | null = null;

const asset = (env: Env, base: URL, path: string) =>
  env.ASSETS.fetch(new Request(new URL(path, base).href));

/** Pull the first /product/<slug>/ URL out of the built sitemap. */
async function shellPathFromSitemap(env: Env, base: URL): Promise<string | null> {
  const res = await asset(env, base, "/sitemap-0.xml");
  if (!res.ok) return null;
  const xml = await res.text();
  const m = xml.match(/<loc>\s*[^<]*?(\/product\/[^<\s]+?)\s*<\/loc>/);
  return m ? m[1] : null;
}

function parseShell(html: string): Shell | null {
  // Must have the pieces we splice into, or it is not a usable product shell.
  const island = html.match(/<astro-island\b[^>]*AddToBag[^>]*>/);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!island || !canonical || !/<main\b[^>]*>/.test(html)) return null;
  let siteOrigin: string;
  try {
    siteOrigin = new URL(canonical[1]).origin;
  } catch {
    return null;
  }
  return { html, islandOpen: island[0], siteOrigin };
}

/**
 * Load a built product page to use as the shell. Tries the sitemap first, then
 * falls back to probing a handful of known slugs (a sitemap can be filtered or
 * missing). Returns null when the site has no built product page at all — the
 * caller then leaves the original 404 alone.
 */
export async function loadShell(
  env: Env,
  base: URL,
  probeSlugs: string[],
): Promise<Shell | null> {
  if (shellCache) return shellCache;

  const candidates: string[] = [];
  const fromSitemap = await shellPathFromSitemap(env, base).catch(() => null);
  if (fromSitemap) candidates.push(fromSitemap);
  for (const slug of probeSlugs.slice(0, 8)) {
    candidates.push(`/product/${encodeURIComponent(slug)}/`);
  }

  for (const path of candidates) {
    const res = await asset(env, base, path).catch(() => null);
    if (!res || !res.ok) continue;
    const parsed = parseShell(await res.text());
    if (parsed) {
      shellCache = parsed;
      return parsed;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Astro island props
 * ------------------------------------------------------------------ */

/**
 * Astro serialises island props as [type, value] tuples, recursively for plain
 * objects — `{"inStock":[0,true],"product":[0,{"slug":[0,"…"]}]}`. Type 0 is a
 * plain JSON value, which is all AddToBag takes.
 */
function wrap(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = wrap(val);
    }
    return [0, out];
  }
  return [0, v];
}

function encodeProps(props: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k] = wrap(v);
  return JSON.stringify(out);
}

/* ------------------------------------------------------------------ *
 * Markup
 * ------------------------------------------------------------------ */

interface RenderImage {
  url: string;
  width: number;
  height: number;
}

function galleryHTML(images: RenderImage[], name: string): string {
  if (!images.length) {
    return `<div class="card-lux rounded-[2px]" style="aspect-ratio:4 / 5;"></div>`;
  }
  const img = (
    src: RenderImage,
    i: number,
    cls: string,
    alt: string,
    eager: boolean,
  ) =>
    `<img src="${esc(src.url)}" width="${src.width}" height="${src.height}" alt="${esc(alt)}"${
      alt ? "" : ' aria-hidden="true"'
    } loading="${eager ? "eager" : "lazy"}" fetchpriority="${
      eager ? "high" : "auto"
    }" class="${cls}">`;

  const mobile = images
    .map(
      (im, i) =>
        `<div class="w-[85%] shrink-0 snap-center first:ml-0">${img(
          im,
          i,
          "aspect-[4/5] w-full rounded-[2px] object-cover",
          `${name} — view ${i + 1}`,
          i === 0,
        )}</div>`,
    )
    .join("");

  const thumbs = images
    .map(
      (im, i) =>
        `<button type="button" data-thumb="${i}" role="tab" aria-selected="${
          i === 0 ? "true" : "false"
        }" aria-label="Show view ${i + 1}" class="overflow-hidden rounded-[2px] border transition-colors aria-[selected=true]:border-champagne border-charcoal/15">${img(
          im,
          i,
          "aspect-[4/5] w-full object-cover",
          "",
          false,
        )}</button>`,
    )
    .join("");

  const mains = images
    .map(
      (im, i) =>
        `<div data-main="${i}" class="${i === 0 ? "" : "hidden"}">${img(
          im,
          i,
          "aspect-[4/5] w-full rounded-[2px] object-cover",
          `${name} — view ${i + 1}`,
          i === 0,
        )}</div>`,
    )
    .join("");

  // Same DOM contract as src/components/Gallery.astro, so the shell's already
  // loaded gallery script wires the thumbnails up without any extra JS here.
  return `<div class="gallery" data-gallery>
  <div class="flex snap-x snap-mandatory gap-3 overflow-x-auto md:hidden [scrollbar-width:none] [-ms-overflow-style:none]" style="scroll-padding:0">${mobile}</div>
  <div class="hidden gap-4 md:grid md:grid-cols-[84px_1fr]">
    <div class="flex flex-col gap-3" role="tablist" aria-label="${esc(name)} images">${thumbs}</div>
    <div class="relative">${mains}</div>
  </div>
</div>`;
}

function cardHTML(p: ProductRow, images: ImageMeta[], inStock: boolean): string {
  const onSale = p.compare_at_price !== null && p.compare_at_price > p.price;
  const discount = onSale
    ? Math.round(((p.compare_at_price! - p.price) / p.compare_at_price!) * 100)
    : 0;
  const shot = images[0];
  const hover = images[1];
  const pic = (im: ImageMeta, cls: string, alt: string) =>
    `<img src="/api/images/${im.id}" width="${im.width}" height="${im.height}" alt="${esc(
      alt,
    )}"${alt ? "" : ' aria-hidden="true"'} loading="lazy" class="${cls}">`;

  return `<a href="/product/${encodeURIComponent(p.slug)}" class="group block" aria-label="${esc(
    `${p.name}, ${formatINR(p.price)}`,
  )}">
  <div class="card-lux relative overflow-hidden rounded-[3px]" style="aspect-ratio: 4 / 5;">
    ${
      shot
        ? pic(
            shot,
            `h-full w-full object-cover transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.05]${
              hover ? " group-hover:opacity-0" : ""
            }`,
            p.name,
          )
        : ""
    }
    ${
      hover
        ? pic(
            hover,
            "absolute inset-0 h-full w-full scale-[1.05] object-cover opacity-0 transition-opacity duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:opacity-100",
            "",
          )
        : ""
    }
    ${onSale && inStock ? `<span class="pill absolute left-3 top-3">−${discount}%</span>` : ""}
    ${!inStock ? `<span class="pill absolute left-3 top-3 !text-charcoal/80">Sold out</span>` : ""}
    <div class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-[#150b10]/75 to-transparent pb-4 pt-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
      <span class="text-[11px] uppercase tracking-[0.22em] text-champagne-soft">View piece →</span>
    </div>
  </div>
  <div class="pt-4 text-center">
    <p class="text-[10px] uppercase tracking-[0.2em] text-champagne/70">${esc(p.category)}</p>
    <h3 class="mt-1.5 font-serif text-lg leading-snug transition-colors group-hover:text-ink">${esc(p.name)}</h3>
    <p class="mt-1.5 flex items-baseline justify-center gap-2 text-sm">
      <span class="text-champagne">${formatINR(p.price)}</span>
      ${
        onSale
          ? `<span class="text-charcoal/40 line-through">${formatINR(p.compare_at_price!)}</span>`
          : ""
      }
    </p>
  </div>
</a>`;
}

const TRUST_BADGES = [
  {
    label: `Free shipping over ${formatINR(2500)}`,
    svg: `<path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="7" cy="17" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="17.5" cy="17" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  },
  {
    label: "Hallmarked metals",
    svg: `<circle cx="12" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 15.5 8 22l4-2 4 2-1-6.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
  },
  {
    label: "14-day returns",
    svg: `<path d="M4 12a8 8 0 1 1 2.5 5.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 8v4h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

/* ------------------------------------------------------------------ *
 * Page assembly
 * ------------------------------------------------------------------ */

export interface RenderInput {
  product: ProductRow;
  images: ImageMeta[];
  inStock: boolean;
  /** Already ordered: same-category first, then the rest. Max 4 used. */
  related: { product: ProductRow; images: ImageMeta[]; inStock: boolean }[];
}

export function renderProductPage(
  shell: Shell,
  input: RenderInput,
  requestOrigin: string,
): string {
  const { product: p, images, inStock, related } = input;
  const onSale = p.compare_at_price !== null && p.compare_at_price > p.price;
  const paragraphs = p.description.split(/\n\s*\n/).filter(Boolean);
  const galleryImages: RenderImage[] = images.map((i) => ({
    url: `/api/images/${i.id}`,
    width: i.width,
    height: i.height,
  }));

  // OG/JSON-LD images point at the live request origin so they actually
  // resolve; the canonical keeps the built site's origin for consistency with
  // the static pages.
  const ogImage = images[0]
    ? `${requestOrigin}/api/images/${images[0].id}`
    : `${requestOrigin}/og-default.jpg`;
  const canonical = `${shell.siteOrigin}/product/${encodeURIComponent(p.slug)}/`;
  const title = `${p.name} · Livira Elegants`;
  const description = paragraphs[0] ?? p.material;

  const specs: [string, string][] = [
    ["Material", p.material],
    ...(p.weight_grams ? ([["Weight", `${p.weight_grams} g`]] as [string, string][]) : []),
    ...(p.dimensions ? ([["Dimensions", p.dimensions]] as [string, string][]) : []),
    ...(p.sku ? ([["SKU", p.sku]] as [string, string][]) : []),
  ];

  const island =
    shell.islandOpen.replace(
      /props="[^"]*"/,
      `props="${esc(
        encodeProps({
          inStock,
          product: {
            slug: p.slug,
            name: p.name,
            price: p.price,
            image: images[0] ? `/api/images/${images[0].id}` : "/og-default.jpg",
          },
        }),
      )}"`,
    ) +
    (inStock
      ? `<div class="flex flex-col gap-3 sm:flex-row"><div class="flex items-center justify-between border hairline sm:w-32"><button type="button" aria-label="Decrease quantity" class="flex h-12 w-12 items-center justify-center text-lg text-charcoal/70 hover:text-charcoal">–</button><span class="text-sm" aria-live="polite">1</span><button type="button" aria-label="Increase quantity" class="flex h-12 w-12 items-center justify-center text-lg text-charcoal/70 hover:text-charcoal">+</button></div><button type="button" class="btn btn-primary flex-1">Add to bag</button></div>`
      : `<button type="button" disabled class="btn btn-primary w-full">Sold out</button>`) +
    `<!--astro:end--></astro-island>`;

  const body = `<section class="container-page py-10 md:py-14">
  <nav class="mb-8 text-xs uppercase tracking-[0.12em] text-charcoal/50">
    <a href="/shop" class="link-underline">Shop</a>
    <span class="px-2">/</span>
    <a href="/shop?category=${encodeURIComponent(p.category)}" class="link-underline">${esc(p.category)}</a>
  </nav>

  <div class="grid gap-8 lg:grid-cols-2 lg:gap-16">
    ${galleryHTML(galleryImages, p.name)}

    <div class="lg:pt-4">
      <p class="eyebrow flex items-center gap-2"><span class="gem-mark">◆</span> ${esc(p.category)}</p>
      <h1 class="mt-3 font-serif text-3xl leading-tight md:text-4xl">${esc(p.name)}</h1>

      <div class="mt-3 h-px w-16 gold-rule" aria-hidden="true"></div>

      <div class="mt-5 flex items-baseline gap-3">
        <span class="text-2xl text-champagne">${formatINR(p.price)}</span>
        ${
          onSale
            ? `<span class="text-lg text-charcoal/40 line-through">${formatINR(p.compare_at_price!)}</span>`
            : ""
        }
      </div>
      <p class="mt-1 text-xs text-charcoal/50">Inclusive of all taxes (GST)</p>

      <div class="mt-8 space-y-4 text-[0.97rem] leading-relaxed text-charcoal/80">
        ${paragraphs.map((para) => `<p>${esc(para)}</p>`).join("")}
      </div>

      <div class="mt-8">
        ${island}
        ${
          !inStock
            ? `<p class="mt-3 text-sm text-charcoal/55">This piece is currently sold out. <a href="/contact" class="link-underline text-champagne">Ask about a waitlist</a>.</p>`
            : ""
        }
      </div>

      <dl class="mt-10 divide-y divide-charcoal/10 border-y hairline text-sm">
        ${specs
          .map(
            ([label, value]) =>
              `<div class="flex justify-between gap-6 py-3"><dt class="text-charcoal/55">${esc(
                label,
              )}</dt><dd class="text-right text-charcoal/85">${esc(value)}</dd></div>`,
          )
          .join("")}
      </dl>

      <div class="mt-10 grid grid-cols-3 gap-4 border-t hairline pt-8 text-center">
        ${TRUST_BADGES.map(
          (f) =>
            `<div class="flex flex-col items-center gap-2"><span class="text-champagne" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24">${f.svg}</svg></span><span class="text-[10px] uppercase leading-tight tracking-[0.1em] text-charcoal/60">${esc(
              f.label,
            )}</span></div>`,
        ).join("")}
      </div>
    </div>
  </div>
</section>
${
  related.length
    ? `<section class="container-page py-14 md:py-20">
  <div class="mb-10 text-center md:mb-12">
    <p class="eyebrow flex items-center justify-center gap-2"><span class="gem-mark">◆</span> Pairs beautifully</p>
    <h2 class="mt-2 font-serif text-2xl md:text-3xl">You may also like</h2>
  </div>
  <div class="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12 md:grid-cols-4 md:gap-x-8">
    ${related.map((r) => cardHTML(r.product, r.images, r.inStock)).join("")}
  </div>
</section>`
    : ""
}`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: ogImage,
    description: p.description.replace(/\n+/g, " ").slice(0, 300),
    ...(p.sku ? { sku: p.sku } : {}),
    category: p.category,
    brand: { "@type": "Brand", name: "Livira Elegants" },
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: p.price,
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `${shell.siteOrigin}/product/${encodeURIComponent(p.slug)}`,
    },
  });

  let html = shell.html;
  const swap = (re: RegExp, replacement: string) => {
    html = html.replace(re, () => replacement);
  };

  swap(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  swap(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${esc(description)}">`,
  );
  swap(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${esc(canonical)}">`,
  );
  swap(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${esc(title)}">`,
  );
  swap(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${esc(description)}">`,
  );
  swap(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${esc(canonical)}">`,
  );
  swap(
    /<meta property="og:image" content="[^"]*">/,
    `<meta property="og:image" content="${esc(ogImage)}">`,
  );
  swap(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${esc(title)}">`,
  );
  swap(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${esc(description)}">`,
  );
  swap(
    /<meta name="twitter:image" content="[^"]*">/,
    `<meta name="twitter:image" content="${esc(ogImage)}">`,
  );
  swap(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">${jsonLd}</script>`,
  );

  // Replace the shell page's <main> body with this product's markup.
  const mainOpen = html.match(/<main\b[^>]*>/)!;
  const start = html.indexOf(mainOpen[0]) + mainOpen[0].length;
  const end = html.indexOf("</main>");
  return `${html.slice(0, start)}\n<!-- livira: rendered live from D1 (not yet published as a static page) -->\n${body}\n${html.slice(end)}`;
}
