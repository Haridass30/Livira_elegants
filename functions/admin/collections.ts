/** /admin/collections — create, rename and delete collections (categories). */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "../_lib/env";
import { adminPage, htmlResponse, esc } from "../_lib/adminHtml";
import {
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
} from "../_lib/catalogDb";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");
  const collections = await listCollections(env);

  const rows =
    collections.length === 0
      ? `<tr><td colspan="3" class="muted" style="padding:28px;text-align:center">No collections yet.</td></tr>`
      : collections
          .map(
            (c) => `<tr>
        <td>
          <form method="post" style="display:flex;gap:8px;align-items:center">
            <input type="hidden" name="action" value="rename"/>
            <input type="hidden" name="old_name" value="${esc(c.name)}"/>
            <input name="new_name" value="${esc(c.name)}" style="padding:8px 10px;border:1px solid rgba(43,39,36,.25);border-radius:2px"/>
            <button type="submit">Rename</button>
          </form>
        </td>
        <td>${c.product_count} product${c.product_count === 1 ? "" : "s"}</td>
        <td>
          <form method="post" onsubmit="return confirm('Delete collection ${esc(c.name)}?')">
            <input type="hidden" name="action" value="delete"/>
            <input type="hidden" name="name" value="${esc(c.name)}"/>
            <button type="submit" style="background:#8a2f2f"${(c.product_count ?? 0) > 0 ? " disabled title=\"Move its products first\"" : ""}>Delete</button>
          </form>
        </td>
      </tr>`,
          )
          .join("");

  const body = `
    <p><a href="/admin/products">← Back to products</a></p>
    <h1>Collections</h1>
    <p class="muted">Collections group products in the shop (e.g. Rings, Necklaces). A collection can only be deleted when it has no products.</p>
    ${msg ? `<div class="err" style="background:#e4f0e6;color:#2f6b3a">${esc(msg)}</div>` : ""}
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <table>
      <thead><tr><th>Name</th><th>Products</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:32px">Add a collection</h2>
    <form method="post" style="display:flex;gap:10px;max-width:420px">
      <input type="hidden" name="action" value="create"/>
      <input name="name" required placeholder="e.g. Anklets" style="flex:1;padding:10px 12px;border:1px solid rgba(43,39,36,.25);border-radius:2px"/>
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

  try {
    if (action === "create") {
      const name = String(form.get("name") ?? "").trim();
      if (name.length < 2 || name.length > 40)
        return back("err=" + encodeURIComponent("Name must be 2–40 characters."));
      await createCollection(env, name);
      return back("msg=" + encodeURIComponent(`Collection “${name}” added.`));
    }
    if (action === "rename") {
      const oldName = String(form.get("old_name") ?? "");
      const newName = String(form.get("new_name") ?? "").trim();
      if (!oldName || newName.length < 2)
        return back("err=" + encodeURIComponent("Enter a valid name."));
      if (oldName !== newName) await renameCollection(env, oldName, newName);
      return back("msg=" + encodeURIComponent("Collection renamed."));
    }
    if (action === "delete") {
      const name = String(form.get("name") ?? "");
      const ok = await deleteCollection(env, name);
      return back(
        ok
          ? "msg=" + encodeURIComponent("Collection deleted.")
          : "err=" + encodeURIComponent("Move its products to another collection first."),
      );
    }
    return back("err=" + encodeURIComponent("Unknown action."));
  } catch (e) {
    const dup = String(e).includes("UNIQUE");
    return back(
      "err=" +
        encodeURIComponent(dup ? "A collection with that name already exists." : "Could not save."),
    );
  }
};
