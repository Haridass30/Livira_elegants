-- Livira — manual-UPI payment verification.
--
-- Before this migration an "online" order was written straight to `pending` and
-- the customer was told the order was confirmed, whatever they typed into the
-- UPI reference box. Now an online order lands in `awaiting_payment`: it holds
-- stock but is not a sale until the owner matches the reference against the
-- real credit in their bank/UPI app and confirms (or rejects) it in /admin.

ALTER TABLE orders ADD COLUMN upi_ref TEXT;             -- normalised 12-digit UTR
ALTER TABLE orders ADD COLUMN payment_proof_id INTEGER; -- payment_proofs.id (screenshot)
ALTER TABLE orders ADD COLUMN verified_at TEXT;         -- when the owner decided
ALTER TABLE orders ADD COLUMN verified_note TEXT;       -- owner's note / reject reason
ALTER TABLE orders ADD COLUMN stock_held INTEGER NOT NULL DEFAULT 0; -- 1 = stock still reserved

-- A UPI reference can only ever back ONE order. Re-using someone else's UTR, or
-- replaying your own from an earlier order, fails at INSERT time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_upi_ref
  ON orders (upi_ref) WHERE upi_ref IS NOT NULL;

-- Used by the per-customer throttle on unverified orders.
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders (phone);

-- Payment screenshots submitted at checkout. Admin-only: served through
-- /admin/orders/proof, never from a public route.
CREATE TABLE IF NOT EXISTS payment_proofs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref  TEXT    NOT NULL,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_ref ON payment_proofs (order_ref);

-- Existing manual-UPI orders sitting in `pending` are really awaiting
-- verification — move them so they show up in the new admin queue.
UPDATE orders
   SET status = 'awaiting_payment'
 WHERE status = 'pending' AND method = 'online' AND razorpay_order_id IS NULL;
