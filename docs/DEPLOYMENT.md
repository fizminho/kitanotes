# KitaNotes deployment

## Current state

The repository is configured for a single Cloudflare Worker serving the Vite static build and API routes through Worker Static Assets. CI runs a build, Node tests and Wrangler dry-run. There is deliberately no deploy workflow yet.

## Required before first deployment

1. Create a dedicated Cloudflare Worker named `kitanotes` under the intended account.
2. Create a dedicated D1 database named `kitanotes-db` on the Free plan.
3. Replace the explicit all-zero placeholder database ID in `wrangler.toml` with the resulting KitaNotes D1 database ID under the `DB` binding.
4. Apply migrations with Wrangler against that database only: `npx wrangler d1 migrations apply kitanotes-db --remote`.
5. Configure GitHub Actions secrets/variables for a narrowly scoped Cloudflare API token and account ID.
6. Configure Google OAuth credentials for the exact KitaNotes hostname and add `https://YOUR-HOST/auth/google/callback` as an authorised redirect URI. Set `GOOGLE_CLIENT_ID` and `APP_BASE_URL` as Worker vars; set `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` with `wrangler secret put`.
7. Add the Gemini API key as a Worker secret only after the AI adapter is implemented and free-tier quota is checked.
8. Add the deploy workflow after the above prerequisites are met. Do not deploy with the placeholder D1 ID.

Do not reuse Investlah's D1 database ID, OAuth client, Gemini key, Worker name or custom domain binding.

## Local commands

```bash
npm install
npm run dev
npm run build
npm test
npx wrangler deploy --dry-run
npm run cf:dev
```

Copy `.dev.vars.example` to `.dev.vars` for local Google OAuth configuration. Apply local D1 migrations with `npx wrangler d1 migrations apply kitanotes-db --local`.\n\n`npm run cf:dev` builds first and starts Wrangler locally. The health endpoint is `/api/health`. Google auth routes and notes/categories API handlers are implemented, but require a provisioned D1 database and Google OAuth credentials to run. Unimplemented API areas return HTTP 501.

## Cost guardrails

- Do not change the Cloudflare plan or enable paid products.
- Do not configure automatic billing or paid fallbacks.
- Keep Gemini to explicitly approved free-tier models only.
- If a free quota is exhausted, return a temporary unavailable response and preserve manual note-taking.
- A custom domain is optional and may have separate registration/renewal charges.
