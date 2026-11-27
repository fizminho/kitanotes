-- Rename the per-workspace "all" delivery mode to "detailed".
-- Existing users keep their selected important/mute modes; existing "all" rows
-- are upgraded to detailed, and workspaces without a saved preference default
-- to detailed in application code.
CREATE TABLE workspace_notification_preferences_new (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'detailed' CHECK (mode IN ('detailed','important','mute')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,workspace_id)
);

INSERT INTO workspace_notification_preferences_new (user_id,workspace_id,mode,updated_at)
SELECT user_id,workspace_id,
       CASE mode WHEN 'all' THEN 'detailed' ELSE mode END,
       updated_at
FROM workspace_notification_preferences;

DROP TABLE workspace_notification_preferences;
ALTER TABLE workspace_notification_preferences_new RENAME TO workspace_notification_preferences;

CREATE INDEX IF NOT EXISTS ix_workspace_notification_preferences_workspace
  ON workspace_notification_preferences(workspace_id,user_id);
