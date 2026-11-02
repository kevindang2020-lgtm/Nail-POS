# Period-end subscription invoice generator — policy & how to apply

Builds the missing recurring/renewal biller. It scans subscriptions whose `current_period_end` has passed and, per the
policy below, issues the next invoice + advances the period, cancels, or skips. **It is OFF by default** — nothing bills
until you arm it, so you can review the policy first.

## The policy (edit in `billing-cycle-core.ts` → `decideRenewal`)
| subscription state | action | notes |
|---|---|---|
| `active` | **invoice** next cycle, advance period | the core case |
| `trialing` | **invoice** (first real charge) + convert to `active`, advance | trial converts to paid at trial end |
| `pending_cancellation` | **cancel** (status→cancelled, cancelled_at), no invoice | tenant asked to stop at period end |
| `active` + `cancel_at` ≤ period end | **cancel**, no invoice | a scheduled cancellation that has come due |
| `past_due` | **skip** | dunning/aging owns it — never stack a second invoice on an unpaid one |
| `paused` | **skip** | paused doesn't bill |
| `expired` / `cancelled` | **skip** | terminal |

Pricing: annual interval → the plan's `annual_price_cents` (falls back to monthly×12 if the catalog has none); else the
subscription's `monthly_price_cents`. Period advance clamps day-of-month (Jan 31 → Feb 28).

## Safety
- **Idempotent**: never writes two invoices for the same period (guard on `billing_invoices.period_start`); a re-run
  never double-bills. Invoice + period-advance happen in ONE transaction (atomic).
- **Per-subscription `pg_advisory_xact_lock`** — no two ticks touch the same subscription at once.
- **Full catch-up in one pass**: a subscription N cycles overdue is billed for EVERY missed cycle in a single pass —
  each cycle a separate, contiguous invoice (period_start of each = period_end of the previous) — then the period is
  advanced to current. Per-period idempotency means a re-run adds nothing. A safety cap of 120 cycles per subscription
  per pass prevents runaway on corrupt/ancient data; any residual cycles are billed on the next pass.
- Never recomputes historical invoices — only issues the NEXT one.

## How to apply / run
1. Review/adjust `decideRenewal` + pricing in `billing-cycle-core.ts`.
2. Manual pass (no worker): `POST /super-admin/billing/cycle/run` (SuperAdminGuard) → returns
   `{ due, invoiced, cancelled, skipped, errors }`.
3. Automatic: set env `BILLING_CYCLE_WORKER_ENABLED=1` to arm the hourly in-process worker (mirrors the existing
   billing-export worker; off in dev/test/CI by default).

## Files
- `billing-cycle-core.ts` — pure policy (decideRenewal / renewalAmountCents / advancePeriodEnd) + 17 unit tests.
- `billing-cycle.service.ts` — the generator (raw SQL like the existing billing repo; idempotent, advisory-locked).
- `billing-cycle.scheduler.ts` — env-gated hourly worker.
- `billing-cycle.controller.ts` — `POST /super-admin/billing/cycle/run`.
- `super-admin-billing.module.ts` — registers all three (+ exports the service).
- `*.pgtest.vitest.spec.ts` — 9 tests against the real migrated schema (every branch + idempotency).

## Verified (in-sandbox)
Full api `tsc --noEmit` 0 errors; check:di + check:crosswire pass; no-orphaned-controllers pass (controller mounted);
tests: core 17 + pgtest 9 = 26 green.

## Not touched
No existing billing/dunning/trial code changed. No migration needed — uses existing columns
(tenant_subscriptions.cancel_at/cancelled_at/monthly_price_cents/billing_interval, billing_invoices, subscription_plans).
