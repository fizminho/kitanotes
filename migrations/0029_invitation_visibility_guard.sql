DROP TRIGGER IF EXISTS trg_invitation_accept_membership;
CREATE TRIGGER trg_invitation_accept_membership
AFTER UPDATE OF status ON invitations
WHEN OLD.status='pending' AND NEW.status='accepted'
  AND EXISTS (SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND visibility='shared')
BEGIN
  INSERT OR IGNORE INTO workspace_members (workspace_id,user_id,role,joined_at)
  VALUES (NEW.workspace_id,NEW.accepted_by_user_id,NEW.role,NEW.accepted_at);
END;
