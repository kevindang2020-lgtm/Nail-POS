> **SUPERSEDED (Jul 30 2026).** Canonical doc: **LOCAL_DEVELOPMENT.md**. This file is preserved history — do not follow it for current commands.

# Run AIPowerSalon + Super Admin locally (for testing each task)

This package runs the whole system on your machine — the API, the POS web app, the Super Admin web app, a
Postgres database, and seeded demo data — so you can click through and test every sidebar task and the Super
Admin screens. Login and the full data layer are real; card payments run in a **simulated** sandbox (no real charges).

---

## Prerequisites

- **Docker Desktop** (for the Postgres database) — running.
- **Node.js 20+** (tested on 22) and npm.
- A **Mac or Linux** shell for the two scripts below (they're bash). On Windows, use WSL or run the steps in
  "Manual steps" by hand.

---

## Quick start (two commands)

From the project root (`aipowersalon-pos/`):

```bash
bash scripts/local/setup.sh     # installs deps, starts Postgres, migrates, seeds admin + demo data, builds the API
bash scripts/local/dev.sh       # starts API (:3000) + all 4 web apps (POS :5173, Super Admin :5174, Technician :5175, Customer :5176); Ctrl-C stops all
```

Then open:

| App | URL |
|-----|-----|
| **POS** (tenant app) | http://localhost:5173 |
| **Super Admin** | http://localhost:5174 |
| **Technician app** | http://localhost:5175 |
| **Customer app** | http://localhost:5176 |

> Use `localhost` (not `127.0.0.1`) so the session cookie behaves.

---

## Login credentials (created by the seed)

**POS — Owner**
- Salon code: `PILOT01`
- Email: `owner@pilotsalon.com`
- Password: `ChangeMe!Owner1`

**Super Admin**
- Email: `admin@aipowersalon.com`
- Password: `ChangeMe!SuperAdmin1`
- MFA code: **any 6-digit number** (e.g. `123456`) — MFA is format-gated locally for users with no enrolled authenticator; real TOTP is wired and enforced in production (local / non-production only: with `NODE_ENV=production` or `MFA_REQUIRE_TOTP=1` a user with no enrolled authenticator cannot pass MFA with a bare 6-digit code — `packages/auth/src/security.ts` `requireRealTotpEnrollment`; corrected Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep)).

**Technician app** (`apps/tech-web`)
- Salon code: `PILOT01`
- Email: `tech@pilotsalon.com`
- Password: `Tech!2345`

**Customer app** (`apps/customer-web`)
- Salon code: `PILOT01`
- Email: `customer@pilotsalon.com`
- Password: `Cust!2345`
- This account is linked to a demo customer (Grace Kim), so **Home** and **Appointments** show real data. **Receipts**
  populate after a real checkout for that customer (the static seed doesn't create receipt rows).

---

## What demo data is seeded

For tenant **PILOT01 / branch Main**: 3 service categories + 6 services, 4 technicians (with live statuses:
available / in-service / on-break), 5 customers, 5 of today's appointments (completed, checked-in, confirmed,
booked), 2 waiting walk-ins in the queue, 1 accepted tech-queue ticket, and 4 tickets spread across
**serving → service-done → ready-for-checkout → paid** (so every workflow screen has something on it), plus a
pending per-tenant payment-gateway config.

---

## Per-task testing checklist

### POS sidebar (16 items)
- **Overview / Dashboard** — KPIs and today's activity render from the seeded data; quick-action buttons navigate.
- **Check-In** — search a seeded customer (e.g. "Grace Kim"), or add a walk-in; check someone in and watch the Queue update.
- **Booking** — the day view shows today's appointments; create / move / cancel an appointment (double-booking is blocked).
- **Tech Appointments** — per-technician columns with today's appointments.
- **Live Schedule** *(new — wired this round)* — technicians working today, their statuses and current/next work.
- **Tech Queue / Queue** — the seeded waiting walk-ins and the accepted ticket; assign / accept / start service.
- **Serving** — the in-service ticket; add a service line, then mark service done.
- **Service Done** — the completed-but-unpaid ticket; send it to checkout.
- **Checkout** — the ready ticket; take a **card** or **cash** payment. With `PAYMENTS_SANDBOX=1` (default here),
  card/split record a simulated `sbx_` approval so you can test the full flow, tips, surcharge, and a refund/void.
- **Customers** — the 5 seeded customers; open a profile, edit, view history.
- **Technicians** — the 4 seeded techs; profiles, skills, schedule.
- **Services** — categories + services; add / edit / deactivate.
- **Reports** — sales/payments reflect the one paid ticket ($30 from the seed); date/technician/method filters; CSV export.
- **Settings** — the Settings Center; Payments & Checkout shows the masked gateway status; toggles persist.

### Super Admin
- **Login** (admin@aipowersalon.com + any 6-digit code) → **Dashboard**.
- **Tenants** — PILOT01 is listed; open it, and configure its **payment gateway** (processor, environment, masked
  merchant ID, test-connection). Each tenant's gateway is isolated.
- **Billing / Project Status / System Health** — render from real data.

---

## Reset / reseed

- **Wipe and start fresh:** `docker compose down -v` then re-run `bash scripts/local/setup.sh`.
- **Re-run a seed only:** `npm run db:seed` (admin + tenant) or `npm run db:seed:demo` (operational data). Both are
  idempotent — the demo seed skips if the tenant already has services. To force fresh demo data, wipe first.

## Manual steps (if you can't run the bash scripts)

```bash
cp .env.local.example .env
npm install
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run db:seed:demo
npm run build:api
# in three terminals (or background them):
PORT=3000 npm run start:api      # API
npm run dev:pos                  # POS  → http://localhost:5173
npm run dev:admin                # Admin → http://localhost:5174
npm run dev:tech                 # Technician → http://localhost:5175
npm run dev:customer             # Customer → http://localhost:5176
```

(`.env` is loaded automatically by the scripts; for the manual API start, make sure the `.env` values are exported
or pass them inline, e.g. `env $(grep -v '^#' .env | xargs) npm run start:api`.)

---

## Honest caveats

- **Card payments are simulated** (`PAYMENTS_SANDBOX=1`). Real Fiserv/CardConnect auth/refund/void needs sandbox
  credentials (`CARDPOINTE_*` in `.env`); see the production `.env.example` for the full list. Unset `PAYMENTS_SANDBOX`
  to exercise the honest "gateway not configured" path.
- **SMS/email receipts** are mock senders unless you set Twilio/SendGrid keys — the receipt is still recorded.
- Everything else (auth, tenant isolation, the full booking→checkout workflow, reports, settings) runs against the
  real Postgres database and the real backend.
