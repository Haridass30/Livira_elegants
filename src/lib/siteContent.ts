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

export interface ResolvedContent {
  announcements: string[];
  /** First slide, kept for callers that only expect one hero. */
  hero: ResolvedHero;
  /** Full banner carousel (always at least one slide). */
  slides: ResolvedSlide[];
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

async function load(): Promise<ResolvedContent> {
  try {
    const res = await fetch(`${API}/api/content`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const d = (await res.json()) as {
      announcements?: string[];
      hero?: RawSlide;
      slides?: RawSlide[];
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
    };
  } catch (err) {
    console.warn(`[content] using defaults (${(err as Error).message})`);
    return DEFAULTS;
  }
}
