/**
 * /admin/bento — manage the homepage "bento" grid: up to 5 image tiles, each
 * with an optional link and caption. Box 1 is the large feature tile.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../../_lib/env";
import { adminPage, htmlResponse, esc } from "../../_lib/adminHtml";
import { getBento, saveBento, getBentoImageIdsInUse, type BentoBox } from "../../_lib/settings";
import { listImages, deleteImage } from "../../_lib/catalogDb";

const LABELS = ["Large feature", "Tile 2", "Tile 3", "Tile 4", "Tile 5"];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const saved = url.searchParams.get("saved");
  const boxes = await getBento(env);

  const slot = (i: number) => {
    const b = boxes[i] ?? { imageId: null, link: "", caption: "" };
    const preview = b.imageId
      ? `<img src="/api/images/${b.imageId}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:8px;display:block"/>`
      : `<div style="width:100%;height:130px;border-radius:8px;background:var(--bone);display:flex;align-items:center;justify-content:center;color:rgba(43,39,36,.4);font-size:13px">No image</div>`;
    return `<div style="border:1px solid var(--line);border-radius:12px;padding:14px;background:#fff">
      <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(43,39,36,.55)">${LABELS[i]}</p>
      <div class="bento-preview" data-i="${i}">${preview}</div>
      <input type="hidden" name="imageId_${i}" value="${b.imageId ?? ""}"/>
      <label class="s-upload" style="margin-top:10px">
        <input type="file" accept="image/*" class="bento-file" data-i="${i}" hidden/>
        <span class="s-upload-btn">Choose image…</span>
      </label>
      <input name="link_${i}" value="${esc(b.link)}" placeholder="Link e.g. /shop?category=Necklaces" style="margin-top:10px;width:100%;padding:8px 10px;border:1px solid rgba(43,39,36,.2);border-radius:7px"/>
      <input name="caption_${i}" value="${esc(b.caption)}" placeholder="Caption (optional)" style="margin-top:8px;width:100%;padding:8px 10px;border:1px solid rgba(43,39,36,.2);border-radius:7px"/>
    </div>`;
  };

  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>Homepage bento</h1>
    <p class="muted">Up to 5 image tiles shown in a collage on the homepage. The first is the large feature tile. Each can link somewhere (a collection, a product, any URL). Empty tiles are skipped. Changes show on the homepage on the next refresh.</p>
    ${saved ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a;border:1px solid #bfe0c6">Saved. Open or refresh the homepage to see it.</div>` : ""}
    <form method="post" id="bento-form">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin:20px 0">
        ${[0, 1, 2, 3, 4].map(slot).join("")}
      </div>
      <button type="submit">Save bento</button>
    </form>

    <style>
      .s-upload{display:inline-flex;align-items:center;gap:9px}
      .s-upload-btn{display:inline-block;padding:7px 13px;border:1px solid var(--line);border-radius:7px;font-size:13px;cursor:pointer;background:#fff}
      .s-upload-btn:hover{border-color:var(--gold)}
    </style>
    <script>
      async function uploadFor(input) {
        const i = input.dataset.i;
        const file = input.files && input.files[0];
        if (!file) return;
        const btn = input.parentElement.querySelector('.s-upload-btn');
        const orig = btn.textContent; btn.textContent = 'Uploading…';
        try {
          const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
          const max = 1100; let w = img.width, h = img.height;
          if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
          const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
          const res = await fetch('/admin/bento/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mime: 'image/jpeg', width: w, height: h, dataBase64: b64 }) });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Upload failed');
          const form = document.getElementById('bento-form');
          form.querySelector('input[name="imageId_' + i + '"]').value = data.id;
          const prev = form.querySelector('.bento-preview[data-i="' + i + '"]');
          prev.innerHTML = '<img src="/api/images/' + data.id + '" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:8px;display:block">';
        } catch (e) {
          alert('Could not upload: ' + e.message);
        } finally {
          btn.textContent = orig;
        }
      }
      document.addEventListener('change', (e) => {
        if (e.target.classList.contains('bento-file')) uploadFor(e.target);
      });
    </script>`;

  return htmlResponse(adminPage({ title: "Bento", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const boxes: BentoBox[] = [];
  for (let i = 0; i < 5; i++) {
    const id = Number(form.get(`imageId_${i}`));
    boxes.push({
      imageId: Number.isInteger(id) && id > 0 ? id : null,
      link: String(form.get(`link_${i}`) ?? "").trim(),
      caption: String(form.get(`caption_${i}`) ?? "").trim(),
    });
  }
  await saveBento(env, boxes);

  // Prune bento images no longer referenced by any tile.
  const inUse = await getBentoImageIdsInUse(env);
  const stored = await listImages(env, "__bento__");
  await Promise.all(
    stored.filter((img) => !inUse.has(img.id)).map((img) => deleteImage(env, img.id)),
  );

  return Response.redirect(new URL("/admin/bento?saved=1", request.url).href, 303);
};
