# Push Notification Content Catalogue

**Project:** KitaNotes  
**Scope:** Web Push notifications displayed by the service worker  
**Source of truth:** `worker/push.ts`, `worker/notes.ts`, `worker/events.ts`, `worker/reminder-cron.ts`, `worker/invitations.ts`, and `public/sw.js`.

This document records the behaviour implemented in the current code. It distinguishes the text displayed on the device from the richer in-app notification inbox. Do not assume that every in-app notification also sends a Web Push notification.

## 1. What the device displays

All activity push messages are deliberately generic. The strings below are returned by `safePushMessage()` in `worker/push.ts` and are the exact title/body sent to the browser push service.

| Push kind | Device title | Device body |
|---|---|---|
| `reminder` | **Reminder due** | A reminder is due. Open KitaNotes to review it. |
| `reminder_update` | **Reminder changed** | A shared workspace reminder was updated or cancelled. Open KitaNotes to review it. |
| `shared_note` | **New shared note** | Someone added a note in a shared workspace. Open KitaNotes to view it. |
| `shared_note_update` | **Shared note changed** | A shared note was updated or removed. Open KitaNotes to review it. |
| `event` | **Calendar activity** | A calendar event was created, changed or cancelled. Open KitaNotes to review it. |
| `workspace` | **Workspace activity** | Your workspace membership or permissions changed. Open KitaNotes to review it. |
| `test` | **KitaNotes** | Push notifications are connected on this device. |

The caller may construct a more specific title, body, URL or tag, but `sendPushToUser()` intentionally ignores those values. It always uses `safePushMessage(kind)`, sets the target URL to `/`, and creates an opaque random tag. Therefore note titles, note text, event titles/descriptions, reminder titles/due times, member names, workspace names and resource IDs are not included in the push payload.

## 2. Function-by-function coverage

### 2.1 Notes

| User action / code path | Recipient | Push kind | Device content | Status |
|---|---|---|---|---|
| Create a note in a shared workspace (`worker/notes.ts`, create handler) | Other current workspace members; creator excluded | `shared_note` | **New shared note** / Someone added a note in a shared workspace. Open KitaNotes to view it. | Implemented |
| Update a note (`worker/notes.ts`, update handler) | Other current workspace members; editor excluded | `shared_note_update` | **Shared note changed** / A shared note was updated or removed. Open KitaNotes to review it. | Implemented |
| Delete a note (`worker/notes.ts`, delete handler) | Other current workspace members; deleter excluded | `shared_note_update` | **Shared note changed** / A shared note was updated or removed. Open KitaNotes to review it. | Implemented |
| Restore a deleted note (`worker/notes.ts`, restore handler) | Other current workspace members; restorer excluded | `shared_note_update` | **Shared note changed** / A shared note was updated or removed. Open KitaNotes to review it. | Implemented |

Note updates include changes handled by the note update endpoint, such as title/content/archive state. The SQL notification triggers also create or update in-app inbox entries, but the push itself is sent by the Worker handler.

### 2.2 Calendar events

| User action / code path | Recipient | Push kind | Device content | Status |
|---|---|---|---|---|
| Create an event (`worker/events.ts`, create handler) | Other current workspace members; creator excluded | `event` | **Calendar activity** / A calendar event was created, changed or cancelled. Open KitaNotes to review it. | Implemented |
| Update an event (`worker/events.ts`, update handler) | Other current workspace members; editor excluded | `event` | Same generic Calendar activity message | Implemented |
| Delete/cancel an event (`worker/events.ts`, delete handler) | Other current workspace members; deleter excluded | `event` | Same generic Calendar activity message | Implemented |
| Import calendar events through another import path | Depends on the import implementation; no direct `sendPushToUser()` call is present in the event handler catalogue | None confirmed | No push is documented as guaranteed | Verify separately |

The push message intentionally does not distinguish create, update and delete on the lock screen. The in-app inbox uses more specific event activity types.

### 2.3 Reminders

| User action / code path | Recipient | Push kind | Device content | Status |
|---|---|---|---|---|
| Reminder reaches its due time (`worker/reminder-cron.ts`, `deliverDueReminders()`) | Every current member of the reminder's workspace, including the creator/owner | `reminder` | **Reminder due** / A reminder is due. Open KitaNotes to review it. | Implemented |
| Reminder is edited or rescheduled (`worker/reminders.ts`, PATCH handler) | Other current workspace members; editor excluded | `reminder_update` | **Reminder changed** / A shared workspace reminder was updated or cancelled. Open KitaNotes to review it. | Implemented |
| Reminder is cancelled before due time (`worker/reminders.ts`, DELETE handler) | Other current workspace members; canceller excluded | `reminder_update` | Same generic Reminder changed message | Implemented |

The scheduled Worker invokes reminder delivery every five minutes. Due reminders are processed in batches of up to 25. A reminder linked to an event or note that has already been deleted is cancelled instead of being delivered. The in-app inbox stores the reminder title and due-time context; the device push does not expose either value.

Unlike note/event mutations, due reminders are broadcast to all current workspace members. This is a scheduled reminder delivery, not an action notification, so there is no actor to exclude.

### 2.4 Workspace membership and access

| User action / code path | Push recipient | Push kind | Device content | Status |
|---|---|---|---|---|
| Member accepts an invitation, including invite-link and email invitation flows (`worker/invitations.ts`) | Workspace owner | `workspace` | **Workspace activity** / Your workspace membership or permissions changed. Open KitaNotes to review it. | Implemented |
| Owner changes a member's role to Editor or Viewer | Affected member | `workspace` | Same generic Workspace activity message | Implemented |
| Owner removes a member | Removed member | `workspace` | Same generic Workspace activity message | Implemented |
| Member leaves a workspace | Workspace owner | `workspace` | Same generic Workspace activity message | Implemented |
| Owner transfers workspace ownership | New owner | `workspace` | Same generic Workspace activity message | Implemented |
| Owner creates or revokes a pending invitation | No push call in those handlers | None | No push is sent | Not implemented |
| Workspace is changed from Shared to Private (bulk membership removal) | No per-member push call in that handler | None | No push is sent | Not implemented |
| Workspace is deleted | No push call in that handler | None | No push is sent | Not implemented |

The member who accepts an invitation is not sent a push by this flow; the owner receives it. For role changes, removal and ownership transfer, the affected user is the recipient. For a member leaving, the owner is the recipient.

### 2.5 Push test and subscription management

| Function | Device content / behaviour |
|---|---|
| `POST /api/push/test` | Sends **KitaNotes** / Push notifications are connected on this device. |
| `POST /api/push/subscriptions` | Registers or refreshes the current browser subscription; does not send a notification. |
| `DELETE /api/push/subscriptions` | Removes the current user's subscription; does not send a notification. |
| `GET /api/push/public-key` | Returns push configuration status and the public VAPID key; does not send a notification. |

## 3. In-app inbox is not the same as device push

The in-app inbox is stored in the D1 `notifications` table and can retain specific titles, bodies and resource references for the signed-in user. The push payload is intentionally less detailed.

Examples:
- The inbox can say which note or event changed; the device push only says that a shared note or calendar event changed.
- A due reminder's inbox entry includes the reminder title, workspace context and formatted due time; the device push only says **Reminder due**.
- Workspace inbox entries may identify the member or role change; the device push only says **Workspace activity**.

Some SQL triggers create inbox records without a corresponding push call. Always check the function-by-function table above before describing an activity as push-enabled.

## 4. Delivery rules applied to every push

1. **Global switch:** `push_enabled` must be enabled. If no preference row exists, the Worker uses enabled defaults.
2. **Activity switches:** reminder due/change, new shared note, shared-note update/delete, event and workspace pushes each have their own user preference.
3. **Workspace mode:** each workspace can be set to `all`, `important` or `mute`. Note and event changes are marked non-important. Due reminders and workspace membership/access changes are marked important.
4. **Quiet hours:** activity pushes are suppressed during the user's quiet hours in their IANA timezone. Default timezone is `Asia/Kuala_Lumpur`. Overnight windows are supported. Suppressed pushes are not queued for later delivery.
5. **Test exception:** test pushes bypass activity switches and quiet hours, but still require the global push switch.
6. **Best-effort delivery:** push delivery failures do not roll back the user action. The in-app inbox remains the source of truth where an inbox entry is created.
7. **Device subscriptions:** up to 10 browser subscriptions per user. Expired endpoints returning HTTP 404 or 410 are removed.
8. **Push expiry:** payload TTL is one hour and urgency is normal.
9. **Self-notification:** note and event mutation handlers exclude the acting user. Workspace actions notify the affected member or owner, not the actor. Due reminders go to all current workspace members.

## 5. Privacy and click behaviour

- Push title/body are selected only from the fixed `safePushMessage()` catalogue.
- Caller-provided message text, URLs and tags are ignored.
- Push data always contains the root path `/`; no workspace, note, event or reminder identifier is sent in the payload.
- The tag is random and opaque, not a resource identifier.
- The service worker (`public/sw.js`) displays the title/body and opens/focuses KitaNotes at the supplied same-origin path. With the current Worker sender, that path is always `/`.
- Push services and lock screens therefore do not receive private note/event/reminder content or workspace/member names.

## 6. Current gaps and follow-up candidates

These are gaps observed in the current source, not claims that the features are already implemented:

- Push for reminder cancellation, edits or rescheduling, if those actions should notify collaborators.
- Push for calendar import operations, if imported events should notify workspace members.
- Push for invitation creation/revocation, if the product intends to notify invitees or owners.
- Push when a shared workspace is made private or deleted, if former members need a device-level notice.
- A more granular event message category could distinguish created, updated and cancelled events while remaining privacy-safe. This would require adding new push kinds or a safe subtype, not forwarding event content.

Any future addition should preserve the privacy boundary: do not put note titles/content, event titles/descriptions, reminder titles/due times, member names, workspace names, invitation tokens or resource identifiers into the push payload.
