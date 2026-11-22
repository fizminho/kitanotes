# KitaNotes — Product & Technical Masterplan

**Status:** P0 foundation in progress  
**Repository:** `fizminho/kitanotes`  
**Default branch:** `main`  
**Document owner:** Product / Engineering  
**Last updated:** 2026-11-22 (free-only architecture revision)

> This is the source-of-truth planning document for KitaNotes. Update the checkboxes and decision log as implementation progresses. A checked item means it has been implemented and verified, not merely discussed.

---

## 1. Product vision

KitaNotes is a mobile-first shared notes and lightweight planning application. People sign in with their Google account, create personal notes, invite other Google-account users to collaborate, organise notes into categories, and turn unstructured text into structured notes and calendar items with Gemini.

The product should feel simple for ordinary users while enforcing strong privacy boundaries between users and shared workspaces.

### Core user journeys

1. Sign in with Google.
2. Create a note and optionally assign a category.
3. Invite another person by Google email address to view or edit a note (or a shared space).
4. Paste rough text into the AI assistant and receive a proposed note, category, tasks, dates and reminders.
5. Review and confirm the AI proposal before anything is saved or scheduled.
6. Receive notifications for invitations, newly shared notes, relevant note changes and upcoming reminders.
7. Find notes through categories, search, recent activity and calendar views.

## 2. Product scope

### MVP — required

- [ ] Google sign-in (OpenID Connect); identify users by stable Google subject ID, not email alone.
- [ ] User profile and account settings.
- [ ] Personal notes: create, read, edit, archive and delete.
- [ ] Shared notes / shared spaces with explicit membership.
- [ ] Gmail-address invitations with pending, accepted, expired and revoked states; invitation delivery uses a Gmail compose handoff / copyable secure link in the zero-cost MVP.
- [ ] Membership roles: owner, editor and viewer.
- [ ] User-defined categories, colours and ordering.
- [ ] Note search, category filtering and recent notes.
- [ ] Internal calendar items and reminders, linked to notes.
- [ ] In-app notification inbox.
- [ ] Browser push notifications where permission is granted.
- [ ] In-app notifications and Web Push for invitations and collaboration events. No automated outbound email dependency in the zero-cost MVP.
- [ ] Gemini text-to-structured-note flow with preview and explicit confirmation.
- [ ] AI-suggested categories, with user-defined categories taking precedence when appropriate.
- [ ] Audit/activity history for sharing and material note changes.
- [ ] Responsive PWA experience for mobile and desktop.
- [ ] Automated tests, CI checks, deployment workflow and operational documentation.

### Later releases

- [ ] Optional Google Calendar integration and two-way sync.
- [ ] Real-time collaborative editing / presence.
- [ ] Attachments and image/PDF text extraction.
- [ ] Recurring events and advanced reminder rules.
- [ ] Shared templates and reusable note formats.
- [ ] Offline editing with conflict resolution.
- [ ] Additional AI actions such as summarise, extract action items and reorganise existing notes.

### Explicit non-goals for the first release

- No public-by-default notes or guessable public sharing URLs.
- No silent AI writes, calendar creation or invitations.
- No paid Gemini model escalation.
- No requirement to grant Google Calendar permissions just to sign in.
- No complex enterprise administration or billing in the MVP.

## 3. Proposed free-only architecture

**Hard budget constraint: RM0 recurring infrastructure / API spend. No S3, no CloudFront, no paid Workers plan, no paid database, no paid email service and no automatic paid AI fallback.** Use free plans only and configure the account so exceeding a quota fails closed rather than creating a bill.

Reuse the actual Investlah pattern: Cloudflare-hosted application/API on a Worker with secrets stored as Cloudflare Worker Secrets. The prior Investlah production health check was served by a Cloudflare Worker at `investlah.binalah.com`; it was not an S3 + CloudFront deployment. Keep the same server-side secret-handling and GitHub Actions deployment principles.

### Proposed components

| Layer | Free-only choice | Notes / constraints |
|---|---|---|
| Web client | React + TypeScript + Vite on Cloudflare Worker Static Assets | Decision recorded in ADR-0001 after inspecting the existing Investlah Worker deployment. |
| API | Cloudflare Workers Free | 100,000 requests/day; 10 ms CPU per invocation. Keep handlers short and avoid CPU-heavy synchronous work. |
| Database | Cloudflare D1 Free | SQLite; 5 million rows read/day, 100,000 rows written/day, 500 MB max per database, 5 GB total account storage; free-tier limit exhaustion causes queries to fail until reset. |
| Identity | Google OAuth 2.0 / OpenID Connect | Gmail/Google sign-in; no Calendar scope at login. |
| AI | Gemini API free tier only | Server-side Worker Secret; quotas and eligible models can change. No paid fallback. |
| Reminders | Cloudflare Workers Cron Trigger | Use a small number of scheduled scans and indexed due-time queries. Workers Free supports up to 5 Cron Triggers/account. |
| Notifications | In-app inbox + browser Web Push | Push is best-effort and requires permission; in-app inbox is durable. |
| CI/CD | GitHub Actions + Cloudflare deploy action/CLI | Use repository/environment secrets; never expose secret values in logs or frontend builds. |

### Free-tier ceilings to design around

- Workers Free: 100,000 requests/day and 10 ms CPU time per invocation.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 500 MB maximum per database and 5 GB total account storage. D1 free-tier queries fail after daily read/write limits are exceeded; data remains stored.
- Workers Free supports up to 5 Cron Triggers per account.
- Pages static asset requests are free and unlimited; any Pages Functions requests count against Workers Free request quota.
- Do not rely on Cloudflare Email Sending for arbitrary-recipient transactional email: current documentation says arbitrary-recipient sending requires Workers Paid. For the zero-cost MVP, create the invitation in KitaNotes and provide a secure copyable invitation link plus a Gmail compose handoff for the inviter to send manually. Do not claim the email was sent automatically.
- A custom domain may have a separate registration/renewal cost. RM0 infrastructure does not mean a paid domain is free; use a free `*.workers.dev` hostname unless the user already owns a domain and accepts its existing renewal cost.
- Free plans have quotas and provider policies, not unlimited capacity or an uptime guarantee. Enforce application-level quotas and degrade gracefully instead of upgrading automatically.

### Request flow

1. Browser loads the static application from Cloudflare Worker Static Assets.
2. Google sign-in completes through the configured OAuth client and a server-validated identity flow.
3. Browser calls the Cloudflare Worker API with a secure session.
4. API validates identity, membership and role for every protected operation.
5. API reads/writes D1 using prepared statements and indexed queries.
6. AI requests go through the backend Gemini adapter; the browser never receives the Gemini API key.
7. Cron scans due reminders and creates durable in-app notification records; Web Push delivery is best-effort.

## 4. Authentication, invitations and access control

### Google sign-in

- Use Google OpenID Connect and validate issuer, audience, signature, expiry and nonce/state.
- Use Google's immutable `sub` as the identity key. Email is a mutable contact/ invitation attribute.
- Require a verified email for invitation matching and delivery.
- Keep login scopes minimal: `openid`, `email`, `profile`.
- Google Calendar scopes must be separately requested only when the user enables calendar sync.
- Use secure, HttpOnly, SameSite cookies for the application session where supported.
- Protect OAuth callback and state-changing requests against CSRF.
- Never store Google client secrets or Gemini keys in frontend source, Vite environment variables, public build artifacts or Git.

### Invitation lifecycle

1. Owner/editor enters an email address and role.
2. API verifies inviter permission and creates a cryptographically random, single-use invitation token.
3. Store only a hash of the token; set an expiry and status.
4. Create a one-time acceptance URL and show a copy-link action plus a prefilled Gmail compose handoff; the inviter sends it manually.
5. Invitee signs in with Google.
6. Accept only if the authenticated, verified Google email matches the invitation email (case-normalised for comparison).
7. Record acceptance and create membership atomically.
8. Allow inviter/owner to revoke a pending invitation or remove an existing member.

Invitation links must not reveal note contents before authentication and membership checks.

### Roles

| Capability | Owner | Editor | Viewer |
|---|---:|---:|---:|
| Read note | Yes | Yes | Yes |
| Edit note | Yes | Yes | No |
| Invite members | Yes | Configurable; default no | No |
| Change roles / remove members | Yes | No | No |
| Delete shared note/space | Yes | No | No |
| Leave shared space | No (transfer ownership first) | Yes | Yes |

Enforce permissions in the API and database query layer, never only in the UI.

## 5. Notes and categories

### Note fields (initial model)

- `id` (UUID)
- `workspace_id` (nullable for personal scope, or a personal workspace)
- `title`
- `content` (Markdown/plain text initially)
- `category_id` (nullable)
- `created_by`
- `created_at`, `updated_at`
- `archived_at`, `deleted_at` (soft-delete lifecycle)
- `version` (optimistic concurrency)
- optional `source_type` and `ai_metadata` for traceability

### Categories

- Categories belong to a user or workspace.
- Users can create, rename, recolour, reorder and archive categories.
- AI may suggest an existing category or propose a new category.
- AI must not silently create a category or move existing notes without confirmation.
- If the user has configured category rules, those rules take priority over AI guesses.
- Preserve the original text and show what AI extracted or changed.

## 6. Calendar and reminders

MVP calendar is an internal KitaNotes calendar. This avoids requiring calendar permissions during sign-in and lets reminders work even when Google Calendar is not connected.

### Event fields

- `id`, `workspace_id`, `note_id`
- `title`, `description`
- `start_at`, `end_at` (UTC timestamps)
- `timezone` (IANA timezone, default from user settings; Malaysia users commonly use `Asia/Kuala_Lumpur`)
- `all_day`
- `created_by`
- `reminder_rules`
- `status`, `created_at`, `updated_at`

### Reminder behavior

- Store event instants in UTC and retain the IANA timezone used to interpret local input.
- Support user-selected reminders such as at event time, 10 minutes, 1 hour or 1 day before.
- Use durable scheduled jobs / a due-reminder query with idempotency keys.
- Create one notification per recipient according to workspace membership and notification preferences.
- Handle edits, cancellations, daylight-saving transitions and past-due reminders.
- Do not promise push delivery when browser permission is denied or a device is offline; retain the notification in the in-app inbox and retain the notification in the in-app inbox; automated email is outside the free-only MVP.

### Google Calendar (later phase)

- Optional, explicit opt-in and incremental OAuth consent.
- Encrypt refresh tokens at rest and support disconnect/revocation.
- Track external calendar event IDs and sync state.
- Define conflict rules before enabling two-way sync.
- Do not duplicate events when retries occur.

## 7. Notifications

Notification types:

- Invitation received / accepted / revoked.
- Note shared with you.
- New note created in a workspace you follow.
- Note edited (configurable; avoid noisy notifications for every keystroke).
- Upcoming event/reminder.
- Event changed or cancelled.

Delivery channels:

1. In-app notification inbox is the durable source of truth.
2. Web Push is best-effort and requires explicit browser permission.
3. Invitation delivery in the zero-cost MVP uses a Gmail compose handoff / copyable secure link. Automated transactional email is excluded because the relevant Cloudflare Email Sending feature requires Workers Paid for arbitrary recipients.

Add per-user preferences, quiet hours, deduplication, retry/backoff and delivery status. Never send note content in push/email by default; use a secure deep link requiring login.

## 8. Gemini AI integration

### Server-side provider adapter

Implement an interface such as `IAiNoteProvider` / `GeminiProvider` behind the API. The frontend calls KitaNotes API, never Google Gemini directly.

Configuration:

- `GEMINI_API_KEY`: server-side secret only (Cloudflare Worker Secret or the chosen backend's secret store).
- `GEMINI_MODEL_PRIMARY`: configured free-tier primary model.
- `GEMINI_MODEL_FALLBACKS`: ordered list of approved free-tier fallback models.
- `AI_FEATURE_ENABLED`: feature flag.
- `AI_REQUEST_TIMEOUT_MS`, retry limits and per-user rate limits.

Do not commit secrets. GitHub Actions should deploy secret bindings/configuration by reference or use securely configured environment secrets; never print secret values in logs. Separate development, staging and production credentials.

### Fallback policy to carry forward from Investlah

- Free-tier models only; never automatically escalate to a paid model.
- Retry transient failures with bounded exponential backoff and jitter.
- On HTTP 429, 500 or 503: retry within limits, then try the next configured free-tier model.
- On model-not-found / HTTP 404: skip that model and continue to the next configured model.
- On authentication, permission, invalid-key or malformed-request errors: stop fallback and return an actionable configuration error. Do not repeatedly call other models with the same invalid credentials/request.
- Validate all model outputs against the same strict schema and business rules, regardless of which model generated them.
- Record requested model, attempted models, successful model, latency, status and a correlation ID. Do not log API keys or unnecessary private note content.
- If all models fail, preserve the user's original text and offer manual note creation. AI failure must not block ordinary notes.
- Make the provider adapter independently testable using mocked HTTP responses.

**Model availability is runtime-dependent.** Keep model names configurable and verify current free-tier availability/quota before enabling production fallback. Never assume a model remains available indefinitely.

### AI structured output

Expected schema (illustrative):

```json
{
  "title": "Website deployment meeting",
  "content": "Discuss deployment and hosting costs.",
  "category": {
    "matchExistingCategoryId": null,
    "suggestedName": "Work",
    "confidence": 0.91
  },
  "tasks": [
    { "title": "Review hosting costs", "dueAt": null }
  ],
  "calendarEvents": [
    {
      "title": "Website deployment meeting",
      "startLocal": "2026-11-24T10:00:00",
      "timezone": "Asia/Kuala_Lumpur",
      "durationMinutes": 60,
      "remindersMinutesBefore": [1440]
    }
  ],
  "clarifications": []
}
```

This is an example contract, not a promise that the model can infer missing dates. The backend must resolve relative dates using an explicit reference timestamp and user timezone. If date, year, time or duration is materially ambiguous, return a clarification instead of inventing values.

### AI confirmation boundary

- AI output is a draft.
- User reviews note content, category, event date/time/timezone, attendees and reminder settings.
- Saving the note and creating events happen only after explicit confirmation.
- Use an idempotency key to prevent duplicate notes/events on retries.
- Keep source text available until the user accepts or discards the draft.

## 9. Initial database entities

Proposed relational entities (final schema follows implementation review):

- `users`
- `user_preferences`
- `workspaces`
- `workspace_members`
- `invitations`
- `notes`
- `categories`
- `note_versions` (optional MVP, recommended if edit history is required)
- `calendar_events`
- `event_reminders`
- `notifications`
- `push_subscriptions`
- `activity_events`
- `ai_generation_runs`
- `oauth_connections` (only for optional Google Calendar integration)

Use UUID text primary keys, SQLite foreign keys, useful indexes, UTC timestamps and D1 batch/transaction semantics around membership and invitation changes. Add workspace-scoped authorization checks to every query. Database constraints and triggers provide additional integrity checks, not a replacement for API authorization.

## 10. Security, privacy and reliability

- Enforce tenant/workspace isolation on every API request.
- Validate input server-side; encode/render note content safely to prevent XSS.
- Rate-limit login callbacks, invitation creation, AI calls and notification endpoints.
- Protect against CSRF, replayed invitation tokens and brute-force token guessing.
- Encrypt secrets and OAuth refresh tokens at rest.
- Use least-privilege IAM, deployment credentials and database roles.
- Add audit records for membership, permission and destructive changes.
- Define retention/deletion behavior for accounts, notes, AI requests and notification records.
- Avoid sending shared note content to AI unless the user explicitly invokes the AI action.
- Provide clear privacy disclosure for AI processing and third-party providers.
- Add database backups and test restore procedures.
- Add health/readiness endpoints and structured logs with correlation IDs.

## 11. Deployment and CI/CD

### Environments

- Local development
- Preview / staging (free Cloudflare preview deployments)
- Production (Cloudflare Free)

### Frontend and API deployment

- Build static assets with a pinned Node version and lockfile.
- Deploy the SPA and API together through one Cloudflare Worker using Worker Static Assets, following the inspected Investlah deployment pattern.
- Use Cloudflare's asset caching and deployment versions; no S3 bucket or CloudFront distribution.
- Configure SPA fallback without masking API errors.
- Use separate Cloudflare environments / project deployments for staging and production where feasible on the free plan.
- Configure custom domain, TLS certificate, cache policy and security headers.
- Keep API URLs and public OAuth client ID environment-specific; neither is a secret.

### Worker bindings and release

- Serve API routes from the same Worker deployment as the frontend.
- Bind Gemini key as a Cloudflare Worker Secret (server-side only).
- Bind Google OAuth client configuration appropriately; keep any client secret server-side.
- Apply D1 migrations as a controlled release step.
- Run smoke tests after deployment.
- Support rollback to the previous frontend artifact and API version.
- Never claim production readiness solely because GitHub Actions completed; verify the deployed health endpoint and a real authenticated smoke test.

### GitHub Actions

- Pull request: lint, typecheck, unit tests, build, dependency/security checks.
- Main branch: repeat required checks, deploy staging or production according to configured branch/environment policy.
- Use GitHub Environments and protected secrets for production.
- Pin actions to reviewed versions/SHAs where practical.
- Do not echo secrets or include them in artifacts.
- Publish build/deploy summaries and deployment commit SHA.

## 12. Suggested repository layout

```text
kitanotes/
├── README.md
├── docs/
│   ├── MASTERPLAN.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── SECURITY.md
│   ├── API_CONTRACT.md
│   ├── AI_GEMINI.md
│   ├── NOTIFICATIONS.md
│   ├── DEPLOYMENT.md
│   └── decisions/
│       └── ADR-0001-initial-architecture.md
├── apps/
│   └── web/
├── services/
│   └── api/
├── packages/
│   └── contracts/
├── infra/
│   └── cloudflare/
└── .github/
    └── workflows/
```

The layout is a target, not a mandate to create empty directories immediately. Keep the initial implementation simple and introduce packages only when there is real shared code.

## 13. Prioritised implementation plan

### P0 — Foundation and decisions

- [x] Inspect and document the exact Investlah Cloudflare Worker deployment workflow and reusable GitHub Actions. See ADR-0001.
- [x] Confirm Worker Static Assets for the frontend and API. See ADR-0001.
- [x] Create and verify the initial D1 workspace/notes migration with SQLite validation in CI. D1 resource provisioning and quota monitoring remain open.
- [ ] Confirm domain/subdomain and staging/production environments.
- [x] Create architecture, data-model and security baseline documents (ADR-0001 through ADR-0004, DATA_MODEL.md and SECURITY.md). Security review remains open.
- [x] Bootstrap React/Vite frontend, Worker API and shared route handlers with pinned direct dependencies. A separate shared-contract package is deferred until the API stabilises.
- [x] Verify strict TypeScript build (including Worker code), Node regression tests, all D1 migrations with SQLite and Wrangler dry-run in CI. Successful run: [44999942863](https://github.com/fizminho/kitanotes/actions/runs/44999942863).
- [x] Add Worker health endpoint and local development instructions.

### P1 — Identity and secure collaboration

- [ ] Configure Google OAuth clients for development/staging/production.
- [x] Implement Google OIDC ID-token signature/claim validation, state, nonce, PKCE and opaque hashed D1 sessions; offline D1 + mocked Google callback, personal workspace, session and logout integration tests pass. Real Google credentials/cloud D1 verification remains pending.
- [x] Implement and integration-test user upsert plus personal workspace/member creation in the Google login callback against SQLite-backed D1 test adapter. Live cloud D1 verification remains pending.
- [x] Implement and integration-test workspace-scoped notes CRUD, soft delete/archive, categories CRUD/archive, role checks, same-origin mutation checks, bounded JSON parsing and optimistic note versions.
- [x] Implement and integration-test workspace membership role checks for owner/editor/viewer and cross-workspace note/category isolation.
- [ ] Implement invitation creation, secure link generation, Gmail compose handoff, acceptance, expiry and revocation.
- [ ] Add authorization and cross-workspace isolation tests.

### P2 — Calendar and notifications

- [x] Implement internal calendar event API and UI, including note linking, timezone storage, create/list/delete and version-checked API editing.
- [x] Implement timezone-safe event/reminder input validation with explicit UTC offsets and IANA timezone retention.
- [x] Implement durable reminder scheduling, idempotent five-minute Cron delivery and automatic cancellation when linked notes/events are deleted.
- [x] Implement in-app notification inbox API/UI, unread count, mark-read and mark-all-read.
- [x] Notify other workspace members when a new shared note is created.
- [ ] Add event editing UI and month/week calendar views.
- [ ] Implement PWA service worker and Web Push subscription/delivery.
- [ ] Implement notification preferences and delivery settings.

### P3 — Gemini assistant

- [ ] Implement server-side Gemini provider adapter.
- [ ] Add free-tier model configuration and fallback policy.
- [ ] Add strict structured-output validation.
- [ ] Add relative-date resolution using explicit reference time/timezone.
- [ ] Add preview/confirmation UI.
- [ ] Save accepted note/category/event drafts transactionally.
- [ ] Add mocked tests for 429, 500, 503, 404, auth failure, malformed JSON, timeout and total provider outage.
- [ ] Verify AI failure never blocks manual note creation.

### P4 — Production hardening

- [ ] Deploy frontend and API through Cloudflare Free services only.
- [ ] Configure domains, TLS, CORS, security headers and secrets.
- [ ] Add database backups, restore test, migrations and rollback.
- [ ] Add logs, metrics, health checks and error reporting.
- [ ] Run end-to-end tests across two real Google test accounts.
- [ ] Verify invitations, permissions, reminders and notification delivery.
- [ ] Verify production deployment with smoke tests and record evidence.
- [ ] Update docs and mark only verified items complete.

### P5 — Enhancements

- [ ] Optional Google Calendar sync.
- [ ] Real-time collaboration.
- [ ] Attachments and OCR/text extraction.
- [ ] Recurring events and richer task management.
- [ ] Offline support and conflict resolution.

## 14. Acceptance criteria for MVP

MVP is not complete until all of these are demonstrated:

1. Two separate Google accounts can sign in.
2. Account A creates a private note that Account B cannot access.
3. Account A invites Account B; B accepts only while signed in with the invited verified email.
4. Owner can grant viewer/editor and revoke access; API tests prove each permission.
5. User can create, edit, archive and search notes and categories.
6. User can create an internal calendar event and receive a reminder without leaving the browser open.
7. A shared-note invitation and new-note notification reach the correct recipient only.
8. Gemini can turn sample text into a draft with category and event suggestions.
9. AI drafts require confirmation; ambiguous dates are clarified; invalid AI output is rejected safely.
10. Gemini outage, quota exhaustion or invalid credentials do not prevent manual note creation.
11. No Gemini key, OAuth client secret or refresh token is present in client assets or Git history.
12. CI passes, production health check passes, and an authenticated production smoke test is recorded.

## 15. Decisions requiring confirmation

| Decision | Current proposal | Status |
|---|---|---|
| Product name | KitaNotes | Proposed |
| Frontend hosting | Cloudflare Worker Static Assets; no S3 / CloudFront | Accepted (ADR-0001) |
| API runtime | Cloudflare Workers Free, same Worker serves static assets and API | Accepted (ADR-0001) |
| Database | Cloudflare D1 Free | Proposed |
| Authentication | Google OIDC | Proposed |
| Calendar | Internal calendar first; Google Calendar sync optional later | Proposed |
| Notifications | In-app + Web Push; Gmail compose handoff for invitations | Proposed |
| AI | Gemini free-tier-only fallback | Proposed |
| AI writes | Preview and explicit confirmation | Proposed |
| Collaboration | Workspace membership, owner/editor/viewer | Proposed |
| Default timezone | User preference; initial default Asia/Kuala_Lumpur | Proposed |

## 16. Strict zero-cost operating rules

- Never enable a paid Cloudflare plan or paid add-on for KitaNotes.
- Never configure a billing fallback, paid AI model, paid email provider or paid database.
- Use provider quota dashboards and application-level counters to detect approaching limits.
- Apply per-user AI rate limits, input-size limits and request throttling.
- When Gemini free quota is exhausted, disable AI temporarily and keep manual note CRUD working.
- When D1 or Workers limits are exhausted, return a clear temporary-capacity message; never attempt a paid upgrade.
- Avoid attachments and large binary storage in the MVP. Keep note content text-first.
- A custom domain is optional and its renewal is outside the free-infrastructure promise.

## 17. Working rules for future implementation

- Read this masterplan before starting a new implementation task.
- Inspect the current repository before changing architecture or adding dependencies.
- Prefer small, reviewable changes with tests.
- Update this document and relevant technical docs as decisions change.
- Tick a checkbox only after implementation and verification.
- Keep unresolved decisions visibly open; do not silently turn assumptions into facts.
- Never expose credentials or private note content in logs.
- Distinguish code complete, CI passed, deployed and production verified. They are different states.
- At the end of each implementation phase, provide changed files, test evidence, deployment status, outstanding risks and the next priority.

---

## Change log

- **2026-11-22:** Initial product and technical masterplan created. No application code or deployment has been implemented yet.
- **2026-11-22:** Revised architecture to strict free-only Cloudflare Workers/D1 + Gemini free tier. Removed S3/CloudFront, PostgreSQL and automated outbound email from the MVP. No paid fallback is permitted.
- **2026-11-22:** Inspected Investlah's Worker Static Assets deployment, Wrangler D1 binding pattern, GitHub Actions build/deploy workflow and Gemini model allowlist/failover implementation. Selected Worker Static Assets; created ADR-0001 through ADR-0004.
- **2026-11-22:** Bootstrapped React/Vite UI, Worker health/API shell, D1 migrations, SQLite migration validator and CI. No D1 resource, OAuth credentials, Gemini secret or production deployment has been created.
- **2026-11-22:** Implemented Google OIDC login/session routes and workspace-scoped notes/categories/invitation APIs, connected the notes and sharing UI, and added CSP/security headers. Added API, authentication and security documentation. Offline D1-backed auth, notes, invitation, calendar, reminder and notification integration tests pass in CI. Live Google login and cloud D1 persistence remain blocked on dedicated external resources/credentials.\n- **2026-11-22:** Implemented timezone-aware internal events, reminder APIs, five-minute Cron delivery and in-app notification inbox; added notifications for newly shared notes.
