/**
 * /admin/products — catalogue overview grouped by collection, with a live
 * "on sale / disabled" toggle per product (stored in D1, no redeploy needed).
 *
 * Adding a NEW product = add a JSON file + images to the repo and redeploy
 * (see README §2); the note at the top of the page explains this to the owner.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc, money } from "../_lib/adminHtml";
import { getDisabledSlugs, setProductDisabled } from "../_lib/settings";
import { CATALOG } from "../../src/lib/catalog";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const activeCat = url.searchParams.get("category") || "All";
  const saved = url.searchParams.get("saved");

  const disabled = await getDisabledSlugs(env);
  const products = Object.values(CATALOG);
  const categories = ["All", ...new Set(products.map((p) => p.category))];

  const shown =
    activeCat === "All"
      ? products
      : products.filter((p) => p.category === activeCat);

  const tabs = `<div class="filters">${categories
    .map(
      (c) =>
        `<a href="/admin/products?category=${encodeURIComponent(c)}" class="${c === activeCat ? "active" : ""}">${esc(c)}</a>`,
    )
    .join("")}</div>`;

  const rows = shown
    .map((p) => {
      const isOff = disabled.has(p.slug) || !p.inStock;
      const state = disabled.has(p.slug)
        ? `<span class="badge s-cancelled">Disabled</span>`
        : p.inStock
          ? `<span class="badge s-paid">On sale</span>`
          : `<span class="badge s-pending">Out of stock (file)</span>`;
      const toggle = `<form method="post" action="/admin/products" style="display:inline">
          <input type="hidden" name="slug" value="${esc(p.slug)}"/>
          <input type="hidden" name="category" value="${esc(activeCat)}"/>
          <input type="hidden" name="disabled" value="${disabled.has(p.slug) ? "0" : "1"}"/>
          <button type="submit">${disabled.has(p.slug) ? "Enable" : "Disable"}</button>
        </form>`;
      return `<tr${isOff ? ' style="opacity:.65"' : ""}>
        <td><strong>${esc(p.name)}</strong><br><span class="muted" style="font-size:12px">${esc(p.slug)}${p.sku ? " · " + esc(p.sku) : ""}</span></td>
        <td>${esc(p.category)}</td>
        <td>${money(p.price)}</td>
        <td>${state}</td>
        <td><a href="/product/${esc(p.slug)}" target="_blank" rel="noopener">View</a></td>
        <td>${toggle}</td>
      </tr>`;
    })
    .join("");

  const body = `
    <h1>Products</h1>
    <p class="muted">${products.length} products · ${categories.length - 1} collections.
      “Disable” instantly blocks a product from being ordered (works without a redeploy).</p>
    <div class="err" style="background:#f3ecd7;color:#8a6d1e">
      To add a <strong>new</strong> product or change photos/price: add or edit its JSON file in
      <code>src/content/products/</code> + images in <code>src/assets/products/</code>, then rebuild &amp; deploy
      (see README §2). Price and photo changes require a deploy so the fast static pages stay in sync.
    </div>
    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Product updated.</div>` : ""}
    ${tabs}
    <table>
      <thead><tr><th>Product</th><th>Collection</th><th>Price</th><th>Status</th><th></th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  return htmlResponse(adminPage({ title: "Products", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const slug = String(form.get("slug") ?? "");
  const disabled = String(form.get("disabled") ?? "0") === "1";
  const category = String(form.get("category") ?? "All");

  if (slug && CATALOG[slug]) {
    await setProductDisabled(env, slug, disabled);
  }
  return Response.redirect(
    new URL(
      `/admin/products?saved=1&category=${encodeURIComponent(category)}`,
      request.url,
    ).href,
    303,
  );
};
