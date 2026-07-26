-- Livira — let the owner hide (disable) a collection from the shop without
-- deleting it. Hidden collections and their products drop out of the public
-- catalogue API and the storefront navigation; re-showing brings them back.

ALTER TABLE collections ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
