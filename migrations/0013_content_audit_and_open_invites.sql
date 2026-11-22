ALTER TABLE notes ADD COLUMN updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_activity_target_created
  ON activity_events(target_type,target_id,created_at DESC);
