# Constitution 1 — Database (112 §) vs the tree (Oct 6 2026, 7301539f)

Verdict: **PARTIAL, about 60%** — §111: 15 done, 23 partial, 4 missing, 2 waiting on Kevin. Everything that Constitutions
5, 8, 11, 12 and 13 rebuilt is real (idempotency, outbox, consumer dedup, race tests, tenant-consistency triggers, append-only
audit, customer RLS, backup reports, replica routing). Finishing this is a reconciliation, not a fresh build.

Measured on the local Postgres 16 (all 512 migration files applied; ledger matches the files): **672 tables; 507 with
`tenant_id` (81 nullable); 252 foreign keys covering 253 of 1,740 UUID `*_id` columns (15%); 43 tenant tables with a FK to
`tenants`; 83 tenant tables with no tenant-leading index (80 with no index containing `tenant_id`, 18 with only a PK);
1,981 indexes; 635 CHECKs (6 end-after-start); 110 of 286 `status` columns without a CHECK; 92 of 240 non-PK unique indexes
on tenant tables omit `tenant_id`; 603 UUID PKs; 14 `tenant_id` + 3 `branch_id` columns typed text; 301 integer-cents money
columns, no float money; 1,578 timestamptz, 0 naive timestamps; 50 `version` + 2 `record_version` columns; `expectedVersion`
in 47 files; ~236 transactions, 30 `FOR UPDATE`, 25 advisory locks, 11 `SKIP LOCKED`; 31 real-Postgres race test files.**

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Ownership | every table classified (§3, Phase 2) | MISSING | no registry; `DB_ERD_AND_DOMAINS.md` stale (618 tables, Jul 30) |
| Ownership | tenant from session, tenant-aware repos (§4–6) | EQUIVALENT, partial | `packages/tenant-context` `contextFromSession`; `scoped()` (`apps/api/src/common/tenant-scope.kysely.ts`, ~500 uses / 45 files); gates allow 78 reviewed raw-SQL + 42 PK reads + 164 builder statements (`apps/api/scripts/tenant-builder-baseline.json`) |
| Ownership | RLS (§6) | PARTIAL | only `customers` (458, forced) behind `DB_TENANT_RLS` (off); policy lets every row through when no tenant is set; setting is per connection (breaks behind PgBouncer transaction mode); compares `tenant_id::text` (no index) |
| Ownership | memberships (§10) | PARTIAL | one tenant per `users` row; `tenants.owner_user_id`, `user_branch_access`, `tech_salon_memberships`; no `tenant_memberships` |
| Ownership | identity separate (§9, §11) | PARTIAL | two customer roots `customer_identities` (366, sign-in) and `global_customers` (421); no bridge |
| Keys | UUID keys (§35) | DONE | 603 `gen_random_uuid()`; 5 text + 3 integer PKs |
| Keys | ID types match (§36) | PARTIAL | 36 internal ID columns are text (`pos_*`, `user_*_prefs`, `commission_change_audit_logs`, `pos_tech_appointments.overbook_by_user_id`) |
| Integrity | core FKs (§40) | MISSING | none on `payments.ticket_id`, `payment_refunds.payment_id`, `tickets.customer_id`, `ticket_service_lines.ticket_id`, `customers.tenant_id` |
| Integrity | composite tenant integrity (§41) | EQUIVALENT, partial | 450: 18 tenant-consistency triggers on 10 tables; 12 composite FKs (509–516 + `pos_stations`); `branches (tenant_id, id)` unique |
| Integrity | tenant-scoped uniques (§42) | PARTIAL | `users` has NO unique email or phone; `customer_loyalty_profiles` no unique (tenant, customer) |
| Integrity | data-quality CHECKs (§88) | PARTIAL | `booking_holds` none; `pos_tech_appointments` no end>start / time format; `inventory_location_stock` no `quantity >= 0` |
| Integrity | no double booking (§81) | DONE | EXCLUDE on `booking_holds` (372), `pos_tech_appointments` (426/482) |
| Indexes | tenant-leading (§43) | PARTIAL | 83 tables (e.g. `tenant_subscriptions`, `customer_preferences`, `customer_allergies`, `technician_status_events`, `deal_redemptions`, `sessions`) |
| Indexes | partial / search (§44, §77) | DONE | trigram on customer name/phone/email (107) |
| Indexes | EXPLAIN heavy queries (§45) | PARTIAL | `SCALING_PHASE1_3_*` (Jul 3, 426-table schema); payments, Super Admin tenant list, AI usage never profiled |
| Migrations | version-controlled (§68) | DONE | 512 files = 512 ledger rows (gaps 374, 504, 506–508 harmless) |
| Migrations | safe large changes (§69–71) | PARTIAL | `migrate.mjs` runs at every API start, one tx per file, no lock vs concurrent runners, no lock_timeout, no `CONCURRENTLY` path; `preflight.mjs` checks env only; 451's cleanup (drop plaintext columns) never shipped |
| Concurrency | version columns (§38) | PARTIAL | missing on `pos_queue_items`, `inventory_location_stock`, `technician_schedules` |
| Concurrency | idempotency (§39) | DONE | `api_idempotency` (502), `@Idempotent` on 12 money routes, 41 unique idempotency indexes |
| Concurrency | transactions / locks (§49–51, §82–84) | DONE | race lane in CI (`run-race-tests.mjs`) |
| Concurrency | pooling / priority (§60–61) | PARTIAL | `PG_POOL_MAX` default 10 (`kysely.provider.ts`); no PgBouncer; workers share the limit; no `statement_timeout` / `idle_in_transaction_session_timeout`; one DB role |
| Concurrency | read replicas (§93) | DONE in code | `DATABASE_READ` / `DATABASE_REPLICA_URL` |
| Outbox | outbox + consumer dedup (§52–53) | DONE (C8) | 433, `processed_events`, 434 dead letters |
| Outbox | webhook replay | PARTIAL | `payment_gateway_events` has no unique on `event_id`; `sms_delivery_logs.provider_sid` not unique |
| Audit | audit records (§32–33) | PARTIAL | append-only triggers (452, 449), legal holds; two audit tables live (`audit_logs` 126 files, `audit_events` 44); `audit_events` lacks before/after/reason/request/correlation/session |
| Audit | created_by / updated_by (§34, §37) | PARTIAL | 122 / 44 columns; actor-stamp plugin + gate absent; `pos_tech_appointments`, `pos_queue_items` no creator |
| Audit | status history (§54) | PARTIAL | `appointment_change_log` (483), `ticket_revisions`; none for tenant or queue |
| Audit | support sessions (§64) | DONE, duplicated | `support_access_sessions` + `super_admin_support_sessions` + `membership_support_sessions` |
| Retention | classes (§57) | PARTIAL | `data_retention_rules` (269) dry-run only; piecemeal sweeps; no central executor |
| Retention | soft/hard-delete policy (§55–56) | MISSING | `deleted_at` on 8 tables, `archived_at` on 10, `deleted_by` on none; no policy doc |
| Backups | §90–92 | PARTIAL; rest Kevin | `SECURITY_DR.md`, `backup_reports` (447), `restore-verify.ts`; no PITR / off-primary / drill |
| Monitoring | §94–98 Database page | PARTIAL | slow queries >250 ms logged by shape; pool utilisation in health; nothing reads `pg_stat_statements`/locks/vacuum/bloat/growth; migration version not shown |
| Monitoring | summary tables (§62–63) | PARTIAL + bug | `tenant_daily_*` read by Super Admin Overview and AI reports; nothing writes them |
| Growth | partitioning / sharding (§46–48, §103) | DONE as documentation | `DB_PARTITIONING_READINESS.md`, `SCALING_PHASE1_3_GROWTH_TABLES.md` |
| Money/time | money (§20) | DONE | `check:money` gate; currency column on 27 tables |
| Money/time | timezone-safe (§15) | PARTIAL | appointments = date + text "HH:MM"; `technician_schedules` time without zone; blocked times text; normaliser + CHECK absent |
| Money/time | appointment model / snapshots (§13–14, §19, §25) | PARTIAL | services as JSON array (no `appointment_services`); price snapshots on `ticket_service_lines` + `deal_version` DONE |
| Money/time | settlement traceability (§24) | PARTIAL | nothing links a payment to its settlement batch |
| Tests | §100 / §101 | DONE / PARTIAL | migrations only tested on a fresh DB; load p95 1,585 ms at 50 clients (sandbox) |

## §111 Definition of Done
DONE (15): 11 money; 14 idempotency; 15 transactions; 16 outbox; 17 dedup; 26 migrations; 33 partitioning doc; 34 sharding
path; 35 Super Admin via platform APIs; 37 cross-tenant tests; 38 concurrency tests; 40–42 build/types/lint; 44 no known leak.
PARTIAL (23): 1, 3, 4, 5, 6, 9, 10, 12, 13, 18, 19 (phone plaintext — Kevin), 20 (`bank_webhook_endpoints.token`/
`signing_secret` plaintext), 21, 22, 25, 27, 28, 29, 30, 31, 36, 39, 43 (451 cleanup).
MISSING (4): 2 classification; 7 duplicate tables merged; 8 core FKs; 32 soft-delete policy. KEVIN (2): 23 backup, 24 PITR.

## Duplicates
Audit (`audit_logs` / `audit_events`); support sessions ×3; customer identity ×2 roots; loyalty ×3 (`loyalty_ledger` 474,
`loyalty_point_earnings` 435, `customer_loyalty_profiles.points_balance`); idempotency ×3 (`api_idempotency`,
`ai_checkout_upsell_idempotency`, `voice_gateway_idempotency`); unused `pos_tech_appointments_audit`, `pos_queue_audit`,
`pos_tech_queue_audit`, `pos_service_done_audit`.

## Bugs
1. **CONFIRMED — the tenant-consistency trigger (450) scans the whole parent table on every insert**: `WHERE id::text = $1`
   defeats the PK index (EXPLAIN confirmed a full scan). Every insert into tickets, payments, appointments, queue items or
   payment intents reads all of `customers` / `tickets` / `technicians` / `branches` / `payments`. Fix `WHERE id = $1::uuid`.
2. **CONFIRMED — Super Admin figures read tables nothing writes** (`tenant_daily_sales/booking/customer_summary`, 007;
   `overview.kysely.repository.ts:70-80`); other daily summary tables lack a unique (tenant, date).
3. **CONFIRMED — `PATCH /customers/:id/loyalty` (`setLoyalty`, `customers.kysely.repository.ts:520-562`) overwrites balances
   outside the ledger, no lock; the loyalty consumer (`events/consumers/loyalty-points.consumer.ts`) writes the profile but never `loyalty_ledger`.
4. PLAUSIBLE — duplicate loyalty profiles (SELECT … FOR UPDATE locks nothing when no row exists; no unique).
5. PLAUSIBLE — owner sign-in `where role='OWNER' and lower(email)=… limit 1` with no unique email (`auth-user.kysely.repository.ts:60-80,228-240`).
6. CONFIRMED — `bank_webhook_endpoints.token` plaintext beside its hash (451 cleanup never shipped).
7. Risk — 43 FKs cascade from `tenants` into money records (chargebacks, `overage_charges`, `ai_billing_events`, `sms_usage_records`).
8. Risk — text appointment times: validators disagree ("9:30" vs "09:30"); text sorts mis-order; EXCLUDE throws a raw cast error.
9. Performance — RLS policy compares `tenant_id::text`; write `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`.

## Build order (code) / needs Kevin
Code: (1) regenerate DB docs + machine-readable ownership registry for 672 tables + gate; (2) harden `migrate.mjs` (advisory
lock, per-file lock_timeout, out-of-transaction marker for CONCURRENTLY, DB pre-flight, batched resumable backfill helper);
(3) 450 trigger fix; (4) tenant-leading indexes for the 83 tables; (5) constraints after pre-flight (core FKs NOT VALID →
VALIDATE; `users` (tenant, lower email) + (tenant, phone); `customer_loyalty_profiles` (tenant, customer); unique event id on
`payment_gateway_events`; unique provider sid on `sms_delivery_logs`; CHECKs for end>start, HH:MM, quantity ≥ 0, the 110
status columns; extend consistency triggers to ticket lines, refunds, gift-card tx, loyalty, deal redemptions); (6) version
columns on queue/stock/schedules, actor-stamp plugin + gate, `updated_by`; (7) merge duplicates expand-then-contract; loyalty
ledger as source of truth; write or repoint the summary tables; (8) central retention executor + soft-delete policy +
`deleted_by`; (9) statement/idle timeouts per role, separate worker pool, RLS setting per transaction before PgBouncer; (10)
Super Admin Database page; (11) EXPLAIN on the 672-table schema; (12) extend RLS after the staging trial, refuse rows with no tenant.
Kevin: phone encryption decision; cross-salon staff decision; which identity root wins; `DB_TENANT_RLS=1` staging trial;
PgBouncer + replica; PITR + off-primary backups + restore drill; pre-flights/backfills on production data; partitioning
(row counts); load on target infrastructure.
