# Push Notification Content Catalogue

**Implementation status:** Phase 1 core UX implemented in the feature branch. Phase 2 coverage gaps and Phase 3 batching/digest work remain separate follow-ups.

## 1. Device-visible content

Push previews are selected per recipient from `notification_preferences.push_preview_mode`:

- `detailed`: show actor, resource title, workspace and time where available.
- `generic`: preserve the original `safePushMessage(kind)` title/body exactly.

New accounts without a saved preference receive `detailed`. Migration `0030_push_preview_and_debounce.sql` adds the column with a `generic` database default, so existing preference rows retain the privacy-preserving behaviour they had before this release.

The in-app notifications table and its content are unchanged.

### Notes

| Trigger | Detailed title | Detailed body |
|---|---|---|
| Created | `{actor} added a note` | `{note} · {ws}` |
| Edited | `{actor} edited a note` | `{note} · {ws}` |
| Archived | `{actor} archived a note` | `{note} · {ws}` |
| Deleted | `{actor} deleted a note` | `{note} · {ws}` |
| Restored from trash | `{actor} restored a note` | `{note} · {ws}` |

Empty note titles display as `Untitled note`. Note body/content is never included.

### Calendar

| Trigger | Detailed title | Detailed body |
|---|---|---|
| Created | `New event: {event}` | `{when} · added by {actor} · {ws}` |
| Start time changed | `Event moved: {event}` | `Now {when} · {actor}` |
| Other details changed | `Event updated: {event}` | `{when} · {actor}` |
| Cancelled/deleted | `Event cancelled: {event}` | `Was {when} · {actor}` |

The update handler compares the old and new UTC start time. Display time is formatted for the recipient's stored timezone (default `Asia/Kuala_Lumpur`).

### Reminders

| Trigger | Detailed title | Detailed body |
|---|---|---|
| Due on schedule | `Reminder: {reminderTitle}` | `Due now · {ws}` |
| Cron runs more than five minutes late | `Reminder: {reminderTitle}` | `Due {when}` |

Reminder reschedule and cancellation pushes are not yet implemented.

### Workspace

| Trigger | Detailed title | Detailed body |
|---|---|---|
| Invitation accepted | `{actor} joined {ws}` | `They can now access shared notes.` |
| Role changed | `Your role changed in {ws}` | `You are now {role}.` |
| Member removed | `Removed from {ws}` | `You no longer have access to this workspace.` |
| Member left | `{actor} left {ws}` | `Their access has been removed.` |
| Ownership transferred | `You are now the owner of {ws}` | `You can manage members and settings.` |

Invitation-received pushes and former-member pushes for workspace privacy/deletion changes remain Phase 2 gaps.

### Test

`KitaNotes` / `Push notifications are connected on this device.`

### Generic fallback catalogue

These exact strings remain the generic-mode content and the fallback when required detailed data is unavailable:

| Kind | Title | Body |
|---|---|---|
| `reminder` | Reminder due | A reminder is due. Open KitaNotes to review it. |
| `shared_note` | New shared note | Someone added a note in a shared workspace. Open KitaNotes to view it. |
| `shared_note_update` | Shared note changed | A shared note was updated or removed. Open KitaNotes to review it. |
| `event` | Calendar activity | A calendar event was created, changed or cancelled. Open KitaNotes to review it. |
| `workspace` | Workspace activity | Your workspace membership or permissions changed. Open KitaNotes to review it. |
| `test` | KitaNotes | Push notifications are connected on this device. |

## 2. Payload and deep-link behaviour

Version 2 payloads contain `v`, `kind`, optional `subtype`, title/body, a validated same-origin path, a stable per-resource tag, `renotify`, and resource metadata under `data`. The server rejects malformed URL/tag values and skips payloads over 3 KB.

- Notes link to `/?workspaceId=…&noteId=…`.
- Events link to `/?workspaceId=…&eventId=…`.
- Reminders link to their linked event/note, or to the reminder itself.
- Workspace changes link to the workspace; removed access links to `/`.

The service worker keeps version 1 handling compatible, validates same-origin destinations on click, focuses/navigates an existing app window, and opens a new one when no same-origin window exists. The application must handle stale resource IDs with a friendly unavailable state.

## 3. Formatting and privacy

- Titles are capped at 60 characters and bodies at 120 characters, truncated at a word boundary.
- Newlines, control characters, HTML and common Markdown syntax are removed; whitespace is collapsed.
- Only note titles are sent, never note body text.
- Missing required actor/workspace/time data falls back to the generic catalogue. No empty title or `undefined` text is sent.
- Detailed previews may be visible on a locked device screen. Users can switch to generic in **Notifications → Delivery preferences → Notification details**.
- Web Push payloads are encrypted between the server and browser push endpoint. Lock-screen visibility remains the practical exposure controlled by preview mode.

## 4. Delivery rules

The existing delivery rules remain in force:

1. Global `push_enabled` switch.
2. Per-activity switches for reminders, new notes, note updates, events and workspace activity.
3. Workspace modes: `all`, `important`, `mute`.
4. Existing IANA-timezone quiet-hours suppression.
5. Actor exclusion for note and event mutations; due reminders go to all current workspace members.
6. Up to 10 subscriptions per user.
7. HTTP 404/410 endpoints are removed.
8. Push is best-effort and never rolls back the underlying user action. The inbox remains unchanged.

Reminder TTL is 24 hours with high urgency; event TTL is 4 hours; other pushes use 1 hour. Reminder pushes use high urgency; other pushes use normal urgency.

## 5. Anti-spam

- Stable tags collapse repeated notifications for the same note, event or reminder.
- Note edits are debounced per note + actor + recipient for 120 seconds using D1. A later edit after expiry can alert again and replace the existing notification.
- Expired debounce rows are cleaned during the reminder cron.

Burst summaries and quiet-hours digests remain Phase 3 work.

## 6. Remaining verification

Before production release, complete real-device checks on Android Chrome, desktop Chrome and iOS Home Screen PWA with the app closed, backgrounded and focused. Also verify stale-item UX and deployed D1 migration `0030`. Automated builder, validation and integration tests are included in the implementation branch; passing CI is still required before merge.
