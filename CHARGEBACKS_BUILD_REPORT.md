# Chargebacks — Build Report (closes REMAINING_BLOCKERS #1)

The "Chargeback Alerts" KPI is now backed by a real, tenant-scoped source and an idempotent webhook ingestion path. It is
no longer hard-coded to 0/"not tracked yet" — it shows the live count when the source is present, and still degrades
honestly to "not tracked yet" if the table hasn't been migrated.

## What was added
- **DB migration `db/migrations/096_chargebacks.sql`** — new `chargebacks` table (integer cents; tenant-scoped; FK to
  `tenants`). Statuses `open | needs_response | under_review | won | lost | refunded | expired`. Idempotency via a unique
  partial index on `(tenant_id, chargeback_id)`; indexes on tenant, `(tenant_id,status)`, and `opened_at`. Raw card data is
  never stored (only the scrubbed `payload_json_safe`).
- **`src/database/kysely.types.ts`** — `ChargebacksTable` + `DB.chargebacks`.
- **`src/payments/payment-webhook.service.ts`** — chargeback/dispute webhooks now record a chargeback the **same way
  refunds/settlements already do**: tenant resolved ONLY by merchant id, signature verified against that tenant's secret,
  and **idempotent** — a "created/received" event opens a `needs_response` alert; a later `won/lost/refunded/expired` event
  resolves the **same** case (updates, never duplicates). New pure, exported, unit-tested helpers `isChargebackEvent` and
  `mapChargebackStatus` (+ `CHARGEBACK_RESOLVED`). The handler response now includes `recordedChargeback`.
- **`src/super-admin-platform/payment-gateways-core.ts`** — `RawGatewayRow.chargebackAlerts` + `GatewayView.chargebackAlerts`;
  `computeKpis(rows, { chargebacksTracked })` now **sums** real open-chargeback counts and reports the tracked flag.
- **`super-admin-platform.repository.ts`** — `paymentGatewaysState()` queries open chargebacks per tenant
  (`status in ('open','needs_response','under_review')`) and sets `chargebacksTracked` (true when the table is present; the
  query is wrapped so a missing table degrades to `false` instead of erroring).
- **`super-admin-platform.service.ts`** — threads `chargebacksTracked` from the repo into `computeKpis`.
- **Frontend** — `PgGateway.chargebackAlerts` type; the **Chargeback Alerts KPI** shows the real count (with an "open alerts"
  caption) and drills to Recent Payment Events when tracked, or shows "not tracked yet" otherwise; the **detail panel** now
  has a Chargebacks line per tenant.

## How a chargeback flows in (no new infra needed)
Processor → existing `POST` payment webhook → `PaymentWebhookService.handle` resolves the tenant by merchant id, verifies the
signature, and (for a dispute/chargeback event) upserts the `chargebacks` row + writes the existing `payment_gateway_events`
audit row (so it also appears in the Recent Events/Activity feeds). The Super Admin KPI counts the unresolved rows.

## Tests / verification
- `payment-gateways-core.spec.ts` — **64 assertions** (was 60): chargeback alerts summed; tracked flag flips; back-compat
  default (untracked → still sums, tracked=false); view carries `chargebackAlerts`.
- `src/payments/payment-webhook-chargeback.vitest.spec.ts` — **3 tests**: event recognition, lifecycle→status mapping,
  resolved-vs-alert set.
- `PaymentGatewaysScreen.test.tsx` — **8 tests** (was 7): added "shows the real chargeback count once the source is tracked".
- Full backend suite **606 + harness, RESULT: PASS**; full admin-web suite **30 files / 155 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds.

## Honest notes
- Live signature verification still needs raw-body capture + the processor's exact header/scheme when the gateway sandbox is
  available (pre-existing webhook caveat; the tenant-isolation + idempotency logic is independent of it).
- A "needs_response" SLA / `due_by` countdown column could be surfaced next; the field exists on the table.
