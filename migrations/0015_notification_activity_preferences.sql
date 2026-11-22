ALTER TABLE notification_preferences ADD COLUMN event_push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (event_push_enabled IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN workspace_push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (workspace_push_enabled IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN shared_note_update_push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (shared_note_update_push_enabled IN (0,1));
