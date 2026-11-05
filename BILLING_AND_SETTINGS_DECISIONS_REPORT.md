# Build Report — Two Open Product Decisions (Resolved)

Date: 2026-06-17. Both items that prior handoffs left as "product decisions" are now decided, implemented, and tested.
No external credentials or deploy were needed — this is pure in-repo code. Full backend suite stays green.

---

## Decision 1 — Billing "recalculate-month" semantics

**Policy chosen: a settled (paid) month is immutable; unpaid/failed months reverse-and-recompute.**

Rationale: once a shortfall has actually been charged, quietly recomputing a corrected card-volume for that month would
let the invoice/ledger drift away from the money that was really collected. So:

- **Paid month, same volume** → returns the settled invoice unchanged (scheduler retry / idempotent "recalculate month").
- **Paid month, different volume** → **rejected** with `HardwarePaymentError('month_settled', …, 409)` and an audit row
  (`hardware_recalc_rejected_month_settled`). A corrected volume after settlement must be handled as an explicit
  adjustment, never a silent recompute. (Previously the new volume was silently ignored — a quiet no-op that could mask a
  real correction.)
- **Unpaid / payment-failed month** → **reverse-and-recompute** (already the behaviour): the prior reconciliation's
  principal reduction and consumed carry-forward are restored and its reconciliation ledger rows dropped, then the month
  is recomputed from the corrected volume — so principal is never double-reduced and the ledger never accumulates
  duplicate rows. This reversal now also emits an audit row (`hardware_recalc_month_reversed`) for traceability.

Files: `apps/api/src/hardware-payment/hardware-payment.service.ts` (the `reconcile` idempotency block).

Tests: `hardware-payment.service.vitest.spec.ts` — new case *"REJECTS a corrected-volume re-run on a settled (paid)
month"* (asserts the throw, no second charge, the audit row, and that a same-volume re-run still returns idempotently).
The existing idempotent-paid and unpaid-recompute cases remain green.

## Decision 2 — Tax / surcharge settings-schema tightening (write-validation)

The checkout *resolver* already coerced values on read; this tightens the *write* path so bad values can't be saved in
the first place. `apps/api/src/settings/settings.service.ts` `validate()` now enforces:

- **Card surcharge ≤ 4%** (US card-surcharge cap is 3–4%; the old bound allowed up to 100%), and a non-empty
  `surchargeLabel` whenever the surcharge is enabled.
- **Tax rate ≤ 15%** (sales tax can't sanely exceed that; old bound allowed 100%).
- **Finite-number guard**: `NaN`/`Infinity` are now rejected (they previously slipped through, since `typeof NaN ===
  'number'` and every `NaN` comparison is false).
- **Enum guards**: tax `mode` (`exclusive`/`inclusive`), tax `roundingRule` (`half_up`/`bankers`/`none`), and
  `customerDisplayMode` (`review_only`/`tip_only`/`customer_pays`).
- **Whole-number tip presets**: each `defaultTipPercents` entry must be an integer within `maxTipPercent`.
- `managerApprovalOverCents` finite and non-negative.

Tests: `settings-core.spec.ts` — 8 new assertions (tax > 15% rejected, NaN rejected, invalid tax mode rejected,
surcharge > 4% rejected, 3% accepted, enabled-surcharge-empty-label rejected, invalid display mode rejected, non-integer
tip preset rejected). The existing valid-patch and 250%-rejected cases remain green.

---

## Verification (real run, this tree)

| Check | Result |
|---|---|
| `tsc --noEmit` (API) | **clean** |
| `settings-core.spec.ts` harness | **41 + 78 passed** (was 33 + 70 — 8 new assertions) |
| `hardware-payment.service.vitest.spec.ts` | **12 passed** (was 11 — 1 new case) |
| `scripts/run-core-specs.sh` (all harnesses + full vitest) | **70 files / 453 tests passed — RESULT: PASS** |

No regressions. Both rows can be struck from the "product decisions" list in REMAINING_BLOCKERS.md /
REMAINING_WORK_FOR_NEW_CHAT.md.
