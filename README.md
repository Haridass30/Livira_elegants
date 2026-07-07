# Livira — bespoke jewellery storefront

A fully custom, image-led jewellery e‑commerce storefront with **Cash on
Delivery** and **online payment (Razorpay)**. Static Astro frontend + Cloudflare
Pages Functions for checkout + D1 for orders. Everything runs on free tiers.

- **~90% gallery, ~10% app** — ships zero JavaScript by default; only the cart
  and checkout hydrate as React islands.
- **Server‑authoritative pricing** — every total is recomputed on the server
  from the canonical catalogue. Client prices are never trusted.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | [Astro 5](https://astro.build) (static output) + TypeScript |
| Islands | React (`@astrojs/react`) — cart & checkout only |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) + hand‑written CSS tokens |
| Fonts | Self‑hosted Fraunces + Inter via Fontsource |
| Product data | Astro Content Collections (local JSON, zod‑validated) |
| Cart state | nanostores + `@nanostores/persistent` (localStorage) |
| Order API | Cloudflare Pages Functions (`/functions`, TypeScript) |
| Order storage | Cloudflare D1 (SQLite) |
| Payments | Razorpay Orders API + Checkout (server‑side signature verify) |
| Owner email | Resend (optional, graceful no‑op if unset) |
| Images | `astro:assets` `<Image>` (responsive, lazy, WebP) |
| Deploy | Cloudflare Pages (static + Functions + D1) |

---

## Project structure

```
├─ astro.config.mjs          # static output, react, sitemap, tailwind
├─ wrangler.toml             # D1 binding + non-secret vars
├─ migrations/0001_init.sql  # orders table
├─ functions/                # Cloudflare Pages Functions (the order API)
│  ├─ _lib/                  # env, http, crypto, razorpay, db, email (not routed)
│  └─ api/
│     ├─ orders/create.ts    # validate + price + (COD record | Razorpay order)
│     ├─ orders/verify.ts    # verify Razorpay signature, mark paid, notify
│     └─ webhooks/razorpay.ts# optional reliability webhook
├─ src/
│  ├─ assets/products/       # local product imagery (placeholders provided)
│  ├─ content/products/*.json# the catalogue (single source of truth)
│  ├─ content.config.ts      # zod schema for products
│  ├─ lib/                   # catalog, pricing (shared w/ functions), format, types
│  ├─ stores/cart.ts         # nanostores cart
│  ├─ components/            # *.astro + react/{CartButton,CartDrawer,AddToBag,CheckoutForm}
│  ├─ layouts/ pages/ styles/
└─ public/                   # favicon, robots.txt, og-default.jpg
```

> The catalogue JSON in `src/content/products/` is read **both** by the Astro
> content collection (for display) and by `src/lib/catalog.ts` (imported by the
> Functions for pricing) — so what's shown can never drift from what's charged.

---

## 1. Run locally

You can build and finalise **everything on your machine**; Cloudflare is only
needed at deploy time. There are two local modes — because the order API and the
`/admin` dashboard are **Cloudflare Pages Functions**, and the plain Astro dev
server does not run Functions.

```bash
npm install
```

### Mode A — design / storefront work (instant hot reload)

```bash
npm run dev            # http://localhost:4321
```

Fast HMR for pages, styles, components and product content. **`/api/*` and
`/admin` do NOT work in this mode** (Astro dev doesn't run Functions) — that's
expected. Use this for 90% of the design work.

> ⚠️ Visiting `/admin` under `npm run dev` gives a **404** — that's why. Switch
> to Mode B to use the admin/checkout.

### Mode B — full stack (storefront + `/api` + `/admin` + D1)

```bash
cp .dev.vars.example .dev.vars   # set ADMIN_PASSWORD, ADMIN_SESSION_SECRET, Razorpay TEST keys
npm run db:local                 # create the orders table in the local D1 (once)
npm run pages:dev                # builds, then serves everything via Wrangler
```

This runs `wrangler pages dev`, which serves the built site **and** the Functions
**and** a local D1 database, all from one URL it prints (default
`http://localhost:8788`). Now:

- `http://localhost:8788/`            → storefront
- `http://localhost:8788/admin`       → redirects to `/admin/login` (log in with `ADMIN_PASSWORD`)
- `http://localhost:8788/api/*`       → order API (COD works out of the box; online needs Razorpay test keys)

Re-run `npm run pages:dev` after changing Functions or content to rebuild. Use
**Razorpay test keys** for online checkout. No Cloudflare account is required for
any of this — it's all local (Wrangler simulates D1/Functions on your machine).

### Type-check

```bash
npm run typecheck     # checks src and functions (separate tsconfigs)
```

---

## 2. Add or edit a product (owner — no code needed)

Everything is managed in the **admin dashboard** at `/admin`:

- **Products** → *Add product*: name, price, was-price, collection, material,
  description, stock quantity, featured flag — then upload photos straight from
  the browser (they're auto-resized). Edit or delete any product the same way.
- **Collections** → create/rename/delete collections (Rings, Necklaces, …).
- **Coupons** → discount codes with min-order, expiry and usage limits.
- **Settings** → COD on/off, online payment on/off, COD cap, shipping fees,
  **Razorpay keys**, and the Deploy Hook URL.
- **Publish site** button (Products page) → rebuilds the static shop pages
  (~2 min). Checkout, stock and pricing use the live database instantly even
  before publishing; only the visible pages wait for the rebuild.

Product data lives in **D1** (`products`, `product_images`, `collections`);
the static site pulls it from `/api/products` at build time via the content
loader in `src/content.config.ts`. Stock decrements automatically on each
order.

> One-time setup for the Publish button: Cloudflare dashboard → your Pages
> project → Settings → Build → **Deploy hooks** → create one → paste its URL
> into `/admin` → Settings → Deploy Hook URL.

### Developer notes (legacy seed data)

The JSON files in `src/content/products/` and images in `src/assets/products/`
are the original sample data, kept only as a reference/backup — the live
catalogue is in D1 and they are no longer read by the build. The old format,
for the record:

```jsonc
{
  "name": "Eternal Solitaire Ring",
  "price": 12499,                 // whole rupees, INR
  "compareAtPrice": 14999,        // optional "was" price
  "category": "Rings",            // Rings | Necklaces | Earrings | Bangles
  "material": "18k recycled gold · 0.30ct lab diamond",
  "weightGrams": 3.2,             // optional
  "dimensions": "Band 1.8mm",     // optional
  "description": "First paragraph.\n\nSecond paragraph.",
  "images": [                     // paths relative to the JSON file; first = primary
    "../../assets/products/eternal-solitaire-ring-1.jpg",
    "../../assets/products/eternal-solitaire-ring-2.jpg"
  ],
  "inStock": true,
  "featured": true,               // shows on the homepage
  "sku": "LV-R-001",              // optional
  "tags": ["diamond", "solitaire"]// optional
}
```

---

## 3. Brand & config

Edit [`src/config.ts`](src/config.ts) for brand name, tagline, WhatsApp number,
support email, currency/GST note, COD cap, shipping thresholds and pincode
rules. Search the codebase for `TODO(owner)` for every placeholder to replace,
including the production domain in `astro.config.mjs` and `public/robots.txt`.

---

## 4. Secrets & environment (Cloudflare)

| Name | Where | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | `wrangler.toml [vars]` / dashboard | Public; used by client + server |
| `RAZORPAY_KEY_SECRET` | **Secret** | Server only — signs orders & verifies payments |
| `RAZORPAY_WEBHOOK_SECRET` | **Secret** | Only if the webhook is enabled |
| `RESEND_API_KEY` | **Secret** | Owner email; omit to disable notifications |
| `OWNER_EMAIL` / `FROM_EMAIL` | vars | Notification recipient / verified sender |
| `COD_MAX_ORDER_VALUE` | vars | ₹ cap above which COD is blocked (server‑enforced) |
| `CURRENCY` | vars | Defaults to `INR` |
| `ADMIN_PASSWORD` | **Secret** | Password for the `/admin` dashboard |
| `ADMIN_SESSION_SECRET` | **Secret** | Long random string used to sign admin session cookies |
| `DB` | D1 binding | The orders database |

Set secrets (never commit them):

```bash
wrangler pages secret put RAZORPAY_KEY_SECRET
wrangler pages secret put RAZORPAY_WEBHOOK_SECRET   # optional
wrangler pages secret put RESEND_API_KEY            # optional
wrangler pages secret put ADMIN_PASSWORD           # for /admin
wrangler pages secret put ADMIN_SESSION_SECRET     # e.g. `openssl rand -hex 32`
```

Locally these live in `.dev.vars` (git‑ignored). **`RAZORPAY_KEY_SECRET` is
never bundled into client code** — it exists only inside the Functions.

---

## 5. Create the D1 database

```bash
wrangler d1 create livira-db
# → paste the returned database_id into wrangler.toml ([[d1_databases]].database_id)
#   and into the Pages project's D1 binding in the dashboard.

npm run db:remote      # apply migrations/0001_init.sql to the remote DB
npm run db:local       # ...and/or to the local dev DB
```

Inspect orders later with e.g.
`wrangler d1 execute livira-db --remote --command "SELECT order_ref,status,method,amount_total FROM orders ORDER BY created_at DESC LIMIT 20"`.

---

## 6. Deploy to Cloudflare Pages

1. Push the repo to GitHub/GitLab and create a **Cloudflare Pages** project from
   it (or `wrangler pages deploy dist`).
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Add the **D1 binding** `DB` → `livira-db`, the **vars** and the **secrets**
   from §4 in the Pages project settings.
4. (Optional) In Razorpay → Webhooks, add
   `https://<your-domain>/api/webhooks/razorpay` for `payment.captured` and
   `order.paid`, using `RAZORPAY_WEBHOOK_SECRET`.

The `/functions` directory is auto‑discovered and deployed as Pages Functions
alongside the static assets — no separate server.

---

## Checkout flows

**Online (Razorpay)**
1. Client `POST /api/orders/create` with `{ items:[{slug,qty}], customer, method:"online" }`.
2. Function validates + recomputes the total, creates a Razorpay order, stores a
   `pending` order in D1, returns `razorpay_order_id`, `amount` (paise) and the
   public `RAZORPAY_KEY_ID`.
3. Client opens Razorpay Checkout. On success it `POST /api/orders/verify`.
4. Function verifies the HMAC‑SHA256 signature of `order_id|payment_id`. Only if
   valid → mark `paid`, notify the owner, return success. (The webhook does the
   same independently, so a closed tab still reconciles.)

**Cash on Delivery**
1. Client `POST /api/orders/create` with `method:"cod"`.
2. Function validates + recomputes the total, enforces the COD value cap and
   pincode rules, records a `cod_pending` order, notifies the owner. No gateway.

**COD guard rails** (configurable): value cap (`COD_MAX_ORDER_VALUE`), optional
pincode allow/deny lists (`src/lib/pricing.ts` / `src/config.ts`), and a clearly
marked seam in `CheckoutForm.tsx` for an optional phone‑OTP step before COD.

---

## Admin dashboard (`/admin`)

A password-protected, server-rendered dashboard (Cloudflare Pages Functions —
no client framework, no build step) for the shop owner.

- **Login** at `/admin/login` using `ADMIN_PASSWORD`; a signed, HttpOnly session
  cookie (7‑day expiry) keeps you in. All `/admin/*` routes are guarded by
  [functions/admin/_middleware.ts](functions/admin/_middleware.ts).
- **Orders** at `/admin`:
  - Headline stats: **revenue** (paid + delivered), **COD to collect**, total
    orders, paid-online count, COD-pending count.
  - Full order table: date, reference, customer + address, itemised contents,
    method, subtotal/shipping/total, and current status.
  - Filter by status, and **update an order's status** inline
    (pending → paid → shipped → delivered / cancelled …).

Works locally with `npm run pages:dev` once `ADMIN_PASSWORD` /
`ADMIN_SESSION_SECRET` are in `.dev.vars`.

### Managing products (current vs. options)

Today products are **files** ([src/content/products/](src/content/products/) +
images in `src/assets/`) — edit/commit → Cloudflare rebuilds. This keeps the
storefront 100% static and fast, but is a developer workflow, not a browser UI.

To let the owner **add products and upload images from the browser**, pick one
(ask and I'll wire it up):

1. **Git-based CMS** (Decap/Sveltia at `/admin/cms`): a UI that edits the
   product files + uploads images and commits to the repo, triggering an
   auto-rebuild (~60s). Keeps everything static & free. *Recommended if you want
   to preserve the current architecture.*
2. **Dynamic catalogue** (D1 + Cloudflare R2 for images): products live in the
   database and images in object storage, added instantly from the admin with no
   rebuild. Most "real backend", but makes `/shop` and `/product/[slug]` render
   dynamically (a change to the locked static/content-collection design).

## Security notes

- Prices, totals and stock are **always** recomputed server‑side from the
  catalogue; mismatched/tampered client values are rejected.
- The cart is validated server‑side (product exists, in stock, qty > 0) before
  any order is recorded.
- Payment signatures are verified server‑side with the key secret; orders only
  become `paid` after verification.
- No card data ever touches this app — Razorpay Checkout handles it.

---

## Quality targets

- Lighthouse mobile: Performance / A11y / Best Practices / SEO ≥ 95.
- Responsive, lazy, correctly‑sized images (WebP) with no layout shift; alt text
  everywhere. Per‑page titles/meta/OG; product pages include image + price and
  `Product` JSON‑LD. Sitemap, robots, 404 included.
# Livira_elegants
