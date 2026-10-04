-- Data Glow core schema (v2).
-- NON-DESTRUCTIVE: the original v1 tables (orders, customers, services, agents, agent_withdrawals)
-- are renamed to legacy_* and kept with all their rows. Nothing is dropped.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'paystack_reference') THEN
    ALTER TABLE orders RENAME TO legacy_orders;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'customers' AND column_name = 'phone')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'customers' AND column_name = 'password_hash') THEN
    ALTER TABLE customers RENAME TO legacy_customers;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'services' AND column_name = 'price') THEN
    ALTER TABLE services RENAME TO legacy_services;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agent_withdrawals' AND column_name = 'requested_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agent_withdrawals' AND column_name = 'amount_minor') THEN
    ALTER TABLE agent_withdrawals RENAME TO legacy_agent_withdrawals;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agents' AND column_name = 'wallet_balance') THEN
    ALTER TABLE agents RENAME TO legacy_agents;
  END IF;
END $$;

-- ---------- People & access ----------
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  phone           TEXT,
  full_name       TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','support','admin','owner')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted')),
  restricted_reason TEXT,
  last_login_at   TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE INDEX users_phone_idx ON users (phone);
CREATE INDEX users_role_idx ON users (role) WHERE role <> 'customer';

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

CREATE TABLE password_reset_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_by_admin_id BIGINT REFERENCES users(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_invites (
  id            BIGSERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('support','admin','owner')),
  label         TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  used_by_user_id BIGINT REFERENCES users(id),
  created_by_user_id BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Catalogue ----------
CREATE TABLE networks (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  prefixes    TEXT[] NOT NULL DEFAULT '{}'
);
INSERT INTO networks (code, name, sort_order, prefixes) VALUES
  ('MTN', 'MTN', 1, ARRAY['024','025','053','054','055','059']),
  ('TELECEL', 'Telecel', 2, ARRAY['020','050']),
  ('AT', 'AT', 3, ARRAY['026','027','056','057']);

CREATE TABLE suppliers (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  adapter         TEXT NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT false,
  networks        TEXT[] NOT NULL DEFAULT '{}',
  notes           TEXT,
  last_check_at   TIMESTAMPTZ,
  last_check_ok   BOOLEAN,
  last_check_message TEXT,
  balance_minor   BIGINT,
  balance_checked_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO suppliers (code, name, adapter, is_enabled, networks, notes) VALUES
  ('manual', 'Manual fulfilment (admin)', 'manual', true, ARRAY['MTN','TELECEL','AT'], 'Orders are delivered by an authorised admin and confirmed in the dashboard.'),
  ('remadata', 'RemaData', 'remadata', false, ARRAY['MTN','TELECEL','AT'], 'Not connected. Needs RemaData API documentation and API credentials.');

CREATE TABLE products (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('data','airtime')),
  network_code       TEXT NOT NULL REFERENCES networks(code),
  name               TEXT NOT NULL,
  category           TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('daily','weekly','monthly','non_expiry','other','airtime')),
  data_mb            INT CHECK (data_mb IS NULL OR data_mb > 0),
  validity_label     TEXT,
  currency           CHAR(3) NOT NULL DEFAULT 'GHS',
  -- Data bundles: fixed selling price. All money in pesewas (minor units).
  price_minor        BIGINT CHECK (price_minor IS NULL OR price_minor > 0),
  fee_minor          BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  cost_minor         BIGINT CHECK (cost_minor IS NULL OR cost_minor >= 0),
  -- Airtime: customer chooses face value within limits; fee and supplier cost in basis points of face value.
  airtime_min_minor  BIGINT CHECK (airtime_min_minor IS NULL OR airtime_min_minor > 0),
  airtime_max_minor  BIGINT,
  airtime_fee_bps    INT NOT NULL DEFAULT 0 CHECK (airtime_fee_bps >= 0 AND airtime_fee_bps <= 5000),
  airtime_cost_bps   INT CHECK (airtime_cost_bps IS NULL OR (airtime_cost_bps >= 0 AND airtime_cost_bps <= 20000)),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','paused')),
  manual_fulfilment_allowed BOOLEAN NOT NULL DEFAULT true,
  supplier_id        INT REFERENCES suppliers(id),
  supplier_product_code TEXT,
  sort_order         INT NOT NULL DEFAULT 0,
  admin_note         TEXT,
  created_by         BIGINT REFERENCES users(id),
  updated_by         BIGINT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_data_price CHECK (kind <> 'data' OR price_minor IS NOT NULL),
  CONSTRAINT products_airtime_limits CHECK (kind <> 'airtime' OR (airtime_min_minor IS NOT NULL AND airtime_max_minor IS NOT NULL AND airtime_max_minor >= airtime_min_minor))
);
CREATE INDEX products_public_idx ON products (status, network_code, kind, sort_order);

-- ---------- Agents (referral network) ----------
CREATE TABLE agents (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT UNIQUE REFERENCES users(id),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  referral_code   TEXT NOT NULL UNIQUE,
  commission_bps  INT CHECK (commission_bps IS NULL OR (commission_bps >= 0 AND commission_bps <= 5000)),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Orders ----------
CREATE TABLE orders (
  id                  BIGSERIAL PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  idempotency_key     TEXT NOT NULL UNIQUE,
  access_token_hash   TEXT NOT NULL,
  user_id             BIGINT REFERENCES users(id),
  contact_email       TEXT NOT NULL,
  contact_phone       TEXT,
  recipient_phone     TEXT NOT NULL,
  network_code        TEXT NOT NULL REFERENCES networks(code),
  product_id          BIGINT NOT NULL REFERENCES products(id),
  kind                TEXT NOT NULL CHECK (kind IN ('data','airtime')),
  product_snapshot    JSONB NOT NULL,
  face_value_minor    BIGINT,
  price_minor         BIGINT NOT NULL CHECK (price_minor > 0),
  fee_minor           BIGINT NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  total_minor         BIGINT NOT NULL CHECK (total_minor > 0),
  expected_cost_minor BIGINT,
  actual_cost_minor   BIGINT,
  currency            CHAR(3) NOT NULL DEFAULT 'GHS',
  status              TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                        'pending_payment','payment_failed','expired','paid','queued','processing',
                        'successful','failed','needs_review','refund_pending','refunded')),
  fulfilment_mode     TEXT NOT NULL DEFAULT 'manual' CHECK (fulfilment_mode IN ('auto','manual')),
  supplier_id         INT REFERENCES suppliers(id),
  supplier_reference  TEXT,
  escalated           BOOLEAN NOT NULL DEFAULT false,
  agent_id            BIGINT REFERENCES agents(id),
  agent_commission_minor BIGINT NOT NULL DEFAULT 0,
  is_test             BOOLEAN NOT NULL DEFAULT false,
  client_ip           TEXT,
  paid_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);
CREATE INDEX orders_recipient_idx ON orders (recipient_phone);

CREATE TABLE order_events (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES orders(id),
  event_type    TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  message       TEXT,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('system','customer','admin','supplier','payment_provider')),
  actor_user_id BIGINT REFERENCES users(id),
  data          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

-- ---------- Payments ----------
CREATE TABLE payments (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           BIGINT NOT NULL REFERENCES orders(id),
  provider           TEXT NOT NULL DEFAULT 'paystack',
  provider_reference TEXT NOT NULL UNIQUE,
  access_code        TEXT,
  authorization_url  TEXT,
  amount_minor       BIGINT NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'GHS',
  status             TEXT NOT NULL DEFAULT 'initialized' CHECK (status IN ('initialized','success','failed','abandoned','reversed')),
  channel            TEXT,
  gateway_response   TEXT,
  provider_fees_minor BIGINT,
  is_test            BOOLEAN NOT NULL DEFAULT false,
  verified_at        TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE payment_events (
  id                 BIGSERIAL PRIMARY KEY,
  provider           TEXT NOT NULL,
  event_type         TEXT,
  provider_reference TEXT,
  body_sha256        TEXT NOT NULL,
  signature_valid    BOOLEAN NOT NULL,
  processing_result  TEXT,
  payload            JSONB,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX payment_events_dedupe ON payment_events (provider, body_sha256) WHERE signature_valid;
CREATE INDEX payment_events_ref_idx ON payment_events (provider_reference);

CREATE TABLE refunds (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES orders(id),
  payment_id          BIGINT REFERENCES payments(id),
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','processing','processed','rejected','failed')),
  requested_by_type   TEXT NOT NULL CHECK (requested_by_type IN ('customer','admin')),
  requested_by_user_id BIGINT REFERENCES users(id),
  reviewed_by_user_id BIGINT REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  provider_refund_id  TEXT,
  processed_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refunds_one_open_per_order ON refunds (order_id) WHERE status NOT IN ('rejected','failed');

-- ---------- Fulfilment ----------
CREATE TABLE delivery_attempts (
  id                 BIGSERIAL PRIMARY KEY,
  order_id           BIGINT NOT NULL REFERENCES orders(id),
  attempt_no         INT NOT NULL,
  supplier_id        INT NOT NULL REFERENCES suppliers(id),
  request_id         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','success','failed','pending','unknown')),
  supplier_reference TEXT,
  request_summary    JSONB,
  response_summary   JSONB,
  error_message      TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  UNIQUE (order_id, attempt_no)
);

CREATE TABLE jobs (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  unique_key    TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 5,
  locked_at     TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (status, run_at);

-- ---------- Agents money ----------
CREATE TABLE agent_ledger (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     BIGINT NOT NULL REFERENCES agents(id),
  order_id     BIGINT REFERENCES orders(id),
  withdrawal_id BIGINT,
  type         TEXT NOT NULL CHECK (type IN ('commission','withdrawal','reversal','adjustment')),
  amount_minor BIGINT NOT NULL,
  note         TEXT,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_ledger_one_commission ON agent_ledger (order_id) WHERE type = 'commission';

CREATE TABLE agent_withdrawals (
  id            BIGSERIAL PRIMARY KEY,
  agent_id      BIGINT NOT NULL REFERENCES agents(id),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  momo_number   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','rejected')),
  payout_reference TEXT,
  processed_by  BIGINT REFERENCES users(id),
  processed_at  TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Customer extras ----------
CREATE TABLE saved_recipients (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  network_code TEXT REFERENCES networks(code),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);

CREATE TABLE support_tickets (
  id              BIGSERIAL PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  access_token_hash TEXT NOT NULL,
  user_id         BIGINT REFERENCES users(id),
  name            TEXT,
  email           TEXT NOT NULL,
  phone           TEXT,
  order_id        BIGINT REFERENCES orders(id),
  category        TEXT NOT NULL CHECK (category IN ('general','order','failed_transaction','refund','account')),
  subject         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_customer','resolved','closed')),
  assigned_to     BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, updated_at DESC);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id);

CREATE TABLE support_messages (
  id             BIGSERIAL PRIMARY KEY,
  ticket_id      BIGINT NOT NULL REFERENCES support_tickets(id),
  author_type    TEXT NOT NULL CHECK (author_type IN ('customer','admin','system')),
  author_user_id BIGINT REFERENCES users(id),
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, id);

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  order_id    BIGINT REFERENCES orders(id),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email','sms')),
  status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending','sent','failed','skipped')),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- ---------- Governance ----------
CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  before_data   JSONB,
  after_data    JSONB,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, id DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  BIGINT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('business', '{"name":"Data Glow","tagline":"Stay connected. Stay glowing.","support_email":null,"support_phone":"0592290174","whatsapp_number":"233592290174","address":null,"show_founders":false}'),
  ('limits', '{"max_order_minor":100000,"max_orders_per_recipient_per_day":20,"order_expiry_minutes":60}'),
  ('maintenance', '{"enabled":false,"message":"We are doing some quick maintenance. Please check back shortly."}'),
  ('policies', '{"refund_window_days":7}'),
  ('notifications', '{"email_enabled":false,"sms_enabled":false,"admin_alert_email":null}'),
  ('agents', '{"enabled":false,"default_commission_bps":0,"min_withdrawal_minor":2000}');

-- Immutable history: order events and audit logs can never be edited or deleted.
CREATE OR REPLACE FUNCTION dd_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are immutable', TG_TABLE_NAME;
END $$;
CREATE TRIGGER order_events_immutable BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION dd_forbid_change();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION dd_forbid_change();

-- Bring the original 9 bundles across as DRAFT products (not on sale) so the founders can
-- review each price and supplier cost before going live.
DO $$
DECLARE r RECORD; net TEXT; mb INT; val TEXT; cat TEXT;
BEGIN
  IF to_regclass('legacy_services') IS NOT NULL THEN
    FOR r IN SELECT * FROM legacy_services WHERE category = 'data' ORDER BY id LOOP
      net := CASE upper(r.network) WHEN 'MTN' THEN 'MTN' WHEN 'TELECEL' THEN 'TELECEL' WHEN 'VODAFONE' THEN 'TELECEL' ELSE 'AT' END;
      mb := NULLIF(substring(r.name from '([0-9]+)\s*GB'), '')::INT * 1024;
      val := trim(substring(r.name from '-\s*(.*)$'));
      cat := CASE WHEN val ILIKE '%30 day%' THEN 'monthly' WHEN val ILIKE '%7 day%' THEN 'weekly' WHEN val ILIKE '%1 day%' OR val ILIKE '%24%' THEN 'daily' ELSE 'other' END;
      INSERT INTO products (kind, network_code, name, category, data_mb, validity_label, price_minor, status, admin_note, sort_order)
      VALUES ('data', net, trim(split_part(r.name, '-', 1)), cat, mb, NULLIF(val, ''), round(r.price * 100)::BIGINT, 'draft',
              'Imported from the original site (legacy service #' || r.id || '). Confirm price and supplier cost before going live.', r.id);
    END LOOP;
  END IF;
END $$;

-- Airtime products for each network, as drafts. Founders must set limits, fees and cost before going live.
INSERT INTO products (kind, network_code, name, category, airtime_min_minor, airtime_max_minor, airtime_fee_bps, status, admin_note, sort_order)
VALUES
  ('airtime', 'MTN', 'MTN Airtime', 'airtime', 100, 50000, 0, 'draft', 'Set purchase limits, customer fee and supplier cost, then go live.', 0),
  ('airtime', 'TELECEL', 'Telecel Airtime', 'airtime', 100, 50000, 0, 'draft', 'Set purchase limits, customer fee and supplier cost, then go live.', 0),
  ('airtime', 'AT', 'AT Airtime', 'airtime', 100, 50000, 0, 'draft', 'Set purchase limits, customer fee and supplier cost, then go live.', 0);
