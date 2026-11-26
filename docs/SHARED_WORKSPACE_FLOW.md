# Shared Workspace: Complete Flow & Architecture

**Project:** KitaNotes  
**Scope:** Shared Workspace for Notes and Calendar  
**Document type:** Functional flow and implementation reference

---

## 1. Overview

Shared Workspace allows multiple users to collaborate in one workspace and share:

- Notes
- Categories
- Calendar Events
- Reminders
- Members and Roles
- Activity Logs
- Invitations

Each workspace has its own data boundary, membership and permissions. A user should only access a workspace they own or have joined.

### 1.1 Workspace types

| Type | Description |
|---|---|
| Personal / Private | Only the owner has access |
| Shared | The owner can invite other users to collaborate |

### 1.2 Workspace roles

| Role | Permissions |
|---|---|
| Owner | Full access, including workspace and member management |
| Editor | Can view and modify workspace content |
| Viewer | Read-only access |

---

## 2. Workspace Creation Flow

### 2.1 Create a personal workspace

1. User opens the Workspace selector.
2. User selects **Create Workspace**.
3. User enters a workspace name.
4. Backend creates the workspace.
5. The creating user becomes its Owner.
6. The workspace is created as Private.
7. The new workspace becomes the active workspace.

### 2.2 Enable sharing

1. Owner opens **Manage Space**.
2. Owner opens **Settings**.
3. Owner changes visibility from Private to Shared.
4. The invitation feature becomes available.
5. Owner can invite other users.

---

## 3. Invitation Flow

### 3.1 Create an invitation

1. Owner opens **Manage Space**.
2. Owner selects **Invite Members**.
3. Owner chooses the invitee's role: Editor or Viewer.
4. Backend generates a cryptographically secure random invitation token.
5. Backend stores the SHA-256 hash of the token, not the raw token.
6. The invitation link is generated for sharing.
7. The invitation expires after seven days if it has not been accepted.

### 3.2 Accept an invitation

1. Invitee opens the invitation link.
2. Backend validates the invitation token.
3. Backend checks that the invitation is still valid and unused.
4. Invitee signs in using a supported authentication method.
5. The system verifies the invitee's identity and applies the configured email verification requirements.
6. Backend creates the workspace membership.
7. The role selected by the Owner is assigned.
8. Invitation is marked as accepted.
9. The workspace appears in the invitee's workspace list.

### 3.3 Invitation security

- Generate tokens using a cryptographically secure random generator.
- Store only the token hash in the database.
- Enforce invitation expiry.
- Prevent reuse after acceptance.
- Bind acceptance to the authenticated user.
- Verify workspace visibility and invitation status on the backend.
- Do not rely on frontend validation for authorization.

### 3.4 Membership lifetime

After an invitation is accepted, membership remains active until one of these actions occurs:

- Owner removes the member.
- Member leaves the workspace.
- Owner changes the workspace to Private.

The seven-day expiry applies to pending invitations, not accepted memberships.

---

## 4. Notes Flow

### 4.1 Load notes

When a user selects a workspace:

1. Frontend sets the `activeWorkspaceId`.
2. Frontend requests notes for that workspace.
3. Backend authenticates the user.
4. Backend verifies workspace membership.
5. Backend returns only notes belonging to that workspace.
6. Frontend renders the returned notes.

API:

```http
GET /api/notes?limit=100&workspaceId={workspaceId}
```

### 4.2 Create a note

1. User selects **Create Note**.
2. Frontend submits the active workspace ID.
3. Backend verifies the user has Owner or Editor permission.
4. Backend validates the workspace and request.
5. Note is stored with the correct `workspace_id`.
6. Activity log is recorded.
7. Other authorized members can see the note.

### 4.3 Update a note

1. User opens a note.
2. Frontend loads its latest version.
3. User edits the content.
4. Frontend submits the update with the current version.
5. Backend verifies membership and write permission.
6. Backend checks the version to prevent silent overwrites.
7. If the version matches, the update is saved.
8. The version is incremented.
9. Activity log is recorded.

### 4.4 Concurrent editing

The current design uses optimistic concurrency through a version field.

Example:

1. User A opens Note version 5.
2. User B opens Note version 5.
3. User A saves changes; the note becomes version 6.
4. User B attempts to save using version 5.
5. Backend detects a version conflict.
6. User B must reload or reconcile the latest content before saving again.

This prevents one user's stale update from silently overwriting another user's changes.

### 4.5 Archive, restore and delete permissions

| Action | Owner | Editor | Viewer |
|---|---:|---:|---:|
| View Note | Yes | Yes | Yes |
| Create Note | Yes | Yes | No |
| Edit Note | Yes | Yes | No |
| Archive Note | Yes | Yes | No |
| Restore Note | Yes | Yes | No |
| Delete Note | Yes | Yes | No |

All permissions must be enforced by the backend. Hiding buttons in the frontend is only a user-experience measure.

### 4.6 Note synchronization

The current implementation polls every five seconds for the note currently open. This is not intended to reload the entire note list every five seconds.

Recommended approach:

- Keep the current polling mechanism initially.
- Ensure only the currently opened note is polled.
- Avoid duplicate polling requests.
- Consider WebSocket or Server-Sent Events if stronger real-time collaboration is required later.

---

## 5. Calendar Flow

### 5.1 Calendar event data model

Calendar Events include fields such as:

- `workspace_id`
- `created_by_user_id`
- `updated_by_user_id`
- `starts_at_utc`
- `ends_at_utc`
- `timezone`
- `linked_note_id`
- `version`

Every workspace-owned event must have a workspace ID. The workspace ID defines its access boundary.

### 5.2 Create an event

1. User opens Calendar.
2. User selects a date.
3. User selects **Create Event**.
4. Frontend submits the active workspace ID.
5. Backend verifies workspace membership.
6. Backend verifies the user has Owner or Editor permission.
7. If the event links to a note, backend verifies that the note belongs to the same workspace.
8. Event is saved.
9. Activity log is recorded.
10. Authorized workspace members can view the event.

API:

```http
POST /api/events
```

### 5.3 Read events

The current frontend request was observed as:

```http
GET /api/events?from={date}&to={date}
```

The request does not include a workspace ID. The current backend behaviour without a workspace filter can return events from all workspaces the user belongs to.

This differs from Notes and Reminders, which are scoped to the active workspace.

### 5.4 Reminders

The current frontend requests reminders using the active workspace:

```http
GET /api/reminders?workspaceId={workspaceId}&limit=100
```

Target scope comparison:

| Data | Target behaviour |
|---|---|
| Notes | Active workspace only |
| Calendar Events | Aggregate across all joined workspaces, filtered in the client |
| Reminders | Aggregate across joined workspaces when tied to calendar events |

### 5.5 Calendar permissions

The Calendar UI must reflect the role in each event's own workspace. Calendar is an aggregate personal view across all joined workspaces, so the active workspace role must never be reused for every event.

| Action | Owner | Editor | Viewer |
|---|---:|---:|---:|
| View Events | Yes | Yes | Yes |
| Create Event | Yes | Yes | No |
| Edit Event | Yes | Yes | No |
| Delete Event | Yes | Yes | No |

The frontend should hide or disable write actions for Viewers. The backend must independently reject unauthorized write requests.

### 5.6 Linked notes

If a Calendar Event links to a Note:

- The Note must belong to the same workspace as the Event.
- The user must have access to that workspace.
- Backend must reject a `linked_note_id` from another workspace.
- Note deletion must be handled consistently so Events do not retain invalid or unauthorized references.

---

## 6. Calendar Display Behaviour

### 6.1 Default view

When Calendar opens without a selected date:

- Show the monthly summary for the current month.
- Show the number of Events.
- Show the number of Public Holidays.
- Show the number of School Holidays.

### 6.2 Date selection

When a user selects a date:

- Show Events for that date.
- Show relevant Public Holidays.
- Show relevant School Holidays.

### 6.3 Return to monthly summary

When the user selects **Monthly Summary**:

- Clear the selected date.
- Display the monthly summary again.

### 6.4 Month navigation

When the user changes month:

- Update the displayed month.
- Clear the previous selected date.
- Display the monthly summary for the newly selected month.

### 6.5 Public and school holidays

Public Holidays and School Holidays are global reference data, not workspace-owned records.

The user's selected state or region can remain a personal calendar preference.

---

## 7. Workspace Management

The **Manage Space** area contains the following sections.

### 7.1 People

Owner can:

- View workspace members.
- View each member's role.
- Change member roles.
- Remove members.
- Transfer ownership, where supported.

### 7.2 Invite

Owner can:

- Generate invitation links.
- Select the invited user's role.
- View pending invitations.
- Revoke invitations that have not been accepted.

### 7.3 Activity

Activity shows recent workspace actions.

Examples:

- `note.created`
- `note.updated`
- `note.deleted`
- `event.created`
- `event.updated`
- `event.deleted`
- `member.joined`
- `member.left`
- `member.removed`
- `member.role_changed`

The current implementation was observed to limit the activity display to the latest 50 entries.

### 7.4 Settings

Owner can manage:

- Workspace name.
- Workspace visibility.
- Membership-related settings.
- Workspace deletion.

---

## 8. Convert Shared Workspace to Private

This action allows the Owner to stop sharing a workspace without deleting its content.

Flow:

1. Owner opens **Manage Space**.
2. Owner opens **Settings**.
3. Owner selects **Make Private**.
4. Backend changes workspace visibility to Private.
5. Other members' memberships are removed.
6. Pending invitations are revoked.
7. Notes are preserved.
8. Categories are preserved.
9. Calendar Events are preserved.
10. Reminders are preserved.

After conversion:

- Only the Owner has access.
- Former members do not automatically regain access if the workspace is shared again.
- The Owner must invite members again.

**Make Private is not the same as Delete Workspace.**

---

## 9. Delete Workspace

Deleting a workspace is a separate and destructive action.

Flow:

1. Owner selects **Delete Workspace**.
2. Backend verifies that the user is the Owner.
3. Backend validates the workspace state.
4. The workspace deletion process runs.
5. Workspace-owned child data is deleted according to database cascade rules.

Important considerations:

- Only the Owner may delete the workspace.
- The current shared-workspace delete endpoint does not support deleting a Private workspace.
- UI must show a clear confirmation before deletion.
- Backend must prevent deletion of another user's workspace.
- Deletion behaviour and cascading effects should be covered by tests.

---

## 10. Activity Logs and Notifications

Important workspace changes should generate Activity Logs.

| Action | Activity |
|---|---|
| Create Note | `note.created` |
| Update Note | `note.updated` |
| Delete Note | `note.deleted` |
| Create Event | `event.created` |
| Update Event | `event.updated` |
| Delete Event | `event.deleted` |
| Member joins | `member.joined` |
| Member leaves | `member.left` |
| Member removed | `member.removed` |
| Role changed | `member.role_changed` |

### 10.1 Notifications

Notifications may be sent to other workspace members for relevant changes, for example:

- A new Note is created.
- A Note is updated.
- A new Event is created.
- An Event is updated.
- A new member joins the workspace.

Notifications must respect each user's notification preferences.

The in-app notification inbox and push notifications are separate mechanisms and should be handled independently.

---

## 11. Current Architecture Issues

The following issues were identified from the code inspection and should be addressed.

### Issue 1: Calendar workspace scope

The current Events request does not include `workspaceId`.

Potential impact:

- Calendar may combine Events from multiple workspaces.
- Notes and Reminders use the active workspace.
- The application behaves inconsistently when switching workspaces.

### Issue 2: Calendar permission UI

Create, Edit and Delete controls may be visible without considering the current user's role.

Potential impact:

- Viewers may see actions they cannot perform.
- Backend may reject those actions, but the UX is confusing.
- Frontend should use the current workspace role to render the correct controls.

### Issue 3: Linked Note validation

Backend must verify that a linked Note and its Calendar Event belong to the same workspace.

This prevents cross-workspace references and unauthorized data access.

### Issue 4: Synchronization

Notes currently have polling for the opened note. Calendar synchronization should follow a similarly deliberate strategy so members can see changes without manual refresh.

### Issue 5: Cross-workspace security

All relevant endpoints should be audited to ensure:

- Workspace membership is verified.
- Role is verified for write operations.
- Resource ownership is verified.
- A resource ID cannot be used to access data from another workspace.
- Linked resources cannot cross workspace boundaries.

---

## 12. Recommended Target Architecture

Recommended data scope:

| Component | Scope |
|---|---|
| Notes | Active Workspace |
| Categories | Active Workspace |
| Calendar Events | All joined workspaces (personal aggregate view) |
| Reminders | Aggregate when event-linked; otherwise explicitly labelled by workspace |
| Members | Active Workspace |
| Activity Logs | Active Workspace |
| Invitations | Active Workspace |
| Public Holidays | Global reference data |
| School Holidays | Global reference data |

### 12.1 Workspace switching

When a user switches workspace:

1. Update `activeWorkspaceId`.
2. Reload Notes.
3. Reload Categories.
4. Reload Calendar Events.
5. Reload Reminders.
6. Reload Members and workspace permissions.
7. Clear stale data belonging to the previous workspace.
8. Avoid displaying old workspace data while the new workspace is loading.
9. Ensure in-flight requests for the previous workspace cannot overwrite the new workspace's state.

### 12.2 Backend enforcement

Every API receiving a workspace ID should:

1. Authenticate the user.
2. Verify the workspace exists.
3. Verify the user is a member of the workspace.
4. Verify the user's role if the operation requires write access.
5. Verify the target resource belongs to that workspace.
6. Return an appropriate error when access is denied.

Frontend permission checks improve UX. Backend authorization is the actual security boundary.

---

## 13. Recommended Implementation Roadmap

### Phase 1: Workspace scope consistency

- [ ] Ensure Calendar Events use the active workspace ID.
- [ ] Ensure Reminders use the active workspace ID.
- [ ] Ensure Notes use the active workspace ID.
- [ ] Ensure Categories use the active workspace ID.
- [ ] Clear stale workspace data when switching workspace.
- [ ] Review workspace scoping across all relevant APIs.

### Phase 2: Role-based Calendar UI

- [ ] Owner can create, edit and delete Events.
- [ ] Editor can create, edit and delete Events.
- [ ] Viewer can only view Events.
- [ ] Hide or disable actions the current role cannot perform.
- [ ] Ensure backend still enforces permissions.

### Phase 3: Linked resource security

- [ ] Validate `linked_note_id`.
- [ ] Ensure Note and Event belong to the same workspace.
- [ ] Verify access to linked resources.
- [ ] Review deletion behaviour for linked Notes.

### Phase 4: Synchronization

- [ ] Review Notes synchronization.
- [ ] Review Calendar Events synchronization.
- [ ] Check for duplicate polling.
- [ ] Avoid unnecessary polling.
- [ ] Consider WebSocket or Server-Sent Events if needed.

### Phase 5: Activity and notifications

- [ ] Review all Activity Log events.
- [ ] Ensure actor ID is recorded.
- [ ] Ensure workspace ID is recorded.
- [ ] Ensure notifications go to the correct members.
- [ ] Respect notification preferences.

### Phase 6: Security audit

- [ ] Audit Notes endpoints.
- [ ] Audit Calendar endpoints.
- [ ] Audit Reminder endpoints.
- [ ] Audit invitation endpoints.
- [ ] Audit membership endpoints.
- [ ] Audit workspace settings.
- [ ] Audit workspace deletion.
- [ ] Test Viewer write rejection.
- [ ] Test cross-workspace ID manipulation.
- [ ] Test revoked membership.
- [ ] Test expired invitation.
- [ ] Test reused invitation token.

---

## 14. Decisions to Confirm

Two product decisions should be explicit before implementation.

### Decision A: Calendar scope

#### Option A: Active Workspace Calendar

Calendar only displays Events from the currently active workspace.

Advantages:

- Consistent with Notes and Reminders.
- Easier to understand.
- Prevents unrelated workspace data from being mixed.
- Simpler permission handling.

#### Option B: Aggregate Calendar

Calendar displays Events from every workspace the user has joined.

Advantages:

- Gives users one overview of all commitments.
- Useful if Calendar is intended to be a personal master calendar.

Trade-offs:

- Every Event should clearly identify its source workspace.
- Permission handling must be evaluated per workspace.
- UI and filtering become more complex.

**Decision: Option B, Aggregate Calendar.** Calendar is a personal view across all joined workspaces. Every event remains owned by exactly one workspace, is visible only to its members, and carries a source-workspace indicator.

### Decision B: Synchronization strategy

#### Option A: Polling

- Straightforward to implement.
- Does not require additional real-time infrastructure.
- Can use controlled periodic requests.

#### Option B: Realtime

- Uses WebSocket or Server-Sent Events.
- Delivers changes without waiting for the next polling interval.
- Requires connection lifecycle, reconnect and delivery handling.

**Recommendation: Keep polling initially and make it efficient. Consider realtime after the core workspace behaviour is stable.**

---

## 15. Expected User Experience

The completed Shared Workspace experience should satisfy these requirements:

1. Users can own multiple workspaces.
2. Each workspace can be Private or Shared.
3. Owners can invite other users.
4. Owners can assign Editor or Viewer roles.
5. Members can collaborate on Notes.
6. Members can collaborate on Calendar Events.
7. Notes, Events and Reminders are scoped consistently to the active workspace.
8. Viewers have read-only access.
9. Editors can manage workspace content.
10. Owners have full workspace control.
11. Member changes are recorded in Activity.
12. Notifications follow user preferences.
13. Switching workspace never mixes data between workspaces.
14. All access is authorized by the backend.
15. Owners can make a workspace Private without losing its content.

---

## 16. Core Design Principle

A workspace is an independent collaboration boundary with its own data, members, permissions and activity.

**Notes and Calendar must follow the same workspace boundary.** This keeps the user experience consistent and protects data from leaking across workspaces.

---

## 17. Implementation Status and Verification Notes

This document combines observed current behaviour, identified gaps and recommended future work.

- Items described as current behaviour are based on the code inspection performed for this document.
- Items in the roadmap are recommendations and are not claims that implementation is complete.
- API behaviour, authorization and database cascade rules should be revalidated against the latest source before implementation.
- Each completed roadmap item should be accompanied by appropriate tests.


## 18. Updated product decisions and implementation addendum (2026-11-27)

This section supersedes any earlier wording in Sections 5.3, 5.4, 12, 13, 14, 15 and 16 that describes Calendar or Reminders as active-workspace-only.

### 18.1 Confirmed scope

| Resource | Scope | Behaviour |
|---|---|---|
| Notes | Active workspace | Only notes from the active workspace are shown. Global search is the explicit cross-workspace discovery path. |
| Categories | Active workspace | Category lists remain workspace-specific. |
| Calendar Events | Aggregate | One visible-range request returns events from every workspace the user has joined. Every event retains its workspaceId. |
| Reminders | Aggregate | Reminders follow Calendar because they are associated with calendar events or notes. |
| Holidays | Global | Public and school holiday data remain global reference data. |
| Members, Activity, Invitations | Active workspace | These management views remain scoped to the selected workspace. |

The aggregate Calendar is a personal view, not a shared cross-workspace data boundary. The backend returns only events from workspaces in which the authenticated user is currently a member. Event create, update and delete authorization is checked against the event's own workspace.

### 18.2 Calendar source identity and linked notes

- Workspaces have shared Owner-configurable icon and colour defaults. Each user may override a workspace colour locally in their own calendar.
- Calendar filter chips persist per user and show the source workspace name. Event detail shows the workspace name and colour.
- Event creation requires a writable workspace. The linked-note picker is restricted to notes in the selected event workspace.
- Event detail shows a linked-note title and workspace. Selecting it switches the active Notes workspace and opens the note. A soft-deleted or inaccessible note is shown as unavailable.
- Calendar polling uses the visible date range, one aggregate request, an updatedSince cursor and removed event IDs.

### 18.3 Synchronization contract

- Notes poll only for the active workspace. Notes, Events, Reminders and Workspace membership/list endpoints support incremental updatedSince requests.
- Notes deltas include removed note IDs when notes are archived or deleted. Event deltas include removed event IDs when events are deleted or moved outside the visible range. Workspace deltas include removed workspace IDs when membership is revoked.
- A keyed shared poll scheduler owns resource polling. It pauses when the document is hidden or the device is offline, refreshes immediately on resume/reconnect, applies jitter and bounded exponential backoff, and aborts requests when a resource key is released.
- Open-note polling remains five seconds. Calendar is 30 seconds, workspace membership 60 seconds, Notes 30 seconds, Activity 15 seconds and notification badge/inbox 30 seconds. These are starting values to be tuned with measured traffic.
- A lightweight presence heartbeat runs while the app is visible and a workspace is active. The member list shows online or last-seen status. This is polling-based presence, not a WebSocket session.
- Local note drafts are retained for recovery. A full offline write queue is not implemented and must not be represented as supported.

### 18.4 Trash retention

Deleted notes enter Trash and can be restored by an Owner or Editor for 30 days. Expired notes are purged in bounded batches by the daily scheduled cleanup. Restoring a note increments its version and records an activity event. The backend enforces the retention window even if a stale client attempts a restore.

### 18.5 Notifications and activity

- In-app notifications and push notifications remain separate delivery mechanisms.
- Both include the workspace name. Push delivery supports per-workspace All, Important only and Mute settings. Important alerts include reminders and workspace access/role changes; routine note and event changes are suppressed in Important only mode.
- In-app inbox notifications remain available regardless of the push preference.
- Notification links carry workspace and resource identifiers. Opening a notification switches workspace and opens the target note or event where it remains available.
- Activity supports type/person filters and cursor pagination. Human-readable descriptions are preferred over raw event codes.

### 18.6 Roadmap status and remaining work

The following items are implemented on the current feature branch but are not considered released until CI, migration validation and CodeQL pass and the branch is merged to main:

- Aggregate Calendar and Reminders with workspace identity and filters.
- Shared workspace icon/colour defaults and personal calendar colour overrides.
- Workspace-scoped Notes, global search, conflict recovery and local draft recovery.
- Invitation preview, activity filters/pagination and consequence-aware workspace lifecycle confirmations.
- 30-day Trash/Restore and scheduled purge.
- Per-workspace push preferences, workspace unread counts, notification deep links and workspace-aware inbox text.
- Incremental Notes, Events, Reminders and Workspace membership sync.
- Keyed polling scheduler, pause/resume, jitter, backoff and request cancellation.
- Polling-based member presence.

Still requiring a separate UX/verification pass:

- Inline updated-by banners while a user is editing, with explicit preservation of unsaved text when a remote delete occurs.
- A single visible sync-status indicator for Up to date, Syncing and Paused/offline, plus an offline banner.
- Pull-to-refresh on Notes and Calendar and explicit Updated just now feedback.
- A complete offline write queue. Current local drafts are recovery only.
- Skeleton loaders and dynamic text-size review across all workspace/calendar states.
- Full screen-reader announcement and contrast audit, including event title plus workspace name.
- Traffic/conflict measurement before any decision to adopt SSE or WebSocket.

### 18.7 Core design principle (supersedes Section 16)

Notes are workspace-scoped; Calendar is a personal view over all joined workspaces. Every Event and Reminder still belongs to exactly one workspace. Workspace membership and role checks remain the backend security boundary.
