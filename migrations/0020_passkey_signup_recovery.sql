CREATE TABLE IF NOT EXISTS passkey_signup_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  challenge TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_passkey_signup_challenges_expiry ON passkey_signup_challenges(expires_at);

CREATE TABLE IF NOT EXISTS passkey_recovery_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_passkey_recovery_codes_user ON passkey_recovery_codes(user_id, used_at);
