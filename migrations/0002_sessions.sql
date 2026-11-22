CREATE UNIQUE INDEX IF NOT EXISTS ux_workspaces_one_personal_per_owner
  ON workspaces(owner_user_id)
  WHERE workspace_type = 'personal';

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user_expires ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);
