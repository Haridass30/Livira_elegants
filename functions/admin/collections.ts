/** /admin/collections — manage the two-level category tree (mains + subs). */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import {
  listCollections,
  buildCollectionTree,
  createCollection,
  renameCollection,
  deleteCollection,
  type CollectionRow,
  type CollectionNode,
} from "../_lib/catalogDb";

const inputStyle =
  "padding:8px 10px;border:1px solid rgba(43,39,36,.25);border-radius:2px";

/** Rename + delete controls shared by mains and subs. */
function renameForm(c: CollectionRow): string {
  return `<form method="post" style="display:flex;gap:8px;align-items:center">
    <input type="hidden" name="action" value="rename"/>
    <input type="hidden" name="old_name" value="${esc(c.name)}"/>
    <input name="new_name" value="${esc(c.name)}" style="${inputStyle};min-width:180px"/>
    <button type="submit">Rename</button>
  </form>`;
}

function deleteForm(c: CollectionRow, isGroup: boolean): string {
  const hasProducts = (c.product_count ?? 0) > 0;
  const disabled = hasProducts
    ? ' disabled title="Move its products first"'
    : "";
  const confirm = isGroup
    ? `Delete group “${esc(c.name)}”? (must have no sub-categories)`
    : `Delete “${esc(c.name)}”?`;
  return `<form method="post" onsubmit="return confirm('${confirm}')">
    <input type="hidden" name="action" value="delete"/>
    <input type="hidden" name="name" value="${esc(c.name)}"/>
    <button type="submit" style="background:#8a2f2f"${disabled}>Delete</button>
  </form>`;
}

function subRow(s: CollectionRow): string {
  return `<tr>
    <td style="padding-left:32px">↳ ${renameForm(s)}</td>
    <td>${s.product_count} product${s.product_count === 1 ? "" : "s"}</td>
    <td>${deleteForm(s, false)}</td>
  </tr>`;
}

function mainBlock(m: CollectionNode): string {
  const isGroup = m.kind === "group";
  const badge = isGroup
    ? `<span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;background:#efe7dd;padding:2px 8px;border-radius:2px">Group</span>`
    : `<span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;background:#e4f0e6;color:#2f6b3a;padding:2px 8px;border-radius:2px">Direct</span>`;

  const meta = isGroup
    ? `${m.children.length} sub-categor${m.children.length === 1 ? "y" : "ies"}`
    : `${m.product_count} product${m.product_count === 1 ? "" : "s"}`;

  const header = `<tr style="background:#faf7f2">
    <td><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${badge} ${renameForm(m)}</div></td>
    <td>${meta}</td>
    <td>${deleteForm(m, isGroup)}</td>
  </tr>`;

  const subs = isGroup ? m.children.map(subRow).join("") : "";

  const addSub = isGroup
    ? `<tr><td colspan="3" style="padding:6px 12px 14px 32px">
        <form method="post" style="display:flex;gap:8px;max-width:420px">
          <input type="hidden" name="action" value="create_sub"/>
          <input type="hidden" name="parent" value="${esc(m.name)}"/>
          <input name="name" required placeholder="Add a sub-category to “${esc(m.name)}”" style="${inputStyle};flex:1"/>
          <button type="submit">Add sub</button>
        </form>
      </td></tr>`
    : "";

  return header + subs + addSub;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");
  const tree = buildCollectionTree(await listCollections(env));

  const rows =
    tree.length === 0
      ? `<tr><td colspan="3" class="muted" style="padding:28px;text-align:center">No collections yet.</td></tr>`
      : tree.map(mainBlock).join("");

  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>Collections</h1>
    <p class="muted">Collections group products in the shop. A <strong>Direct</strong> main category holds products itself; a <strong>Group</strong> main category holds sub-categories, and products live under those. A category can only be deleted when it has no products (and no sub-categories).</p>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <table>
      <thead><tr><th>Name</th><th>Contains</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:32px">Add a main category</h2>
    <form method="post" style="display:flex;gap:10px;flex-wrap:wrap;max-width:560px;align-items:center">
      <input type="hidden" name="action" value="create_main"/>
      <input name="name" required placeholder="e.g. Anklets" style="${inputStyle};flex:1;min-width:200px"/>
      <select name="kind" style="${inputStyle}">
        <option value="direct">Direct — holds products</option>
        <option value="group">Group — holds sub-categories</option>
      </select>
      <button type="submit">Add</button>
    </form>
    <p class="muted" style="margin-top:14px;font-size:13px">After changing collections, press <strong>Publish site</strong> on the Products page so the shop menus update.</p>`;

  return htmlResponse(adminPage({ title: "Collections", body }));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const back = (params: string) =>
    Response.redirect(new URL(`/admin/collections?${params}`, request.url).href, 303);
  const ok = (m: string) => back("msg=" + encodeURIComponent(m));
  const fail = (m: string) => back("err=" + encodeURIComponent(m));

  try {
    if (action === "create_main") {
      const name = String(form.get("name") ?? "").trim();
      const kind = String(form.get("kind") ?? "direct") === "group" ? "group" : "direct";
      if (name.length < 2 || name.length > 40)
        return fail("Name must be 2–40 characters.");
      await createCollection(env, name, null, kind);
      return ok(`Main category “${name}” added.`);
    }

    if (action === "create_sub") {
      const name = String(form.get("name") ?? "").trim();
      const parent = String(form.get("parent") ?? "").trim();
      if (name.length < 2 || name.length > 40)
        return fail("Name must be 2–40 characters.");
      const all = await listCollections(env);
      const parentRow = all.find((c) => c.name === parent);
      if (!parentRow || parentRow.parent || parentRow.kind !== "group")
        return fail("Sub-categories can only be added to a Group main category.");
      await createCollection(env, name, parent, "direct");
      return ok(`Sub-category “${name}” added to “${parent}”.`);
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
      const block = await deleteCollection(env, name);
      if (block === "products")
        return fail("Move its products to another collection first.");
      if (block === "children")
        return fail("Delete its sub-categories first.");
      return ok("Collection deleted.");
    }

    return fail("Unknown action.");
  } catch (e) {
    const dup = String(e).includes("UNIQUE");
    return fail(
      dup ? "A collection with that name already exists." : "Could not save.",
    );
  }
};
