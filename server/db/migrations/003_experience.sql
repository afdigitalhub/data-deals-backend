-- Curated collections ("Shop by vibe" and "The Edit"), item badges, outfit pairings, small photo copies for fast pages,
-- two more order steps for tracking, and optional gift details. Adds only; nothing is removed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN IF NOT EXISTS pairs_with BIGINT[] NOT NULL DEFAULT '{}';
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS thumb BYTEA;

CREATE TABLE IF NOT EXISTS collections (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('vibe','edit')),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  tagline     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_products (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX IF NOT EXISTS collection_products_product_idx ON collection_products (product_id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('new','confirmed','preparing','out_for_delivery','delivered','cancelled'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift JSONB;
