CREATE TABLE IF NOT EXISTS workspace_membership_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT,
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_workspace_membership_changes_user_time ON workspace_membership_changes(user_id,changed_at);
INSERT INTO workspace_membership_changes(user_id,workspace_id,role,active,changed_at)
SELECT user_id,workspace_id,role,1,COALESCE(joined_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) FROM workspace_members;

CREATE TRIGGER IF NOT EXISTS trg_workspace_member_added
AFTER INSERT ON workspace_members
BEGIN
  INSERT INTO workspace_membership_changes(user_id,workspace_id,role,active,changed_at)
  VALUES(NEW.user_id,NEW.workspace_id,NEW.role,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_workspace_member_removed
AFTER DELETE ON workspace_members
BEGIN
  INSERT INTO workspace_membership_changes(user_id,workspace_id,role,active,changed_at)
  VALUES(OLD.user_id,OLD.workspace_id,OLD.role,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER IF NOT EXISTS trg_workspace_member_role_changed
AFTER UPDATE OF role ON workspace_members
WHEN OLD.role<>NEW.role
BEGIN
  INSERT INTO workspace_membership_changes(user_id,workspace_id,role,active,changed_at)
  VALUES(NEW.user_id,NEW.workspace_id,NEW.role,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
