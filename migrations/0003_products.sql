-- Livira — products, images and collections move into D1 so the owner can
-- manage the catalogue entirely from /admin (no code edits, no redeploys for
-- data; a "Publish" rebuild refreshes the static pages).

CREATE TABLE IF NOT EXISTS collections (
  name       TEXT PRIMARY KEY,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO collections (name, position) VALUES
  ('Rings', 1), ('Necklaces', 2), ('Earrings', 3), ('Bangles', 4);

CREATE TABLE IF NOT EXISTS products (
  slug             TEXT    PRIMARY KEY,
  name             TEXT    NOT NULL,
  price            INTEGER NOT NULL,             -- whole rupees
  compare_at_price INTEGER,
  category         TEXT    NOT NULL,             -- references collections.name
  material         TEXT    NOT NULL DEFAULT '',
  weight_grams     REAL,
  dimensions       TEXT,
  description      TEXT    NOT NULL DEFAULT '',
  in_stock         INTEGER NOT NULL DEFAULT 1,   -- manual on/off switch
  stock_qty        INTEGER,                      -- NULL = not tracked
  featured         INTEGER NOT NULL DEFAULT 0,
  sku              TEXT,
  tags             TEXT    NOT NULL DEFAULT '',  -- comma-separated
  active           INTEGER NOT NULL DEFAULT 1,   -- 0 = deleted (kept for order history)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active   ON products (active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

-- Product photos stored as blobs (small catalogue; admin resizes on upload).
CREATE TABLE IF NOT EXISTS product_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_slug TEXT    NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  mime         TEXT    NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  bytes        BLOB    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_images_slug ON product_images (product_slug, position);
