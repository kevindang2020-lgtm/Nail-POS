# Payroll architecture (Payroll mandate §210–§212)

One payroll system: `modules/workforce/src/compensation` (the engine + ledger) and `modules/workforce/src/payroll`
(pay periods + the review / approval / payout workflow). Money is integer cents everywhere; rates are percents on the
rule (the salon share is the remainder).

## Authoritative tables (§212)

| Table | Owns | Written by |
|---|---|---|
| `compensation_policies` / `compensation_policy_versions` | commission rules (scope, effective window, versions) | `compensation-rules.*` (overlap refused, §142) |
| `ticket_service_lines` (commission_*_snapshot, policy_id, rule_source) | the rule that priced a line, frozen at Service Done | `service-done-transition.ts`, `stampCommissionOnLine` |
| `ticket_compensation_snapshots` | the immutable per-line, per-technician earning at payment | `CompensationService.snapshotPaidTicket` (write-once) |
| `ticket_tip_allocations` | the ONE tip split per ticket | engine at payment; `TipAllocationService` (locked after payment) |
| `compensation_adjustments` | every correction: refund / void / chargeback reversals, tip corrections, bonuses, deductions, manual corrections | append-only; `status` via `COMPENSATION_ADJUSTMENT` |
| `technician_pay_plans` | commission / hourly / salary / hybrid terms, effective-dated (no overlap — EXCLUDE) | `PayPlansRepository` |
| `compensation_deduction_types` | the only deductions a salon may apply | `PayPlansRepository` |
| `technician_shifts`, `technician_breaks` | worked time (server instants) for hourly pay | time clock |
| `payroll_periods` | the pay run: status draft → review → finalized (approved + locked) → paid; version; preview / approval hash | `PayrollWorkflowService` |
| `payroll_lines` | the per-technician period result (frozen by trigger outside draft) | `PayrollService.buildFromSales` (draft only) |
| `payroll_payouts` | what was actually paid (≤ payable) | `PayrollWorkflowService.recordPayout / markPaid` |
| `payroll_exports` | export audit (who, format, sha256) | `PayrollWorkflowService.exportPeriod` |
| `compensation_exceptions` | the financial exception queue | `CompensationRecoveryWorker`, refund routing, owner actions |
| `payroll_inquiries` | technician questions + answers (private note never shown to the technician) | Tech App / POS |

## Flow
Service Done stamps the rule on the line → payment writes the snapshot + tip split (a failure never touches the payment;
the recovery worker retries it) → `buildFromSales` sums snapshot + ledger (bonus / deduction / other) + guarantee + hourly /
salary into lines for the period's **salon-local** window `[start 00:00, end+1 00:00)` → **prepare** (validate, freeze, preview
hash) → **approve** (payroll.approve + step-up + expected version; blocking issues refuse it; approval hash stored) →
**payouts / mark paid** (payouts.manage + step-up; Σ paid ≤ payable) → history. A refund, tip re-split or chargeback after
the period is approved never edits it: the entry lands in the next open period with `original_period_id`.

## Runbook (§211)
- *Missing commission*: Payroll › Exceptions shows `missing_snapshot` (retried automatically, or "Retry now"). Check
  `ticket_compensation_snapshots` for the ticket; a line without a technician is `missing_technician`.
- *Incorrect tip*: `ticket_tip_allocations` Σ must equal `tickets.tip_cents`; re-split from the period's technician drawer
  (a paid ticket needs a reason → `tip_correction` entries, Σ 0).
- *Payroll total mismatch*: the period's checks show `PAYROLL_CHANGED_SINCE_BUILD` → rebuild (draft) or reopen with a reason.
  A paid period whose lines no longer match `approval_hash` refuses to pay.
- *Refund not reversed*: `compensation_adjustments where refund_payment_id = …` (idempotent per refund); against a locked
  period it is `pending` in the next open period — approve it under Adjustments to review.
- *Duplicate earning*: unique indexes on snapshots, refund / chargeback reversals and idempotency keys make it impossible;
  the `DUPLICATE_COMMISSION` check reports any.
- *Worker failure*: `CompensationRecoveryWorker` logs a pass summary; `COMPENSATION_RECOVERY=off` disables it.
- *Tenant isolation*: every payroll query is `tenant_id`-scoped; periods are branch-scoped; tests:
  `payroll-wave2.postgres-race.vitest.spec.ts`, live proof `apps/api/scripts/live-payroll-completion.mjs`.
