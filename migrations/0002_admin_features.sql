-- Livira — admin features: store settings, coupons, product availability,
-- and order discounts.
-- Apply locally:  npx wrangler d1 execute livira-db --local  --file=./migrations/0002_admin_features.sql
-- Apply remote:   npx wrangler d1 execute livira-db --remote --file=./migrations/0002_admin_features.sql

-- Key/value store settings, editable from /admin/settings.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('cod_enabled', '1'),
  ('online_enabled', '1'),
  ('cod_max_order_value', '20000'),
  ('free_shipping_threshold', '2500'),
  ('flat_shipping_fee', '99');

-- Discount coupons, managed from /admin/coupons.
CREATE TABLE IF NOT EXISTS coupons (
  code        TEXT    PRIMARY KEY,             -- stored uppercase
  type        TEXT    NOT NULL CHECK (type IN ('percent','flat')),
  value       INTEGER NOT NULL,                -- percent (1-90) or flat ₹
  min_order   INTEGER NOT NULL DEFAULT 0,      -- min subtotal to qualify
  active      INTEGER NOT NULL DEFAULT 1,
  expires_at  TEXT,                            -- 'YYYY-MM-DD' or NULL = never
  max_uses    INTEGER,                         -- NULL = unlimited
  used_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Per-product sale toggle (slug matches the catalogue). A row with
-- disabled=1 blocks ordering that product without a redeploy.
CREATE TABLE IF NOT EXISTS product_overrides (
  slug     TEXT    PRIMARY KEY,
  disabled INTEGER NOT NULL DEFAULT 0
);

-- Coupon usage recorded on orders.
ALTER TABLE orders ADD COLUMN coupon_code TEXT;
ALTER TABLE orders ADD COLUMN amount_discount INTEGER NOT NULL DEFAULT 0;
