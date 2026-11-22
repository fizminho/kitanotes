# KitaNotes

Shared notes, reminders and AI-assisted planning.

KitaNotes is planned as a mobile-first web application where people can sign in with Google, create private notes, share notes with invited collaborators, organise content into categories, and turn unstructured text into proposed notes and calendar reminders using Gemini.

## Project status

**Planning baseline only.** The repository currently contains the initial product and technical masterplan. Application code, infrastructure and production deployment have not been implemented.

## Start here

- [Product & Technical Masterplan](docs/MASTERPLAN.md) — product scope, architecture, authentication, sharing, data model, Gemini fallback policy, notifications, deployment and prioritised roadmap.

## Core principles

- Private by default; sharing requires explicit membership.
- Google sign-in does not automatically grant Google Calendar access.
- Gemini API keys remain server-side.
- AI-generated notes and events require user review and confirmation.
- Gemini fallback uses approved free-tier models only; no automatic paid escalation.
- Manual note-taking remains available when AI is unavailable.
- A feature is complete only after tests and verification.

## Planned stack

React + TypeScript + Vite, S3 + CloudFront for static hosting, a serverless API, PostgreSQL, Google OpenID Connect, Gemini and in-app/email/Web Push notifications. Final API runtime and database provider remain open pending infrastructure review.

## Development

See the masterplan's prioritised implementation checklist before beginning implementation.
