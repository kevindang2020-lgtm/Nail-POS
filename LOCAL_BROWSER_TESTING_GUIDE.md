# Local Browser Testing Guide — AIPowerSalon

Run the whole platform on your Mac and click through it in your browser. Verified end-to-end: a real browser logs in
through the dev server and loads authenticated POS data (see BUILD_AND_TEST_REPORT.md → "Local run verification").

## How the local setup actually works (important)

Each app is its **own Vite dev server** that **proxies API calls to the backend on `:3000`**. Your browser only ever
talks to one origin (the app's dev server), so the httpOnly login cookie works with no CORS setup. That's why you open
`http://localhost:5173` (the POS app) rather than `localhost:3000/pos` — each app has its own port. The real ports are
documented below.

## Prerequisites

- **Node 22** (20+ works) and npm
- **PostgreSQL 16** running locally

## 1. Install

```bash
npm install
```

## 2. Create a database + seed it (one time)

**Option A — Docker (no local Postgres needed):**

```bash
USE_DOCKER_DB=1 npm run setup:local
```

This spins up Postgres 16 in Docker (`docker compose up -d db`), waits for it, builds the API, applies all migrations,
and seeds everything. Then `npm run dev:all` uses that database automatically — no `DATABASE_URL` to set.

**Option B — your own Postgres:**

```bash
createdb aipowersalon            # or: psql -c "CREATE DATABASE aipowersalon;"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aipowersalon npm run setup:local
```

Either way the seed creates the **Luxe Nails** tenant with the test accounts and demo data (services, technicians,
customers, today's appointments, queue items, and tickets in serving / done / ready-for-checkout / paid states), and
opts the tenant into public listing so it shows in the Customer app's salon search.

Re-runnable any time — migrations and seeds are idempotent. To reset: `npm run db:down` (Docker) or drop/recreate your
database, then re-run setup. Stop the Docker DB with `npm run db:down`.

## 3. Start everything (one command)

If you used **Docker** in step 2:

```bash
npm run dev:all
```

If you used **your own Postgres**:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aipowersalon npm run dev:all
```

This starts the API on `:3000` (in **sandbox payment mode**, so card payments work in test mode) and all six app dev
servers. Leave it running.

> Backend code changes need a rebuild (`npm run build:api`) because `dev:all` runs the compiled API. Frontend changes
> hot-reload automatically.

To run pieces individually: `npm run dev:backend` (API only), `npm run dev:frontend` (all UIs only), or a single app
e.g. `npm run dev:pos`.

## 4. Open these URLs

| App | URL | Sign in with |
|---|---|---|
| **POS Front Desk** | http://localhost:5173 | Front Desk or Owner |
| **Super Admin** | http://localhost:5174 | Super Admin |
| **Technician app** | http://localhost:5175 | Technician |
| **Customer app** | http://localhost:5176 | Customer |
| **Owner app** | http://localhost:5177 | Owner |
| **Customer Display** | http://localhost:5180 | (pairs to a POS station) |
| Backend API | http://localhost:3000 | (health: `/health`) |

## 5. Test accounts (local only — salon code `LUXE`)

| Role | Where | Salon code | Email | Password |
|---|---|---|---|---|
| Super Admin | Super Admin (5174) | — | `admin@aipowersalon.test` | `Admin123!` |
| Owner | POS (5173) / Owner (5177) | `LUXE` | `owner@luxenails.test` | `Owner123!` |
| Front Desk | POS (5173) | `LUXE` | `frontdesk@luxenails.test` | `FrontDesk123!` |
| Technician | Tech (5175) | `LUXE` | `tech@luxenails.test` | `Tech123!` |
| Customer | Customer (5176) | `LUXE` | `customer@test.com` | `Customer123!` |

Notes:
- **Super Admin** requires an MFA code — any 6-digit number works (TOTP is format-gated locally).
- **Owner / Front Desk / Technician** sign in with **salon code `LUXE`** + email + password on their app's login.
- The demo tenant `PILOT01` also exists if you ran the older seeds; `LUXE` is the one this guide uses.

## 6. First workflow to test

1. Open **POS** (5173), sign in as Front Desk (`LUXE` / `frontdesk@luxenails.test` / `FrontDesk123!`).
2. **Overview** and **Dashboard** load live KPIs. Click each sidebar item — every screen loads real data.
3. **Check-In** a walk-in → send to **Queue** → assign a technician.
4. In a second tab open **Tech app** (5175), sign in as the Technician → accept the ticket → start service →
   add/adjust a service → mark **Service Done**.
5. Back in POS, the ticket moves to **Checkout**. Open **Checkout**, add a tip, take a **cash** payment (card needs a
   live Fiserv MID — see blockers), send a receipt.
6. **Customer Display** (5180): pair to the POS station, then watch it follow the checkout.
7. **Reports** and the technician's **Earnings** update from the completed sale.
8. Open **Super Admin** (5174) as Super Admin → **Tenants** → open Luxe Nails.

## 6b. Automated end-to-end check (optional)

Prove the whole chain in one command (boots the API in sandbox mode, runs check-in → queue → tech → checkout with a
test card → asserts reports + earnings update):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aipowersalon npm run e2e:workflow
```

Expect `FULL WORKFLOW GREEN: 22 passed, 0 failed`.

## 7. Pointing the apps at a deployed backend (optional)

Not needed for local testing. For deploys, set the API origin per app via `dist/config.js` (runtime, no rebuild) or
build-time `VITE_API_BASE`. See **CONFIG_API_ORIGIN.md**.

## 8. Local payment + discovery (now working in test mode)

- **Card payments — work locally in SANDBOX mode.** `dev:all` runs the API with `PAYMENTS_SANDBOX=1`, so card and split
  payments are **approved in test mode** (transaction IDs are labeled `sbx_…`; the checkout shows `fiservStatus:
  sandbox`). No real Fiserv/CardPointe MID is needed to click through the full checkout workflow. To test against a real
  CardPointe sandbox instead, set `CARDPOINTE_*` env and a per-tenant gateway config.
- **Customer salon search — works without a Google key.** The seed opts Luxe Nails into public listing and geocodes the
  branch, so it appears in the Customer app's "Find Salons". A `GOOGLE_PLACES_API_KEY` only adds *non-partner* Google
  results; partner/seeded salons show without it.
- **Super Admin MFA — format-gated on purpose for local.** Any 6-digit code works so you can sign in without an
  authenticator app. Real TOTP enrollment is a production step, intentionally not enabled locally (it would only make
  local login harder).

These are the previous "blockers" — all resolved for local testing. See REMAINING_BLOCKERS.md for the production notes.
