CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  linked_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (ends_at_utc > starts_at_utc)
);
CREATE INDEX IF NOT EXISTS ix_events_workspace_start ON calendar_events(workspace_id, deleted_at, starts_at_utc);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_at_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_reminders_due ON reminders(status, due_at_utc);
CREATE INDEX IF NOT EXISTS ix_reminders_workspace ON reminders(workspace_id, status, due_at_utc);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  resource_type TEXT,
  resource_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_unread ON notifications(user_id, read_at, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_event_note_workspace_insert
BEFORE INSERT ON calendar_events
WHEN NEW.linked_note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id=NEW.linked_note_id AND n.workspace_id=NEW.workspace_id AND n.deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'event note must belong to the same workspace');
END;

CREATE TRIGGER IF NOT EXISTS trg_event_note_workspace_update
BEFORE UPDATE OF workspace_id, linked_note_id ON calendar_events
WHEN NEW.linked_note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id=NEW.linked_note_id AND n.workspace_id=NEW.workspace_id AND n.deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'event note must belong to the same workspace');
END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_event_workspace_insert
BEFORE INSERT ON reminders
WHEN NEW.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.id=NEW.event_id AND e.workspace_id=NEW.workspace_id AND e.deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'reminder event must belong to the same workspace');
END;

CREATE TRIGGER IF NOT EXISTS trg_reminder_note_workspace_insert
BEFORE INSERT ON reminders
WHEN NEW.note_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id=NEW.note_id AND n.workspace_id=NEW.workspace_id AND n.deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'reminder note must belong to the same workspace');
END;
