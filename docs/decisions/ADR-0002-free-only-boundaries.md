# ADR-0002: Strict free-only service boundaries

- **Status:** Accepted
- **Date:** 2026-11-22

The MVP may use Cloudflare Workers Free, D1 Free, static assets, Google OAuth/OIDC and Gemini API free tier only. No automatic billing upgrade or paid fallback is allowed.

Invitation delivery uses a secure expiring invitation link, copy action and prefilled Gmail compose handoff. The UI must not claim an email was automatically sent.

AI output is a draft requiring explicit user confirmation. AI outages and quota exhaustion must not block manual note creation. Custom domain registration/renewal is optional and outside the RM0 infrastructure target.
