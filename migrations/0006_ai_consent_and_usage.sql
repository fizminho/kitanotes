ALTER TABLE users ADD COLUMN ai_consent_at TEXT;
ALTER TABLE users ADD COLUMN ai_consent_policy_version TEXT;

CREATE TABLE IF NOT EXISTS ai_request_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);
