/**
 * Canonical product catalogue — the single source of truth for PRICE and STOCK
 * on the server. The order Functions import this (never the client's numbers).
 *
 * It imports the very same JSON files the Astro content collection reads, so
 * the catalogue can never drift between what's displayed and what's charged.
 *
 * NOTE: plain static JSON imports are used (not Vite's import.meta.glob) so this
 * module also bundles cleanly inside Cloudflare Pages Functions via esbuild.
 */
import eternalSolitaireRing from "../content/products/eternal-solitaire-ring.json";
import aureliaStackingBand from "../content/products/aurelia-stacking-band.json";
import lumierePendantNecklace from "../content/products/lumiere-pendant-necklace.json";
import seraphinePearlDrop from "../content/products/seraphine-pearl-drop.json";
import celesteHoopEarrings from "../content/products/celeste-hoop-earrings.json";
import miraStudEarrings from "../content/products/mira-stud-earrings.json";
import noorKadaBangle from "../content/products/noor-kada-bangle.json";
import velaCuffBangle from "../content/products/vela-cuff-bangle.json";

export interface CatalogProduct {
  slug: string;
  name: string;
  /** Whole rupees (INR). */
  price: number;
  category: string;
  inStock: boolean;
  sku?: string;
}

/** slug => raw imported JSON (slug is the filename, kept in sync manually). */
const RAW: Record<string, unknown> = {
  "eternal-solitaire-ring": eternalSolitaireRing,
  "aurelia-stacking-band": aureliaStackingBand,
  "lumiere-pendant-necklace": lumierePendantNecklace,
  "seraphine-pearl-drop": seraphinePearlDrop,
  "celeste-hoop-earrings": celesteHoopEarrings,
  "mira-stud-earrings": miraStudEarrings,
  "noor-kada-bangle": noorKadaBangle,
  "vela-cuff-bangle": velaCuffBangle,
};

export const CATALOG: Record<string, CatalogProduct> = Object.fromEntries(
  Object.entries(RAW).map(([slug, p]) => {
    const prod = p as {
      name: string;
      price: number;
      category: string;
      inStock?: boolean;
      sku?: string;
    };
    return [
      slug,
      {
        slug,
        name: prod.name,
        price: prod.price,
        category: prod.category,
        inStock: prod.inStock ?? true,
        sku: prod.sku,
      },
    ];
  }),
);

export function getCatalogProduct(slug: string): CatalogProduct | undefined {
  return CATALOG[slug];
}
