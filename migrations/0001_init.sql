-- Livira — orders schema (Cloudflare D1 / SQLite)
-- Apply locally:  npm run db:local
-- Apply remote:   npm run db:remote   (after `wrangler d1 create livira-db`)

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref           TEXT    NOT NULL UNIQUE,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),

  -- pending | paid | cod_pending | failed | cancelled
  status              TEXT    NOT NULL,
  -- online | cod
  method              TEXT    NOT NULL,

  amount_subtotal     INTEGER NOT NULL,   -- whole rupees
  amount_shipping     INTEGER NOT NULL DEFAULT 0,
  amount_total        INTEGER NOT NULL,
  currency            TEXT    NOT NULL DEFAULT 'INR',

  items               TEXT    NOT NULL,   -- JSON array of priced line items

  customer_name       TEXT    NOT NULL,
  phone               TEXT    NOT NULL,
  email               TEXT    NOT NULL,
  address             TEXT    NOT NULL,
  pincode             TEXT    NOT NULL,

  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_ref        ON orders (order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_rzp_order  ON orders (razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
