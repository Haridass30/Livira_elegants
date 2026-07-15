/**
 * /admin/content — edit the homepage banners (a sliding carousel) and the top
 * announcement bar. Each banner has its own heading, sub-text, buttons and
 * photo. Saved to D1; the static pages refresh on the next "Publish site".
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc } from "../../_lib/adminHtml";
import {
  getSiteContent,
  saveAnnouncements,
  saveBannerSlides,
  getBannerImageIdsInUse,
  type BannerSlide,
} from "../../_lib/settings";
import { listImages, deleteImage } from "../../_lib/catalogDb";

const HERO_SLUG = "__hero__";

/** Render one editable banner card. `idx` is 0-based; -1 is the JS template. */
function slideCard(s: BannerSlide, idx: number): string {
  const preview = s.imageId
    ? `<img src="/api/images/${s.imageId}" alt="Banner" class="s-img"/>`
    : `<div class="s-img s-img--empty">No image yet — a default is shown.</div>`;
  return `
  <div class="slide-card">
    <div class="slide-bar">
      <strong class="slide-title">Banner ${idx + 1}</strong>
      <button type="button" class="link btn-remove">✕ Remove</button>
    </div>
    <input type="hidden" class="s-imageId" value="${s.imageId ?? ""}"/>
    <div class="s-preview">${preview}</div>
    <div class="field">
      <label>Banner image</label>
      <input type="file" class="s-file" accept="image/*"/>
      <span class="s-status muted" style="margin-left:8px"></span>
      <p class="muted" style="font-size:12px;margin-top:6px">Landscape works best (wide, e.g. 2000×1200), under ~1.4 MB.</p>
    </div>
    <div class="field"><label>Heading</label>
      <input class="s-heading" value="${esc(s.heading)}" maxlength="80"/></div>
    <div class="field"><label>Sub-text</label>
      <textarea class="s-subtext" rows="2" style="width:100%;padding:10px 12px">${esc(s.subtext)}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="field"><label>Button text</label>
        <input class="s-buttonLabel" value="${esc(s.buttonLabel)}" maxlength="30"/></div>
      <div class="field"><label>Button link</label>
        <input class="s-buttonLink" value="${esc(s.buttonLink)}" placeholder="/shop"/></div>
      <div class="field"><label>2nd button text (blank = hide)</label>
        <input class="s-secondaryLabel" value="${esc(s.secondaryLabel)}" maxlength="30"/></div>
      <div class="field"><label>2nd button link</label>
        <input class="s-secondaryLink" value="${esc(s.secondaryLink)}" placeholder="/about"/></div>
    </div>
  </div>`;
}

const EMPTY_SLIDE: BannerSlide = {
  heading: "",
  subtext: "",
  buttonLabel: "Shop the collection",
  buttonLink: "/shop",
  secondaryLabel: "",
  secondaryLink: "/about",
  imageId: null,
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const saved = url.searchParams.get("saved");
  const c = await getSiteContent(env);

  const cards = c.slides.map((s, i) => slideCard(s, i)).join("");

  const body = `
    <style>
      .slide-card{background:#fff;border:1px solid rgba(43,39,36,.14);border-radius:4px;padding:18px 20px;margin:0 0 16px}
      .slide-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      .slide-title{font-family:Georgia,serif;font-size:17px;font-weight:400}
      .btn-remove{background:none;color:#8a2f2f;padding:0;text-transform:none;letter-spacing:0;font-size:13px}
      .s-preview{margin:0 0 12px}
      .s-img{width:100%;max-width:520px;border-radius:3px;border:1px solid rgba(43,39,36,.15);display:block;object-fit:cover;aspect-ratio:16/9;background:#f0ece4}
      .s-img--empty{display:flex;align-items:center;justify-content:center;color:rgba(43,39,36,.5);font-size:13px}
      .slide-card input.s-heading,.slide-card input[class^='s-button'],.slide-card input[class^='s-secondary']{width:100%;padding:10px 12px;border:1px solid rgba(43,39,36,.25);border-radius:2px}
      #add-slide{background:#fff;color:var(--char);border:1px dashed rgba(43,39,36,.4)}
    </style>

    <h1>Homepage banners</h1>
    <p class="muted">Add one or more banners for the top of the homepage. With more than one they
      slide automatically left to right. After saving, press <strong>Publish site</strong> to update
      the live pages (~2 minutes).</p>
    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">Saved. Now press “Publish site” to make it live.</div>` : ""}

    <form method="post" action="/admin/publish" style="margin:14px 0">
      <button type="submit" style="background:var(--gold)">⟳ Publish site (make changes live)</button>
    </form>

    <form method="post" action="/admin/content" id="content-form">
      <input type="hidden" name="slides_json" id="slides_json"/>

      <div id="slides">${cards}</div>
      <button type="button" id="add-slide">＋ Add another banner</button>

      <h2 style="font-family:Georgia,serif;font-weight:400;font-size:20px;margin:28px 0 4px">Announcement bar</h2>
      <p class="muted" style="font-size:13px;margin:0 0 10px">The thin scrolling strip at the very top. One message per line. Leave empty to hide the bar.</p>
      <div class="field" style="max-width:720px">
        <textarea name="announcements" rows="4" style="width:100%;padding:10px 12px" placeholder="Free shipping on orders over ₹2,500">${esc(c.announcements.join("\n"))}</textarea>
      </div>

      <button type="submit">Save changes</button>
    </form>

    <template id="slide-tpl">${slideCard(EMPTY_SLIDE, -1)}</template>

    <script>
      const slidesEl = document.getElementById('slides');
      const tpl = document.getElementById('slide-tpl');

      function renumber() {
        const cards = slidesEl.querySelectorAll('.slide-card');
        cards.forEach((c, i) => { c.querySelector('.slide-title').textContent = 'Banner ' + (i + 1); });
        // Keep at least one banner; hide the remove button when only one remains.
        cards.forEach((c) => {
          c.querySelector('.btn-remove').style.display = cards.length > 1 ? '' : 'none';
        });
      }

      async function uploadFor(card) {
        const input = card.querySelector('.s-file');
        const status = card.querySelector('.s-status');
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
          const data = await res.json();
          card.querySelector('.s-imageId').value = data.id;
          card.querySelector('.s-preview').innerHTML =
            '<img src="/api/images/' + data.id + '" alt="Banner" class="s-img"/>';
          status.textContent = 'Uploaded ✓';
        } catch (e) {
          status.textContent = 'Upload failed: ' + e.message;
        }
      }

      slidesEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove')) {
          const cards = slidesEl.querySelectorAll('.slide-card');
          if (cards.length > 1) { e.target.closest('.slide-card').remove(); renumber(); }
        }
      });
      slidesEl.addEventListener('change', (e) => {
        if (e.target.classList.contains('s-file')) uploadFor(e.target.closest('.slide-card'));
      });

      document.getElementById('add-slide').addEventListener('click', () => {
        slidesEl.insertAdjacentHTML('beforeend', tpl.innerHTML);
        renumber();
      });

      document.getElementById('content-form').addEventListener('submit', (e) => {
        const slides = [...slidesEl.querySelectorAll('.slide-card')].map((c) => ({
          heading: c.querySelector('.s-heading').value,
          subtext: c.querySelector('.s-subtext').value,
          buttonLabel: c.querySelector('.s-buttonLabel').value,
          buttonLink: c.querySelector('.s-buttonLink').value,
          secondaryLabel: c.querySelector('.s-secondaryLabel').value,
          secondaryLink: c.querySelector('.s-secondaryLink').value,
          imageId: c.querySelector('.s-imageId').value ? Number(c.querySelector('.s-imageId').value) : null,
        }));
        document.getElementById('slides_json').value = JSON.stringify(slides);
      });

      renumber();
    </script>`;

  return htmlResponse(adminPage({ title: "Homepage banners", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();

  const announcements = String(form.get("announcements") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  let slides: BannerSlide[] = [];
  try {
    const parsed = JSON.parse(String(form.get("slides_json") ?? "[]"));
    if (Array.isArray(parsed)) slides = parsed;
  } catch {
    /* keep empty → falls back to a default slide below */
  }
  // Always keep at least one banner.
  if (!slides.length) slides = [EMPTY_SLIDE];

  await Promise.all([
    saveAnnouncements(env, announcements),
    saveBannerSlides(env, slides),
  ]);

  // Prune banner photos that no longer belong to any slide.
  const inUse = await getBannerImageIdsInUse(env);
  const stored = await listImages(env, HERO_SLUG);
  for (const img of stored) if (!inUse.has(img.id)) await deleteImage(env, img.id);

  return Response.redirect(new URL("/admin/content?saved=1", request.url).href, 303);
};
