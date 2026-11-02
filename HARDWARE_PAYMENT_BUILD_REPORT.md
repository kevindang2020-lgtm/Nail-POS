# HARDWARE_PAYMENT_BUILD_REPORT.md

Hardware Payment Recovery — built, tested, and live-verified. The salon's monthly hardware payment is first covered by a
hardware credit derived from the credit-card revenue split; any shortfall is auto-charged to the tenant's saved tokenized
card, with invoices, ledger, consent, audit, alerts, and Super-Admin controls.

## Calculation (backend-authoritative, integer cents + bps) — `apps/api/src/hardware-payment/hardware-payment-core.ts`
Pure, fully tested. The spec formula: `gross = volume×pricing_bps/10000`, `expense = volume×expense_bps/10000`,
`net = gross−expense`, `platform = net×platform%/100`, `fiserv = net×fiserv%/100`,
`credit = platform×creditPct/100`, `shortfall = max(0, due−credit−carryForward)`, plus extra-credit handling
(cap / carry-forward / apply-to-principal) and §7 validation (pricing≥expense, platform+fiserv=100, credit 0–100).

**Exact spec example proven** (test + live): $50,000 volume, 300/180 bps, $250 due →
gross $1,500, expense $900, net **$600**, platform **$390**, fiserv **$210**, salon credit **$97.50**,
**shortfall $152.50**, auto-charge **$152.50**.

## Orchestration — `hardware-payment.service.ts`
Per-tenant override resolves over the global default; plan CRUD; `reconcile()` writes the invoice + balanced ledger,
applies extra-credit (carry-forward / principal), then runs the **pure auto-charge gate** (`decideAutoCharge`): charges
**only the shortfall**, and only when the plan is active, autopay consent exists, and a tokenized method exists —
otherwise the invoice is `payment_method_required` / `shortfall_pending` with an alert. Failed charges →
`payment_failed` + a critical alert + ledger `payment_failed`. Tokenized cards only (raw PAN/CVV rejected). Every
material action is audit-logged.

## Data model — migration `apps/api/db/migrations/078_hardware_payment.sql` (8 tables)
`hardware_payment_plans`, `hardware_revenue_split_settings` (DB CHECKs mirror §7), `hardware_payment_invoices`,
`hardware_payment_ledger`, `hardware_payment_methods` (token/brand/last4 only), `hardware_autopay_consents`,
`hardware_payment_transactions`, `hardware_reconciliation_runs`. Applied to `aps_fresh` (9 `hardware_%` tables incl. the
existing `hardware_packages`).

## Persistence
Kysely repository (`hardware-payment.kysely.repository.ts`) over migration `078`'s 8 tables, wired via a DB-keyed
factory in the module (Kysely when a DB handle exists, else in-memory). Reconciliation, invoices, ledger, plans,
settings, methods, consents, and transactions all persist. Verified live against `aps_fresh`.

## Ledger correctness fix
A `shortfall_charge` ledger entry now represents an **actual** card charge only — the computed obligation lives on the
invoice (`shortfall_cents`), not the ledger. (Previously the core also emitted a planned `shortfall_charge`, double-
counting; removed. Verified live: exactly one `shortfall_charge` row per settled shortfall.)

## APIs
- Super-Admin (`hardware-payment.super-admin.controller.ts`, behind `SuperAdminGuard`): global + per-tenant settings,
  plan create/edit, reconciliation, recalculate-month, charge-shortfall, pause/resume, invoices, ledger.
- Owner (`hardware-payment.owner.controller.ts`, `TenantAuthGuard`+`RolePermissionGuard`): plan, invoices (Fiserv-internal
  figures hidden), ledger, add tokenized payment method, autopay consent. **Owners cannot change split percentages.**

## Tests — 15 passing
- Core (6): exact example, no-charge-when-covered, reconcile ledger consistency, carry-forward, validation, auto-charge gate.
- Service (9): charge-only-shortfall ($152.50), no-charge-when-covered, missing method blocks + alerts, missing consent
  blocks, failed charge → payment_failed + critical alert, ledger platform+fiserv=net, tenant isolation, per-tenant
  override changes the math, raw-card rejection.
- Full API suite: **424/424 (63 files)** — no regressions.

## Live verification (boot vs Postgres, SuperAdminGuard path)
`GET /super-admin/hardware-payment/settings` → 200 defaults; `POST .../hardware-payment-plan` → active plan;
`POST .../recalculate-month` ($50k) → **shortfall 15250, credit 9750, invoice `payment_method_required`** (correctly not
charged — no saved method); `GET .../invoices` → the invoice; owner endpoint unauthenticated → **401**.

## Audit + alerts (§17/§18)
Persisted to the existing `owner_audit_log` (audit trail) and `owner_alerts` (Super-Admin alert dashboard) — merged, not
duplicated. Every material action is audited; failed charges + missing-method raise alerts.

## UI status — COMPLETE
Super-Admin management (§14), Owner view (§15), and reports + CSV export (§16) are all built and build clean. The feature
is usable end-to-end across backend + admin-web + owner-web.

## Production wiring (env)
Flip these on when the credentials/targets exist — no code changes needed:
- **Live charges:** `CARDPOINTE_BASE_URL` (or `CARDPOINTE_SITE`) + `CARDPOINTE_MERCHID` + `CARDPOINTE_USERNAME` +
  `CARDPOINTE_PASSWORD` → the charge adapter switches from sandbox to the real CardPointe/Fiserv client automatically.
- **Live residuals:** `FISERV_RESIDUAL_URL` (+ optional `FISERV_RESIDUAL_AUTH`) → `importFromFiserv()` pulls real volume.
- **Unattended run (pick one):** `HARDWARE_PAYMENT_CRON_ENABLED=1` (in-process 6-hourly timer) **or** an external
  scheduler `POST /internal/hardware-payment/run-monthly` with `x-cron-secret: $HARDWARE_PAYMENT_CRON_SECRET`.

## Honest remaining items (non-blocking)
- **Kysely persistence — DONE.** `hardware-payment.kysely.repository.ts` implements the full data port over the 8 tables;
  the module wires it when a DB handle exists (else in-memory). The 8 tables were added to the Kysely `DB` types.
  *Live-proven:* create-plan → 1 row in `hardware_payment_plans`; recalculate-month ($50k) → 1 row in
  `hardware_payment_invoices` (shortfall 15250, `payment_method_required`) + **9 `hardware_payment_ledger` rows**
  (gross 150000 / expense −90000 / net 60000 / platform 39000 / fiserv 21000 / credit 9750 / due 25000 / shortfall
  15250 — platform+fiserv = net); GET invoices reads back from Postgres. All money read through `num()` (bigint-safe).
- **Real charge processor wiring — DONE.** `hardware-payment.charge-adapter.ts` binds `HardwareChargePort` to the
  payment processor: the live CardPointe client via `processorFromEnv()` when `CARDPOINTE_*` is configured, a no-network
  `SandboxPaymentProcessor` when `PAYMENTS_SANDBOX=1`, else fail-safe "not configured". Wired as `HW_CHARGE` in the module.
  *Live-proven:* owner adds a tokenized method + autopay consent → reconcile **auto-charged the $152.50 shortfall** →
  invoice `paid`, a `hardware_payment_transactions` row `succeeded / 15250` with a retref, and exactly **one**
  `shortfall_charge` ledger entry. Adapter unit-tested (approve / decline / not-configured).
- **Monthly reconciliation job + residual import — DONE (trigger only remains).** `hardware-payment.reconciliation-job.ts`
  (`HardwarePaymentReconciliationJob.runMonthly(month)`) lists every ACTIVE plan, reads its imported card volume, and
  reconciles each (credit → shortfall → gated auto-charge), recording a `hardware_reconciliation_runs` row; idempotent per
  (plan, month). `hardware-payment.residual-import.ts` (`FiservResidualImportService`) lands per-tenant monthly volume into
  the new `hardware_card_volume` table (migration `079`). Endpoints: `POST /super-admin/hardware-payment/run-monthly` and
  `POST /super-admin/tenants/:tenantId/hardware-payment/import-volume`. **Live-proven:** import $50k → run-monthly →
  1 plan processed, 1 invoice created (shortfall 15250), run `completed`, all persisted. *Remaining:* register a scheduler
  to hit run-monthly automatically (add `@nestjs/schedule` + a `@Cron`, or an external scheduler/cron — the job is a pure
  callable), and wire `importFromFiserv()` to the live Fiserv residual report (creds/network).
- **UI** (§14 Super-Admin screens + §15 Owner view) and the §16 report views.
- Retry-count loop for failed charges (single attempt + a manual "charge shortfall now" retry are implemented).
