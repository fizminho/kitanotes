# KitaNotes deployment

## Current state

KitaNotes is configured as one Cloudflare Worker serving the Vite static build and API routes through Worker Static Assets. The production deployment uses Cloudflare Workers Builds connected to the GitHub repository. The build runs `npm run build`; the deploy command must be `npm run cf:deploy` so remote D1 migrations are applied before the Worker is published.

## Cloudflare Workers Builds configuration

In Cloudflare Dashboard, open **Workers & Pages → kitanotes → Settings → Builds** and configure:

- Production branch: `main`
- Build command: `npm run build`
- Deploy command: `npm run cf:deploy`
- Root directory: repository root
- Build output directory: not required for Worker Static Assets; Wrangler reads `dist` from `wrangler.toml`

Workers Builds provides the Cloudflare deployment authentication. Do not add a Cloudflare API token to the repository or expose credentials in GitHub Actions. The deploy script runs:

1. `wrangler d1 migrations apply kitanotes-db --remote`
2. `wrangler deploy`

Wrangler records applied migration versions in D1's `d1_migrations` table and skips migrations already applied. A migration failure stops the command chain, so the new Worker is not deployed. Keep schema changes backward-compatible with the currently deployed Worker because migrations run immediately before deployment.

## First deployment / migration bootstrap

The dedicated D1 database must exist before the first production build/deploy. The database binding in `wrangler.toml` must point to the KitaNotes database:

- Database name: `kitanotes-db`
- Database ID: `cb4cb9e3-eab9-47d6-9e56-49c6b52b2062`
- Binding: `DB`
- Migrations directory: `./migrations`

After setting the Cloudflare deploy command to `npm run cf:deploy`, trigger a production deployment from `main`. The first run applies every unapplied migration in order. Later deployments apply only newly added migration files.

Do not paste migration SQL into the D1 console. Use Wrangler migrations so the migration history remains consistent.

## Required Worker variables and secrets

Configure these under **Workers & Pages → kitanotes → Settings → Variables and Secrets**:

Variables:
- `APP_BASE_URL=https://kitanotes.binalah.com`
- `GOOGLE_CLIENT_ID`

Secrets:
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `GEMINI_API_KEY` (optional; only if enabling Gemini features)
- `VAPID_PRIVATE_KEY` (optional Secret; VAPID private JWK `d` value)\n- `VAPID_PUBLIC_KEY` (optional plain-text variable)\n- `VAPID_SUBJECT` (optional plain-text variable such as `mailto:you@example.com`)

Never commit secret values, put them in `VITE_*` variables, or paste them into chat.

## Google OAuth

The Google OAuth web client must allow:

- JavaScript origin: `https://kitanotes.binalah.com`
- Redirect URI: `https://kitanotes.binalah.com/auth/google/callback`

The Google OAuth consent screen must include the intended test users while the app remains in Testing.

## Local commands

```bash
npm install
npm run dev
npm run build
npm test
npx wrangler deploy --dry-run
npm run cf:dev
npm run cf:migrate:remote
npm run cf:deploy
```

For local development, copy `.dev.vars.example` to `.dev.vars` and replace placeholders. Never commit `.dev.vars`. Apply local D1 migrations with `npx wrangler d1 migrations apply kitanotes-db --local`.

`npm run cf:dev` builds first and starts Wrangler locally. The health endpoint is `/api/health`. A successful CI run does not verify the deployed revision; check the Cloudflare Workers Builds deployment record and then test the production health endpoint and authenticated workflows.

## Cost guardrails

- Keep Cloudflare on Free plans; do not enable paid Workers, D1, R2, Queues, Email Sending or other paid products.
- Do not configure automatic billing or paid AI model fallbacks.
- Gemini is optional and must use only the free-tier allowlist. If free quota is exhausted, fail gracefully and preserve manual note-taking.
- A custom domain may have separate registration/renewal charges; this deployment assumes the user already owns `binalah.com`.
- Free plans have quotas, not unlimited capacity. If a quota is exhausted, return a clear temporary-capacity message rather than upgrading automatically.

## Release verification

After each successful deployment (including the current workspace-visibility release):

1. Confirm the Workers Builds run completed both the migration and deploy commands.
2. Check the D1 database's migration history and confirm migrations `0001` through `0012` are applied, especially `0011_workspace_visibility.sql` and `0012_unified_workspace_type.sql`.
3. Open `https://kitanotes.binalah.com/api/health` and verify a healthy response.
4. Test Google sign-in and verify the callback creates a D1-backed session.
5. Test notes and invitation access using two Google test accounts.\n6. For Web Push, verify the Worker has all three VAPID bindings, `/api/push/public-key` reports `enabled: true`, D1 migration `0015_notification_activity_preferences.sql` is applied, and a real-device test notification arrives.

A green build is not proof that live authentication, database persistence or reminders work. Mark production verification complete only after the corresponding live tests pass.
\n\n## Calendar 2.0

Apply D1 migration `0016_calendar_2_0.sql` before deploying the Calendar 2.0 Worker code. The migration creates workspace-scoped iCalendar import tracking and per-user Malaysia holiday preferences, and removes the retired Google Calendar OAuth connection tables. Google Sign-In continues to use the existing OpenID Connect configuration; no Calendar API scope or additional redirect URI is required. The holiday endpoint combines the selected state's HolidayWise public/state feed with KPM school-break ranges for 2026 and 2027 (Group A: Kedah, Kelantan and Terengganu; Group B: all other supported states). Future academic-year data must be added when KPM publishes the next calendar.

## Web Push key provisioning\n\nFor an iPhone-only setup, open `https://kitanotes.binalah.com/vapid-generator.html` after deploying the browser generator. Generate one key pair and copy the values directly into **Workers & Pages → kitanotes → Settings → Variables and Secrets**. Keep the private key as a Secret. The generator runs locally in the browser and does not transmit the key pair. See [PWA_PUSH.md](PWA_PUSH.md) for the full checklist.\n