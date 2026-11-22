CREATE TABLE IF NOT EXISTS calendar_event_imports (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_uid TEXT NOT NULL,
  local_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, source_uid),
  UNIQUE(local_event_id)
);
CREATE INDEX IF NOT EXISTS ix_calendar_event_imports_local ON calendar_event_imports(local_event_id);

CREATE TABLE IF NOT EXISTS user_calendar_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  holiday_state TEXT NOT NULL DEFAULT 'selangor',
  updated_at TEXT NOT NULL
);

DROP TABLE IF EXISTS google_calendar_event_map;
DROP TABLE IF EXISTS google_calendar_connections;
DROP TABLE IF EXISTS google_calendar_oauth_states;
