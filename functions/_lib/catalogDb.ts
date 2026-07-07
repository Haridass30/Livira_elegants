/**
 * D1-backed product catalogue — the single source of truth for products,
 * images and collections. The admin edits these; the order functions price
 * carts from here; the static site pulls /api/products at build time.
 */
/// <reference types="@cloudflare/workers-types" />
import type { Env } from "./env";
import type { CatalogProduct } from "../../src/lib/pricing";

export interface ProductRow {
  slug: string;
  name: string;
  price: number;
  compare_at_price: number | null;
  category: string;
  material: string;
  weight_grams: number | null;
  dimensions: string | null;
  description: string;
  in_stock: number;
  stock_qty: number | null;
  featured: number;
  sku: string | null;
  tags: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ImageMeta {
  id: number;
  product_slug: string;
  position: number;
  mime: string;
  width: number;
  height: number;
}

/** Is the product actually orderable right now? */
export function effectiveInStock(p: ProductRow): boolean {
  return (
    p.active === 1 &&
    p.in_stock === 1 &&
    (p.stock_qty === null || p.stock_qty > 0)
  );
}

/** Catalog map for server-side pricing (slug → price/stock). */
export async function loadCatalog(
  env: Env,
): Promise<Record<string, CatalogProduct>> {
  const res = await env.DB.prepare(
    `SELECT * FROM products WHERE active = 1`,
  ).all<ProductRow>();
  const map: Record<string, CatalogProduct> = {};
  for (const p of res.results ?? []) {
    map[p.slug] = {
      slug: p.slug,
      name: p.name,
      price: p.price,
      category: p.category,
      inStock: effectiveInStock(p),
      stockQty: p.stock_qty,
      sku: p.sku ?? undefined,
    };
  }
  return map;
}

/** Decrement tracked stock after an order is recorded (no-op when untracked). */
export async function decrementStock(
  env: Env,
  lines: { slug: string; qty: number }[],
): Promise<void> {
  const stmt = env.DB.prepare(
    `UPDATE products
       SET stock_qty = MAX(0, stock_qty - ?), updated_at = datetime('now')
     WHERE slug = ? AND stock_qty IS NOT NULL`,
  );
  await env.DB.batch(lines.map((l) => stmt.bind(l.qty, l.slug)));
}

/* ------------------------------------------------------------------ *
 * Products CRUD (admin)
 * ------------------------------------------------------------------ */

export async function listProducts(env: Env): Promise<ProductRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM products WHERE active = 1 ORDER BY category, name`,
  ).all<ProductRow>();
  return res.results ?? [];
}

export async function getProduct(env: Env, slug: string): Promise<ProductRow | null> {
  return env.DB.prepare(`SELECT * FROM products WHERE slug = ?`)
    .bind(slug)
    .first<ProductRow>();
}

export interface ProductInput {
  name: string;
  price: number;
  compareAtPrice: number | null;
  category: string;
  material: string;
  weightGrams: number | null;
  dimensions: string | null;
  description: string;
  inStock: boolean;
  stockQty: number | null;
  featured: boolean;
  sku: string | null;
  tags: string;
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents: Lumière → Lumiere
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "product"
  );
}

/** Create with a unique slug derived from the name; returns the slug. */
export async function createProduct(env: Env, input: ProductInput): Promise<string> {
  let slug = slugify(input.name);
  const existing = await getProduct(env, slug);
  if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  await env.DB.prepare(
    `INSERT INTO products (
       slug, name, price, compare_at_price, category, material, weight_grams,
       dimensions, description, in_stock, stock_qty, featured, sku, tags
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      slug,
      input.name,
      input.price,
      input.compareAtPrice,
      input.category,
      input.material,
      input.weightGrams,
      input.dimensions,
      input.description,
      input.inStock ? 1 : 0,
      input.stockQty,
      input.featured ? 1 : 0,
      input.sku,
      input.tags,
    )
    .run();
  return slug;
}

export async function updateProduct(
  env: Env,
  slug: string,
  input: ProductInput,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE products SET
       name=?, price=?, compare_at_price=?, category=?, material=?,
       weight_grams=?, dimensions=?, description=?, in_stock=?, stock_qty=?,
       featured=?, sku=?, tags=?, updated_at=datetime('now')
     WHERE slug=?`,
  )
    .bind(
      input.name,
      input.price,
      input.compareAtPrice,
      input.category,
      input.material,
      input.weightGrams,
      input.dimensions,
      input.description,
      input.inStock ? 1 : 0,
      input.stockQty,
      input.featured ? 1 : 0,
      input.sku,
      input.tags,
      slug,
    )
    .run();
}

/** Soft delete — keeps the row for order history, removes images. */
export async function deleteProduct(env: Env, slug: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE products SET active = 0, updated_at = datetime('now') WHERE slug = ?`,
    ).bind(slug),
    env.DB.prepare(`DELETE FROM product_images WHERE product_slug = ?`).bind(slug),
  ]);
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

export async function listImages(env: Env, slug: string): Promise<ImageMeta[]> {
  const res = await env.DB.prepare(
    `SELECT id, product_slug, position, mime, width, height
     FROM product_images WHERE product_slug = ? ORDER BY position, id`,
  )
    .bind(slug)
    .all<ImageMeta>();
  return res.results ?? [];
}

export async function listAllImages(env: Env): Promise<ImageMeta[]> {
  const res = await env.DB.prepare(
    `SELECT id, product_slug, position, mime, width, height
     FROM product_images ORDER BY product_slug, position, id`,
  ).all<ImageMeta>();
  return res.results ?? [];
}

export async function addImage(
  env: Env,
  slug: string,
  mime: string,
  width: number,
  height: number,
  bytes: ArrayBuffer,
): Promise<number> {
  const pos = await env.DB.prepare(
    `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM product_images WHERE product_slug = ?`,
  )
    .bind(slug)
    .first<{ p: number }>();
  const res = await env.DB.prepare(
    `INSERT INTO product_images (product_slug, position, mime, width, height, bytes)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(slug, pos?.p ?? 0, mime, width, height, bytes)
    .run();
  return Number(res.meta.last_row_id);
}

export async function getImage(
  env: Env,
  id: number,
): Promise<{ mime: string; bytes: ArrayBuffer } | null> {
  const row = await env.DB.prepare(
    `SELECT mime, bytes FROM product_images WHERE id = ?`,
  )
    .bind(id)
    .first<{ mime: string; bytes: ArrayBuffer | number[] }>();
  if (!row) return null;
  const bytes = Array.isArray(row.bytes)
    ? new Uint8Array(row.bytes).buffer
    : row.bytes;
  return { mime: row.mime, bytes };
}

export async function deleteImage(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM product_images WHERE id = ?`).bind(id).run();
}

/** Swap an image one step earlier/later in the gallery order. */
export async function moveImage(env: Env, id: number, dir: "up" | "down"): Promise<void> {
  const img = await env.DB.prepare(
    `SELECT id, product_slug, position FROM product_images WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; product_slug: string; position: number }>();
  if (!img) return;
  const neighbour = await env.DB.prepare(
    `SELECT id, position FROM product_images
     WHERE product_slug = ? AND position ${dir === "up" ? "<" : ">"} ?
     ORDER BY position ${dir === "up" ? "DESC" : "ASC"} LIMIT 1`,
  )
    .bind(img.product_slug, img.position)
    .first<{ id: number; position: number }>();
  if (!neighbour) return;
  await env.DB.batch([
    env.DB.prepare(`UPDATE product_images SET position = ? WHERE id = ?`).bind(
      neighbour.position,
      img.id,
    ),
    env.DB.prepare(`UPDATE product_images SET position = ? WHERE id = ?`).bind(
      img.position,
      neighbour.id,
    ),
  ]);
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

export interface CollectionRow {
  name: string;
  position: number;
  product_count?: number;
}

export async function listCollections(env: Env): Promise<CollectionRow[]> {
  const res = await env.DB.prepare(
    `SELECT c.name, c.position,
            (SELECT COUNT(*) FROM products p WHERE p.category = c.name AND p.active = 1) AS product_count
     FROM collections c ORDER BY c.position, c.name`,
  ).all<CollectionRow>();
  return res.results ?? [];
}

export async function createCollection(env: Env, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO collections (name, position)
     VALUES (?, (SELECT COALESCE(MAX(position),0)+1 FROM collections))`,
  )
    .bind(name.trim())
    .run();
}

export async function renameCollection(
  env: Env,
  oldName: string,
  newName: string,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE collections SET name = ? WHERE name = ?`).bind(
      newName.trim(),
      oldName,
    ),
    env.DB.prepare(`UPDATE products SET category = ? WHERE category = ?`).bind(
      newName.trim(),
      oldName,
    ),
  ]);
}

/** Delete only when empty; returns false if it still has products. */
export async function deleteCollection(env: Env, name: string): Promise<boolean> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM products WHERE category = ? AND active = 1`,
  )
    .bind(name)
    .first<{ c: number }>();
  if ((count?.c ?? 0) > 0) return false;
  await env.DB.prepare(`DELETE FROM collections WHERE name = ?`).bind(name).run();
  return true;
}
