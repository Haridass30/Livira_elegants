/**
 * /admin/content — edit the homepage banner (hero) and the top announcement
 * bar. Saved to D1; the static pages refresh on the next "Publish site".
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc } from "../../_lib/adminHtml";
import { getSiteContent, saveSiteContent } from "../../_lib/settings";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const saved = url.searchParams.get("saved");
  const c = await getSiteContent(env);

  const heroPreview = c.hero.imageId
    ? `<img src="/api/images/${c.hero.imageId}" alt="Current hero" style="width:100%;max-width:520px;border-radius:3px;border:1px solid rgba(43,39,36,.15);display:block;margin:8px 0"/>`
    : `<p class="muted" style="margin:8px 0">No banner image uploaded yet — a default is used.</p>`;

  const body = `
    <h1>Homepage banner</h1>
    <p class="muted">Edit the big banner and the scrolling announcement bar. After saving,
      press <strong>Publish site</strong> to update the live pages (~2 minutes).</p>
    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Saved. Now press “Publish site” to make it live.</div>` : ""}

    <form method="post" action="/admin/publish" style="margin:14px 0">
      <button type="submit" style="background:var(--gold)">⟳ Publish site (make changes live)</button>
    </form>

    <form method="post" action="/admin/content" style="background:#fff;border:1px solid rgba(43,39,36,.1);border-radius:3px;padding:22px;max-width:720px">
      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:0 0 4px">Hero banner</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">The main banner at the top of the homepage.</p>

      <div class="field"><label>Heading</label>
        <input name="hero_heading" value="${esc(c.hero.heading)}" maxlength="80"/></div>
      <div class="field"><label>Sub-text</label>
        <textarea name="hero_subtext" rows="2" style="width:100%;padding:10px 12px">${esc(c.hero.subtext)}</textarea></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field"><label>Button text</label>
          <input name="hero_button_label" value="${esc(c.hero.buttonLabel)}" maxlength="30"/></div>
        <div class="field"><label>Button link</label>
          <input name="hero_button_link" value="${esc(c.hero.buttonLink)}" placeholder="/shop"/></div>
        <div class="field"><label>2nd button text (blank = hide)</label>
          <input name="hero_secondary_label" value="${esc(c.hero.secondaryLabel)}" maxlength="30"/></div>
        <div class="field"><label>2nd button link</label>
          <input name="hero_secondary_link" value="${esc(c.hero.secondaryLink)}" placeholder="/about"/></div>
      </div>

      <div class="field">
        <label>Banner image</label>
        ${heroPreview}
        <input type="file" id="hero-input" accept="image/*"/>
        <span id="hero-status" class="muted" style="margin-left:8px"></span>
        <p class="muted" style="font-size:12px;margin-top:6px">
          Landscape photo works best (wide, e.g. 2000×1200). Uploaded instantly; still press Publish to go live.
        </p>
      </div>

      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:24px 0 4px">Announcement bar</h2>
      <p class="muted" style="font-size:13px;margin:0 0 10px">The thin scrolling strip at the very top. One message per line. Leave empty to hide the bar.</p>
      <div class="field">
        <textarea name="announcements" rows="4" style="width:100%;padding:10px 12px" placeholder="Free shipping on orders over ₹2,500">${esc(c.announcements.join("\n"))}</textarea>
      </div>

      <button type="submit">Save changes</button>
    </form>

    <script>
      // Client-side resize (max 2000px, JPEG q0.85) then upload as base64 JSON.
      const input = document.getElementById('hero-input');
      const status = document.getElementById('hero-status');
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        status.textContent = 'Uploading…';
        try {
          const img = await createImageBitmap(file);
          const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
          const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
          const res = await fetch('/admin/content/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mime: 'image/jpeg', width: w, height: h, dataBase64: b64 })
          });
          if (!res.ok) throw new Error(await res.text());
          location.reload();
        } catch (e) {
          status.textContent = 'Upload failed: ' + e.message;
        }
      });
    </script>`;

  return htmlResponse(adminPage({ title: "Homepage banner", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const announcements = String(form.get("announcements") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  await saveSiteContent(env, {
    announcements,
    heading: String(form.get("hero_heading") ?? "").trim(),
    subtext: String(form.get("hero_subtext") ?? "").trim(),
    buttonLabel: String(form.get("hero_button_label") ?? "").trim(),
    buttonLink: String(form.get("hero_button_link") ?? "").trim() || "/shop",
    secondaryLabel: String(form.get("hero_secondary_label") ?? "").trim(),
    secondaryLink: String(form.get("hero_secondary_link") ?? "").trim() || "/about",
  });

  return Response.redirect(new URL("/admin/content?saved=1", request.url).href, 303);
};
