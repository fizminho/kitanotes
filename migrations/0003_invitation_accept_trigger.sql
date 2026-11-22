CREATE TRIGGER IF NOT EXISTS trg_invitation_accept_membership
AFTER UPDATE OF status ON invitations
WHEN OLD.status = 'pending' AND NEW.status = 'accepted'
BEGIN
  INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, joined_at)
  VALUES (NEW.workspace_id, NEW.accepted_by_user_id, NEW.role, NEW.accepted_at);
END;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_invites_workspace_email
  ON invitations(workspace_id, invited_email_normalized)
  WHERE status = 'pending';
