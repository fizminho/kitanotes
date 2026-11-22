# KitaNotes deployment

## Current state

The repository is configured for a single Cloudflare Worker serving the Vite static build and API routes through Worker Static Assets. CI runs a build, Node tests and Wrangler dry-run. There is deliberately no deploy workflow yet.

## Required before first deployment

1. Create a dedicated Cloudflare Worker named `kitanotes` under the intended account.
2. Create a dedicated D1 database named `kitanotes-db` on the Free plan.
3. Add the resulting D1 database ID to `wrangler.toml` under a `[[d1_databases]]` binding named `DB`.
4. Apply migrations with Wrangler against that database only.
5. Configure GitHub Actions secrets/variables for a narrowly scoped Cloudflare API token and account ID.
6. Configure Google OAuth credentials for the exact KitaNotes hostname and keep any client secret in Worker secrets.
7. Add the Gemini API key as a Worker secret only after the AI adapter is implemented and free-tier quota is checked.
8. Add the deploy workflow after the above prerequisites are met.

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

`npm run cf:dev` builds first and starts Wrangler locally. The current health endpoint is `/api/health`; non-health API routes return 501.

## Cost guardrails

- Do not change the Cloudflare plan or enable paid products.
- Do not configure automatic billing or paid fallbacks.
- Keep Gemini to explicitly approved free-tier models only.
- If a free quota is exhausted, return a temporary unavailable response and preserve manual note-taking.
- A custom domain is optional and may have separate registration/renewal charges.
