CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (push_enabled IN (0,1)),
  reminder_push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminder_push_enabled IN (0,1)),
  shared_note_push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (shared_note_push_enabled IN (0,1)),
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((quiet_hours_start IS NULL AND quiet_hours_end IS NULL) OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)),
  CHECK (quiet_hours_start IS NULL OR (length(quiet_hours_start)=5 AND quiet_hours_start GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(quiet_hours_start,1,2) BETWEEN '00' AND '23')),
  CHECK (quiet_hours_end IS NULL OR (length(quiet_hours_end)=5 AND quiet_hours_end GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(quiet_hours_end,1,2) BETWEEN '00' AND '23')),
  CHECK (quiet_hours_start IS NULL OR quiet_hours_start<>quiet_hours_end)
);
