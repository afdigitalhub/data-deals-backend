-- Pmsomel Enterprise store schema.

CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  phone           TEXT,
  full_name       TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('customer','support','admin','owner')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- One-time links: 'invite' creates a staff account, 'reset' lets an existing user choose a new password.
CREATE TABLE access_links (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  token_hash    TEXT NOT NULL UNIQUE,
  role          TEXT CHECK (role IN ('admin','owner')),
  user_id       BIGINT REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id                BIGSERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  category_id       BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  description       TEXT NOT NULL DEFAULT '',
  price_minor       BIGINT NOT NULL CHECK (price_minor > 0),
  compare_at_minor  BIGINT CHECK (compare_at_minor IS NULL OR compare_at_minor > 0),
  sizes             TEXT[] NOT NULL DEFAULT '{}',
  colours           TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','sold_out')),
  is_featured       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_cat_idx ON products (category_id, status);

-- Photos live in the database so the shop needs no separate file storage.
CREATE TABLE product_images (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL,
  bytes       BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images (product_id, position, id);

CREATE TABLE orders (
  id              BIGSERIAL PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  location        TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  items           JSONB NOT NULL,
  total_minor     BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','delivered','cancelled')),
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('store', '{"name":"Pmsomel Enterprise","tagline":"Sneakers, outfits and the finishing touches.","whatsapp":"0546867225","phones":["0546867225","0540720742"],"location":"","delivery_note":"We deliver across Ghana. The delivery fee depends on your location and is confirmed on WhatsApp before you pay.","about":""}');

INSERT INTO categories (name, slug, sort_order) VALUES
  ('Sneakers', 'sneakers', 1),
  ('Women''s outfits', 'womens-outfits', 2),
  ('Men''s outfits', 'mens-outfits', 3),
  ('Bags and accessories', 'bags-accessories', 4);
