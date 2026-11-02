# DATABASE_STATUS.md — measured on fresh databases (Oct 27 2026 on top; Oct 26, Oct 22 and Oct 20 below) (mandate §240 / 130-section §121)

## Oct 27 2026 — migrations 693 → 702 (final pass)

There are **642** migration files (`001` … `702`, with reviewed gaps). Measured on `fr_migrate`, created empty and migrated by
`tooling/ci/final-run.sh` (run #2 of the final pass, HEAD `3c5ae402`): **642 applied, 0 already present**; **773** base tables,
**2,466** indexes, **206** non-internal triggers in `public`. The same 642 ran on every fresh database of the final pass
(the injection-pass database, the race / harness / live / pilot databases of `final-run.sh`, each live proof's own database).
No production database exists.

All ten are expand-only and idempotent (`check:migration-safety` green); none rewrites, deletes or back-fills financial rows.
`kysely.types.ts` follows (`check:types-drift`), the ownership registry follows (`check:db-ownership`; regenerated Oct 27 —
`payroll_payouts` is SECURITY_SECRET since 701 added the handoff-token hash).

| Migration | Tables / columns | Purpose | Backward compatible |
|---|---|---|---|
| `693_outbox_open_rows_index.sql` | partial index on `outbox_events` open rows (no-transaction, concurrent) | 200-tech §90: the publisher's claim reads only open rows | yes — index |
| `694_vi_search_fold.sql` | `vi_fold(text)` (IMMUTABLE) + trigram GIN indexes on `vi_fold(full_name)` (customers, technicians) and `vi_fold(name)` (services), built concurrently | Vietnamese WP-E: "nguyen" finds "Nguyễn"; stored names never changed | yes — index |
| `695_tenant_pos_language_authority.sql` | data: the salon-wide `tenant_settings` business-branch row carries `defaultLanguage` (copied from the newest branch row when missing) | Vietnamese WP-A: one source for a salon's default POS language | yes — data, only fills a missing value |
| `696_platform_notice_vietnamese.sql` | `platform_notices` + `title_vi`, `message_vi`, `vi_reviewed_by`, `vi_reviewed_at`, `english_only` (default false) + shape CHECK | Vietnamese WP-F: a reviewed Vietnamese version of an announcement | yes — nullable |
| `697_customer_language_normalize.sql` | data: `customers.preferred_language` normalised to 'en' / 'vi' / NULL (an unrecognised free-text value is kept in `notes_json.preferredLanguage`) | Vietnamese WP-I: messages in the customer's language | yes — NULL = English |
| `698_platform_device_approval.sql` | `auth_devices` + platform approval columns; new `platform_device_approvals` | Security S-A13: trusted device for Super Admin sign-in | yes — first device bootstraps |
| `699_platform_notice_plan_indexes.sql` | indexes on `platform_notices` / reads (no-transaction) | Announcement §98: reviewed against EXPLAIN plans | yes — index |
| `700_receipt_expense_ocr_close.sql` | `ocr_documents` page count / quality / extraction job / suggestion / retention columns (pages in the existing `ocr_document_pages`); `expenses` payment match; `expense_settings` switches + auto-approval rules | Receipt / Expense / OCR close-out (multi-page, retry ladder, suggestion, payment matching, retention) | yes — expand-only, defaults = today's behaviour |
| `701_payroll_paycheck_closeout.sql` | `payroll_periods` + `canceled_at` / `canceled_by` / `cancel_reason`; `payroll_statements` + itemised `refund_reversal_cents` / `tip_adjustment_cents` / `retail_reversal_cents`; `payroll_payouts` + `cash_handoff_token_hash` / `_expires_at`, `cash_ack_signature`, `cash_ack_confirmed_by`; unique schedule week | Weekly Paycheck close-out (frequencies, cancel, QR / signature / dual cash confirmation) | yes — expand-only |
| `702_schedule_explanation_language.sql` | `schedule_optimization_recommendations.explanation_language` | Vietnamese §120: the language a stored explanation was written in | yes — nullable |

## Oct 26 2026 — migrations 679 → 692

There are **632** migration files (`001` … `692`, with reviewed gaps).

Where they were executed:
- **through 690** — the Oct 24 200-tech pilot
- **through 691** — the Oct 24 M4 pilot (`docs/pilot-runs/2026-10-24-m4/`)
- **through 692** — the Oct 26 Secure Tap pilot (`docs/pilot-runs/2026-10-26-secure-tap/`)

Each pilot ran on a database migrated from empty with `apps/api/scripts/migrate.mjs`. None has run on a production database, because none exists.

Table / index / trigger counts were **not re-measured** for this hand-back; the Oct 22 figures below are at 678. Re-measure in the Oct 26 full regression (`TEST_REPORT.md`).

All 14 migrations are expand-only and idempotent. None rewrites, deletes or back-fills financial rows; 689 back-fills `family_id` with the rule that was already implicit. `kysely.types.ts` follows (`check:types-drift`).

| Migration | Tables / columns | Purpose | Backward compatible |
|---|---|---|---|
| `679_wallet_topup_intents.sql` | new `wallet_topup_intents` (status CREATED → PROCESSING → APPROVED / DECLINED / FAILED / UNKNOWN / CANCELED, `client_key`); unique (tenant, customer, client_key); open-intent index | B-79: a top-up is a durable intent before the charge; a lost answer is settled from the processor (`inquireByOrderid`, intent id = order id); a retry never charges twice | yes — new table |
| `680_payment_intents_recovery.sql` | `payment_intents` + `charge_started_at`, processor reference, settled-by, last inquiry | B-80: Skip-the-Line Verify + stranded sweep | yes — nullable, older rows NULL |
| `681_expense_shared_cost_policy.sql` | `shared_cost_policy` ('NONE' default / 'MANUAL_PERCENTAGE'), `shared_cost_shares` (basis points) | P2-3: split salon-wide costs across branches to the cent | yes — default = previous behaviour |
| `682_sms_pricing_tiers_guide.sql` | data: `sms_verification_packages` names / prices / limits | SMS Essential / Growth / Unlimited Team tiers; merged from the developer tree and renumbered from 664 | yes — data update only |
| `683_technician_clock_pin_lookup.sql` | `pin_lookup` (HMAC under `CLOCK_PIN_LOOKUP_KEY`), `pin_lookup_kid` + index | the kiosk narrows to the matching row instead of one scrypt per technician; scrypt still verifies (since Oct 26 at the PIN cost, M4-1 — code only, no migration) | yes — NULL rows scanned the old way and re-keyed on match |
| `684_tenant_messaging_number_owner_lock.sql` | trigger on `tenant_messaging_numbers` | security E1: a number never moves to another salon (inbound STOP routing / TCPA) | yes |
| `685_go_checkin_sessions_tenant_started.sql` | index | security E10: per-salon 15-minute kiosk caps as a range scan | yes |
| `686_security_event_mfa_replace_refused.sql` | `security_events.event_type` CHECK | security C1: `MFA_REPLACE_REFUSED` recordable | yes |
| `687_payment_device_identity.sql` | `mobile_pay_devices` + `public_key`, `key_alg` (ES256), `key_fingerprint` (unique), `attestation_status`, `paired_via`; new `mobile_pay_device_branches` (tenant-consistency trigger), `mobile_pay_device_nonces`, `payment_device_pairings` (hash only) | Secure Tap §3–§9: per-phone P-256 identity, branch authorization, single-use nonces and pairing codes | yes — existing devices keyless (policy `MOBILE_PAY_DEVICE_KEYS`) |
| `688_payment_device_shared.sql` | `mobile_pay_devices` shared flag | §14 / §77: one identity for a front-desk phone; payments attributed to the signed-in user | yes — default personal |
| `689_refresh_token_family.sql` | `refresh_tokens.family_id` (nullable, back-filled = session) | §2 / §69: reuse revokes the family → `TOKEN_REUSE_DETECTED` | yes — same rule as before |
| `690_checkout_lock_version.sql` | `checkout_locks.checkout_version` | §21 / §22: a stale phone claim → `CHECKOUT_STALE` | yes — NULL = nothing compared |
| `691_large_salon_lookup_indexes.sql` | six indexes `CONCURRENTLY` (no-transaction): `pos_queue_items` (tenant, appointment) / (tenant, technician, started_at) / (tenant, ticket); `pos_tech_queue_tickets` (tenant, appointment) / (tenant, ticket); `technician_blocked_times` (tenant, block_date) | M4: measured 5–18 ms → 0.01–0.34 ms on a 60-salon fixture (`PERFORMANCE_REPORT.md`) | yes — indexes only |
| `692_security_event_network_policy.sql` | `security_events.event_type` CHECK | Security §136 / §29: `NETWORK_POLICY_DENIED` recordable | yes |

Other Oct 26 DB-relevant changes without a migration:
- The outbox claim is serialized under `pg_advisory_xact_lock`. It uses `FOR UPDATE OF o SKIP LOCKED` with a `pending` re-check and a head-of-line rule per aggregate (`044a1878`).
- Recipe deduction locks stock rows in `product_id` order (`146a3f55`).
- Loyalty netting is ordered by `payments (created_at, id)`.
- The worker pool size is `PG_WORKER_POOL_MAX` (default 5 → consumer budget 3).

## Oct 22 2026 — measured on a database migrated from empty today (`px_pilot`, `migrate: complete — 618 applied, 0 already present`)

| Measure | Value |
|---|---|
| Migration files | **618** (`001` … `678`, reviewed gaps) |
| Tables (`public`) | **768** — `kysely.types.ts` has **768** interfaces (`check:types-drift` green) |
| Indexes | **2,433** · Foreign keys **372** · tables with `tenant_id` **580** |
| Row-level security enabled | **32** tables (policies apply only with `DB_TENANT_RLS=1`; the strict trial `live-rls-trial` passed 20/20 today) |
| User triggers | **201** · Functions **287** |

### Migrations added Oct 22 (all expand-only, idempotent, applied by `apps/api/scripts/migrate.mjs`; executed today on fresh `fr_*` / `lp_*` / `px_pilot` databases — never on a production database, none exists)

| Migration | Tables / columns | Purpose | Backward compatible |
|---|---|---|---|
| `675_loyalty_earning_basis.sql` | `loyalty_point_earnings` + `excluded_cents`, `reversed_points` (default 0) | D3: points on every paid tender, none for gift-card value, reversals never exceed what was earned | yes — existing rows read as before |
| `676_booking_drafts.sql` | `booking_holds` + `kind` ('slot' default / 'draft'), `draft_payload`, `notes`, `draft_title`; check constraint | B-22: POS "Save Draft" is a real draft, never an appointment | yes — every existing row is kind 'slot' |
| `677_export_bytes_to_object_storage.sql` | `super_admin_scheduled_report_runs.artifact_key`, `billing_export_jobs.content_key`, `revenue_export_jobs.content_key` | B-18: export files go to the private object store; the row keeps the key | yes — old base64 columns kept and still read |
| `678_notification_sender_route.sql` | `notifications` + `sender_route` (validated CHECK), `sender_from` | mandate §65: which sending path (salon's own Twilio account / platform account with the salon's number / platform default) and From carried each text | yes — older rows NULL (unknown, never guessed) |

No migration rewrites, deletes or back-fills financial rows. Fixes on Oct 22 that touch money read paths without a schema
change: pay-period overlap refusal (advisory lock, `payroll.kysely.repository.ts`), no tender while a card attempt is
unsettled (`checkout.service.ts`), salon-wide expense visibility (`expense.repository.ts` `scoped()`).


Every number below was read with `psql` from `fr_migrate`, the database `tooling/ci/final-run.sh` created empty and migrated in lane `migrations-fresh` (`final-run/02-migrations.log`: **605 applied, 0 already present**). Conventions, identity model and migration rules: `DATABASE_ARCHITECTURE.md`; ERD + table inventory: `DB_ERD_AND_DOMAINS.md` (generated).

## 1. Schema as of migration 665

| Measure | Value | How measured |
|---|---|---|
| Migrations in `apps/api/db/migrations` | **605** files, `001` … `665` (numbering has reviewed gaps; 664 + 665 added Oct 20) | `ls \| wc -l` |
| Tables (`public`) | **750** | `pg_tables` |
| Typed table interfaces (`packages/database/src/kysely.types.ts`) | **750** — matches exactly (`check:types-drift` gate) | `grep -c "^export interface"` |
| Indexes (incl. constraint-backed) | **2,369** | `pg_indexes` |
| Foreign keys | **323** | `information_schema.table_constraints` |
| Tables carrying `tenant_id` | **564** | `information_schema.columns` |
| Row-level security enabled | **11** tables: `api_operations`, `customer_loyalty_profiles`, `customers`, `loyalty_ledger`, `payment_refunds`, `payments`, `pos_queue_items`, `pos_tech_appointments`, `ticket_service_lines`, `tickets`, `users` (policies active only with `DB_TENANT_RLS=1` — Kevin switch, staging first) | `pg_class.relrowsecurity` |
| User triggers | **59** on 41 tables (same-tenant FK consistency on 33 (table, column) pairs, `updated_at`, outbox guards, merchant isolation) | `pg_trigger` / `information_schema.triggers` |
| Functions (`public`) | **286** | `pg_proc` |
| Materialized views | 0 (rollups are tables fed by the analytics consumer) | `pg_matviews` |

## 2. What changed on Oct 20 2026

| Migration | Tables | Why | Expand / contract |
|---|---|---|---|
| `664_payment_refunds_unknown_state.sql` | `payment_refunds` + `stranded_at`, `review_reason`, `last_error`, `request_detail JSONB`, `settled_at`, `settled_by`; partial index on `status = 'processing'` | refund lost-answer state (§228, B-03): a refund whose processor answer was lost stays `processing` until settled from the processor's record | expand only (nullable columns, additive index) |
| `665_pos_queue_items_check_in_idempotency_key.sql` | `pos_queue_items` + `check_in_idempotency_key`; `uq_pos_queue_checkin_key (tenant_id, branch_id, check_in_idempotency_key)` | walk-in check-in replay across API replicas (§33/§60, B-07) instead of a per-process Map | expand only |

Both are idempotent per file, applied in order by `apps/api/scripts/migrate.mjs`, and reflected in `kysely.types.ts` (types-drift gate green in lane `gates`).

## 3. Authority (one writer per concept) — verified for the money and scheduling tables

| Concept | Authoritative table | Writers (all inside the module) | State machine |
|---|---|---|---|
| Ticket | `tickets`, `ticket_service_lines` | `modules/checkout` (+ serving line edits via the checkout port) | `TICKET` |
| Payment | `payments`, `payment_attempts` | `modules/checkout` → `modules/payments` adapters | `PAYMENT` (`canMoveToSql`) |
| Refund | `payment_refunds` | `modules/checkout` only (`reserveRefundAtomic` → `finalizeRefund` / `markRefundUnknown` → `settleUnknownRefundAtomic`) | `PAYMENT_REFUND`: `processing → refunded \| failed \| (deleted on not_refunded settle)` |
| Gift card balance | `gift_cards` + `gift_card_transactions` ledger | `modules/checkout` gift-card service — balance and ledger in ONE transaction (B-02) | `GIFT_CARD` |
| Appointment | `pos_tech_appointments` | `modules/booking` (POS, customer, public, AI receptionist all go through `BookingService`) + `modules/appointments` tech-side status transitions | `APPOINTMENT` |
| Queue item / visit | `pos_queue_items` | `modules/queue` (check-in, queue, serving) | `QUEUE_ITEM` |
| Technician availability | `technician_schedules`, `technician_blocked_times`, approved `technician_time_off` | `modules/workforce`; read through the ONE schedule reader `blockedTimes` (B-06) | — |
| Compensation | `compensation_rules` + `ticket_compensation_snapshots` | `modules/workforce` compensation (ladder in `compensation-policy.ts`, B-04); snapshots immutable per ticket | — |
| Outbox | `outbox_events`, `processed_events`, `event_dead_letters` | `packages/events` writer in the business transaction; `outbox-publisher` dispatcher | lifecycle in `event-lifecycles.ts` |
| Jobs | `jobs` | `packages/database` job queue; worker claims with `FOR UPDATE SKIP LOCKED`; nothing claimed under `POST_RESTORE_HOLD` (B-10) | — |
| Idempotency | `api_idempotency` | `@Idempotent()` decorator (`@aipowersalon/database/nest`): key stored on success, dropped on failure — a lost refund answer is NOT a failure (held) | — |

## 4. Isolation, integrity, concurrency (what the run proved)

- Tenant predicate on every tenant-scoped query (`check:tenant`, `tenant-builder` gates — lane `gates`); cross-tenant probes in `live-route-sweep` (lane `live-route-sweep`); IDOR sweep `idor-routes.mjs`.
- Same-tenant DB triggers on **every** single-column tenant→tenant foreign key (migration 666, B-12 — 144 `trg_tc_*` triggers on a fresh database, enumerated from the catalog; `tenant-consistency.pgtest` fails the battery if a later FK arrives without one). Excluded by design: the Tenant Safety Community (`community_*`), where a salon replies in another salon's thread — the test pins exactly those two pairs.
- Real-Postgres race lane (lane `race-lane`, fresh `fr_race`): refund reserve/settle, gift-card activation, booking time-off, walk-in replica retry, check-in idempotency, payment claim, queue assignment, outbox — exact counts in TEST_REPORT.md.
- Money: integer cents everywhere (`check:money`), no float columns on money tables.
- Backups / PITR / restore: `DISASTER_RECOVERY.md`; drill in lane `drill-restore` (restore to a scratch DB, hold check, reconciliation checklist §3.1). A restore on the real host = HOSTING A3 (Kevin).

## 5. Open database debt (from BUG_REGISTER.md)

| ID | Item |
|---|---|
| ~~B-12~~ | fixed `ce2fa5f5` — migration 666 |
| ~~B-15~~ | fixed `e7463677` — `check:migration-safety` in `ci:gates` (24 pre-gate statements reviewed in `apps/api/db/migration-safety.allowlist.json`; no pre-flight archive is owed for 541/542 because no production database has ever existed) |
| ~~B-17~~ | fixed `602fad5d` — migration 667 (`inventory_units.sold_ticket_id` / `sold_line_id`), retail sales reversible unit by unit |
| B-18 | avatars / export bytes still in Postgres rows → media store |
| K-13 | hosted encrypted backups + KMS, real restore test |
