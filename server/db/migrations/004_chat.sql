-- Live support chat (customers <-> Data Glow team) and a private team chat for staff. Additive only.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_token_hash      TEXT UNIQUE,                 -- guests keep a random token in their browser; only its hash is stored
  name                  TEXT NOT NULL,
  phone                 TEXT,
  order_id              BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  customer_last_read_id BIGINT NOT NULL DEFAULT 0,
  staff_last_read_id    BIGINT NOT NULL DEFAULT 0,
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS chat_conversations_user ON chat_conversations (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_inbox ON chat_conversations (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL CHECK (sender IN ('customer','staff','system')),
  staff_user_id   BIGINT REFERENCES users(id),
  body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_conv ON chat_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS team_messages (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_reads (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0
);

-- Chat messages are a record of what was said: they can't be edited or deleted.
DROP TRIGGER IF EXISTS chat_messages_immutable ON chat_messages;
CREATE TRIGGER chat_messages_immutable BEFORE UPDATE OR DELETE ON chat_messages FOR EACH ROW EXECUTE FUNCTION dd_forbid_change();
DROP TRIGGER IF EXISTS team_messages_immutable ON team_messages;
CREATE TRIGGER team_messages_immutable BEFORE UPDATE OR DELETE ON team_messages FOR EACH ROW EXECUTE FUNCTION dd_forbid_change();
