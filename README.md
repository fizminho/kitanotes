# KitaNotes

Shared notes, reminders and AI-assisted planning.

KitaNotes is a mobile-first web application for private notes, collaboration, categories, reminders and AI-assisted organisation.

## Project status

**P0 foundation complete; P1 identity and notes APIs in progress.** The repository now has a React/Vite interface, a Cloudflare Worker serving static assets and API routes, Google OIDC login/session code, workspace-scoped notes/categories/invitations APIs, internal calendar events, reminders, in-app notifications, D1 migrations, architecture/security docs and CI.

Google OAuth credentials and a dedicated D1 database have not been provisioned, so sign-in and persistence have not been exercised against a live Cloudflare environment. Invitation creation, acceptance and pending-invitation management/revocation UI are implemented. Calendar event/reminder and in-app notification APIs/UI are implemented. Google Calendar sync, browser push, Gemini and production deployment remain outstanding.

## Start here

- [Product & Technical Masterplan](docs/MASTERPLAN.md)
- [API Contract](docs/API_CONTRACT.md)
- [Authentication setup](docs/AUTHENTICATION.md)
- [Security baseline](docs/SECURITY.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [ADR-0001: Cloudflare Worker Static Assets](docs/decisions/ADR-0001-worker-static-assets.md)
- [ADR-0002: Free-only boundaries](docs/decisions/ADR-0002-free-only-boundaries.md)
- [ADR-0003: D1 workspace data model](docs/decisions/ADR-0003-d1-workspace-data-model.md)
- [ADR-0004: Gemini fallback adaptation](docs/decisions/ADR-0004-gemini-provider-reuse.md)

## Architecture

- React + TypeScript + Vite frontend.
- Cloudflare Worker serves static assets and API routes in one deployment.
- Cloudflare D1 stores users, sessions, workspaces, memberships, invitations, notes and categories.
- Google OpenID Connect login with state, nonce, PKCE, JWKS signature validation and hashed opaque sessions.
- Workspace-scoped notes/categories API with role checks, same-origin mutation checks and optimistic note versions.
- Gemini API free tier only, called server-side through Worker secrets.
- In-app notifications and best-effort Web Push.
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
