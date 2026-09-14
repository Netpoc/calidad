# AGENTS.md

Greenfield laundry business management app. [CLAUDE.md](CLAUDE.md) is the source of truth for product behavior, scope, stack, and domain rules — read it first and do not duplicate it here.

## AI agent working rules

- Before changing behavior, confirm the requirement against [CLAUDE.md](CLAUDE.md)
- Do not invent unsupported roles, dashboards, or business rules beyond the brief
- When implementing features, keep owner/manager access boundaries explicit
- When working on finance or report logic, include collection states and branch aggregation in the model
- When implementing PWA/offline behavior, favor local persistence and sync flows instead of assuming always-online access
- Prefer adding or updating links to docs over duplicating large product specs in multiple files

## Layout

`server/` (Express + Mongoose API) and `client/` (Vue 3 PWA) as npm workspaces. Both are organized feature-first — `auth`, `branches`, `customers`, `bookings`, `pricing`, `dashboard`, `notifications` — so a domain concern stays in one folder rather than spreading across `models/`, `routes/`, `services/`.

## Files and references

- [CLAUDE.md](CLAUDE.md) — product brief, stack, and cross-cutting domain rules
- [laundry_price_list.csv](laundry_price_list.csv) — seed pricing data
- [skills/](skills/) — vendored third-party agent skills (reference material, not project config)
