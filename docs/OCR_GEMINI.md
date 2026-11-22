# KitaNotes Gemini OCR — Design and Implementation Plan

**Status:** Core backend and frontend capture/edit/handoff workflow implemented; image preview, client-side image preparation and live provider verification remain open  
**Priority:** P5 enhancement; backend foundation started after notification preferences  
**Budget:** RM0 recurring spend; Gemini free tier only  
**Related:** [Masterplan](MASTERPLAN.md), [AI privacy policy](AI_PRIVACY.md)

## 1. Goal

Add an image-to-text workflow inspired by the OCR experience in Bayarlah. A user can select or capture a photo of a document, receipt, handwritten note or whiteboard. Gemini extracts readable text, and KitaNotes can optionally convert that text into a structured note, category, tasks and calendar/reminder suggestions.

OCR must be an optional input method for the existing AI organiser, not a separate path that bypasses its safety and confirmation rules.

## 2. User flow

1. User opens Scan with AI from the note composer.
2. User captures an image with the camera or selects an image from the device.
3. The browser retains the selected file locally and lets the user replace it. A dedicated rendered image preview is not implemented yet.
4. Before the first OCR request, show a clear disclosure that the image will be sent to Google's Gemini API under the free-tier privacy terms. Require explicit OCR consent; existing text-AI consent must not silently imply consent to image processing.
5. Browser sends the image to an authenticated KitaNotes Worker endpoint over HTTPS.
6. Worker validates the session, same-origin mutation, image MIME type, encoded and decoded size, user quota and AI configuration.
7. Worker sends the image to the configured Gemini free-tier model using the existing server-side provider adapter and model allowlist.
8. Gemini returns extracted text only. Validate response shape and enforce a maximum extracted-text length.
9. Show extracted text in an editable preview. User may correct OCR mistakes before continuing.
10. User may pass the corrected text into the existing structured-note organiser. That produces the normal note/category/task/event draft.
11. Nothing is saved and no reminder/event is created until the user explicitly confirms the corresponding action.

## 3. Supported first-release scope

- JPEG, PNG and WebP images.
- One image per OCR request.
- Printed text first; handwriting support is best-effort and must be described as such.
- Receipts, letters, forms, meeting notes, whiteboards and screenshots are useful examples.
- English and Bahasa Malaysia text should be tested. Other languages may work but are not guaranteed.
- OCR result is editable plain text. Structured extraction remains a separate explicit step.

Defer multi-page PDFs, batch scanning, automatic document classification, background uploads, OCR of existing attachments and persistent image libraries.

## 4. Technical design

### Frontend

- Add a dedicated image picker/camera capture control with image/jpeg,image/png,image/webp and capture=environment where supported.
- Show a local preview before upload.
- Resize large photos in the browser while preserving readability; do not upscale small images.
- Strip EXIF metadata where practical, especially GPS location.
- Provide clear progress, retry and cancel states.
- Do not persist image bytes in local storage, IndexedDB, service-worker cache or analytics.
- Clear the selected image and extracted text when the user discards the draft or signs out.

### Worker API

Implemented endpoint: POST /api/ai/ocr. Consent endpoints: POST/DELETE /api/ai/ocr/consent.

- Require an authenticated session and same-origin request.
- Accept a bounded request body with a single image and declared MIME type. Prefer a binary-safe request format; do not reuse the existing small JSON parser limit without an explicit OCR-specific body limit.
- Current backend limit: 2 MiB raw image body. The Worker accepts one raw JPEG, PNG or WebP image, verifies the file signature, and never accepts a URL. This conservative limit should be revisited only after testing on the deployed Workers Free runtime.
- Verify actual file signature against the declared MIME type. Reject SVG, GIF, animated formats, archives and arbitrary URLs.
- Never fetch a user-supplied URL. This avoids SSRF and unbounded external downloads.
- Enforce per-user daily OCR quotas separately from text-generation quotas, with a conservative initial cap and a bounded request rate.
- Do not store the image in D1, R2, object storage or logs. Process it in memory for the provider request, then release references.
- Never return or expose the Gemini API key to the browser.
- Reuse the existing free-tier model allowlist, timeout, bounded retry/fallback and error mapping. A quota failure must not trigger paid escalation.
- Return extracted text, model metadata safe for display, and usage status. Do not log image bytes or extracted personal content.

### Gemini provider

- Extend the existing provider abstraction with an image-input operation rather than adding a second Gemini client or hardcoding a model in the route.
- Use only models explicitly configured and verified to accept image input on the free tier.
- Keep model names configurable because model availability and free quotas change.
- Use the same fallback rules as the existing AI organiser: bounded retry for transient errors, skip unavailable models, stop on invalid credentials/request, and never escalate to a paid tier.
- Request plain extracted text, not executable instructions or automatic actions.
- Treat text found inside an image as untrusted user content. It must not override system instructions or trigger tools/actions.
- Validate output type and length; reject empty, malformed or unexpectedly structured responses.

## 5. Privacy and consent

- [x] Add a distinct, revocable OCR/image-processing consent record (`ai_ocr_consent`). Do not silently reuse text-only consent.
- Explain that images are transmitted to Google Gemini and may be processed under Google's applicable free-tier terms.
- Warn users not to upload sensitive identity documents, bank statements, passwords or information they are not comfortable sending to the provider.
- No image retention by KitaNotes. No OCR image in D1, logs, traces, crash reports or push notifications.
- Do not include extracted text in telemetry. Record only counters, model identifiers, outcome category, latency and correlation ID.
- Revoking OCR consent disables future OCR requests; it does not imply deletion of data already processed by the external provider.

## 6. Quotas and failure behavior

- OCR has its own per-user daily usage counter and request-size limit.
- A quota-exhausted response must explain that OCR can be tried again after the quota resets.
- If all free models are unavailable, offer manual text entry or retry later.
- OCR failure must not block manual note creation or the existing text-only Gemini flow.
- Do not configure billing, paid models or automatic paid API escalation.
- Do not persist failed image payloads for retry.

## 7. Security and validation checklist

- [x] Authenticated and same-origin endpoint.
- [x] Strict MIME and file-signature validation (JPEG, PNG, WebP).
- [x] Request body limit (2 MiB).
- [x] No user-supplied URL fetching; the endpoint accepts raw image bytes only.
- [x] Per-user daily quota (5/day) and dedicated burst rate limit (3/minute).
- [x] OCR consent is separate and revocable.
- [x] Gemini key remains Worker Secret only.
- [x] Existing free-tier model allowlist reused.
- [x] Extraction-only prompt treats image content as untrusted; no tools are available.
- [x] No image or extracted text is logged or persisted by the OCR handler.
- [x] No image persistence or service-worker caching; the service worker caches only the application shell and static assets.
- [x] OCR output is editable and requires user review.
- [x] Structured note/event creation remains behind existing explicit confirmation.

## 8. Test plan

- Valid JPEG, PNG and WebP.
- MIME spoofing, corrupt images, SVG, unsupported formats and oversized payloads.
- Unauthenticated, cross-origin and revoked-consent requests.
- User quota exhaustion and rate limiting.
- Gemini 404 model fallback, 429 quota, 503 transient error, invalid key and malformed output.
- Very long OCR output and empty/no-text images.
- Image containing instructions such as ignore previous instructions; verify it is treated only as text to extract.
- OCR result edited by user before structured extraction.
- OCR output does not create notes, categories, events or reminders without confirmation.
- Regression tests prove manual note creation and text-only AI continue to work when OCR is disabled or unavailable.

## 9. Acceptance criteria

1. User can capture/select a supported image and preview it before upload.
2. OCR runs only after explicit image-processing consent.
3. Extracted text is editable and can be passed to the existing Gemini organiser.
4. No note, category, event or reminder is created automatically.
5. OCR uses only configured Gemini free-tier models and never triggers paid billing.
6. Image bytes and extracted content are not persisted or logged by KitaNotes.
7. Quota exhaustion, provider errors and invalid images fail safely without affecting manual notes.
8. Build, migration validation, security tests and integration tests pass before the feature is marked complete.


## 10. Implementation status (2026-11-22)

The OCR backend and first frontend workflow slice are committed:
- `worker/ocr.ts` implements authenticated OCR consent and image extraction routes.
- `migrations/0010_gemini_ocr.sql` stores separate OCR consent and daily usage counters.
- The endpoint accepts a raw image body (not base64 JSON), limited to 2 MiB, and checks JPEG/PNG/WebP signatures.
- The existing Gemini free-model allowlist and server-side API key are reused. No paid fallback is possible.
- Daily OCR cap is 5 requests per user. Images are held in request memory only and are not written to D1 or logged.
- OCR returns editable plain text and explicitly flags that user review is required. It does not create notes or events.
- Automated tests cover separate consent, signature validation, extraction, no automatic note writes and quota exhaustion.

**Remaining:** a rendered image preview, client-side resizing/EXIF stripping, and runtime verification of the 2 MiB limit plus the configured Gemini model's image-input support/free-tier availability. The frontend already has an image file picker, explicit OCR consent, editable extracted text and handoff to the existing organiser. The Worker now enforces a separate 3-requests-per-minute burst limit in addition to the 5-per-day OCR quota. Do not describe OCR as production-verified until a live Gemini request succeeds.
