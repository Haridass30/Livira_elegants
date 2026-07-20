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
  type CollectionRow,
  type CollectionNode,
} from "../_lib/catalogDb";

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

function deleteForm(c: CollectionRow, blockReason?: string): string {
  const disabled = blockReason ? ` disabled title="${esc(blockReason)}"` : "";
  return `<form method="post" onsubmit="return confirm('Delete “${esc(c.name)}”?')">
    <input type="hidden" name="action" value="delete"/>
    <input type="hidden" name="name" value="${esc(c.name)}"/>
    <button type="submit" style="background:#8a2f2f"${disabled}>Delete</button>
  </form>`;
}

function rowFor(
  c: CollectionRow,
  opts: { indent: boolean; mains: CollectionRow[]; hasChildren: boolean },
): string {
  const count = c.product_count ?? 0;
  const blockReason = opts.hasChildren
    ? "Remove its sub-categories first"
    : count > 0
      ? "Move its products first"
      : undefined;
  return `<tr${opts.indent ? ' style="background:#fcfbf9"' : ""}>
    <td style="${opts.indent ? "padding-left:26px" : ""}">${renameForm(c, opts.indent)}</td>
    <td>${count} product${count === 1 ? "" : "s"}</td>
    <td>${parentForm(c, opts.mains, !opts.hasChildren)}</td>
    <td>${deleteForm(c, blockReason)}</td>
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
      ? `<tr><td colspan="4" class="muted" style="padding:28px;text-align:center">No collections yet — add your first one below.</td></tr>`
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
      <thead><tr><th>Collection</th><th>Products</th><th>Parent</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 style="font-family:Georgia,serif;font-weight:400;margin-top:32px">Add a collection</h2>
    <form method="post" style="display:flex;gap:10px;flex-wrap:wrap;max-width:620px;align-items:center">
      <input type="hidden" name="action" value="create"/>
      <input name="name" required placeholder="e.g. Gold Necklaces" style="${inputStyle};flex:1;min-width:200px"/>
      <label class="muted" style="font-size:13px">Parent
        <select name="parent" style="${inputStyle};margin-left:6px">${addParentOptions}</select>
      </label>
      <button type="submit">Add</button>
    </form>
    <p class="muted" style="margin-top:14px;font-size:13px">After changing collections, press <strong>Publish site</strong> on the Products page so the shop menus update (takes ~2 minutes).</p>`;

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
      if (block === "children") return fail("Remove its sub-categories first.");
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
