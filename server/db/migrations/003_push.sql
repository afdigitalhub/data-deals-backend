-- Phone notifications (web push). Additive only.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  marketing       BOOLEAN NOT NULL DEFAULT true,   -- daily deals + reminders; order updates are always sent while subscribed
  user_agent      TEXT,
  failure_count   INT NOT NULL DEFAULT 0,
  last_sent_at    TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  disabled_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id) WHERE disabled_at IS NULL;

-- One marketing message per device per day, and one "running low" reminder per device per order.
CREATE TABLE IF NOT EXISTS push_log (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('daily','reminder','order','test','broadcast')),
  day             DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Accra')::date,
  order_id        BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  title           TEXT,
  ok              BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_log_one_marketing_per_day ON push_log (subscription_id, day) WHERE kind IN ('daily','reminder');
CREATE UNIQUE INDEX IF NOT EXISTS push_log_one_reminder_per_order ON push_log (subscription_id, order_id) WHERE kind = 'reminder';

INSERT INTO settings (key, value) VALUES
  ('push', '{"daily_enabled":true,"send_hour":10,"reminders_enabled":true,"custom_title":null,"custom_message":null}')
ON CONFLICT (key) DO NOTHING;

-- Guests can ask for delivery alerts for a specific order from that order's page.
CREATE TABLE IF NOT EXISTS push_order_watch (
  subscription_id BIGINT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, order_id)
);
