# KitaNotes Gemini OCR — Design and Implementation Plan

**Status:** Planned, not implemented  
**Priority:** P5 enhancement after notification preferences and production foundation  
**Budget:** RM0 recurring spend; Gemini free tier only  
**Related:** [Masterplan](MASTERPLAN.md), [AI privacy policy](AI_PRIVACY.md)

## 1. Goal

Add an image-to-text workflow inspired by the OCR experience in Bayarlah. A user can select or capture a photo of a document, receipt, handwritten note or whiteboard. Gemini extracts readable text, and KitaNotes can optionally convert that text into a structured note, category, tasks and calendar/reminder suggestions.

OCR must be an optional input method for the existing AI organiser, not a separate path that bypasses its safety and confirmation rules.

## 2. User flow

1. User opens Scan with AI from the note composer.
2. User captures an image with the camera or selects an image from the device.
3. The browser shows a preview and allows the user to replace or remove it.
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

Proposed endpoint: POST /api/ai/ocr.

- Require an authenticated session and same-origin request.
- Accept a bounded request body with a single image and declared MIME type. Prefer a binary-safe request format; do not reuse the existing small JSON parser limit without an explicit OCR-specific body limit.
- Initial proposed maximum: 5 MiB decoded image, subject to verification against Cloudflare Workers Free request/body constraints and Gemini free-tier limits before implementation.
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

- Add a distinct, revocable OCR/image-processing consent record. Do not silently reuse text-only consent.
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

- [ ] Authenticated and same-origin endpoint.
- [ ] Strict MIME and file-signature validation.
- [ ] Request and decoded image size limits.
- [ ] No user-supplied URL fetching.
- [ ] Per-user quota and rate limit.
- [ ] OCR consent is separate and revocable.
- [ ] Gemini key remains Worker Secret only.
- [ ] Free-tier image-capable model allowlist only.
- [ ] Prompt-injection-resistant extraction prompt and no tool execution.
- [ ] No image or extracted text in logs/analytics.
- [ ] No persistence or service-worker caching of image data.
- [ ] OCR output is editable and requires user review.
- [ ] Structured note/event creation remains behind existing explicit confirmation.

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
