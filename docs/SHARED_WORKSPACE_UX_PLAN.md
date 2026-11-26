# Shared Workspace UX Implementation

## Product decisions

- Notes and categories are scoped to the active workspace.
- Calendar is an aggregate personal view across every workspace the signed-in user has joined.
- Every event belongs to exactly one workspace. The API enforces membership before returning it.
- Calendar filters are presentation-only and never narrow the aggregate API request.
- Event-linked reminders follow the aggregate Calendar model. Standalone reminders identify their workspace.
- Public and school holidays are global reference data.
- Polling remains the sync strategy until measured conflict, load, battery or presence requirements justify SSE/WebSocket.

## UX and security requirements

1. Every calendar event and reminder marker identifies its source workspace with a visible initial/name and workspace colour. Event details show the full workspace name.
2. Calendar offers All plus one filter per joined workspace. The filter is persisted locally and monthly totals respect it.
3. Event creation is available only when at least one joined workspace is writable. The workspace picker contains Owner and Editor workspaces only.
4. Event edit/delete permissions are resolved against the event's workspace, never the active Notes workspace.
5. Linked notes must belong to the event's workspace. Changing the event workspace clears the linked note and loads notes from the selected workspace. Stale responses must not replace the selected workspace's notes.
6. Switching Notes workspace clears old workspace data while loading and ignores responses from previous workspace requests.
7. Viewer controls are read-only. Backend authorization remains authoritative.
8. Make Private, Leave and Delete Workspace explain consequences before confirmation. Make Private preserves content and revokes memberships and pending invitations. Delete Workspace remains a separate destructive operation.
9. Invitation preview exposes no workspace content. After token validation it shows workspace, inviter, offered role and member count.
10. Conflict handling preserves unsaved text until the user chooses how to reconcile it.
11. Activity uses human-readable descriptions, type/person filters and cursor pagination.
12. Polling is visible-screen-only, one poller per resource, paused while hidden/offline, refreshed on resume, jittered and backed off after failures. Stale requests are aborted or ignored using resource identity.

## Implementation status (2026-11-27)

The feature implementation from PR #55 and the event workspace guard from PR #56 are merged to `main`.

### Implemented

- Aggregate Calendar Events and Reminders across current workspace memberships, with per-event workspace authorization and source identity.
- Calendar workspace filters, local colour overrides, monthly summary, date agenda, and workspace labels for standalone reminders.
- Workspace-scoped Notes and Categories, cross-workspace global search, unread workspace indicators, and immediate clearing of stale workspace data.
- Same-workspace linked-note validation and picker, optimistic conflict review, local recovery drafts, and remote update/deletion handling.
- Invitation preview and lifecycle management, including backend visibility checks on preview and acceptance.
- Make Private, Leave and Delete confirmation flows; 30-day Trash/Restore and bounded scheduled purge.
- Activity type/person filters and cursor pagination.
- Workspace-aware in-app notifications, push preferences, unread counts and notification deep links.
- Incremental Notes, Events, Reminders and membership deltas, including removal of cached aggregate events/reminders when membership is revoked.
- Centralized visible-screen polling with offline/hidden pause, resume refresh, jitter, bounded backoff, request cancellation and presence heartbeat.
- Loading skeletons, sync state, offline recovery messaging, contrast-aware calendar markers, keyboard focus and larger touch targets.
- Event creation requires an explicit writable workspace. The API never silently falls back to a personal workspace.
- Event linked-note loading is tied to the selected event workspace; previous workspace requests are aborted and stale notes are not displayed.
- Calendar day markers show a workspace initial and colour. Event and reminder date matching uses each item's timezone.

### Intentionally limited / follow-up verification

- Offline edits are saved as local recovery drafts. A durable background write queue is not implemented and must not be described as full offline sync.
- VoiceOver/NVDA verification still requires a manual device session.
- Full-app contrast and enlarged-text review still requires manual visual verification across screens.
- Production conflict/load/battery measurements are not yet available. Do not introduce SSE/WebSocket without those measurements.

## Verification

Run `npm test` and `npm run build`. Integration coverage must include aggregate event/reminder access, cross-workspace isolation, Viewer write rejection, revoked membership, invitation expiry/reuse, and linked-resource workspace boundaries. Do not mark manual device or production-measurement work complete based only on automated tests.