# ADR-0004: Reuse the Investlah Gemini fallback principles, not its accounting workflow

- **Status:** Accepted
- **Date:** 2026-11-22

## Observed in Investlah

The current `magic-screen` Worker keeps a supported text-model allowlist, accepts an ordered configured fallback list, de-duplicates candidates, and refuses models outside the allowlist. Its accounting review path can move to another configured model on model-not-found (404), timeout (408), rate-limit/quota conditions and server errors. It treats quota exhaustion distinctly and does not produce/cache a successful conclusion when all candidates fail. The API key is read from a Worker environment binding and sent in the server-side request header.

## KitaNotes adaptation

- Implement a small, independent Gemini adapter for note structuring. Do not copy accounting prompts, schemas, business rules, evidence handling or large review modules.
- Keep a strict allowlist/configuration for free-tier model IDs only. Model IDs must be checked against current free-tier availability before enabling.
- Use server-side Worker secrets; never expose the key to browser code or build variables.
- Use bounded retries and a small per-user request budget. If fallback candidates are exhausted, disable AI for the request and retain the original text for manual saving.
- Stop on authentication, permission, invalid-key and malformed-request errors. Never fall back to a paid model.
- Validate every candidate response against the same strict JSON schema. AI output is a draft requiring user confirmation.
- Add mocked tests for every status class before enabling production AI.

## Important implementation note

Investlah's inspected implementation has a model candidate allowlist and failover policy, plus retry-delay helper functions. The KitaNotes adapter must implement and test its own bounded retry behavior explicitly; do not assume every retry helper in the source is used by every request path.
