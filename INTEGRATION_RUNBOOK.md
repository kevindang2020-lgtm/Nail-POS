# AIPowerSalon — Integration Runbook (taking it live)

This is the bridge between "built + unit-tested here" and "running end-to-end in your environment." Everything below
that says **verified** has automated coverage in this repo; everything that says **do this on a live DB** could only be
written/type-checked here (no Postgres or Nest runtime in the build sandbox) and must be exercised by you.

Monorepo layout: `apps/api` (NestJS), `apps/pos-web` (staff POS, Vite/React), `apps/admin-web` (Super-Admin, Vite/React).
The API runs with `setGlobalPrefix('')`, so routes are at the root: `/auth/*`, `/pos/*`, `/super-admin/*`, `/tech/*`.

---

## 1. Prerequisites
- Node 18+ and a running PostgreSQL 16.
- `npm install` at the monorepo root (deps are hoisted; the web apps resolve from the root `node_modules`).

## 2. Environment variables (API)
Set these for `apps/api` before starting it:

| Var | Purpose | Example |
|---|---|---|
| `REPO_DRIVER` | `postgres` switches every feature module from in-memory to the Kysely/Postgres adapters | `postgres` |
| `DATABASE_URL` | Postgres connection string | `postgres://user:pass@localhost:5432/aipowersalon` |
| `AUTH_SESSION_SECRET` | **Required for login** — HMAC key for `aps_session` tokens. If unset, `POST /auth/login` returns 500 by design. Use 32+ random bytes. | `openssl rand -base64 48` |
| `AUTH_SESSION_TTL` | Session lifetime in seconds (optional; default 43200 = 12h) | `43200` |
| `PG_POOL_MAX` | Optional PG pool size (default 10) | `10` |
| `NODE_ENV` | `production` makes the session cookie `Secure` (HTTPS only) | `production` |

## 3. Run migrations
SQL lives in `apps/api/db/migrations/*.sql`, numbered in apply order (001 → …). Apply them in numeric order against
`DATABASE_URL` (e.g. `for f in apps/api/db/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done`). `001_auth_foundation.sql`
creates `tenants, branches, users, roles/permissions, sessions, refresh_tokens, mfa_factors, password_reset_tokens,
tenant_subscriptions, login_attempts, device_sessions`.

> **Settings/integrations migration:** named `017a_pos_settings_integrations.sql` so it sorts uniquely after
> `017_checkout_payments.sql` (the prior `017_`/`017_` number collision is resolved). The glob still applies everything
> in order: `… 017_checkout_payments → 017a_pos_settings_integrations → 018 …`. Both files are idempotent, and the
> `migrate.mjs` runner reconciles the rename in `schema_migrations`, so a DB already migrated under the old name skips it.

## 4. Seed a SUPER_ADMIN and a pilot tenant
**Easiest: use the seed script** (`apps/api/scripts/seed.ts`). It hashes passwords with the same `password.ts`
`hashPassword` the login path verifies against (round-trip verified), and is idempotent (checks for an existing
SUPER_ADMIN by email and tenant by `tenant_code` before inserting).

```bash
# from apps/api — preview the rows + REAL password hashes WITHOUT touching a DB:
SEED_SUPER_ADMIN_PASSWORD='…' SEED_OWNER_PASSWORD='…' npm run seed:dry

# write the rows (requires DATABASE_URL):
DATABASE_URL=postgres://… \
SEED_SUPER_ADMIN_EMAIL=admin@yourco.com SEED_SUPER_ADMIN_PASSWORD='YourStrongPassw0rd' \
SEED_TENANT_CODE=PALACE SEED_TENANT_NAME='Palace Nails' \
SEED_OWNER_EMAIL=owner@palace.com SEED_OWNER_PASSWORD='OwnerPassw0rd' \
npm run seed
```
Env knobs (all optional, with change-me defaults): `SEED_SUPER_ADMIN_EMAIL/PASSWORD`, `SEED_TENANT_CODE`,
`SEED_TENANT_SLUG`, `SEED_TENANT_NAME`, `SEED_TENANT_LEGAL`, `SEED_TENANT_EMAIL`, `SEED_BRANCH_NAME`,
`SEED_OWNER_EMAIL/PASSWORD/FIRST/LAST`, `SEED_PLAN`. It seeds: a SUPER_ADMIN (tenant_id NULL), the tenant, one branch,
an OWNER, and an active subscription, and links `tenants.owner_user_id`. (`npm run seed` uses `tsx`; `npx tsx` fetches
it if not already installed.)

<details><summary>Manual alternative (psql) — if you'd rather not run the script</summary>

Generate a hash, then insert:

```bash
node -e "import('./src/auth/password.ts').then(async m => console.log(await m.hashPassword(process.argv[1])))" 'YourStrongPassw0rd'
```
```sql
INSERT INTO users (tenant_id, role, email, full_name, password_hash, status, mfa_enabled)
VALUES (NULL, 'SUPER_ADMIN', 'admin@yourco.com', 'Platform Admin', '<scrypt-hash>', 'active', false);
INSERT INTO tenants (legal_name, display_name, tenant_slug, tenant_code, status)
VALUES ('Palace Nails LLC', 'Palace Nails', 'palace-nails', 'PALACE', 'active') RETURNING id;  -- = :tenant_id
INSERT INTO branches (tenant_id, name, city, state, status) VALUES (:tenant_id, 'Cherry Hill', 'Cherry Hill', 'NJ', 'active') RETURNING id;  -- = :branch_id
INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES (:tenant_id, 'Premium', 'active');
INSERT INTO users (tenant_id, branch_id, role, email, full_name, password_hash, status, mfa_enabled)
VALUES (:tenant_id, :branch_id, 'OWNER', 'owner@palace.com', 'Pat Owner', '<scrypt-hash>', 'active', false);
```
</details>

> **MFA note (honest):** `SUPER_ADMIN` is MFA-required, and MFA is **format-gated in local / non-production only** (local / non-production only: with `NODE_ENV=production` or `MFA_REQUIRE_TOTP=1` a user with no enrolled authenticator cannot pass MFA with a bare 6-digit code — `packages/auth/src/security.ts` `requireRealTotpEnrollment`; corrected Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep)) — any 6-digit code passes there
> (`isValidMfaCode`) until real TOTP/WebAuthn verification is wired (see §8). So a super-admin login today needs *a*
> 6-digit code, not a correct one. Tenant roles default to MFA-optional.

## 5. Enforce auth at runtime (apply the middleware + permission guard)  ← do this on the server
The login spine is complete (hash/verify → user lookup → `decideLogin` → signed session → cookie), and
`TenantContextMiddleware` already reads the `aps_session` cookie (or `Authorization: Bearer`). But it is **not applied
globally yet** — apply it so routes actually populate `req.ctx`, excluding the public login route:

```ts
// apps/api/src/app.module.ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextMiddleware } from './common/tenant-context.middleware';

@Module({ /* …imports… */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { path: 'auth/login', method: RequestMethod.POST },   // login must work without a session
        { path: 'auth/logout', method: RequestMethod.POST },
      )
      .forRoutes('*'); // /auth/me, /pos/*, /super-admin/*, /tech/* all get req.ctx from the cookie
  }
}
```

Also register the role/permission guard globally so `@RequirePermission(...)` on the POS controllers is enforced:

```ts
import { APP_GUARD } from '@nestjs/core';
import { RolePermissionGuard } from './common/guards/role-permission.guard';
// add to providers: { provide: APP_GUARD, useClass: RolePermissionGuard }
```

(Tenant- vs super-admin- vs technician-scoped guards live in `common/guards/*` — apply per controller as needed.)

## 6. Build & run
- API: `cd apps/api && npm run build && node dist/main.js` (or your existing start). Confirm it boots with the env above.
- POS web: `cd apps/pos-web && npm run dev` (or `npm run build` + serve `dist`). Dev proxies `/pos` and `/auth` → `:3000`.
- Admin web: `cd apps/admin-web && npm run dev`. Dev proxies `/super-admin` and `/auth` → `:3000` (port 5174).
- In production, serve each web app **same-origin** with the API (or behind a reverse proxy) so the `aps_session` cookie
  (httpOnly, SameSite=Lax, Secure in prod) is sent on API calls.

## 7. Smoke tests (prove the loop)
1. **Tenant login** (pos-web): salon code `PALACE`, `owner@palace.com`, the password you hashed → lands on the POS.
   Single-branch ⇒ immediate `SUCCESS`; the `aps_session` cookie is set.
2. **Super-admin login** (admin-web): `admin@yourco.com` + password → `MFA_REQUIRED` → enter any 6 digits → Tenants console.
3. `GET /auth/me` returns the session context (once §5 middleware is applied).
4. A POS read (e.g. `/pos/overview/state`) returns tenant-scoped data; a write (e.g. service edit) persists.
5. Create a tenant from the Super-Admin **New Tenant** form → appears in `/super-admin/tenants/state`.

---

## 8. What still needs building (and why it wasn't faked)
These were left as real work rather than shipped as compiles-but-unverified code:

- **Kysely `TechDataPort`** (`apps/api/src/tech/tech.kysely.repository.ts`): now **written & type-checked, but NOT run
  against a live DB** — bound in `tech.module.ts` when a Postgres handle exists. It queries the real tables
  (technicians, pos_tech_queue_tickets, pos_tech_appointments, ticket_service_lines, technician_statuses) and does not
  fabricate data. **You MUST reconcile these before trusting it:** (1) the status vocabularies — `asTechTicketStatus`
  and `asTechnicianStatus` assume strings like `assigned/accepted/serving/done`; confirm the actual values your data
  uses and fix the maps/fallbacks. (2) Whether the technician's "ticket" is the `pos_tech_queue_tickets` row (assumed)
  and whether `accept/start/complete` should ALSO advance the POS `tickets` row + serving timers (currently they only
  update the tech-queue row). (3) Per-technician **tips** are 0 (no per-line tip column — needs a payments/receipts
  source); **sales-trend** is 0 (no prior-period baseline); **service name** is best-effort from the `requested_services`
  /`services` JSON. (4) "Today" is computed from server time — apply the salon timezone if needed. TechService
  authorization + guards remain **verified** (11 unit tests); the adapter's behavior is what needs live validation.
- **Real MFA** — replace format-gated `isValidMfaCode` with TOTP/WebAuthn verification (services already exist under
  `apps/api/src/auth/`: `webauthn.service`, `mfa_factors` table).
- **Password reset / force-change routes** — services exist (`password-reset.service`, `system-password-reset.service`);
  mount them on the auth controller and wire the corresponding screens.
- **Branch selection** — backend DONE: `POST /auth/select-branch {branchId}` validates the branch belongs to the
  user's tenant + is active and re-issues the session with it set; `BRANCH_SELECTION_REQUIRED` now issues an
  authenticated *branchless* session so the follow-up call is authorized (logic verified, 6 tests; Kysely branch
  adapter staged — `isActive = branches.status === 'active'`). *Remaining (frontend):* a branch-picker screen that, on
  `BRANCH_SELECTION_REQUIRED`, lists the tenant's branches and POSTs the choice (the web login screens already surface
  the state). **DONE:** `GET /auth/branches` lists the tenant's branches for the picker, and the pos-web LoginScreen
  now shows a branch-picker step on `BRANCH_SELECTION_REQUIRED` (fetch → choose → `POST /auth/select-branch` → in).
  The whole branch flow is end-to-end in code; it exercises live once the auth Kysely + branches adapters run on PG.
- **Super-Admin dashboard backend** — DONE: `@Controller('super-admin/dashboard')` (overview), service verified, Kysely
  adapter staged (usage=0 no usage table; prices from `PLAN_PRICES_JSON`). Admin-web Dashboard screen is wired.
  *Remaining:* run its Kysely adapter vs Postgres; System-Health metrics still need a real infra source.
- **Customer app backend** — route contract DONE: `@Controller('customer')` (home/appointments/service-progress/
  receipts/loyalty + PATCH profile), pure core + `CustomerService` (resolution/validation) verified (16 tests). It is
  bound to the in-memory port (returns no data). **Prerequisite before the Kysely adapter can be written:** decide
  customer↔user identity resolution — `customers` has NO `user_id` column, so linking a logged-in CUSTOMER session to a
  customers row currently has no FK. Recommended: add `customers.user_id` (or an explicit link table) rather than match
  on email/phone (a guessed match is a security risk for customer data). Once decided: write the Kysely
  `CustomerDataPort` (homeRaw/appointments/receipts/loyaltyPoints/activeService/updateProfile + `getLoyaltyConfig` from
  `LOYALTY_TIERS_JSON`), bind it when a DB handle exists, then wire the customer-facing screens.
- **Run the Kysely adapters against real Postgres** — all adapters (auth + the POS features) type-check but have not been
  executed against a live DB in this sandbox.

## 9. What is already done & verified (for reference)
- POS web app: 15/15 screens converted; full service lifecycle + checkout (tip/pay/receipt/display) + admin edits
  (services create/edit, customers edit + duplicate-merge, technicians edit, settings tax + payments&tips).
- Super-Admin web app: Tenants console (read / suspend / reactivate / reset-owner-password / create) + login.
- Technician web app (apps/tech-web): tenant login + MFA + branch picker; dashboard (overview, current-service live
  timer, Accept/Start/Done/Break, next appointment, earnings) wired to /tech. Populates once the tech Kysely adapter runs on PG.
- Customer web app (apps/customer-web): tenant login + MFA + branch picker; Home (loyalty, in-progress service,
  next appointment), Appointments, Receipts, Profile — wired to /customer. Renders empty until the customers.user_id
  decision + customer Kysely adapter land.
- POS staff login + Super-Admin login wired to the real `/auth/login`.
- Auth backend: password hash/verify, users repository (in-memory + Kysely), login orchestrator, session token
  issue/verify + request extraction, `@Controller('auth')` (login/logout/me), all type-checked; **auth unit tests pass**.
- Tech backend: pure dashboard core + `TechService` authorization/guards (**verified**); `@Controller('tech')` wired;
  Kysely data adapter **staged** (type-checked, needs live validation per §8).

## Postgres validation (done 2026-06)
The data layer has now been run against a real Postgres 16 (no longer "staged only"):
- All 30 migrations apply cleanly → 82 tables. (Fixes made: orphaned `queue_items` indexes removed; cross-bundle
  indexes relocated to `029_deferred_indexes.sql`; `tickets.ticket_number`/`station_label` added; `025` ALTER retargeted
  from the non-existent `pos_tickets` to `tickets`.)
- `npm run seed` inserts the SUPER_ADMIN + pilot tenant/branch/OWNER + active subscription.
- `npm run build` (0 errors) and `node dist/main.js` boot NestJS on Postgres with every route mapped.
- 18 representative Kysely adapters pass a direct smoke test: `REPO_DRIVER=postgres DATABASE_URL=… npx tsx scripts/db-smoke.ts`.
Still open: the Customer Kysely adapter (after the `customers.user_id` link), real MFA/TOTP, password-reset route
mounting, System Health source, and applying tenant middleware + permission guard globally.

## Password-reset endpoints (done 2026-06)
Mounted `POST /auth/password-reset/{request,temp-login,complete}` (tenant flow) via PasswordResetModule, backed by
Postgres Kysely ports + scrypt + HMAC sessions; SMS via Twilio (`TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM`) or a mock.
Validated end-to-end on live PG (`npx tsx scripts/password-reset-smoke.ts`, 8/8). Migration `031` adds the token fields.
Still unmounted: the admin/super-admin reset endpoints (SystemPasswordResetService).

## Admin/super-admin reset endpoints (done 2026-06)
Mounted via SystemResetModule: `POST /auth/super-admin/forgot-password`, `POST /auth/admin/reset-user-password`
(authenticated actor; permission + reason; super-admin needs `x-mfa-verified`), `POST /auth/temp-password-login`,
`POST /auth/change-temporary-password`. Backed by Postgres Kysely ports + scrypt + HMAC sessions; Email via SendGrid
(`SENDGRID_API_KEY/SENDGRID_FROM`) or mock, SMS via Twilio or mock. Migration `032` adds the temp-password fields on
`users`. Validated end-to-end on live PG (`npx tsx scripts/system-reset-smoke.ts`, 9/9).
Remaining: real MFA/TOTP; System Health metrics source; global tenant middleware + permission guard.

## Global tenant middleware + permission guard (done 2026-06)
`AppModule` applies `TenantContextMiddleware` to all routes except the public pre-session endpoints (login/logout, the
password-reset entry points, forgot-password, temp-password login + change, admin reset). `RolePermissionGuard` is a
global `APP_GUARD` (enforces `@RequirePermission`); `SuperAdminGuard` now also guards `/super-admin/dashboard`. Verified
over HTTP on live PG: no-session data routes → 401; super-admin → 200 on `/super-admin/dashboard` and 403 on `/tech`;
`/auth/me` returns the ctx with a valid cookie, 401 without. Requires `AUTH_SESSION_SECRET` (login signs / middleware
verifies with the same secret). Remaining: real MFA/TOTP; System Health metrics source.

## Real MFA/TOTP (done 2026-06)
RFC 6238 TOTP (`src/auth/totp.ts`) + AES-256-GCM secret encryption (`mfa-enc.ts`, key from `MFA_ENC_KEY` or scrypt of
`AUTH_SESSION_SECRET`). The Kysely auth repo decrypts the user's confirmed TOTP secret onto the login record; the login
flow requires a real code once a factor is confirmed, with a format-gate fallback only before enrollment (bootstrap).
Enroll via `POST /auth/mfa/enroll` → add the returned secret/otpauth URI to an authenticator → `POST /auth/mfa/confirm`
with a code (sets `users.mfa_enabled`); `GET /auth/mfa/status`. Verified on live PG (`scripts/mfa-smoke.ts`, 7/7) and
over HTTP. **Set a stable `MFA_ENC_KEY` in production** (else secrets are tied to `AUTH_SESSION_SECRET`). Remaining
integration item: System-Health metrics source.

## System Health metrics source (done 2026-06 — final integration item)
`GET /super-admin/system-health` (SUPER_ADMIN-guarded) → `{ ok, generatedAt, process{uptimeSeconds,node,pid,memoryRssMb,
memoryHeapUsedMb,env}, database{driver,ok,latencyMs,serverVersion,tableCount,counts{tenants,users,activeSubscriptions}}}`.
`ok` = DB reachable. Code in `src/super-admin-health/` (port-first; Kysely probe vs in-memory fallback). Admin-web screen
`SystemHealthScreen.tsx` renders it (banner + cards + refresh). Verified on live PG over HTTP (no session → 401; authed →
live metrics: latency ~2ms, PostgreSQL 16.14, 82 tables). **All integration items are now complete.**

## E2E money-path smoke (e2e-flow.mjs)
Boot the API against live Postgres, then run the cookie-aware chain:
```
export PGPASSWORD=aps REPO_DRIVER=postgres DATABASE_URL="postgres://aps:aps@127.0.0.1:5432/aps" AUTH_SESSION_SECRET="dev-secret" PORT=3000
# seed (idempotent) creates SUPER_ADMIN + tenant PALACE + OWNER owner@palace.test / Owner!2345
node dist/main.js & P=$!; sleep 6; node apps/api/scripts/e2e-flow.mjs; kill $P; pkill -9 node
```
Currently reaches 6/13 (through move-to-queue). The remaining steps require the lifecycle-materialization work (see
MERGE_REPORT -83): `moveToQueue` must insert `pos_queue_items`, and start-service must create the central `tickets` row
that serving/service-done/checkout read. Use the seeded OWNER (not super-admin) — `hasPermission` grants OWNER all tenant
permissions; SUPER_ADMIN is denied tenant perms by design.

## E2E money-path smoke — now 14/14 GREEN (-84)
The lifecycle is materialized end-to-end on Postgres. `apps/api/scripts/e2e-flow.mjs` drives the full chain and passes
14/14: login → category → service → technician → walk-in → move-to-queue → assign-technician (managerOverride) →
start-service → mark-service-done → send-to-service-done → quality-check (approved) → send-to-checkout → apply-tip →
pay/cash (approved). Run exactly as in the section above. Notes: the tech adapter has no skill groups yet so assign uses a
manager override; quality-check approval is required because `requireQualityCheckBeforeCheckout` defaults true.

## Non-owner RBAC verification (-85)
Staff roles now operate the POS via a capability resolver (granular `pos.*` checks → coarse catalog capabilities).
1. Seed a FRONT_DESK user (after the main seed): with the live-PG env set,
   `npx tsx scripts/seed-frontdesk.ts` → creates `frontdesk@palace.test` / `Front!2345` (role FRONT_DESK) in PALACE.
2. Boot the API (same env as the money-path section), then run `node scripts/e2e-rbac.mjs`:
   the OWNER creates a category/service/technician, then the FRONT_DESK user runs walk-in → … → pay/cash (14/14) and is
   correctly **denied** create-service (403). Login body for staff is identical to the owner's, with the staff identifier.
Note: the harness `scripts/run-core-specs.sh` now exits non-zero if *either* the `*-core.spec.ts` suites or vitest fail,
and prints `RESULT: PASS|FAIL`.

## Sandbox payments (-86)
The non-cash payment paths are verifiable end-to-end in an explicit test mode. **The default is unchanged**: without the
flag, card/split return `{configured:false}` ("Card processor is not configured yet.") and nothing is ever faked.
1. Boot the API with `PAYMENTS_SANDBOX=1` added to the live-PG env (everything else as in the money-path section).
2. Run `node scripts/e2e-payments.mjs`: owner setup, then CARD pay (approved with a `sbx_` txn), REFUND, VOID, and a
   card+cash SPLIT (→ `paid`). Expect 7/7.
Production note: leave `PAYMENTS_SANDBOX` unset until a real Fiserv/CardPointe client is wired. Every sandbox transaction id
is prefixed `sbx_` so simulated payments can never be confused with real charges. Gift-card has no schema yet (out of scope).

## Deployment
See **DEPLOY.md** (repo root) for the AWS App Runner + RDS PostgreSQL + S3/CloudFront deployment runbook, the container `Dockerfile`, the `migrate.mjs` migration runner, and `.env.example`.
