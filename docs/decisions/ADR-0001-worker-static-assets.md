# ADR-0001: Cloudflare Worker with Static Assets

- **Status:** Accepted for the initial MVP foundation
- **Date:** 2026-11-22

## Context
The existing Investlah deployment in `fizminho/magic-screen` uses a Cloudflare Worker with Vite-built static assets, a D1 binding and Wrangler configuration. Its GitHub Actions deployment builds the application and runs `wrangler deploy`. KitaNotes must remain free-only and must not use S3 or CloudFront.

## Decision
Use Vite + React + TypeScript and Cloudflare Workers Static Assets. The Worker serves the SPA and API routes. Provision a separate KitaNotes D1 database before enabling persistence or production deployment.

## Isolation
- KitaNotes has its own Worker, D1 database, OAuth credentials and Gemini secret.
- Never reuse Investlah's D1 ID, secrets, domain or production bindings.
- No deploy workflow is enabled until the KitaNotes D1 resource and required secrets are configured.
- The current Worker exposes only a health endpoint; other API routes return 501.
- No paid Cloudflare service, S3, CloudFront, paid email or paid AI fallback is permitted.

## Consequences
One deployment unit serves app and API. D1 migrations live in this repository and must only be applied to the KitaNotes database.
