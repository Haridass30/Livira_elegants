/**
 * /admin/content — edit the homepage banners (a sliding carousel) and the top
 * announcement bar. Each banner has its own heading, sub-text, buttons and
 * photo. Banners are shown as compact, collapsible rows so a long list stays
 * easy to scan and reorder. Saved to D1; static pages refresh on next Publish.
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

/** Render one collapsible banner row. `idx` is 0-based; -1 is the JS template. */
function slideCard(s: BannerSlide, idx: number, open: boolean): string {
  const thumb = s.imageId
    ? `<img src="/api/images/${s.imageId}" alt=""/>`
    : `<span class="thumb-ph">▦</span>`;
  const preview = s.imageId
    ? `<img src="/api/images/${s.imageId}" alt="Banner"/>`
    : `<span class="s-empty">No image yet — a default is shown.</span>`;
  return `
  <details class="slide-card"${open ? " open" : ""}>
    <summary class="slide-summary">
      <span class="slide-grip">⋮⋮</span>
      <span class="slide-thumb">${thumb}</span>
      <span class="slide-meta">
        <span class="slide-title">Banner ${idx + 1}</span>
        <span class="slide-sub muted">${esc(s.heading) || "Untitled banner"}</span>
      </span>
      <button type="button" class="btn-remove" title="Remove this banner">Remove</button>
      <span class="chev">⌄</span>
    </summary>
    <div class="slide-body">
      <div class="slide-grid">
        <div>
          <div class="s-preview">${preview}</div>
          <input type="hidden" class="s-imageId" value="${s.imageId ?? ""}"/>
          <label class="s-upload">
            <input type="file" class="s-file" accept="image/*" hidden/>
            <span class="s-upload-btn">Choose image…</span>
            <span class="s-status muted"></span>
          </label>
          <p class="muted hint">Wide/landscape works best (e.g. 2000×1200), under ~1.4 MB.</p>
        </div>
        <div>
          <div class="field"><label>Heading</label>
            <input class="s-heading in" value="${esc(s.heading)}" maxlength="80"/></div>
          <div class="field"><label>Sub-text</label>
            <textarea class="s-subtext in" rows="2">${esc(s.subtext)}</textarea></div>
          <div class="grid2">
            <div class="field"><label>Button text</label>
              <input class="s-buttonLabel in" value="${esc(s.buttonLabel)}" maxlength="30"/></div>
            <div class="field"><label>Button link</label>
              <input class="s-buttonLink in" value="${esc(s.buttonLink)}" placeholder="/shop"/></div>
            <div class="field"><label>2nd button (blank = hide)</label>
              <input class="s-secondaryLabel in" value="${esc(s.secondaryLabel)}" maxlength="30"/></div>
            <div class="field"><label>2nd button link</label>
              <input class="s-secondaryLink in" value="${esc(s.secondaryLink)}" placeholder="/about"/></div>
          </div>
        </div>
      </div>
    </div>
  </details>`;
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

  // Existing banners collapse (except when there's only one) so the list is
  // short and scannable; newly added banners open automatically.
  const single = c.slides.length === 1;
  const cards = c.slides.map((s, i) => slideCard(s, i, single)).join("");

  const body = `
    <style>
      .page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;box-shadow:var(--shadow);margin:0 0 22px}
      .panel > h2{font-size:19px;margin:0 0 2px}
      .panel > .sub{font-size:13px;margin:0 0 16px}

      .slide-card{border:1px solid var(--line);border-radius:10px;background:#fff;margin:0 0 10px;overflow:hidden;transition:border-color .15s}
      .slide-card[open]{border-color:rgba(184,137,63,.5)}
      .slide-summary{display:flex;align-items:center;gap:12px;padding:11px 13px;cursor:pointer;list-style:none}
      .slide-summary::-webkit-details-marker{display:none}
      .slide-summary:hover{background:rgba(184,137,63,.04)}
      .slide-grip{color:rgba(43,39,36,.28);letter-spacing:-3px;font-size:15px;cursor:grab}
      .slide-thumb{width:60px;height:38px;flex:0 0 auto;border-radius:6px;overflow:hidden;border:1px solid var(--line);background:var(--bone);display:flex;align-items:center;justify-content:center}
      .slide-thumb img{width:100%;height:100%;object-fit:cover}
      .thumb-ph{color:rgba(43,39,36,.3);font-size:18px}
      .slide-meta{flex:1;min-width:0}
      .slide-title{display:block;font-family:Georgia,serif;font-size:15px;line-height:1.2}
      .slide-sub{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .btn-remove{background:none;color:#b23a3a;border:1px solid rgba(178,58,58,.3);padding:5px 11px;border-radius:7px;font-size:12px;font-weight:400;box-shadow:none}
      .btn-remove:hover{background:#fbeaea;box-shadow:none}
      .chev{color:rgba(43,39,36,.4);transition:transform .2s;font-size:16px}
      details[open] .chev{transform:rotate(180deg)}
      .slide-body{border-top:1px solid rgba(43,39,36,.08);padding:16px 16px 6px}
      .slide-grid{display:grid;grid-template-columns:210px 1fr;gap:20px}
      @media(max-width:640px){.slide-grid{grid-template-columns:1fr}}
      .s-preview{border-radius:8px;overflow:hidden;border:1px solid var(--line);background:var(--bone);aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
      .s-preview img{width:100%;height:100%;object-fit:cover;display:block}
      .s-empty{font-size:12px;color:rgba(43,39,36,.5);text-align:center;padding:8px}
      .s-upload{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .s-upload-btn{display:inline-block;padding:7px 13px;border:1px solid var(--line);border-radius:7px;font-size:13px;cursor:pointer;background:#fff}
      .s-upload-btn:hover{border-color:var(--gold)}
      .hint{font-size:12px;margin:8px 0 0}
      .in{width:100%;padding:9px 11px;border:1px solid rgba(43,39,36,.2);border-radius:7px}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media(max-width:520px){.grid2{grid-template-columns:1fr}}
      #add-slide{background:#fff;color:var(--char);border:1px dashed rgba(184,137,63,.6);width:100%;padding:13px;font-weight:500}
      #add-slide:hover{background:rgba(184,137,63,.06);box-shadow:none}
      .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:20px}
      .save-btn{background:var(--char)}
      .publish-btn{background:linear-gradient(120deg,#a06f34,#b8893f 50%,#d9b988);color:#241318}
    </style>

    <div class="page-head">
      <div>
        <h1>Homepage banners</h1>
        <p class="muted" style="margin:4px 0 0;max-width:560px">Add one or more banners for the top of the homepage. With more than one they
          slide automatically. Click a banner to expand it. Save, then <strong>Publish site</strong> to go live (~2 min).</p>
      </div>
      <form method="post" action="/admin/publish" style="margin:0">
        <button type="submit" class="publish-btn">⟳ Publish site</button>
      </form>
    </div>

    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a;border:1px solid #bfe0c6">Saved. Now press <strong>Publish site</strong> to make it live.</div>` : ""}

    <form method="post" action="/admin/content" id="content-form" style="margin-top:20px">
      <input type="hidden" name="slides_json" id="slides_json"/>

      <div class="panel">
        <h2>Banners</h2>
        <p class="sub muted">Each banner has its own image, heading, buttons.</p>
        <div id="slides">${cards}</div>
        <button type="button" id="add-slide">＋ Add another banner</button>
      </div>

      <div class="panel">
        <h2>Announcement bar</h2>
        <p class="sub muted">The thin scrolling strip at the very top. One message per line. Leave empty to hide it.</p>
        <textarea name="announcements" rows="4" class="in" placeholder="Free shipping on orders over ₹2,500">${esc(c.announcements.join("\n"))}</textarea>
      </div>

      <div class="actions">
        <button type="submit" class="save-btn">Save changes</button>
        <span class="muted" style="font-size:13px">Uploads are saved instantly; text saves on “Save changes”.</span>
      </div>
    </form>

    <template id="slide-tpl">${slideCard(EMPTY_SLIDE, -1, true)}</template>

    <script>
      const slidesEl = document.getElementById('slides');
      const tpl = document.getElementById('slide-tpl');

      function renumber() {
        const cards = slidesEl.querySelectorAll('.slide-card');
        cards.forEach((c, i) => { c.querySelector('.slide-title').textContent = 'Banner ' + (i + 1); });
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
          const url = '/api/images/' + data.id;
          card.querySelector('.s-preview').innerHTML = '<img src="' + url + '" alt="Banner"/>';
          card.querySelector('.slide-thumb').innerHTML = '<img src="' + url + '" alt=""/>';
          status.textContent = 'Uploaded ✓';
        } catch (e) {
          status.textContent = 'Upload failed: ' + e.message;
        }
      }

      slidesEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove')) {
          e.preventDefault();
          const cards = slidesEl.querySelectorAll('.slide-card');
          if (cards.length > 1) { e.target.closest('.slide-card').remove(); renumber(); }
        }
      });
      slidesEl.addEventListener('change', (e) => {
        if (e.target.classList.contains('s-file')) uploadFor(e.target.closest('.slide-card'));
      });
      // Live-update the collapsed row's preview text as the heading is typed.
      slidesEl.addEventListener('input', (e) => {
        if (e.target.classList.contains('s-heading')) {
          const sub = e.target.closest('.slide-card').querySelector('.slide-sub');
          sub.textContent = e.target.value || 'Untitled banner';
        }
      });

      document.getElementById('add-slide').addEventListener('click', () => {
        slidesEl.insertAdjacentHTML('beforeend', tpl.innerHTML);
        renumber();
        slidesEl.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      document.getElementById('content-form').addEventListener('submit', () => {
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
