# KitaNotes deployment

## Current state

KitaNotes is configured as one Cloudflare Worker serving the Vite static build and API routes through Worker Static Assets. CI runs a production build, Node integration tests, migration validation and Wrangler dry-run. There is deliberately no deploy workflow and no cloud resource has been provisioned by this repository work.

## Required before first deployment

1. Create a dedicated Cloudflare Worker named `kitanotes` under the intended account.
2. Create a dedicated Cloudflare D1 database named `kitanotes-db` on the Free plan.
3. Replace the all-zero placeholder database ID in `wrangler.toml` with the KitaNotes D1 database ID under the `DB` binding.
4. Apply all migrations to that database only: `npx wrangler d1 migrations apply kitanotes-db --remote`.
5. Configure GitHub Actions secrets/variables for a narrowly scoped Cloudflare API token and account ID.
6. Configure Google OAuth credentials for the exact KitaNotes hostname and add `https://YOUR-HOST/auth/google/callback` as an authorised redirect URI. Set `GOOGLE_CLIENT_ID` and `APP_BASE_URL` as Worker vars; set `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` with `wrangler secret put`.
7. If enabling Gemini, create a Google AI Studio API key from a project that is **not linked to Cloud Billing**, then set it using `wrangler secret put GEMINI_API_KEY`. Never place it in a frontend `VITE_*` variable or commit it. Optional `GEMINI_MODEL` and `GEMINI_MODEL_FALLBACKS` vars are filtered through the free-tier allowlist.
8. Verify the five-minute Cron Trigger and reminder delivery in the deployed Worker after migrations are applied.
9. Add the deploy workflow only after the above prerequisites are met. Do not deploy with the placeholder D1 ID.

Do not reuse Investlah's D1 database ID, OAuth client, Gemini key, Worker name or custom-domain binding.

## Local commands

```bash
npm install
npm run dev
npm run build
npm test
npx wrangler deploy --dry-run
npm run cf:dev
```

Copy `.dev.vars.example` to `.dev.vars` and replace placeholders for local development. Never commit `.dev.vars`. Apply local D1 migrations with `npx wrangler d1 migrations apply kitanotes-db --local`.

`npm run cf:dev` builds first and starts Wrangler locally. The health endpoint is `/api/health`. Google auth, notes, categories, invitations, calendar, reminders, notifications and AI APIs are implemented, but require a provisioned D1 database and their respective secrets to run. Unimplemented API areas return HTTP 501.

## Cost guardrails

- Do not change Cloudflare plans or enable paid products.
- Do not attach a Cloud Billing account to the Gemini project.
- Do not configure automatic billing or paid model fallbacks.
- The Gemini adapter only tries allowlisted free-tier models and stops when quota is exhausted.
- If any free quota is exhausted, fail gracefully and preserve manual note-taking.
- A custom domain is optional and may have separate registration/renewal charges.
- The Worker uses one free Cron Trigger (`*/5 * * * *`) for due reminders. Reminder notifications are in-app only; no paid email or push service is configured.

See [AI privacy policy](AI_PRIVACY.md) before enabling Gemini.
