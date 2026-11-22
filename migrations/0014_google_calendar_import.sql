ALTER TABLE calendar_events ADD COLUMN source_created_by TEXT;
ALTER TABLE calendar_events ADD COLUMN source_created_at TEXT;
ALTER TABLE calendar_events ADD COLUMN source_updated_by TEXT;
ALTER TABLE calendar_events ADD COLUMN source_updated_at TEXT;

CREATE TABLE IF NOT EXISTS google_calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_google_calendar_oauth_expiry ON google_calendar_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  refresh_token_ciphertext TEXT,
  sync_token TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS ix_google_calendar_connections_workspace ON google_calendar_connections(workspace_id);

CREATE TABLE IF NOT EXISTS google_calendar_event_map (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  local_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  google_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, connection_user_id, calendar_id, google_event_id),
  UNIQUE(local_event_id)
);
CREATE INDEX IF NOT EXISTS ix_google_calendar_map_local ON google_calendar_event_map(local_event_id);
