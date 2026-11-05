> **SUPERSEDED (Jul 30 2026).** Canonical doc: **LOCAL_DEVELOPMENT.md**. This file is preserved history — do not follow it for current commands.

# AI PowerSalon — Local Development & Testing Guide

Everything you need to run the **whole system** on your machine: API + Postgres + every frontend,
with seeded test data and login accounts for all roles. This is a **development** setup — not production.

---

## 0. Prerequisites

- **Node 20+** and **npm 10+**
- **Postgres 16** — either via **Docker** (recommended, zero local setup) or your own local install
- (Docker path) **Docker Desktop** running

---

## 1. One-command setup

### Option A — Docker Postgres (recommended)

```bash
npm install
USE_DOCKER_DB=1 npm run local:setup      # starts Postgres in Docker, migrates, seeds everything
npm run dev:all                          # starts the API + all frontends
```

### Option B — your own local Postgres

```bash
npm install
# point at your local Postgres (any superuser reachable via `sudo -u postgres psql`,
# or set SUPERUSER_DSN=postgresql://postgres:PASS@localhost:5432/postgres)
DATABASE_URL=postgresql://aps:aps@localhost:5432/aps npm run local:setup
DATABASE_URL=postgresql://aps:aps@localhost:5432/aps npm run dev:all
```

`local:setup` will **provision the role + database** (creating the `aps` role and making it own the
`public` schema — required on Postgres 16), then migrate and seed. It is safe to re-run.

When it finishes it prints the test accounts. Open **http://localhost:5173** (Salon POS) and sign in.

---

## 2. Port map & application inventory

| Application | Workspace | URL | Role it serves | In `dev:all` |
|---|---|---|---|---|
| **API** (NestJS) | `@aipowersalon/api` | http://localhost:3000 | backend for all apps | ✅ |
| **Salon POS** | `aipowersalon-pos-web` | http://localhost:5173 | Owner / Front-desk | ✅ |
| **Super Admin** | `aipowersalon-admin-web` | http://localhost:5174 | Super Admin | ✅ |
| **Technician** | `aipowersalon-tech-web` | http://localhost:5175 | Technician | ✅ |
| **Customer** | `aipowersalon-customer-web` | http://localhost:5176 | Customer | ✅ |
| **Owner** | `aipowersalon-owner-web` | http://localhost:5177 | Owner | ✅ |
| **Customer Display** | `aipowersalon-customer-display` | http://localhost:5180 | in-salon display | ✅ |
| **Manager Pay** | `aipowersalon-manager-pay-web` | http://localhost:5181 | Manager (payments) | ✅ |
| **Go Check-In (kiosk)** | `aipowersalon-go-check-in-kiosk` | — | Capacitor kiosk shell | build-only¹ |
| **Go Check-In (admin)** | admin-web | Super Admin → Check-In Devices (`/check-in-devices`) | device manager (the static `go-check-in-admin` page was removed Oct 10 2026) | admin-web |
| **Shared UI** | `@aipowersalon/ui` (`packages/ui`) | — | shared components | n/a |

¹ The kiosk is a Capacitor app; `npm run build --workspace aipowersalon-go-check-in-kiosk` produces its `www/`.
² The device-manager page is a single static HTML file — open it directly in a browser; it talks to the API at :3000.

Each frontend proxies `/pos`, `/auth`, `/media`, etc. to the API at **:3000** via Vite (see each app's
`vite.config.ts`), so in development everything is same-origin — no CORS setup needed.

---

## 3. Test accounts

The accounts depend on how you seeded:

### After `npm run local:setup` (tenant code **LUXE**)

| Role | Salon code | Login | Password | Sign in at | Lands on |
|---|---|---|---|---|---|
| Super Admin | *(none)* | admin@aipowersalon.test | `Admin123!` | :5174 | Super Admin dashboard |
| Owner | LUXE | owner@luxenails.test | `Owner123!` | :5173 or :5177 | POS / Owner dashboard |
| Front-desk | LUXE | frontdesk@luxenails.test | `FrontDesk123!` | :5173 | POS dashboard |
| Technician | LUXE | tech@luxenails.test | `Tech123!` | :5175 | Tech queue |
| Customer | LUXE | customer@test.com | `Customer123!` | :5176 | Customer home |

> Super Admin MFA is **format-gated** locally — enter **any 6-digit code** (e.g. `123456`).

### After a bare `npm run db:setup` (default tenant **PILOT01**)

`db:setup` seeds the pilot fixtures instead of the LUXE demo. Those accounts are:

| Role | Salon code | Login | Password |
|---|---|---|---|
| Super Admin | *(none)* | admin@aipowersalon.com | `ChangeMe!SuperAdmin1` |
| Owner | PILOT01 | owner@pilotsalon.com | `ChangeMe!Owner1` |
| Technician | PILOT01 | tech@pilotsalon.com | *(seed default)* |

Use **`local:setup`** for the friendlier LUXE demo dataset. All passwords are hashed through the real
auth implementation — there is no auth bypass.

---

## 4. Complete workflow to test

Sign in to the **Salon POS** (:5173) as the owner or front-desk, then walk the salon flow:

1. **Dashboard** → live KPIs from real seeded data
2. **Customers** → create a customer (or search the seeded ones)
3. **Booking** → book an appointment (schedule-aware calendar, open slots, drag-to-move)
4. **Check-In** → check a customer in
5. **Tech Queue** → assign / accept a technician
6. **Customer Queue** → waiting guests
7. **Serving** → start service
8. **Service Done** → complete
9. **Checkout** → build the ticket
10. **Payment** → runs in **sandbox** locally (approvals labeled `sbx_`; no real Fiserv/Clover MID needed)
11. **Receipt** → recorded
12. **Reports** → updated totals
13. **Audit Logs** → every action recorded (append-only)
14. **Super Admin** (:5174) → oversight sees the same tenant data, read-only

Payments are sandboxed because `dev:api` sets `PAYMENTS_SANDBOX=1`. To wire a real Fiserv/CardPointe or
Clover MID, see the payment variables in `.env.example` (leave them unset to stay in sandbox).

---

## 5. Database commands

| Command | What it does |
|---|---|
| `npm run db:start` | start Postgres in Docker (compose service `db`) |
| `npm run db:stop` | stop the Docker Postgres |
| `npm run db:provision` | create the `aps` role + DB and grant `public` schema ownership (PG16-safe; idempotent) |
| `npm run db:migrate` | apply all migrations |
| `npm run db:seed` | seed base data (super-admin + tenant + owner) |
| `npm run db:seed:demo` | seed demo operational data (services, techs, customers, appts, queue, tickets) |
| `npm run db:setup` | migrate + seed + seed:demo |
| `npm run db:status` | connectivity + migration count + row counts |
| `npm run db:reset` | **DESTRUCTIVE** full reset — see below |

### `db:reset` (guarded)

Drops every table, re-provisions, re-migrates, re-seeds. Two guards protect you:

- It **refuses any non-localhost** `DATABASE_URL` (can't hit staging/production by accident).
- It **requires `CONFIRM=1`**.

```bash
CONFIRM=1 npm run db:reset          # local only; wipes and rebuilds
```

---

## 6. Running pieces individually

```bash
npm run dev:api          # API only (:3000)
npm run dev:pos          # Salon POS only (:5173)
npm run dev:admin        # Super Admin only (:5174)
npm run dev:tech         # Technician (:5175)
npm run dev:customer     # Customer (:5176)
npm run dev:owner        # Owner (:5177)
npm run dev:display      # Customer Display (:5180)
npm run dev:managerpay   # Manager Pay (:5181)
npm run dev:frontend     # all frontends, no API
npm run dev:all          # API + all frontends (default `npm run dev`)
```

---

## 7. Environment variables (local dev)

The frontends need **no** env file — they proxy to the API. The API reads these; safe local defaults are
baked into `dev:api`, so you only override what you want:

| Variable | Purpose | Local default | Secret? |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection | `postgresql://aps:aps@localhost:5432/aps` | — |
| `REPO_DRIVER` | `postgres` (live DB) vs in-memory | `postgres` | — |
| `AUTH_SESSION_SECRET` | signs the session cookie | `local-dev-secret` | dev-only |
| `MFA_ENC_KEY` | 32-byte key encrypting TOTP secrets | dev 32-byte constant | dev-only |
| `PAYMENTS_SANDBOX` | `1` = simulated card approvals (`sbx_`) | `1` | — |
| `NODE_ENV` | `development` enables localhost CORS + MFA format-gating | `development` | — |
| `PORT` | API port | `3000` | — |
| `WEB_CORS_ORIGINS` | extra allowed origins (prod) | localhost:5173–5181 auto-allowed in dev | — |
| Fiserv/Clover/Twilio/SendGrid | real integrations | unset → sandbox / mock | **yes (prod)** |

Full documentation of every variable is in `.env.example`. **Never commit real credentials.**

---

## 8. Troubleshooting

- **`permission denied for schema public` on migrate** — run `npm run db:provision` (fixes PG16 schema
  ownership), then `npm run db:migrate`. `local:setup` does this automatically.
- **`db:provision` can't get a superuser connection** — set
  `SUPERUSER_DSN=postgresql://postgres:PASSWORD@localhost:5432/postgres` and re-run, or ensure
  `sudo -u postgres psql` works. Docker users can skip provisioning entirely.
- **A frontend can't reach the API** — make sure the API is up on :3000 (`npm run db:status` first, then
  `npm run dev:api`). The Vite proxy points at :3000.
- **Login says `TENANT_NOT_FOUND`** — you passed the wrong `salonCode`. Super Admin uses **no** salon code;
  tenant users use `LUXE` (after `local:setup`) or `PILOT01` (after bare `db:setup`).
- **Port already in use** — stop the stale process, or change the port in that app's `vite.config.ts`.
