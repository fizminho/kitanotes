CREATE TABLE IF NOT EXISTS passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports_json TEXT,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_passkey_credentials_user ON passkey_credentials(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((purpose = 'register' AND user_id IS NOT NULL) OR (purpose = 'authenticate' AND user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_passkey_challenges_expiry ON passkey_challenges(expires_at);
