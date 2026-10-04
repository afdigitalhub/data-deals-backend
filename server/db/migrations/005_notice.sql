-- Customer notice bar (e.g. network delays). Additive only; off by default.
INSERT INTO settings (key, value) VALUES
  ('notice', '{"enabled":false,"message":"⏳ MTN is having delays today. Your bundle will arrive, but it may take a few hours. Thank you for your patience! 🙏🏾"}')
ON CONFLICT (key) DO NOTHING;
