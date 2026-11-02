# Data Retention and Deletion Policy

Constitution 1 §55 (soft delete), §56 (hard delete), §57 (retention architecture). Written Oct 8 2026 (BUILD_PLAN Phase 10).

**The machine-readable source is [`apps/api/db/retention-policy.json`](../apps/api/db/retention-policy.json).** This
document explains it; when the two disagree, the JSON is what runs. Three things read the JSON:

1. the **central retention executor** — `modules/super-admin/src/super-admin-security/retention-executor.*`, the daily
   `retention.execute` job;
2. the **ownership registry** (`apps/api/scripts/db-ownership.mjs`) — `retention_class` + `delete_policy` per table
   (a table not listed is `indefinite` / `none`);
3. the executor's pgtest, which proves every entry the executor owns names a live table and column.

## Retention classes

| class | meaning | default |
|---|---|---|
| `temporary` | one-time codes, challenges, short-lived tokens and holds — worthless once expired | `hard_delete_after_days` |
| `operational` | queues, jobs, sessions, telemetry rollups — kept while useful for operations | `hard_delete_after_days` |
| `customer_history` | the salon's customer records and what they configured — soft-deleted, never silently purged | `soft_delete` |
| `financial` | money movement and its evidence — corrected by reversal records, never deleted | `never` |
| `security` | sign-in attempts and session history — kept for the investigation window, then deleted | `hard_delete_after_days` |
| `audit` | who did what — append-only, never deleted (audit legal holds overlay it) | `never` |
| `ai` | AI usage, prompts and outputs — usage feeds billing (never); content follows the tenant's AI settings | `never` |
| `communication` | SMS / email delivery logs — consent and delivery evidence | `hard_delete_after_days` |

## Delete policies

- **`never`** — financial and audit history. Corrections are reversal / refund / adjustment records, never deletes
  (§55: "Do not soft-delete immutable financial/audit records in a way that hides history"). The executor refuses a
  `financial` or `audit` class entry even if the file is edited to say otherwise, and it refuses to purge `audit_events`
  even when a Super Admin retention rule exists for that data class (the rule's dry-run preview still works).
- **`soft_delete`** — configurable and customer-facing records (§55): `deleted_at` + `deleted_by` (migration 543 added
  `deleted_by` beside every `deleted_at`; the Kysely actor-stamp plugin fills it whenever a query-builder update sets
  `deleted_at`, and clears it on restore). Nothing purges soft-deleted rows automatically: anonymising soft-deleted
  customers after N days is a privacy decision for Kevin (it interacts with legal holds, disputes and tax records).
- **`hard_delete_after_days`** — temporary and operational data (§56): one-time codes, challenges, expired tokens and
  holds, finished jobs, old sign-in attempts. Deleted `days` after `timestamp_column`.
- **`anonymize_after_days`** — the row is kept (counts and history stay true) but its personal columns are cleared:
  NULL where allowed, `'[removed]'` for NOT NULL text, an empty array/object for NOT NULL json.

## The central executor

- Runs daily (hourly tick through `runTick`, fires once per UTC day, single owner across the fleet), only in a process
  allowed to run `standard` jobs. `RETENTION_EXECUTOR=off` stops it; `=dry_run` computes and logs counts, writing nothing.
  Never under `NODE_ENV=test`.
- Per table: `eligible` = rows at or before the cutoff (plus the entry's status filter / not-referenced guard);
  `held` = eligible rows under an **active legal hold** — `customer_legal_holds` (tenant / branch / customer scope) for any
  table with `tenant_id`, `audit_legal_holds` (global / tenant / user / date range) for `security` tables; the rest are
  deleted (or anonymised) **1,000 rows per transaction**, at most 200 batches per table per run (the next run continues).
- Every executed table run writes one `data_retention_purge_runs` row: table, action, cutoff, eligible, held, processed,
  batches, duration, trigger (`job` / `manual`), actor, error — counts only, never row contents. A **dry run writes
  nothing at all**.
- A Super Admin retention rule (`data_retention_rules`, versioned, compliance floors) for the table's data class
  replaces the policy's days when it asks for the same action.
- Identifiers come from the reviewed JSON and are checked against the live catalog before use; values are bound
  parameters. An entry that is invalid, or names a table/column that does not exist, is skipped and reported.
- Runs on the worker pool (`DATABASE_WORKER`) when there is one. `RetentionExecutorService` is exported from
  `@aipowersalon/super-admin` (`plan()`, `run({ dryRun, trigger, actorUserId, tables })`, `recentRuns()`).

### Tables the executor deletes / anonymises

| table | class | policy | after | measured from | legal basis |
|---|---|---|---|---|---|
| `booking_holds` | temporary | hard_delete_after_days | 30 d | `expires_at` | Constitution 1 §56: expired booking holds after the retention period (a hold a verification session still names is kept until that session is swept) |
| `customer_phone_verifications` | temporary | hard_delete_after_days | 30 d | `expires_at` | data minimisation; 30 days kept for support questions about a verification |
| `gift_card_presentation_tokens` | temporary | hard_delete_after_days | 30 d | `expires_at` | data minimisation: the gift-card ledger (gift_card_transactions) is the financial record, never this token |
| `jobs` | operational | hard_delete_after_days | 30 d | `finished_at` | operations: a finished job's result is recorded by the work it did; dead jobs are kept for investigation |
| `login_attempts` | security | hard_delete_after_days | 90 d | `created_at` | security investigation window; the Super Admin rule for data class login_attempts (floor 90) may lengthen it |
| `notifications` | communication | hard_delete_after_days | 1460 d | `created_at` | TCPA: consent / delivery evidence kept 4 years (the statute of limitations) |
| `password_reset_tokens` | temporary | hard_delete_after_days | 30 d | `expires_at` | data minimisation; 30 days kept for support questions about a reset |
| `public_check_in_sessions` | temporary | hard_delete_after_days | 30 d | `expires_at` | data minimisation: the check-in itself is recorded on the appointment / queue item |
| `refresh_tokens` | security | hard_delete_after_days | 30 d | `expires_at` | data minimisation: an expired refresh token cannot be used; session history is kept in sessions |
| `report_exports` | operational | hard_delete_after_days | 365 d | `created_at` | operations; the Super Admin rule for data class report_exports (floor 180) may change it |
| `security_not_me_tokens` | temporary | hard_delete_after_days | 30 d | `expires_at` | data minimisation: the security event itself is kept in security_events |
| `sessions` | security | hard_delete_after_days | 90 d | `expires_at` | security investigation window (90 days after a session could last be used) |
| `super_admin_login_otp` | temporary | hard_delete_after_days | 1 d | `expires_at` | data minimisation: an expired one-time code has no use |
| `webauthn_challenges` | temporary | hard_delete_after_days | 1 d | `expires_at` | data minimisation: a passkey challenge has no use after it expires |
| `website_leads` | customer_history | anonymize_after_days | 730 d | `archived_at` | data minimisation: an archived sales lead keeps its counts, not its contact details, after 2 years |

### Tables an older dedicated sweep owns (kept; listed so the policy is complete)

| table | class | sweep |
|---|---|---|
| `api_idempotency` | temporary | `packages/database/src/nest/idempotency-sweep.ts` |
| `booking_verification_sessions` | temporary | `modules/booking/src/customer-booking/booking-verification-retention.scheduler.ts` |
| `outbox_events` | operational | `apps/api/src/events/event-retention.ts` |
| `platform_request_metrics_minute` | operational | `apps/api/src/observability/telemetry-retention.ts` |
| `processed_events` | operational | `apps/api/src/events/event-retention.ts` |
| `system_health_snapshots` | operational | `apps/api/src/observability/telemetry-retention.ts` |
| `tenant_health_snapshots` | operational | `apps/api/src/observability/telemetry-retention.ts` |

## Soft-deleted tables

`branches`, `bundles`, `call_transcripts`, `customers`, `display_ad_media`, `inventory_products`, `nail_showcase_comments`, `nail_showcase_posts`, `ocr_documents`, `service_follow_up_tasks`, `services`, `support_ticket_attachments`, `technicians`.

## Never deleted (financial, audit, AI usage billing)

`ai_billing_events`, `ai_usage_logs`, `appointment_change_log`, `audit_events`, `audit_legal_holds`, `audit_logs`, `auth_events`, `authorization_audit_events`, `billing_invoice_lines`, `billing_invoices`, `billing_payment_attempts`, `cash_drawer_movements`, `cash_drawer_sessions`, `cash_payment_confirmations`, `chargebacks`, `commission_change_audit_logs`, `customer_legal_holds`, `customer_merge_logs`, `customer_wallet_ledger`, `data_retention_purge_runs`, `dispute_evidence`, `dispute_funds_events`, `dispute_outcomes`, `dispute_status_events`, `dispute_submissions`, `gift_card_settlement_batches`, `gift_card_transactions`, `gift_cards`, `hardware_payment_invoices`, `hardware_payment_ledger`, `hardware_payment_plans`, `hardware_payment_transactions`, `invoice_lines`, `invoices`, `loyalty_ledger`, `membership_audit`, `membership_credit_ledger`, `membership_payments`, `overage_charges`, `owner_audit_log`, `partner_payouts`, `payment_attempts`, `payment_gateway_events`, `payment_intents`, `payment_refunds`, `payment_settlements`, `payment_signatures`, `payments`, `payroll_lines`, `payroll_periods`, `payroll_sync_events`, `pos_queue_audit`, `revenue_audit_log`, `security_events`, `settings_audit_logs`, `settlement_notes`, `sms_usage_records`, `tech_cash_handoffs`, `technician_audit_logs`, `ticket_service_lines`, `ticket_tip_allocations`, `tickets`.

## Who did it — actor stamps (§34 / §37)

Migration 543: `updated_by uuid` on every tenant table that tracks `updated_at`, `deleted_by uuid` beside every
`deleted_at`, `created_by` on `pos_tech_appointments` and `pos_queue_items`. The Kysely actor-stamp plugin
(`packages/database/src/actor-stamp.plugin.ts`) fills them from the request's person (staff user, technician, customer,
Super Admin); a worker / device / integration / system principal stamps nothing (NULL on update) — the audit row names
it. The columns are not foreign keys (three identity tables can be the actor; a stamp must never fail a write). Raw
`sql` templates are not stamped — repositories that write with raw SQL keep setting the columns themselves. The gate
`check:actor-stamp` fails a new tenant table with `updated_at` but no `updated_by`, a `deleted_at` without `deleted_by`,
or a stale generated column map.

## Decisions left to Kevin

- Anonymising soft-deleted customers after a period (and how that meets disputes, tax and legal holds).
- Communication logs (`notifications`) kept 4 years for TCPA evidence — shorten or lengthen.
- Whether `audit_events` ever leaves the primary (archive to cold storage) — today it is kept forever.

