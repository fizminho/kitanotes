-- Include workspace context in the in-app inbox and notify members about calendar changes.
DROP TRIGGER IF EXISTS trg_shared_note_notifications;
CREATE TRIGGER trg_shared_note_notifications
AFTER INSERT ON notes
WHEN EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.created_by_user_id)
BEGIN
  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,'shared_note','New note · '||w.name,NEW.title,'note',NEW.id,'shared-note:'||NEW.id||':'||wm.user_id,NEW.created_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.created_by_user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_note_update_notifications
AFTER UPDATE OF title,content,archived_at,deleted_at ON notes
WHEN NEW.version>OLD.version AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
BEGIN
  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'note.deleted' ELSE 'note.updated' END,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Note deleted · '||w.name ELSE 'Note updated · '||w.name END,
    NEW.title,'note',NEW.id,'note-change:'||NEW.id||':'||NEW.version||':'||wm.user_id,NEW.updated_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_event_created_notifications
AFTER INSERT ON calendar_events
WHEN EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.created_by_user_id)
BEGIN
  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,'event.created','Calendar event · '||w.name,NEW.title,'event',NEW.id,'event-created:'||NEW.id||':'||wm.user_id,NEW.created_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.created_by_user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_event_updated_notifications
AFTER UPDATE OF title,description,starts_at_utc,ends_at_utc,deleted_at ON calendar_events
WHEN NEW.version>OLD.version AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
BEGIN
  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'event.deleted' ELSE 'event.updated' END,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Event cancelled · '||w.name ELSE 'Calendar updated · '||w.name END,
    NEW.title,'event',NEW.id,'event-change:'||NEW.id||':'||NEW.version||':'||wm.user_id,NEW.updated_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id;
END;
