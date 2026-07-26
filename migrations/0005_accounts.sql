-- Livira — customer accounts (email + password) so returning shoppers can
-- reorder easily. Order history is matched by email; guest checkout still works.

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,          -- stored lowercased
  password_hash TEXT    NOT NULL,                 -- "saltHex:hashHex" (PBKDF2)
  name          TEXT    NOT NULL DEFAULT '',
  phone         TEXT    NOT NULL DEFAULT '',
  street        TEXT    NOT NULL DEFAULT '',
  landmark      TEXT    NOT NULL DEFAULT '',
  city          TEXT    NOT NULL DEFAULT '',
  pincode       TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
