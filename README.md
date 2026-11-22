# KitaNotes

Shared notes, reminders and AI-assisted planning.

KitaNotes is a mobile-first web application for private notes, collaboration, categories, reminders and AI-assisted organisation.

## Project status

**P0 foundation, P1 identity/notes/sharing, P2 calendar/notifications and P3 AI organiser implementation are complete.** The repository now has a React/Vite interface, a Cloudflare Worker serving static assets and API routes, Google OIDC login/session code, workspace-scoped notes/categories/invitations APIs, internal calendar events, reminders, in-app notifications, D1 migrations, architecture/security docs and CI.

Google OAuth credentials, a dedicated D1 database and a Gemini API key have not been provisioned, so live sign-in, persistence and Gemini calls have not been exercised. The AI organiser has consent, free-model allowlisting, daily limits and review-before-save UI, but remains disabled until a key is configured. Google Calendar sync, offline data editing and production deployment remain outstanding. The PWA app shell and month/week calendar are implemented; Web Push code is ready but requires VAPID configuration and real-device verification.

## What's new in 0.2

- **Bug fixes:** editing a calendar event always failed (broken date regex); stray `\n` text rendered in the AI and event dialogs; notes from every workspace were loaded and never refetched when switching workspaces; "Shared with me" was a dead placeholder; the composer always claimed notes were saved to a personal workspace.
- **Features:** category filter chips, sort (recent / oldest / A–Z), archive view with restore and delete, toast feedback, dark mode, keyboard shortcuts (`/` or Ctrl/⌘+K search, Ctrl/⌘+Enter save, Esc close), word counter, view-only handling for viewer role, and a real shared-spaces list.

### Branding

The logo reads **KitaNotes by Binalah.com**. PWA icons (`public/icons/icon-*.png`, maskable and Apple touch) carry the full name; the compact glyph (`mark.svg`) is used for the favicon and the sidebar, and `logo-lockup.svg` / `logo-lockup-dark.svg` are horizontal versions for docs and sharing. Text is converted to outlines, so the SVGs need no fonts.

### Workspace model (clarified)

Every user has exactly one private **personal** workspace (enforced by a unique index). Extra workspaces are **shared spaces**: the owner can invite people, change roles, remove members, rename or delete the space; members can leave. Owners get a Manage space dialog (People, Invite, Activity, Settings) with roles, remove, transfer ownership, re-issue invitation links and a sharing activity log; members see People/Activity and can leave. Previously new workspaces were created as `personal`, which collided with that unique index, and nothing could ever become `shared`, so invitations were unreachable. "Make private" now removes all other members, revokes pending invitations and permanently blocks new invitations. The space is presented as personal/private while its existing notes and data remain intact.

## Start here

- [Product & Technical Masterplan](docs/MASTERPLAN.md)
- [API Contract](docs/API_CONTRACT.md)
- [Authentication setup](docs/AUTHENTICATION.md)
- [Security baseline](docs/SECURITY.md)
- [PWA and Web Push setup](docs/PWA_PUSH.md)
- [AI privacy and free-only policy](docs/AI_PRIVACY.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [ADR-0001: Cloudflare Worker Static Assets](docs/decisions/ADR-0001-worker-static-assets.md)
- [ADR-0002: Free-only boundaries](docs/decisions/ADR-0002-free-only-boundaries.md)
- [ADR-0003: D1 workspace data model](docs/decisions/ADR-0003-d1-workspace-data-model.md)
- [ADR-0004: Gemini fallback adaptation](docs/decisions/ADR-0004-gemini-provider-reuse.md)

## Architecture

- React + TypeScript + Vite frontend.
- Cloudflare Worker serves static assets and API routes in one deployment.
- Cloudflare D1 stores users, sessions, workspaces, memberships, invitations, notes, categories, events, reminders, notifications, per-user Web Push subscriptions and AI usage/consent metadata.
- Google OpenID Connect login with state, nonce, PKCE, JWKS signature validation and hashed opaque sessions.
- Workspace-scoped notes/categories API with role checks, same-origin mutation checks, optimistic note versions and D1-backed rate limits for OAuth/invitations.
- Security headers (CSP, HSTS on HTTPS, frame denial, no-sniff and referrer/permissions policies) applied to API, health and static responses.
- Gemini API free tier only, called server-side through Worker Secrets after explicit privacy consent. Hard allowlist, 10 requests/user/day, no raw prompt persistence and no paid fallback.
- In-app notification inbox and five-minute Cron reminder delivery. Optional Web Push uses VAPID + Web Crypto, generic payloads and per-device subscriptions; it remains disabled until VAPID secrets are configured.
- PWA manifest, install prompt and offline app-shell/static-asset caching. Private API responses are never cached; offline note editing is not supported.
- Invitation links use copy-link and Gmail compose handoff. No paid automated email provider.

**No S3, no CloudFront, no paid Cloudflare plan, no paid database, no paid email and no paid Gemini fallback.** KitaNotes must fail closed at free-tier limits. Never reuse Investlah's database or secrets.

## Local development

Requirements: Node.js 22 and npm.

```bash
npm install
npm run dev
```

Build and validate:

```bash
npm run build
npm test
python3 scripts/validate_migration.py
npx wrangler deploy --dry-run
```

Run the Worker locally after building:

```bash
npm run cf:dev
```

The health endpoint is `/api/health`. Authentication routes are documented in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md). The D1 database ID in `wrangler.toml` is an explicit placeholder and must be replaced only after creating a dedicated KitaNotes database.

## Deployment status

No D1 database, Google OAuth client, Worker secrets or production Worker has been provisioned for KitaNotes. CI validates compilation, unit tests, SQL migrations and Wrangler bundling; it does not deploy or create billable resources.

See the masterplan for the prioritised implementation checklist and acceptance criteria.
