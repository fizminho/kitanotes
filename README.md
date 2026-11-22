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

React + TypeScript + Vite on Cloudflare Pages (or Worker Static Assets), Cloudflare Workers Free API, Cloudflare D1 Free, Google OpenID Connect, Gemini free tier and in-app/Web Push notifications. No S3, CloudFront, paid database, paid Worker plan or paid AI fallback. Invitation delivery in the zero-cost MVP uses a copyable secure link and Gmail compose handoff rather than paid automated transactional email.

## Zero-cost constraints

- Workers Free and D1 Free quotas are hard ceilings; the app must fail gracefully when exhausted.
- Gemini uses free-tier models only. No paid fallback or automatic billing escalation.
- Custom-domain registration/renewal may still cost money; use the free Cloudflare hostname if RM0 including domain is required.

## Development

See the masterplan's prioritised implementation checklist before beginning implementation.
