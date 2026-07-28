-- Livira — give each collection an optional cover photo shown on the storefront
-- collection tiles. Image is stored in product_images under the "__collection__"
-- pseudo-slug; image_id references it (NULL = no photo, falls back to text tile).

ALTER TABLE collections ADD COLUMN image_id INTEGER;
