/**
 * Brand + storefront configuration.
 *
 * TODO(owner): replace the placeholder values below with your real brand
 * details before going live. Everything here is dummy/sample content.
 */
export const site = {
  /** Brand name shown in titles, OG tags and emails. */
  name: "Livira Elegants",
  /** Wordmark parts for the two-line header/footer lockup. */
  wordmark: "LIVIRA",
  wordmarkSub: "ELEGANTS",
  /** Brand tagline (from the logo). */
  tagline: "Elegance in every detail",
  /** Longer brand statement for the homepage hero / about page. */
  statement:
    "Hand-finished fine jewellery, made in small batches. Hallmarked metals, ethically sourced stones, and pieces designed to be worn every day and kept for a lifetime.",
  /** TODO(owner): your support / WhatsApp number in full international form. */
  whatsapp: "+919000000000",
  /** TODO(owner): customer-facing support email. */
  supportEmail: "hello@livira.example.com",
  /** TODO(owner): instagram handle (without @), used in footer. Set "" to hide. */
  instagram: "livira.jewellery",

  /**
   * Top announcement bar. Set to [] to hide it. Multiple messages rotate.
   * TODO(owner): edit these promo lines.
   */
  announcements: [
    "Free shipping on orders over ₹2,500",
    "Handcrafted & hallmarked · Made in India",
    "Elegance in every detail",
  ] as string[],

  currency: "INR" as const,
  locale: "en-IN" as const,
  /** Toggle the "inclusive of GST" note near prices. */
  showGstNote: true,
  gstNote: "Inclusive of all taxes (GST)",

  /**
   * COD guard rail: orders above this total (in ₹) cannot use Cash on Delivery.
   * Keep in sync with COD_MAX_ORDER_VALUE in wrangler.toml — the server is the
   * source of truth; this value only drives the client UI.
   */
  codMaxOrderValue: 20000,

  /**
   * Optional pincode serviceability. Leave both empty to accept all pincodes.
   * If `serviceablePincodes` is non-empty it acts as an allow-list; otherwise
   * `blockedPincodes` acts as a deny-list. Mirrored server-side in lib/pricing.
   */
  serviceablePincodes: [] as string[],
  blockedPincodes: [] as string[],

  /** Free shipping above this order value (₹); below it, flat shipping applies. */
  freeShippingThreshold: 2500,
  flatShippingFee: 99,
} as const;

export const nav = [
  { label: "Shop", href: "/shop" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

// Collections/categories are managed in the admin (/admin/collections) and
// flow into the site from the product catalogue at build time.
