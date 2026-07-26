/**
 * /admin/trending — curate the homepage "Trending" section: an editable
 * heading plus per-product enable/disable toggles, grouped by collection.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import { listProducts, listImages } from "../_lib/catalogDb";
import { getTrending, saveTrending } from "../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const msg = url.searchParams.get("msg");
  const [products, trending] = await Promise.all([listProducts(env), getTrending(env)]);
  const chosen = new Set(trending.slugs);

  // Group products by their collection (category) for a tidy toggle list.
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const arr = groups.get(p.category) ?? [];
    arr.push(p);
    groups.set(p.category, arr);
  }

  // First image per product (small preview thumbnail).
  const thumbs = new Map<string, number>();
  await Promise.all(
    products.map(async (p) => {
      const imgs = await listImages(env, p.slug);
      if (imgs[0]) thumbs.set(p.slug, imgs[0].id);
    }),
  );

  const groupHtml = [...groups.entries()]
    .map(([cat, items]) => {
      const rows = items
        .map((p) => {
          const tid = thumbs.get(p.slug);
          const thumb = tid
            ? `<img src="/api/images/${tid}" alt="" width="38" height="47" style="object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:10px">`
            : `<span style="display:inline-block;width:38px;height:47px;border-radius:3px;background:var(--bone);margin-right:10px;vertical-align:middle"></span>`;
          return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer">
            <input type="checkbox" name="slug" value="${esc(p.slug)}"${chosen.has(p.slug) ? " checked" : ""} style="width:18px;height:18px"/>
            ${thumb}
            <span style="flex:1"><strong>${esc(p.name)}</strong><br><span class="muted" style="font-size:12px">₹${Number(p.price).toLocaleString("en-IN")}${p.active ? "" : " · inactive"}</span></span>
          </label>`;
        })
        .join("");
      return `<fieldset style="border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 16px">
        <legend style="font-family:Georgia,serif;font-size:16px;padding:0 8px">
          ${esc(cat)}
          <button type="button" class="toggle-group" data-group="${esc(cat)}" style="background:#fff;color:var(--char);border:1px solid var(--line);padding:3px 10px;font-size:11px;margin-left:8px">Toggle all</button>
        </legend>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px" data-groupbody="${esc(cat)}">${rows}</div>
      </fieldset>`;
    })
    .join("");

  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>Trending products</h1>
    <p class="muted">Tick the products to feature in the homepage <strong>Trending</strong> section. They're grouped by collection, and visitors can filter by collection there. Changes show on the homepage on the next refresh — no publish needed.</p>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    <form method="post">
      <label style="display:block;margin:18px 0">Section heading
        <input name="title" value="${esc(trending.title)}" maxlength="40" style="display:block;margin-top:6px;width:100%;max-width:420px;padding:9px 12px;border:1px solid rgba(43,39,36,.25);border-radius:7px"/>
      </label>
      ${groupHtml || `<p class="muted">No products yet.</p>`}
      <div style="position:sticky;bottom:0;background:linear-gradient(transparent,var(--ivory) 40%);padding:16px 0;margin-top:8px">
        <button type="submit">Save trending</button>
      </div>
    </form>
    <script>
      document.querySelectorAll(".toggle-group").forEach((b) => {
        b.addEventListener("click", () => {
          const body = document.querySelector('[data-groupbody="' + b.dataset.group.replace(/"/g,'\\\\"') + '"]');
          if (!body) return;
          const boxes = body.querySelectorAll('input[type=checkbox]');
          const anyOff = [...boxes].some((c) => !c.checked);
          boxes.forEach((c) => (c.checked = anyOff));
        });
      });
    </script>`;

  return htmlResponse(adminPage({ title: "Trending", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const slugs = form.getAll("slug").map((s) => String(s)).filter(Boolean);
  await saveTrending(env, { title, slugs });
  return Response.redirect(
    new URL(
      "/admin/trending?msg=" + encodeURIComponent(`Saved — ${slugs.length} trending product${slugs.length === 1 ? "" : "s"}.`),
      request.url,
    ).href,
    303,
  );
};
