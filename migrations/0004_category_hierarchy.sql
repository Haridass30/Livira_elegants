-- Livira — two-level category hierarchy.
--
-- A "main" category (parent IS NULL) is one of two kinds:
--   'direct' — holds products itself (its name is used as products.category).
--   'group'  — holds sub-categories; products live under those instead.
-- A "sub" category has parent = <main category name> and always holds products.
--
-- Existing collections migrate untouched: parent NULL, kind 'direct', so every
-- current collection becomes a direct main category with its products intact.

ALTER TABLE collections ADD COLUMN parent TEXT;                       -- NULL = top-level main
ALTER TABLE collections ADD COLUMN kind   TEXT NOT NULL DEFAULT 'direct'; -- 'direct' | 'group'

CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections (parent);
