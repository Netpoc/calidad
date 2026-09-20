# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

npm workspaces monorepo: `server/` (Express + Mongoose API) and `client/` (Vue 3 PWA). Run from the repo root.

```bash
npm install                  # install both workspaces
npm run dev                  # API on :4000 and client on :5173 together
npm run dev:server           # API only (tsx watch)
npm run dev:client           # client only (vite)
npm run seed                 # dev only: platform admin + demo business with the CSV price list
npm run build                # tsc for server, vue-tsc + vite for client
npm test                     # vitest, both workspaces
```

MongoDB must be running first — `mongod --dbpath <path>` locally, or point `MONGODB_URI` elsewhere. Copy `server/.env.example` to `server/.env`; `JWT_SECRET` is required and the server refuses to start without a valid config.

`npm run seed` is a **development** convenience, idempotent: it creates the platform admin `admin@calidad.local` and a demo business "Calidad Laundry" with owner `owner@calidad.local` (both `changeme123`), HQ + Branch 1, and the 33-item CSV price list. Override with `PLATFORM_ADMIN_EMAIL/PASSWORD` and `SEED_OWNER_EMAIL/PASSWORD`. Production never runs this — see Deployment.

Vite proxies `/api` to `:4000` in development, so the client needs no API base URL.

Single test: `npm test --workspace server -- <pattern>` (vitest passes the pattern through).

## Deployment

**Frontend on Netlify, API on Render** (`https://calidad-tthd.onrender.com`). [netlify.toml](netlify.toml) builds from the repo root (`npm run build --workspace client`, publish `client/dist`) and proxies `/api/*` to Render, so the app stays same-origin — no CORS, and the service worker's `/api/...` cache rules keep matching. The SPA fallback rule must stay *after* the API rule. `MONGOMS_DISABLE_POSTINSTALL=1` there stops the root install downloading a MongoDB binary the frontend build never uses.

The API base is `import.meta.env.VITE_API_URL || '/api'` ([http.ts](client/src/api/http.ts)); the dev proxy target is `VITE_DEV_PROXY_TARGET || 'http://localhost:4000'` ([vite.config.ts](client/vite.config.ts)). Both default local — **never default the dev proxy to Render**, or `npm run dev` writes into production data. See [client/.env.example](client/.env.example).

**Render's free tier sleeps after ~15 min idle and takes 20–50 s to wake.** The 4 s reachability probe would report Offline during that window, so [connection.ts](client/src/stores/connection.ts) `warmUp()` fires one 60 s-patience request on startup and flips the badge when the server answers. Keep the short probe short — a genuinely dead connection must still be detected fast.

**Render bootstraps the platform admin on first boot.** Render's free tier has no shell, so [seed.ts](server/src/scripts/seed.ts) `bootstrapIfEmpty()` runs from `index.ts` at startup: it acts only when the `users` collection is empty (so it can never touch a live database) and only when `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` are set. It creates **only the platform admin** — no business. Set those two plus `JWT_SECRET` and `MONGODB_URI` on Render, deploy, sign in, and create the first business from the Businesses screen. Passwords are never logged. `CORS_ORIGIN` only matters if the frontend ever calls Render directly instead of through the Netlify proxy.

**Atlas holds pre-tenant data and must be migrated once before the multi-tenant server is deployed.** `server/.env` points at Atlas, and as of 2026-09-16 it held an owner, 2 branches and 33 price items with no `tenantId` and the old global unique indexes — the new server would refuse that owner's login. Run once, from a laptop, against Atlas: `MONGODB_URI=<atlas-uri> PLATFORM_ADMIN_EMAIL=… PLATFORM_ADMIN_PASSWORD=… npm run migrate:tenants --workspace server` ([migrate-to-tenants.ts](server/src/scripts/migrate-to-tenants.ts)). It wraps everything in one tenant, drops the legacy indexes, builds the per-tenant ones, and creates the platform admin (which `bootstrapIfEmpty` cannot, since the database is not empty). It refuses to backfill twice; re-running with the admin vars set only adds the admin. **Because `.env` targets Atlas, every local command must pass `MONGODB_URI=mongodb://127.0.0.1:27017/calidad` explicitly** — `npm run seed` once created a default-password admin in production this way (removed).

**Offline caches are per business.** A phone may be used by two businesses. On login, [session.ts](client/src/offline/session.ts) `switchSession()` clears the Dexie price cache **and the service-worker runtime caches** (`pricing`, `reference-data` — the SW caches by URL, not by token) when the tenant changes. Outbox entries carry `tenantId`; `flushOutbox` sends only the current business's, and foreign entries are kept and reported, never sent under the wrong token or dropped.

## Product brief

A backend and frontend to manage a laundry business.

- **Users:** Staff, Manager, Owner, Customer — plus a **Platform admin** above them all (added 2026-09-16)
- **Business:** HQ, Branch 1, Branch 2, ... Branch N+1

### Multi-tenant (decided 2026-09-16)

The app is a SaaS: **each laundry business is a tenant** with its own owner(s), branches, staff, customers, price list, bookings and dashboard. The **platform admin** (the SaaS operator) creates businesses and their first owner through `POST /api/platform/tenants` and the "Businesses" screen, and can deactivate them. The platform admin has no tenant and is refused on every business route. Customers are separate per business (phone-dedup applies within a tenant). A new business starts with one "HQ" branch and an **empty** price list — the owner adds items from the Price list screen.

### Objective

All users are capable of booking a laundry. A Manager manages their branch (a manager can manage multiple branches). The Owner manages all branches, and also creates other users and branches. Managers manage staff under their branch.

Laundry is booked by registering a customer's laundry each-by-each. The Owner is also able to update price lists, products, and more.

Manager and Owner dashboards display daily, monthly, and yearly revenue. All figures must be live as customers bring in their laundry. Calculations must also represent collected, pending collection, etc.

Upon successful booking of laundry, a unique 6–8 character reference code is generated. Upon taking customer information, a unique customer ID is created, so that whenever the customer's phone number is provided for booking another laundry, that same unique ID is tagged to the new booking reference.

When a booking is completed, an SMS is sent to the customer. When the laundry status is updated to *ready for collection*, an SMS is sent as well.

### Stack

- **Frontend:** Vue.js, Tailwind CSS, Pinia
- **Backend:** Node.js
- **Database:** MongoDB
- **Delivery:** PWA + web app. Must be usable offline on mobile devices, with data pushed as soon as the device regains internet.

**Ant Design was removed on the owner's instruction (2026-09-10) — do not reintroduce it.** The brief originally paired Tailwind with Ant Design Vue; the UI is now Tailwind-only, with a small in-house component kit in [client/src/components/ui/](client/src/components/ui/). Two things drove it beyond preference: antd cost ~435 kB gzipped (the whole app now precaches 409 kB, down from 1,785 kB), and its `<a-form>` silently swallowed submits unless given a `:model`, which broke login with no error. Reach for `components/ui/` first; add to it rather than pulling in a component library.

Note: [skills/FULLSTACK.md](skills/FULLSTACK.md) is a generic third-party skill that recommends React/Next.js/Prisma/PostgreSQL. Its architecture and security advice is useful; its stack choices are **not** — the stack above wins.

## Domain rules that cross multiple modules

These are the constraints most likely to be violated by a change made in a single file:

- **Customer identity is deduplicated by phone number.** Booking flow must look up an existing customer before creating one; a returning customer keeps their original customer ID while each booking gets a fresh 6–8 char reference code.
- **Branch scoping is an authorization boundary, not a filter.** Manager access is scoped to their assigned branch IDs (plural — a manager may hold several); Owner access spans all branches. Every branch-scoped query and mutation must derive scope from the authenticated user, never from a client-supplied branch ID alone.
- **Revenue figures derive from booking lifecycle + collection state**, not from summing booking totals. Collected vs. pending-collection must be distinguishable at daily/monthly/yearly granularity and aggregatable per branch and across all branches.
- **Offline-first writes.** Bookings created offline are queued in IndexedDB and replayed to `POST /api/bookings/sync` on reconnect. The conflict story is settled: **the server is authoritative for reference codes, customer ids, and prices.** The client shows a `TMP-xxxxxx` placeholder and a provisional total until sync returns the real ones. Every queued booking carries a `clientRequestId` (UUID) that survives retries; the server enforces it with a unique partial index and returns the original booking on replay instead of creating a second one.
- **Tenant scoping is an authorization boundary.** Every tenant-model query carries `tenantId` taken from the JWT, never from the request. Business routes run `authenticate → requireTenant → requireRole(...)` in that order ([tenant.ts](server/src/middleware/tenant.ts)) — `requireRole` alone would let the rank-4 platform admin through. Owners are **not** exempt: the old owner early-return in `assertBookingInScope` was the cross-tenant hole. `requireTenant` also checks `Tenant.active` (60 s cache), so deactivation bites already-issued tokens, not just new logins. Unique indexes are per-tenant compounds except `User.email` (login resolves the tenant from it), `Booking.referenceCode`, and `SmsLog.dedupeKey`. The six `*.isolation.test.ts` / `*.routes.test.ts` suites prove all of this against a real in-memory Mongo — extend them when adding a model or route.
- **Role boundaries:** the owner creates branches and any tenant role; a manager may create and deactivate **staff only**, and only within branches they already hold — a manager must never be able to mint another manager or assign a branch outside their scope. Enforced in [auth.routes.ts](server/src/modules/auth/auth.routes.ts), not just hidden in the UI.
- **SMS fires on exactly two transitions:** booking completed, and status → ready for collection. Sending never fails the booking (delivery is best-effort), and every send carries a `dedupeKey` (`booking:<id>:confirmed` / `:ready`) with a unique index, so an offline replay cannot double-text a customer.

## Architecture

**Money is stored in kobo** (integer minor units) everywhere — fields are suffixed `Minor`. Format for display only, at the edge.

**Prices are snapshotted onto bookings.** `booking.items[].unitPriceMinor` is copied at booking time, so an owner editing the price list never rewrites what past customers were billed. Booking totals are recomputed in a `pre('validate')` hook rather than trusted from the client.

**Server-side authorization lives in [server/src/middleware/auth.ts](server/src/middleware/auth.ts).** `resolveBranchScope()` derives the acting branch from the JWT and cross-checks any client-supplied `branchId`; `readableBranchIds()` returns `null` for owners (all branches) or the manager's/staff's assigned list. The client's route guards and role checks only hide UI — they are not the gate.

**Both sides are feature-first** (`modules/auth`, `bookings`, `customers`, `pricing`, `dashboard`, `branches`, `notifications`), so a domain change stays in one folder. Shared vocabulary lives in [server/src/shared/domain.ts](server/src/shared/domain.ts), mirrored for the client in [client/src/api/types.ts](client/src/api/types.ts) — **keep those two in step.**

**Phone normalization is the dedup key.** [server/src/shared/identity.ts](server/src/shared/identity.ts) `normalizePhone()` converts to E.164 assuming Nigerian numbers when no country code is given. Every path touching a phone number must normalize first, or `08031234567` and `+2348031234567` become two customers.

**Reference codes** use a 25-character alphabet with `0/O`, `1/I/L`, `2/Z`, `5/S`, `8/B` removed, because staff read them aloud and copy them off paper tickets.

**The UI kit lives in [client/src/components/ui/](client/src/components/ui/)** — `BaseButton`, `BaseInput`, `BaseSelect`, `MoneyInput`, `BaseModal`, `AlertBox`, `EmptyState`, `ToastHost`, and `AppIcon`. Icons are inline SVG paths in [icons.ts](client/src/components/ui/icons.ts), so there is no icon font or network request. Toasts replace antd's imperative `message` via [useToast](client/src/composables/useToast.ts), sharing one polite live region.

**`MoneyInput` is the only place naira floats exist** — it takes and emits integer kobo. `null` is meaningful there: on the price list an empty field means the tier is not offered, which is not the same as free.

**Design tokens are in [client/src/styles/tokens.css](client/src/styles/tokens.css).** Colour never carries meaning alone — every status pairs a colour with an icon and a word ([display.ts](client/src/api/display.ts)). Touch targets are ≥44px. Both are verified, not assumed: the browser audit in the workflow below catches regressions.

**Changing `tailwind.config.js` requires a dev-server restart** — Vite does not pick up config changes through the PostCSS pipeline, and stale config produces phantom styling bugs.

## Pricing data

[laundry_price_list.csv](laundry_price_list.csv) is the initial price list (NGN) and defines the shape of the pricing model: each item has up to two service tiers — *Washing, Starching & Ironing* and *Starching & Ironing* — and many items (bedding, towels, curtains, "Bulk") have no second-tier price. The pricing schema must allow a service tier to be absent for an item rather than defaulting to zero. Prices are Owner-editable, so treat this CSV as seed data, not as a hardcoded table.

## Skills in this repo

[skills/](skills/) contains vendored third-party agent skills — [ux-designer/](skills/ux-designer/) (research, accessibility/WCAG AA, IA, interaction design, visual design — see its [AGENTS.md](skills/ux-designer/AGENTS.md) for the compiled ruleset), [FULLSTACK.md](skills/FULLSTACK.md), and [DEBUGGER.md](skills/DEBUGGER.md). They are reference material, not project configuration.
