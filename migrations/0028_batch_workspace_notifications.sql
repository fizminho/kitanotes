DROP TRIGGER IF EXISTS trg_note_update_notifications;
CREATE TRIGGER trg_note_update_notifications
AFTER UPDATE OF title,content,archived_at,deleted_at ON notes
WHEN NEW.version>OLD.version AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
BEGIN
  UPDATE notifications
  SET body=NEW.title,created_at=NEW.updated_at,read_at=NULL
  WHERE NEW.deleted_at IS NULL AND notification_type='note.updated' AND workspace_id=NEW.workspace_id
    AND user_id IN (SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
    AND julianday(created_at)>=julianday(NEW.updated_at)-0.0020833333;

  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'note.deleted' ELSE 'note.updated' END,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Note deleted · '||w.name ELSE 'Note updated · '||w.name END,
    NEW.title,'note',NEW.id,'note-change:'||NEW.id||':'||NEW.version||':'||wm.user_id,NEW.updated_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id
    AND (NEW.deleted_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM notifications existing WHERE existing.user_id=wm.user_id AND existing.workspace_id=NEW.workspace_id
        AND existing.notification_type='note.updated' AND julianday(existing.created_at)>=julianday(NEW.updated_at)-0.0020833333
    ));
END;

DROP TRIGGER IF EXISTS trg_event_updated_notifications;
CREATE TRIGGER trg_event_updated_notifications
AFTER UPDATE OF title,description,starts_at_utc,ends_at_utc,deleted_at ON calendar_events
WHEN NEW.version>OLD.version AND EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
BEGIN
  UPDATE notifications
  SET body=NEW.title,created_at=NEW.updated_at,read_at=NULL
  WHERE NEW.deleted_at IS NULL AND notification_type='event.updated' AND workspace_id=NEW.workspace_id
    AND user_id IN (SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id)
    AND julianday(created_at)>=julianday(NEW.updated_at)-0.0020833333;

  INSERT OR IGNORE INTO notifications (id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at)
  SELECT lower(hex(randomblob(16))),wm.user_id,NEW.workspace_id,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'event.deleted' ELSE 'event.updated' END,
    CASE WHEN NEW.deleted_at IS NOT NULL THEN 'Event cancelled · '||w.name ELSE 'Calendar updated · '||w.name END,
    NEW.title,'event',NEW.id,'event-change:'||NEW.id||':'||NEW.version||':'||wm.user_id,NEW.updated_at
  FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
  WHERE wm.workspace_id=NEW.workspace_id AND wm.user_id<>NEW.updated_by_user_id
    AND (NEW.deleted_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM notifications existing WHERE existing.user_id=wm.user_id AND existing.workspace_id=NEW.workspace_id
        AND existing.notification_type='event.updated' AND julianday(existing.created_at)>=julianday(NEW.updated_at)-0.0020833333
    ));
END;
