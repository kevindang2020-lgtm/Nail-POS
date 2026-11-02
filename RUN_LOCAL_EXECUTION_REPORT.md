# RUN_LOCAL Execution Report

This records the actual execution of the `RUN_LOCAL.md` flow against a real PostgreSQL 16 database, with the real
NestJS backend, proving the system is data-backed (not a front-end demo). Run in a Linux sandbox; the same commands
run on your Mac via `bash scripts/local/setup.sh` + `bash scripts/local/dev.sh`.

## Environment
- Node 22, npm 10, PostgreSQL 16, fresh database `aps_real`.
- Env: `REPO_DRIVER=postgres`, `DATABASE_URL=…`, `PORT=3000`, `AUTH_SESSION_SECRET=…`, `NODE_ENV=development`.

## Commands & results

| Step | Command | Working dir | Result |
|------|---------|-------------|--------|
| Build API | `npm run build --workspace @aipowersalon/api` | repo root | ✅ exit 0 |
| **Production guard** | `NODE_ENV=production node apps/api/dist/main.js` (no DB env) | repo root | ✅ **Refused to start, exit 1** — printed the missing-var FATAL message |
| Migrate | `node apps/api/scripts/migrate.mjs` | repo root | ✅ `42 applied, 0 already present (42 total)` |
| Seed | `tsx apps/api/scripts/seed.ts` | repo root | ✅ super-admin + tenant PILOT01 + branch Main + OWNER + subscription |
| Seed demo | `tsx apps/api/scripts/seed-demo.ts` | repo root | ✅ 6 services, 4 technicians, 5 customers, 5 appointments, 2 queue items, 1 tech-queue ticket, 4 tickets |
| Boot API | `node apps/api/dist/main.js` (postgres) | repo root | ✅ `AIPowerSalon API listening on :3000`; `GET /health` → `{"status":"ok"}` |
| Test suite | `npm test` | repo root | ✅ **215 passed (32 files)** |

## Real persistence proof (the key evidence)

A screen that only changes local browser state is NOT acceptable. This proves a real authenticated API write lands
in Postgres and reads back:

1. **Before** — direct SQL `select count(*) from customers` → **5**.
2. **Login** — `POST /auth/login` as `owner@pilotsalon.com` (salon `PILOT01`) → HTTP 200, real `aps_session` cookie, full OWNER principal.
3. **Write** — `POST /pos/customers {firstName:"Persisted",lastName:"ByApi",phone:"+18565559999"}` → HTTP 200; returned a customer whose `tenantId`/`branchId` were **derived from the session, not the request body**.
4. **After** — `select count(*) from customers` → **6**; the row `Persisted ByApi | +18565559999 | tenant_scoped=t` is physically present in Postgres.
5. **Read-back ("survives refresh")** — `GET /pos/customers` returned the newly-created customer from the database.

Conclusion: writes persist server-side, scoped to the authenticated tenant/branch. This is the real data-backed system.

## Money-path proof (Checkout → tenant gateway → Paid → refund → Reports)

Run against the seeded `ready_checkout` ticket with `PAYMENTS_SANDBOX=1` (simulated approvals, never real charges):

1. `GET /pos/payment-gateway/status` → `{processorType:"fiserv", environment:"sandbox", status:"pending"}` — the gateway is **resolved per tenant from the session**.
2. `POST /pos/checkout/tickets/:id/pay/card {tipCents:500}` → HTTP 200 `approved`, txn `sbx_…:card:7729`, amount **$77.29** ($65 service + tax + surcharge + $5 tip, all computed server-side).
3. Postgres: a `payments` row `card / approved / 7729c / tip 500c`, and the ticket flipped to **paid**.
4. `POST …/payments/:paymentId/refund` → `refunded`, a `payment_refunds` row created (refund uses the original tenant gateway).
5. `GET /pos/reports/kpis` → reflects the stored transactions: gross $77.29, tips $5.00, refund $77.29, 1 ticket.

This exercises the full money path through the real API with the tenant-resolved gateway, real DB rows, and reporting off stored records.

## Real defect found and fixed by this end-to-end run
Exercising Reports surfaced a genuine RBAC bug: `reports.service.ts`, `pos-project-status.service.ts`, and one line in
`serving.service.ts` did a **raw** `ctx.permissions.includes('pos.reports.view' | 'pos.reports.export' | 'pos.serving.edit_services')`,
but the permission catalog grants the **coarse** capabilities (`reports.view`, `reports.export`, `serving.manage`).
No role is ever granted the granular `pos.*` strings directly, so **Reports returned 403 for every role, including OWNER**.
Fix: use the same `hasPermission()` helper the rest of the app uses (it normalizes a granular `pos.*` key to its coarse
capability). After the fix, `GET /pos/reports/kpis` and `/pos/reports/state` return **200** for OWNER; full suite still **208 passed**.

## What was NOT executed here (honest blockers)
- **Browser click-through of the React UIs** — needs a desktop browser; verified at build/type level (`tsc --noEmit && vite build` exit 0 for **all four** web apps) and via the API persistence proof above.
- **Live Fiserv/Stripe/Square/Clover sandbox round-trips** — need processor credentials. Adapters + selection are unit-proven; set `PAYMENTS_SANDBOX=1` (default in `.env.local.example`) to exercise simulated approvals/refunds/voids, or the real `CARDPOINTE_*` vars for live.
- **Native apps** — share the same backend + API client; not booted here.

---

## Addendum — full ticket lifecycle + all four apps (latest run)

**Full ticket lifecycle through the real API** (Postgres `aps_real`, authenticated as OWNER). Drove seeded tickets across every state and confirmed each transition in the database:
- `serving → service_done` via `POST /pos/serving/tickets/:id/mark-service-done` → **200**, DB status `service_done`.
- `service_done → ready_checkout` via `POST .../quality-check {result:"approved"}` then `POST .../send-to-checkout` → **200**, DB status `ready_checkout`. The quality gate is enforced: sending to checkout **before** approval returns `400 QUALITY_NOT_APPROVED` — the spec's Quality Review requirement working, not a bug.
- `ready_checkout → paid` via `POST /pos/checkout/tickets/:id/pay/card` and `pay/cash` → **200**, DB status `paid`, with a successful refund. (Sandbox approvals under `PAYMENTS_SANDBOX=1`.)

**Technician login added + verified.** `seed-demo` now provisions a `TECHNICIAN` user (`tech@pilotsalon.com` / `Tech!2345`, salon `PILOT01`). On a **fresh** database (migrate 42 → seed → seed-demo), `POST /auth/login` for that account returns **SUCCESS** with role `TECHNICIAN` and its permission set.

**All four web apps build clean.** `npm run build` exits 0 for pos-web, admin-web, tech-web, and customer-web. `scripts/local/dev.sh` now launches the API plus all four (POS :5173, Super Admin :5174, Technician :5175, Customer :5176). Core suite still **215 passed**.

**Customer login added + verified end-to-end.** `seed-demo` now creates a `CUSTOMER` user (`customer@pilotsalon.com` / `Cust!2345`) and links it to a demo customer via `customers.user_id` (the link column from migration 030). On a fresh database, `POST /auth/login` (tenant portal, salon `PILOT01`) returns **SUCCESS** with role `CUSTOMER`; `GET /customer/home` and `/customer/appointments` return that customer's real data (name, loyalty, an upcoming appointment). `/customer/receipts` is empty until a real checkout produces a receipt for that customer — expected, since the static seed doesn't write receipt rows. All four apps are now sign-in-testable against seeded data.

**Realtime push bus (SSE) — built and proven end-to-end on the server.** Transport is Server-Sent Events (`GET /realtime/stream`, NestJS `@Sse()`), chosen over WebSockets because push here is server→client only: SSE adds no dependencies, rides the existing HTTP/Vite proxy, and the browser's `EventSource` reconnects on its own. The connection is scoped to the authenticated user's tenant+branch (from `req.ctx`, never client input), so a tenant only receives its own events. A single in-process bus (`InProcessEmitter`, `@Global` `RealtimeModule`) is injected into the checkout, serving, service-done, and queue services via their factories (an optional constructor param, so the unit specs are unaffected). Emit points: card/cash payment → `payment_approved` + `ticket_paid` + `reports_updated`; mark-done → `service_done`; send-to-checkout → `ticket_ready_checkout`; queue create/assign → `queue_updated`. **Live proof:** with an `EventSource` connected and `PAYMENTS_SANDBOX=1`, a real `pay/card` plus a real queue-create pushed five events to the client — each carrying the event name, the screens to refetch (from the tested core map), and the payload. 7 new tests cover bus routing, tenant isolation, unsubscribe/prune, and the event→screens map (suite now **215**). The pos-web client (`realtime-client.ts` SSE + `useRealtime` hook) is wired into Checkout, Queue, and Dashboard and is test/SSR-safe; live in-browser refetch still needs a desktop browser to QA (the same browser-QA caveat as the modal sweep).

