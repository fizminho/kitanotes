CREATE TABLE IF NOT EXISTS passkey_step_up_challenges (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,challenge TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_passkey_step_up_challenges_expiry ON passkey_step_up_challenges(expires_at);
CREATE TABLE IF NOT EXISTS passkey_step_up_grants (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_passkey_step_up_grants_expiry ON passkey_step_up_grants(expires_at);
