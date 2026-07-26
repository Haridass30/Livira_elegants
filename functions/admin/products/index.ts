/** /admin/products — product list with stock, status and CRUD entry points. */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../../_lib/adminHtml";
import {
  listAllProducts,
  setProductActive,
  listAllImages,
  listCollections,
  effectiveInStock,
} from "../../_lib/catalogDb";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const activeCat = url.searchParams.get("category") || "All";
  const msg = url.searchParams.get("msg");

  const [products, images, collections] = await Promise.all([
    listAllProducts(env),
    listAllImages(env),
    listCollections(env),
  ]);

  const imgCount = new Map<string, number>();
  const firstImg = new Map<string, number>();
  for (const i of images) {
    imgCount.set(i.product_slug, (imgCount.get(i.product_slug) ?? 0) + 1);
    if (!firstImg.has(i.product_slug)) firstImg.set(i.product_slug, i.id);
  }

  // Any collection can hold products, so all are valid filter tabs.
  const cats = ["All", ...collections.map((c) => c.name)];
  const shown =
    activeCat === "All" ? products : products.filter((p) => p.category === activeCat);

  const tabs = `<div class="filters">${cats
    .map(
      (c) =>
        `<a href="/admin/products?category=${encodeURIComponent(c)}" class="${c === activeCat ? "active" : ""}">${esc(c)}</a>`,
    )
    .join("")}</div>`;

  const rows =
    shown.length === 0
      ? `<tr><td colspan="7" class="muted" style="padding:28px;text-align:center">No products${activeCat !== "All" ? " in this collection" : ""} yet — add your first one.</td></tr>`
      : shown
          .map((p) => {
            const live = effectiveInStock(p);
            const stock =
              p.stock_qty === null
                ? "not tracked"
                : `${p.stock_qty} left${p.stock_qty === 0 ? " (out)" : ""}`;
            const thumb = firstImg.has(p.slug)
              ? `<img src="/api/images/${firstImg.get(p.slug)}" alt="" width="44" height="55" style="object-fit:cover;border-radius:2px;vertical-align:middle"/>`
              : `<span class="muted" style="font-size:11px">no photo</span>`;
            const disabled = p.active === 0;
            const badge = disabled
              ? `<span class="badge s-cancelled">Disabled</span>`
              : `<span class="badge ${live ? "s-paid" : "s-cod_pending"}">${live ? "On sale" : "Out of stock"}</span>`;
            return `<tr${disabled || !live ? ' style="opacity:.55"' : ""}>
        <td>${thumb}</td>
        <td><strong>${esc(p.name)}</strong><br><span class="muted" style="font-size:12px">${esc(p.slug)}${p.sku ? " · " + esc(p.sku) : ""}${p.featured ? " · ★ featured" : ""}</span></td>
        <td>${esc(p.category)}</td>
        <td>${money(p.price)}${p.compare_at_price ? `<br><span class="muted" style="font-size:11px;text-decoration:line-through">${money(p.compare_at_price)}</span>` : ""}</td>
        <td>${esc(stock)}<br><span class="muted" style="font-size:11px">${imgCount.get(p.slug) ?? 0} photo${(imgCount.get(p.slug) ?? 0) === 1 ? "" : "s"}</span></td>
        <td>${badge}</td>
        <td style="white-space:nowrap">
          <a href="/admin/products/edit?slug=${encodeURIComponent(p.slug)}"><button type="button">Edit</button></a>
          <form method="post" action="/admin/products" style="display:inline;margin-left:6px">
            <input type="hidden" name="action" value="toggle_active"/>
            <input type="hidden" name="slug" value="${esc(p.slug)}"/>
            <input type="hidden" name="active" value="${disabled ? "1" : "0"}"/>
            <button type="submit" style="background:${disabled ? "#2f6b3a" : "#8a6d1e"}">${disabled ? "Enable" : "Disable"}</button>
          </form>
          <a href="/product/${esc(p.slug)}" target="_blank" rel="noopener" style="margin-left:6px">View</a>
        </td>
      </tr>`;
          })
          .join("");

  const body = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h1>Products</h1>
        <p class="muted">${products.length} products · ${collections.length} collections.</p>
      </div>
      <div style="display:flex;gap:10px">
        <a href="/admin/collections"><button type="button" style="background:#fff;color:var(--char);border:1px solid rgba(43,39,36,.25)">Collections</button></a>
        <a href="/admin/products/edit"><button type="button">+ Add product</button></a>
      </div>
    </div>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    <div class="err" style="background:#e4f0e6;color:#2f6b3a;border:1px solid #bfe0c6">
      Your edits are saved instantly. The <strong>shop</strong> and <strong>home</strong> pages
      show them automatically the next time a visitor loads or refreshes the page — no publish needed.
      <br><span class="muted" style="font-size:12px">Optional: <strong>Publish site</strong> also bakes changes into the
      static pages (slightly better for Google &amp; first load). It needs a one-time Deploy Hook set in
      <a href="/admin/settings">Settings</a>; without it this button just shows a reminder.</span>
    </div>
    <form method="post" action="/admin/publish" style="margin:14px 0">
      <button type="submit" style="background:var(--gold)">⟳ Publish site (optional)</button>
    </form>
    ${tabs}
    <table>
      <thead><tr><th></th><th>Product</th><th>Collection</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(adminPage({ title: "Products", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const back = (msg: string) =>
    Response.redirect(
      new URL("/admin/products?msg=" + encodeURIComponent(msg), request.url).href,
      303,
    );

  if (action === "toggle_active") {
    const slug = String(form.get("slug") ?? "");
    const active = String(form.get("active") ?? "") === "1";
    if (slug) await setProductActive(env, slug, active);
    return back(active ? "Product enabled." : "Product disabled (hidden from the shop).");
  }
  return Response.redirect(new URL("/admin/products", request.url).href, 303);
};
