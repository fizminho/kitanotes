# Gemini AI privacy and free-only policy

## What is sent

When a signed-in user chooses an AI action and submits text or an image, KitaNotes sends only the content needed for that request:

- The text pasted into the AI organiser.
- The specific image selected for OCR.
- A workspace purpose/description entered into the AI-assisted workspace creator, when the user explicitly chooses the suggestion action.
- The user's IANA timezone and a server-generated reference timestamp for note organisation.
- Names of categories in the selected workspace, so suggestions can reuse them.

KitaNotes does not send other existing note contents, unselected files, Google Calendar data, contacts, or the workspace member list. It does not use Google Search grounding.

## Free-tier privacy warning

Google's Gemini API pricing page states that content submitted through the free tier may be used to improve Google's products. Do not submit passwords, financial account details, sensitive personal data, confidential work material, or anything you do not want Google to receive.

There is no separate terms-acceptance checkbox. Each request is initiated by the user pressing an AI action button. The UI discloses that the submitted text or selected image is sent to an external AI service for processing. Users should avoid submitting sensitive information.

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Zero-billing guardrails

- The adapter has a hard allowlist of text models currently listed with free-tier input/output pricing: `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-flash-lite`, and `gemini-2.5-flash`.
- `GEMINI_MODEL` and `GEMINI_MODEL_FALLBACKS` are filtered against that allowlist. Unknown and paid model IDs are ignored.
- A 404 model-not-found, quota/rate-limit response, or transient provider error may move to the next allowlisted free model.
- Invalid API key/permission and malformed-request errors stop immediately.
- If all free models fail or the provider quota is exhausted, the request fails. There is no paid-model fallback, automatic upgrade, or billing escalation.
- Keep the Google AI Studio project unlinked from Cloud Billing. A project with billing enabled may be eligible for paid-tier charges even though this application only chooses free-tier model IDs.
- KitaNotes enforces a local limit of 10 AI requests per user per UTC day and a 16 KiB input limit. Google also applies its own project/model rate limits.

Free-tier model availability and quotas can change. Recheck Google's pricing/model pages before changing the allowlist.

## Data retention and confirmation

- The raw prompt and generated draft are not stored in D1 by the AI endpoint.
- D1 stores daily request counts. Legacy consent fields remain for compatibility but are no longer required to use the AI actions.
- The response is a draft. The user confirms the combined save action before KitaNotes creates the note, events and reminders.
- Workspace planning also returns a draft only. The user must confirm the workspace name and category suggestions before KitaNotes creates the workspace or its categories. The raw workspace purpose and AI draft are not persisted by the AI endpoint.
- AI note organisation recommends one category. It reuses an existing category when it matches; otherwise the recommended category is created only when the user confirms saving the note.
- AI note organisation recommends one category. It reuses an existing category when it matches; otherwise the selected new category is created only when the user confirms saving the note.
- Dates are returned as local date/time strings with the supplied IANA timezone. Ambiguous dates should produce clarifying questions rather than guessed events.
- AI outages or quota exhaustion do not affect manual note, calendar, or reminder features.

## Configuration

1. Create a Gemini API key in Google AI Studio using a project with no Cloud Billing account attached.
2. Add the key as a Cloudflare Worker Secret named `GEMINI_API_KEY`.
3. Optionally set `GEMINI_MODEL` and `GEMINI_MODEL_FALLBACKS`. Values outside the free-model allowlist are ignored.
4. Never commit the API key or place it in frontend `VITE_*` variables.
