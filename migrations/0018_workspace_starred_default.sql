PRAGMA foreign_keys = ON;

-- Each user can choose one workspace to open by default.
CREATE TABLE IF NOT EXISTS user_workspace_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  starred_workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_user_workspace_preferences_starred
  ON user_workspace_preferences(starred_workspace_id);
