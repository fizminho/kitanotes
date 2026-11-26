# Shared Workspace UX Implementation

## Product decisions

- Notes and categories remain scoped to the active workspace.
- Calendar is an aggregate personal view across every workspace the signed-in user has joined.
- Every event remains owned by exactly one workspace. The API must enforce membership before returning it.
- Calendar filters are presentation-only and must not narrow the aggregate API request.
- Reminders associated with calendar events follow the aggregate calendar model. Any reminder not associated with an event must visibly identify its workspace.
- Public and school holidays remain global reference data.
- Polling remains the sync strategy until measured conflict, load, battery or presence requirements justify SSE/WebSocket.

## UX and security requirements

1. Every event chip and event detail identifies its source workspace. Workspace identity uses both a name/initial and a color, never color alone.
2. Calendar offers All plus one filter per joined workspace. The filter is persisted locally and month counts respect it.
3. Creating events is available only when at least one joined workspace is writable. The required workspace picker contains only Owner and Editor workspaces.
4. Event edit/delete permissions are resolved against the event's workspace, never the currently active workspace.
5. Linked notes must belong to the event's workspace. Switching the event workspace clears the selected linked note and loads notes from the selected workspace.
6. Switching workspace must show loading state, clear old workspace data immediately, and ignore late responses from the previous workspace.
7. Viewer controls are read-only. Backend authorization remains authoritative.
8. Make Private, Leave and Delete Workspace must explain the consequences before confirmation. Make Private preserves content and revokes memberships and pending invitations. Delete Workspace is a separate destructive operation.
9. Invitation preview must not expose workspace content. It should show workspace, inviter, offered role and member count after token validation.
10. Conflict handling must preserve unsaved text until the user chooses how to reconcile it.
11. Activity supports human-readable descriptions, type/person filters and pagination.
12. Polling is visible-screen-only, one poller per resource, paused while hidden/offline, refreshed on resume, jittered and backed off after failures. Stale requests must be aborted or ignored using workspace/resource identity.

## Rollout phases

- Phase 0: align SHARED_WORKSPACE_FLOW.md with aggregate Calendar.
- Phase 1: aggregate Calendar source identity, filters, writable event workspace selection and per-event role controls. (Implemented in PR #52.)
- Phase 2: persistent Notes workspace context, skeleton switching, stale-response protection, global search and unread workspace indicators.
- Phase 3: same-workspace linked-note picker and conflict resolution with draft preservation.
- Phase 4: invite preview/management, safe Leave/Make Private/Delete confirmations and recoverable note deletion. (Typed-name confirmation added for Make Private; other lifecycle items remain.)
- Phase 5: activity filtering/pagination and workspace-aware notification preferences/deep links.
- Phase 6: centralized visibility-aware polling, deltas, backoff, stale-request protection, offline drafts and accessibility.

## Verification

Run npm test and npm run build. Add integration coverage for aggregate event access, cross-workspace isolation, Viewer write rejection, revoked membership, invitation expiry/reuse, and linked-resource workspace boundaries. Do not mark a phase complete until the behaviour is implemented and tested.


## Implementation status (2026-11-27)

Implementation is in PR #55 on `feat/shared-workspace-final-lifecycle-sync`. The feature is not released until the final head passes Build and Validate, D1 migration validation, Worker bundle validation and CodeQL, then merges to `main`.

Implemented on the branch:
- Aggregate Calendar Events and Reminders across current workspace memberships, with per-event workspace authorization and source identity.
- Calendar workspace filters, local colour overrides, monthly summary, date agenda, and visible workspace labels for standalone reminders.
- Workspace-scoped Notes and Categories, cross-workspace global search, workspace unread indicators, and immediate clearing of stale workspace data.
- Same-workspace linked-note validation and picker, optimistic conflict review, local recovery drafts, and remote update/deletion handling.
- Invitation preview and lifecycle management, including backend visibility checks on preview and acceptance.
- Make Private, Leave and Delete confirmation flows; 30-day Trash/Restore and bounded scheduled purge.
- Activity type/person filters and cursor pagination.
- Workspace-aware in-app notifications, push preferences, unread counts and notification deep links.
- Incremental Notes, Events, Reminders and membership deltas, including removal of cached aggregate events/reminders when membership is revoked.
- Centralized visible-screen polling with offline/hidden pause, resume refresh, jitter, bounded backoff, request cancellation and presence heartbeat.
- Loading skeletons, sync state, offline recovery messaging, calendar contrast-aware workspace markers, keyboard focus and larger touch targets.

Verification coverage on the branch includes aggregate event/reminder access, cross-workspace isolation, Viewer write rejection, invitation expiry/reuse/visibility, linked-resource boundaries, notification ownership/preferences, Trash retention, polling and migration validation.

Not represented as implemented:
- A full offline write queue. Offline edits remain local recovery drafts only.
- A device/screen-reader verification session across VoiceOver/NVDA and all workspace/calendar states. ARIA announcements and labels have been improved, but manual assistive-technology verification remains.
- A complete visual contrast and enlarged-text review across every screen. Calendar/workspace typography and contrast have been improved; the remaining full-app review is a separate verification task.
- Production traffic/conflict measurements. Polling remains the selected strategy; do not introduce SSE/WebSocket without those measurements.
