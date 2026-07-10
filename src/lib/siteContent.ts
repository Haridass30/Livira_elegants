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

export interface ResolvedContent {
  announcements: string[];
  hero: ResolvedHero;
}

const DEFAULTS: ResolvedContent = {
  announcements: site.announcements ?? [],
  hero: {
    heading: site.tagline,
    subtext: "Hand-finished pieces in recycled metals and responsibly sourced stones.",
    buttonLabel: "Shop the collection",
    buttonLink: "/shop",
    secondaryLabel: "Our story",
    secondaryLink: "/about",
    image: null,
  },
};

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
      hero?: Partial<ResolvedHero> & {
        imageId?: number | null;
        imageWidth?: number | null;
        imageHeight?: number | null;
      };
    };
    const h = d.hero ?? {};
    const dh = DEFAULTS.hero;
    console.log(`[content] loaded homepage content from ${API}`);
    return {
      announcements:
        Array.isArray(d.announcements) && d.announcements.length
          ? d.announcements
          : DEFAULTS.announcements,
      hero: {
        heading: h.heading || dh.heading,
        subtext: h.subtext || dh.subtext,
        buttonLabel: h.buttonLabel || dh.buttonLabel,
        buttonLink: h.buttonLink || dh.buttonLink,
        secondaryLabel: h.secondaryLabel ?? dh.secondaryLabel,
        secondaryLink: h.secondaryLink || dh.secondaryLink,
        image:
          h.imageId && h.imageWidth && h.imageHeight
            ? {
                url: `${API}/api/images/${h.imageId}`,
                width: h.imageWidth,
                height: h.imageHeight,
              }
            : null,
      },
    };
  } catch (err) {
    console.warn(`[content] using defaults (${(err as Error).message})`);
    return DEFAULTS;
  }
}
