/**
 * Homepage content (announcement bar + hero banner), loaded at BUILD TIME from
 * the live store API (/api/content, backed by D1). The owner edits it in
 * /admin/content; the "Publish site" button rebuilds so the pages refresh.
 *
 * Mirrors the product catalogue loader in src/content.config.ts. Falls back to
 * sensible defaults (from src/config.ts) if the API is unreachable.
 */
import { site } from "../config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
const API: string =
  (import.meta as any).env?.CATALOG_API ??
  g.process?.env?.CATALOG_API ??
  "https://livira-store.pages.dev";

export interface ResolvedHero {
  heading: string;
  subtext: string;
  buttonLabel: string;
  buttonLink: string;
  secondaryLabel: string;
  secondaryLink: string;
  image: { url: string; width: number; height: number } | null;
}

/** A banner slide is shaped exactly like the hero. */
export type ResolvedSlide = ResolvedHero;

export interface BentoBox {
  imageId: number | null;
  link: string;
  caption: string;
}

export interface ResolvedContent {
  announcements: string[];
  /** First slide, kept for callers that only expect one hero. */
  hero: ResolvedHero;
  /** Full banner carousel (always at least one slide). */
  slides: ResolvedSlide[];
  /** Admin-uploaded bento image tiles (up to 5). */
  bento: BentoBox[];
}

const DEFAULT_SLIDE: ResolvedHero = {
  heading: site.tagline,
  subtext: "Hand-finished pieces in recycled metals and responsibly sourced stones.",
  buttonLabel: "Shop the collection",
  buttonLink: "/shop",
  secondaryLabel: "Our story",
  secondaryLink: "/about",
  image: null,
};

const DEFAULTS: ResolvedContent = {
  announcements: site.announcements ?? [],
  hero: DEFAULT_SLIDE,
  slides: [DEFAULT_SLIDE],
  bento: [],
};

interface RawSlide {
  heading?: string;
  subtext?: string;
  buttonLabel?: string;
  buttonLink?: string;
  secondaryLabel?: string;
  secondaryLink?: string;
  imageId?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

function resolveSlide(h: RawSlide): ResolvedSlide {
  const d = DEFAULT_SLIDE;
  return {
    heading: h.heading || d.heading,
    subtext: h.subtext ?? d.subtext,
    buttonLabel: h.buttonLabel || d.buttonLabel,
    buttonLink: h.buttonLink || d.buttonLink,
    secondaryLabel: h.secondaryLabel ?? d.secondaryLabel,
    secondaryLink: h.secondaryLink || d.secondaryLink,
    image:
      h.imageId && h.imageWidth && h.imageHeight
        ? {
            url: `${API}/api/images/${h.imageId}`,
            width: h.imageWidth,
            height: h.imageHeight,
          }
        : null,
  };
}

let cached: Promise<ResolvedContent> | null = null;

export function getSiteContent(): Promise<ResolvedContent> {
  if (!cached) cached = load();
  return cached;
}

/**
 * Fetch the homepage content with retries. A reachable API wins (even if it
 * returns partial data — we fill gaps from defaults). If it can't be reached
 * after retrying we THROW so the build fails and Cloudflare keeps the current
 * live site, rather than silently reverting the banner/announcements to defaults.
 */
async function load(tries = 4): Promise<ResolvedContent> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${API}/api/content`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as {
        announcements?: string[];
        hero?: RawSlide;
        slides?: RawSlide[];
        bento?: BentoBox[];
      };

      const rawSlides =
        Array.isArray(d.slides) && d.slides.length
          ? d.slides
          : d.hero
            ? [d.hero]
            : [];
      const slides = rawSlides.length ? rawSlides.map(resolveSlide) : DEFAULTS.slides;

      console.log(`[content] loaded homepage content from ${API} (${slides.length} banner slide(s))`);
      return {
        announcements:
          Array.isArray(d.announcements) && d.announcements.length
            ? d.announcements
            : DEFAULTS.announcements,
        hero: slides[0],
        slides,
        bento: Array.isArray(d.bento)
          ? d.bento
              .slice(0, 5)
              .map((b) => ({
                imageId: Number.isInteger(Number(b?.imageId)) && Number(b?.imageId) > 0 ? Number(b?.imageId) : null,
                link: typeof b?.link === "string" ? b.link : "",
                caption: typeof b?.caption === "string" ? b.caption : "",
              }))
          : [],
      };
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error(
    `[content] Could not load ${API}/api/content after ${tries} attempts (${lastErr}). ` +
      `Aborting the build so the live site's banner is kept instead of reverting to defaults. ` +
      `Re-run "Publish site" once the store API is healthy.`,
  );
}
