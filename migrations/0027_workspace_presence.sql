CREATE TABLE IF NOT EXISTS workspace_presence (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,user_id),
  FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_workspace_presence_last_seen ON workspace_presence(workspace_id,last_seen_at);
