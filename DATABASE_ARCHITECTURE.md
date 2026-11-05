# DATABASE_ARCHITECTURE.md
### PostgreSQL schema, identity model, migrations, and the conventions the tests enforce
Measured from the repo (Jul 30 2026, commit-current): **618 tables · 1,825 indexes (incl. constraint-backed) · 432 migrations · 618 typed
table interfaces — table count matches the type interfaces exactly** in `apps/api/src/database/kysely.types.ts`, kept honest by the `check:types-drift` gate.

Generated companions (regenerate, never hand-edit): **DB_ERD_AND_DOMAINS.md** (ERD + domain map + full
table inventory) · **DB_INDEX_AUDIT.md** (index redundancy) · **DB_TRANSACTIONS_AND_CONCURRENCY.md** ·
**DB_PARTITIONING_READINESS.md** · **DB_ENTERPRISE_VERIFICATION_REPORT.md** (§25 verification).

## 1. One database, tenant-scoped rows
Single Postgres 16 database. Multi-tenancy is **row-level**: tenant-owned tables carry `tenant_id` (and usually
`branch_id`), every tenant-scoped query filters on it, and the value comes from the SERVER session — never the
client. The `check:tenant` gate scans queries for missing tenant predicates; its baseline file lists the only
allowed exceptions (reviewed super-admin cross-tenant aggregations), each with a written justification.

## 2. The identity model — the one thing to understand before touching customer or technician tables
- **`users`** — global login identities (email, role, MFA linkage). A user may exist with no tenant (customer
  accounts) or belong to a tenant (staff).
- **`customers`** — per-tenant customer rows (a salon's client list). A customer row MAY link to a global
  account via `customers.user_id`. The same human at two salons = two `customers` rows, one `users` row.
  The nightly **customer identity sync** (7 PM worker) reconciles duplicates and files conflicts for HUMAN
  review — it never auto-merges across tenants (no cross-tenant copying, by rule).
- **`technicians`** — per-tenant staff rows, linked to `users` via `technicians.user_id`; the cross-salon public
  identity lives in **`global_tech_profiles`** (social profile, certs, reviews), keyed to the user not the tenant.
- **There is no `appointments` table.** The booking table is **`pos_tech_appointments`** — grep before assuming.

## 3. Domain families (where to look, not an enumeration)
Auth & access (`users`, `sessions`, `mfa_factors`, webauthn credentials, `audit_logs`) · Tenancy (`tenants`,
`branches`, `tenant_subscriptions`, applications/onboarding) · POS operations (`pos_queue_items`, serving,
`tickets` + lines, `pos_tech_appointments`, check-in devices) · Money (`payments`, refunds, `settlements`,
`chargebacks`, cash drawer, tips, surcharges — ALL integer cents) · Compensation (commission ledgers, payroll
periods, earnings rules, helper/tip splits) · Catalog (services, products, inventory) · Customers (customers,
loyalty, memberships, wallet, gift cards) · Communications (SMS ledger + packages under `sms_*` /
`tenant_sms_subscriptions`, A2P registration, push `device_push_tokens`, reminders) · Marketplace (deals,
bookings, reviews, tech social) · Platform (`platform_settings`, AI config/usage, billing invoices, security
audit findings, revenue residuals). To find any table's origin: `grep -rn "CREATE TABLE.*<name>" apps/api/db/migrations/`.

## 4. Migrations — the only way schema changes
- Location: `apps/api/db/migrations/NNN_name.sql` (currently 001–432). **Nothing else creates schema.**
- Apply: `npm run db:migrate` (`apps/api/scripts/migrate.mjs`) — ordered, tracked, idempotent per file.
- Verify: `node apps/api/scripts/verify-migrations-pglite.mjs` boots REAL Postgres semantics (PGlite/PG16) and
  applies all 432 in order — run it after writing any migration. It is also part of CI.
- Rule: **grep the migrations before adding a table** — with 618 tables, what you need likely exists.
- Extensions in use include `btree_gist` (exclusion constraints).

## 5. Conventions the schema itself enforces
- **Integer cents** for money columns (`*_cents`); provider costs use integer micros (10,000 micros = 1¢).
- **Partial unique indexes as policy**, not just dedupe — two load-bearing examples:
  `sms_usage_records` unique on provider SID *where SID is not null* (Twilio retries collapse to one billable
  row via ON CONFLICT), and reconciliation findings unique per (tenant, cycle, type) *while open* (re-runs
  can't stack duplicate open findings, but a resolved finding can recur).
- **`audit_logs`** is the uniform audit sink: `(tenant_id, user_id, role, action_type, entity_type, entity_id,
  ip, metadata_json)` — sensitive admin/system actions write before/after snapshots into `metadata_json`.
- **Timestamps** `timestamptz`; soft delete via `deleted_at` where used. PGlite returns DATE columns as JS
  `Date` objects — compare via `toISOString()` in tests.

## 6. Typed access
Kysely 0.27 with hand-maintained `kysely.types.ts` (618 interfaces). If you change schema, update the types —
`check:types-drift` introspects the migrated schema and fails on any interface↔schema mismatch;
`scripts/patch-kysely-types.py` helps remediate.

## 7. Seed data
`npm run db:seed` creates the dev tenant `PILOT01` with working logins (see LOCAL_DEVELOPMENT.md §5). Demo-scale
data: `npm run db:seed:demo`.
