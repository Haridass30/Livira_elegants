/**
 * /admin/collections — manage a simple category tree.
 *
 * Any collection can sit at the top level (a "main" category) or be nested
 * under one main (a "sub-category") by choosing its Parent. Products can be
 * added to any collection. Two levels deep is the max.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import {
  listCollections,
  buildCollectionTree,
  createCollection,
  renameCollection,
  deleteCollection,
  setCollectionParent,
  setCollectionHidden,
  setCollectionImage,
  type CollectionRow,
  type CollectionNode,
} from "../_lib/catalogDb";

function imageCell(c: CollectionRow): string {
  const thumb = c.image_id
    ? `<img src="/api/images/${c.image_id}" alt="" style="width:44px;height:56px;object-fit:cover;border-radius:4px;vertical-align:middle"/>`
    : `<span style="display:inline-flex;width:44px;height:56px;border-radius:4px;background:var(--bone);align-items:center;justify-content:center;color:rgba(43,39,36,.4);font-size:10px">none</span>`;
  const remove = c.image_id
    ? `<form method="post" style="margin:0"><input type="hidden" name="action" value="set_image"/><input type="hidden" name="name" value="${esc(c.name)}"/><input type="hidden" name="image_id" value=""/><button type="submit" style="background:#fff;color:var(--char);border:1px solid var(--line);font-size:11px;padding:2px 8px">Remove</button></form>`
    : "";
  return `<div style="display:flex;align-items:center;gap:8px">
    ${thumb}
    <div style="display:flex;flex-direction:column;gap:4px">
      <label class="s-upload"><input type="file" accept="image/*" class="col-file" data-name="${esc(c.name)}" hidden/><span class="s-upload-btn">Photo…</span></label>
      ${remove}
    </div>
  </div>`;
}

const inputStyle =
  "padding:8px 10px;border:1px solid rgba(43,39,36,.25);border-radius:2px";

function renameForm(c: CollectionRow, indent = false): string {
  return `<form method="post" style="display:flex;gap:8px;align-items:center">
    <input type="hidden" name="action" value="rename"/>
    <input type="hidden" name="old_name" value="${esc(c.name)}"/>
    ${indent ? '<span style="color:#9a8">↳</span>' : ""}
    <input name="new_name" value="${esc(c.name)}" style="${inputStyle};min-width:180px"/>
    <button type="submit">Rename</button>
  </form>`;
}

/** A dropdown that re-parents a collection. `mains` = valid top-level parents. */
function parentForm(c: CollectionRow, mains: CollectionRow[], canNest: boolean): string {
  if (!canNest) {
    // A main that itself has sub-categories can't become a sub (max 2 levels).
    return `<span class="muted" style="font-size:12px">Top level</span>`;
  }
  const options = [
    `<option value=""${c.parent ? "" : " selected"}>— None (top level) —</option>`,
    ...mains
      .filter((m) => m.name !== c.name)
      .map(
        (m) =>
          `<option value="${esc(m.name)}"${c.parent === m.name ? " selected" : ""}>${esc(m.name)}</option>`,
      ),
  ].join("");
  return `<form method="post" style="display:flex;gap:6px;align-items:center">
    <input type="hidden" name="action" value="set_parent"/>
    <input type="hidden" name="name" value="${esc(c.name)}"/>
    <select name="parent" onchange="this.form.submit()" style="${inputStyle}">${options}</select>
    <noscript><button type="submit">Move</button></noscript>
  </form>`;
}

function deleteForm(c: CollectionRow, hasChildren: boolean): string {
  const count = c.product_count ?? 0;
  const warn: string[] = [];
  if (count > 0) warn.push(`${count} product${count === 1 ? "" : "s"}`);
  if (hasChildren) warn.push("its sub-categories");
  const extra = warn.length ? ` This also permanently deletes ${warn.join(" and ")}.` : "";
  return `<form method="post" onsubmit="return confirm('Delete “${esc(c.name)}”?${extra} This cannot be undone.')">
    <input type="hidden" name="action" value="delete"/>
    <input type="hidden" name="name" value="${esc(c.name)}"/>
    <button type="submit" style="background:#8a2f2f">Delete</button>
  </form>`;
}

function hiddenForm(c: CollectionRow): string {
  const hidden = c.hidden === 1;
  return `<form method="post" style="display:inline;margin-right:6px">
    <input type="hidden" name="action" value="toggle_hidden"/>
    <input type="hidden" name="name" value="${esc(c.name)}"/>
    <input type="hidden" name="hidden" value="${hidden ? "0" : "1"}"/>
    <button type="submit" style="background:${hidden ? "#2f6b3a" : "#8a6d1e"}">${hidden ? "Show" : "Hide"}</button>
  </form>`;
}

function rowFor(
  c: CollectionRow,
  opts: { indent: boolean; mains: CollectionRow[]; hasChildren: boolean },
): string {
  const count = c.product_count ?? 0;
  const rowStyle = c.hidden === 1 ? ' style="opacity:.55"' : opts.indent ? ' style="background:#fcfbf9"' : "";
  return `<tr${rowStyle}>
    <td style="${opts.indent ? "padding-left:26px" : ""}">${renameForm(c, opts.indent)}${c.hidden === 1 ? ' <span class="muted" style="font-size:11px">· hidden</span>' : ""}</td>
    <td>${imageCell(c)}</td>
    <td>${count} product${count === 1 ? "" : "s"}</td>
    <td>${parentForm(c, opts.mains, !opts.hasChildren)}</td>
    <td style="white-space:nowrap">${hiddenForm(c)}${deleteForm(c, opts.hasChildren)}</td>
  </tr>`;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");
  const all = await listCollections(env);
  const tree = buildCollectionTree(all);
  const mains = tree as CollectionRow[]; // top-level rows only

  const rows =
    tree.length === 0
      ? `<tr><td colspan="5" class="muted" style="padding:28px;text-align:center">No collections yet — add your first one below.</td></tr>`
      : tree
          .map((m: CollectionNode) => {
            const head = rowFor(m, {
              indent: false,
              mains,
              hasChildren: m.children.length > 0,
            });
            const kids = m.children
              .map((s) => rowFor(s, { indent: true, mains, hasChildren: false }))
              .join("");
            return head + kids;
          })
          .join("");

  // Parent options for the "add" form (top-level collections only).
  const addParentOptions = [
    `<option value="">— None (top level) —</option>`,
    ...mains.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`),
  ].join("");

  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>Collections</h1>
    <p class="muted">Your shop categories, as a simple tree. A collection with no parent is a <strong>main category</strong>; give it a <strong>Parent</strong> to make it a <strong>sub-category</strong> (e.g. parent <em>Necklaces</em> → <em>Gold Necklaces</em>, <em>Silver Necklaces</em>). You can add products to any collection from the product editor. Two levels deep max.</p>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <table>
      <thead><tr><th>Collection</th><th>Image</th><th>Products</th><th>Parent</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <style>
      .s-upload{display:inline-flex;align-items:center}
      .s-upload-btn{display:inline-block;padding:4px 10px;border:1px solid var(--line);border-radius:6px;font-size:11.5px;cursor:pointer;background:#fff}
      .s-upload-btn:hover{border-color:var(--gold)}
    </style>
    <script>
      async function uploadCol(input){
        const name=input.dataset.name;const file=input.files&&input.files[0];if(!file)return;
        const btn=input.parentElement.querySelector('.s-upload-btn');const orig=btn.textContent;btn.textContent='Uploading…';
        try{
          const img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=URL.createObjectURL(file)});
          const max=1000;let w=img.width,h=img.height;if(w>max||h>max){const r=Math.min(max/w,max/h);w=Math.round(w*r);h=Math.round(h*r)}
          const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(img,0,0,w,h);
          const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.85));
          const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(blob)});
          const res=await fetch('/admin/collections/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mime:'image/jpeg',width:w,height:h,dataBase64:b64})});
          const data=await res.json();if(!data.ok)throw new Error(data.errors?data.errors.join(' '):'Upload failed');
          const f=document.createElement('form');f.method='post';f.style.display='none';
          f.innerHTML='<input type="hidden" name="action" value="set_image"><input type="hidden" name="name"><input type="hidden" name="image_id">';
          f.querySelector('input[name="name"]').value=name;f.querySelector('input[name="image_id"]').value=String(data.id);
          document.body.appendChild(f);f.submit();
        }catch(e){alert('Could not upload: '+e.message);btn.textContent=orig}
      }
      document.addEventListener('change',e=>{if(e.target.classList.contains('col-file'))uploadCol(e.target)});
    </script>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:32px">Add a collection</h2>
    <form method="post" style="display:flex;gap:10px;flex-wrap:wrap;max-width:620px;align-items:center">
      <input type="hidden" name="action" value="create"/>
      <input name="name" required placeholder="e.g. Gold Necklaces" style="${inputStyle};flex:1;min-width:200px"/>
      <label class="muted" style="font-size:13px">Parent
        <select name="parent" style="${inputStyle};margin-left:6px">${addParentOptions}</select>
      </label>
      <button type="submit">Add</button>
    </form>
    <p class="muted" style="margin-top:14px;font-size:13px">Collection changes show on the shop automatically the next time it's opened or refreshed — no publish needed.</p>`;

  return htmlResponse(adminPage({ title: "Collections", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const back = (params: string) =>
    Response.redirect(new URL(`/admin/collections?${params}`, request.url).href, 303);
  const ok = (m: string) => back("msg=" + encodeURIComponent(m));
  const fail = (m: string) => back("err=" + encodeURIComponent(m));

  // A collection may be nested only under a top-level collection, and only if
  // it has no children of its own — keeping the tree at two levels.
  const validateNesting = async (
    name: string,
    parent: string,
  ): Promise<string | null> => {
    if (!parent) return null; // moving to top level is always fine
    if (parent === name) return "A collection can’t be its own parent.";
    const all = await listCollections(env);
    const parentRow = all.find((c) => c.name === parent);
    if (!parentRow) return "That parent no longer exists.";
    if (parentRow.parent)
      return `“${parent}” is already a sub-category — pick a main category as the parent.`;
    if (all.some((c) => c.parent === name))
      return `“${name}” has sub-categories, so it can’t become a sub-category itself. Move or remove those first.`;
    return null;
  };

  try {
    if (action === "create") {
      const name = String(form.get("name") ?? "").trim();
      const parent = String(form.get("parent") ?? "").trim() || null;
      if (name.length < 2 || name.length > 40)
        return fail("Name must be 2–40 characters.");
      if (parent) {
        const problem = await validateNesting(name, parent);
        if (problem) return fail(problem);
      }
      await createCollection(env, name, parent);
      return ok(
        parent
          ? `“${name}” added under “${parent}”.`
          : `Main category “${name}” added.`,
      );
    }

    if (action === "set_parent") {
      const name = String(form.get("name") ?? "");
      const parent = String(form.get("parent") ?? "").trim() || null;
      const problem = await validateNesting(name, parent ?? "");
      if (problem) return fail(problem);
      await setCollectionParent(env, name, parent);
      return ok(
        parent ? `“${name}” moved under “${parent}”.` : `“${name}” moved to the top level.`,
      );
    }

    if (action === "set_image") {
      const name = String(form.get("name") ?? "");
      const raw = String(form.get("image_id") ?? "");
      const id = raw ? Number(raw) : null;
      if (name) await setCollectionImage(env, name, Number.isInteger(id) && (id as number) > 0 ? id : null);
      return ok(id ? `Photo added to “${name}”.` : `Photo removed from “${name}”.`);
    }

    if (action === "toggle_hidden") {
      const name = String(form.get("name") ?? "");
      const hidden = String(form.get("hidden") ?? "") === "1";
      if (name) await setCollectionHidden(env, name, hidden);
      return ok(hidden ? `“${name}” is now hidden from the shop.` : `“${name}” is visible again.`);
    }

    if (action === "rename") {
      const oldName = String(form.get("old_name") ?? "");
      const newName = String(form.get("new_name") ?? "").trim();
      if (!oldName || newName.length < 2) return fail("Enter a valid name.");
      if (oldName !== newName) await renameCollection(env, oldName, newName);
      return ok("Collection renamed.");
    }

    if (action === "delete") {
      const name = String(form.get("name") ?? "");
      const { products } = await deleteCollection(env, name);
      return ok(
        products > 0
          ? `“${name}” deleted, along with ${products} product${products === 1 ? "" : "s"}.`
          : `“${name}” deleted.`,
      );
    }

    return fail("Unknown action.");
  } catch (e) {
    const dup = String(e).includes("UNIQUE");
    return fail(
      dup ? "A collection with that name already exists." : "Could not save.",
    );
  }
};
