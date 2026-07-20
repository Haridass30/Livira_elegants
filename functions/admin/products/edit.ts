/**
 * /admin/products/edit — add a new product (no ?slug=) or edit an existing one.
 * Handles the product form, photo uploads (client-side resized, base64 POST to
 * /admin/products/upload), photo delete/reorder, and product delete.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc } from "../../_lib/adminHtml";
import {
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  listImages,
  deleteImage,
  moveImage,
  listCollections,
  buildCollectionTree,
  listAssignableCollections,
  type ProductInput,
} from "../../_lib/catalogDb";

function formToInput(form: FormData, fallbackCategory: string): ProductInput {
  const num = (v: FormDataEntryValue | null): number | null => {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
  };
  return {
    name: String(form.get("name") ?? "").trim(),
    price: Math.max(1, Math.floor(num(form.get("price")) ?? 0)),
    compareAtPrice: num(form.get("compare_at_price")),
    category: String(form.get("category") ?? fallbackCategory),
    material: String(form.get("material") ?? "").trim(),
    weightGrams: num(form.get("weight_grams")),
    dimensions: String(form.get("dimensions") ?? "").trim() || null,
    description: String(form.get("description") ?? "").trim(),
    inStock: form.get("in_stock") === "1",
    stockQty: num(form.get("stock_qty")),
    featured: form.get("featured") === "1",
    sku: String(form.get("sku") ?? "").trim() || null,
    tags: String(form.get("tags") ?? "").trim(),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");

  const collections = await listCollections(env);
  const product = slug ? await getProduct(env, slug) : null;
  if (slug && !product) {
    return htmlResponse(
      adminPage({ title: "Not found", body: `<h1>Product not found</h1><p><a href="/admin/products">Back</a></p>` }),
      404,
    );
  }
  const images = product ? await listImages(env, product.slug) : [];
  const isNew = !product;

  // Every collection can hold products; sub-categories are shown indented
  // beneath their main so the hierarchy is clear but all remain selectable.
  const opt = (name: string, indent: boolean) =>
    `<option value="${esc(name)}"${product?.category === name ? " selected" : ""}>${indent ? "  ↳ " : ""}${esc(name)}</option>`;
  const catOptions = buildCollectionTree(collections)
    .map((m) => opt(m.name, false) + m.children.map((s) => opt(s.name, true)).join(""))
    .join("");

  const imageCards = images
    .map(
      (img, i) => `
      <div style="display:inline-block;margin:0 10px 10px 0;text-align:center;vertical-align:top">
        <img src="/api/images/${img.id}" alt="" width="90" height="112" style="object-fit:cover;border-radius:2px;border:1px solid rgba(43,39,36,.15)"/>
        <div style="margin-top:4px;display:flex;gap:4px;justify-content:center">
          <form method="post" style="display:inline"><input type="hidden" name="action" value="img_up"/><input type="hidden" name="img_id" value="${img.id}"/><input type="hidden" name="slug" value="${esc(product!.slug)}"/><button ${i === 0 ? "disabled" : ""} style="padding:3px 8px">←</button></form>
          <form method="post" style="display:inline"><input type="hidden" name="action" value="img_del"/><input type="hidden" name="img_id" value="${img.id}"/><input type="hidden" name="slug" value="${esc(product!.slug)}"/><button style="padding:3px 8px;background:#8a2f2f" onclick="return confirm('Delete this photo?')">✕</button></form>
          <form method="post" style="display:inline"><input type="hidden" name="action" value="img_down"/><input type="hidden" name="img_id" value="${img.id}"/><input type="hidden" name="slug" value="${esc(product!.slug)}"/><button ${i === images.length - 1 ? "disabled" : ""} style="padding:3px 8px">→</button></form>
        </div>
        ${i === 0 ? `<div class="muted" style="font-size:10px;margin-top:2px">main photo</div>` : ""}
      </div>`,
    )
    .join("");

  const photosSection = isNew
    ? `<p class="muted">Save the product first, then add photos.</p>`
    : `
      ${imageCards || `<p class="muted">No photos yet — add at least one.</p>`}
      <div style="margin-top:10px">
        <input type="file" id="photo-input" accept="image/*" multiple/>
        <span id="upload-status" class="muted" style="margin-left:8px"></span>
      </div>
      <script>
      // Client-side resize (max 1600px, JPEG q0.85) then upload as base64 JSON.
      const input = document.getElementById('photo-input');
      const status = document.getElementById('upload-status');
      input.addEventListener('change', async () => {
        const files = [...input.files];
        let done = 0;
        for (const file of files) {
          status.textContent = 'Uploading ' + (done + 1) + '/' + files.length + '…';
          try {
            const img = await createImageBitmap(file);
            const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
            const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
            const res = await fetch('/admin/products/upload', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug: ${JSON.stringify(product?.slug ?? "")}, mime: 'image/jpeg', width: w, height: h, dataBase64: b64 })
            });
            if (!res.ok) throw new Error(await res.text());
            done++;
          } catch (e) {
            status.textContent = 'Upload failed: ' + e.message; return;
          }
        }
        location.reload();
      });
      </script>`;

  const p = product;
  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>${isNew ? "Add product" : "Edit: " + esc(p!.name)}</h1>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}

    <form method="post" style="background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:22px;max-width:760px">
      <input type="hidden" name="action" value="save"/>
      ${isNew ? "" : `<input type="hidden" name="slug" value="${esc(p!.slug)}"/>`}

      <div class="field"><label>Product name *</label>
        <input name="name" required value="${esc(p?.name ?? "")}" placeholder="e.g. Aurora Gold Ring"/></div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        <div class="field"><label>Price ₹ *</label>
          <input name="price" type="number" min="1" required value="${esc(p?.price ?? "")}"/></div>
        <div class="field"><label>Was-price ₹ (optional strikethrough)</label>
          <input name="compare_at_price" type="number" min="1" value="${esc(p?.compare_at_price ?? "")}"/></div>
        <div class="field"><label>Collection *</label>
          <select name="category" style="width:100%;padding:10px 12px">${catOptions}</select></div>
      </div>

      <div class="field"><label>Material *</label>
        <input name="material" required value="${esc(p?.material ?? "")}" placeholder="e.g. 18k gold vermeil · lab diamond"/></div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        <div class="field"><label>Weight (grams)</label>
          <input name="weight_grams" type="number" step="0.1" min="0" value="${esc(p?.weight_grams ?? "")}"/></div>
        <div class="field"><label>Dimensions</label>
          <input name="dimensions" value="${esc(p?.dimensions ?? "")}" placeholder="e.g. 22mm diameter"/></div>
        <div class="field"><label>SKU</label>
          <input name="sku" value="${esc(p?.sku ?? "")}" placeholder="e.g. LV-R-003"/></div>
      </div>

      <div class="field"><label>Description * (blank line = new paragraph)</label>
        <textarea name="description" rows="5" required style="width:100%;padding:10px 12px;border:1px solid rgba(43,39,36,.25);border-radius:2px;font:inherit">${esc(p?.description ?? "")}</textarea></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>Stock quantity (blank = don't track)</label>
          <input name="stock_qty" type="number" min="0" value="${esc(p?.stock_qty ?? "")}" placeholder="leave blank for unlimited"/></div>
        <div class="field"><label>Tags (comma separated)</label>
          <input name="tags" value="${esc(p?.tags ?? "")}" placeholder="gift, everyday"/></div>
      </div>

      <div style="display:flex;gap:22px;margin:12px 0">
        <label style="display:flex;align-items:center;gap:8px;font-size:14px">
          <input type="checkbox" name="in_stock" value="1"${(p?.in_stock ?? 1) === 1 ? " checked" : ""} style="width:17px;height:17px"/> Available for sale</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px">
          <input type="checkbox" name="featured" value="1"${p?.featured === 1 ? " checked" : ""} style="width:17px;height:17px"/> Featured on homepage</label>
      </div>

      <button type="submit">${isNew ? "Create product" : "Save changes"}</button>
    </form>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:32px">Photos</h2>
    <div style="background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:18px;max-width:760px">
      ${photosSection}
    </div>

    ${
      isNew
        ? ""
        : `<form method="post" style="margin-top:28px" onsubmit="return confirm('Delete this product? It disappears from the shop; past orders keep their records.')">
            <input type="hidden" name="action" value="delete"/>
            <input type="hidden" name="slug" value="${esc(p!.slug)}"/>
            <button type="submit" style="background:#8a2f2f">Delete product</button>
          </form>`
    }`;

  return htmlResponse(adminPage({ title: isNew ? "Add product" : "Edit product", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const action = String(form.get("action") ?? "save");
  const slug = String(form.get("slug") ?? "");
  const back = (s: string, params: string) =>
    Response.redirect(
      new URL(`/admin/products/edit?slug=${encodeURIComponent(s)}&${params}`, request.url).href,
      303,
    );

  try {
    if (action === "img_del" || action === "img_up" || action === "img_down") {
      const imgId = Number(form.get("img_id"));
      if (Number.isInteger(imgId)) {
        if (action === "img_del") await deleteImage(env, imgId);
        else await moveImage(env, imgId, action === "img_up" ? "up" : "down");
      }
      return back(slug, "msg=" + encodeURIComponent("Photos updated."));
    }

    if (action === "delete") {
      if (slug) await deleteProduct(env, slug);
      return Response.redirect(
        new URL("/admin/products?msg=" + encodeURIComponent("Product deleted."), request.url).href,
        303,
      );
    }

    // save (create or update)
    const collections = await listAssignableCollections(env);
    const input = formToInput(form, collections[0]?.name ?? "Uncategorised");
    if (!input.name || !input.price || !input.description || !input.material) {
      return back(slug, "err=" + encodeURIComponent("Please fill all required fields."));
    }
    if (!collections.some((c) => c.name === input.category)) {
      return back(slug, "err=" + encodeURIComponent("Choose a valid collection."));
    }

    if (slug) {
      await updateProduct(env, slug, input);
      return back(slug, "msg=" + encodeURIComponent("Saved."));
    }
    const newSlug = await createProduct(env, input);
    return back(newSlug, "msg=" + encodeURIComponent("Product created — now add photos below."));
  } catch (e) {
    console.error("[admin products] error", e);
    return back(slug, "err=" + encodeURIComponent("Could not save. Please try again."));
  }
};
