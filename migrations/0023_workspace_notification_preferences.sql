CREATE TABLE IF NOT EXISTS workspace_notification_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all','important','mute')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,workspace_id)
);
CREATE INDEX IF NOT EXISTS ix_workspace_notification_preferences_workspace ON workspace_notification_preferences(workspace_id,user_id);
