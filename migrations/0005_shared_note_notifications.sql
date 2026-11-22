CREATE TRIGGER IF NOT EXISTS trg_shared_note_notifications
AFTER INSERT ON notes
WHEN EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = NEW.workspace_id
    AND wm.user_id <> NEW.created_by_user_id
)
BEGIN
  INSERT OR IGNORE INTO notifications (
    id,user_id,workspace_id,notification_type,title,body,resource_type,resource_id,idempotency_key,created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    wm.user_id,
    NEW.workspace_id,
    'shared_note',
    'New note shared with you',
    NEW.title,
    'note',
    NEW.id,
    'shared-note:' || NEW.id || ':' || wm.user_id,
    NEW.created_at
  FROM workspace_members wm
  WHERE wm.workspace_id = NEW.workspace_id
    AND wm.user_id <> NEW.created_by_user_id;
END;
