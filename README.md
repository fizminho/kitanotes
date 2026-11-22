# KitaNotes

Shared notes, reminders and AI-assisted planning.

KitaNotes is a mobile-first web application for private notes, collaboration, categories, reminders and AI-assisted organisation.

## Project status

**P0 foundation in progress.** The repository now contains a React/Vite starter interface, a Cloudflare Worker API shell with a health endpoint, initial architecture decisions and a build/test validation workflow. Google sign-in, persistence, sharing, calendar, notifications, Gemini and production deployment are not implemented yet.

## Start here

- [Product & Technical Masterplan](docs/MASTERPLAN.md)
- [ADR-0001: Cloudflare Worker Static Assets](docs/decisions/ADR-0001-worker-static-assets.md)
- [ADR-0002: Free-only boundaries](docs/decisions/ADR-0002-free-only-boundaries.md)

## Architecture

- React + TypeScript + Vite frontend.
- Cloudflare Worker serves static assets and API routes in one deployment.
- Cloudflare D1 will be the database after a KitaNotes-specific database is provisioned.
- Google OpenID Connect for sign-in.
- Gemini API free tier only, called server-side through Worker secrets.
- In-app notifications and best-effort Web Push.
- Invitation links are shared through copy-link and Gmail compose handoff. No paid automated email provider.

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
npx wrangler deploy --dry-run
```

Run the Worker locally after building:

```bash
npm run cf:dev
```

The health endpoint is `/api/health`. Other API routes intentionally return HTTP 501 until implemented.

## Deployment status

No D1 database, OAuth client, Gemini API secret, Cloudflare production Worker or custom domain has been provisioned for KitaNotes. The current workflow validates a build and Wrangler bundle only. It does not deploy or create billable resources.

See the masterplan for the prioritised implementation checklist and acceptance criteria.
