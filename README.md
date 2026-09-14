# Calidad Laundry

Laundry business management for HQ and branches — booking at the counter, branch-scoped staff and managers, live revenue dashboards, and SMS to customers. Installable PWA that keeps working when the connection drops.

See [CLAUDE.md](CLAUDE.md) for the product brief, domain rules, and architecture.

## Getting started

You need Node 20+ and MongoDB.

```bash
# 1. Start MongoDB (any dbpath you like)
mongod --dbpath /usr/local/var/mongodb

# 2. Configure the API
cp server/.env.example server/.env      # JWT_SECRET is required

# 3. Install and seed
npm install
npm run seed                            # branches, owner account, price list

# 4. Run
npm run dev                             # API :4000, client :5173
```

Sign in at http://localhost:5173 with `owner@calidad.local` / `changeme123`. **Change that password before deploying anywhere.**

## Layout

```
server/     Express + Mongoose API
  src/modules/{auth,branches,customers,bookings,pricing,dashboard,notifications}
  src/shared/          domain vocabulary, phone + reference-code identity
  src/middleware/      JWT auth and branch scoping
client/     Vue 3 + Pinia + Ant Design PWA
  src/modules/         one folder per feature, mirroring the server
  src/offline/         IndexedDB outbox and sync
  src/stores/          Pinia state
```

## How the offline path works

Staff book laundry on a phone that may have no signal.

1. The price list is cached in IndexedDB, so a booking can be priced offline.
2. If the API is unreachable, the booking goes to a local outbox with a `clientRequestId` and a `TMP-xxxxxx` placeholder reference.
3. On reconnect the outbox replays to `POST /api/bookings/sync`. The server issues the real reference code, matches or creates the customer, and prices the booking from the live price list.
4. Replaying the same `clientRequestId` returns the original booking rather than creating a second one — so a flaky connection cannot duplicate bookings or double-text a customer.

The server is authoritative for reference codes, customer ids, and prices. On-device totals are provisional and shown as such.

## SMS

Sent on exactly two events: booking confirmed, and status changed to ready for collection. The default `log` driver prints messages to stdout so nothing is spent in development. Add a real provider as a driver in [server/src/modules/notifications/sms.service.ts](server/src/modules/notifications/sms.service.ts) and set `SMS_DRIVER`.

## Tests

```bash
npm test                                  # both workspaces
npm test --workspace server -- identity   # a single file
```
