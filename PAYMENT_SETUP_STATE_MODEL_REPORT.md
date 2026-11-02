# Payment Setup — real 4-state model (Complete / Pending / Failed / Incomplete)

Follows up the flagged item: the Tenants table "Payment Setup" column + filter were a subscription-derived approximation
(only Complete/Incomplete, computed from the *display status*). They now reflect the tenant's actual **gateway config**.

## Source of truth
`tenant_payment_config.status` (migration 022, CHECK `pending|active|disabled|error`), mapped to the dashboard's 4 states:
- `active` → **Complete**
- `error` → **Failed**
- `pending` → **Pending**
- `disabled` / no config → **Incomplete**  (a legacy `fiserv_configured=true` with no live status still counts Complete)

## Backend (`apps/api/src/super-admin-tenants/`)
- `super-admin-tenants-core.ts`
  - New types `PaymentConfigStatus` (raw, + `'none'`) and `PaymentSetup` (the 4 dashboard states).
  - `TenantRecord.paymentConfigStatus` added.
  - Pure `derivePaymentSetup(t)` (tested).
  - `TenantViewRow.paymentSetup` added + set in `toViewRow`.
  - `TenantFilter.setup` widened to `complete | pending | failed | incomplete`; `applyFilter` now filters by the real
    `paymentSetup` (was a `status==='setup'` proxy).
- `super-admin-tenants.kysely.repository.ts` — `LIST_SQL` selects `pc.status AS payment_config_status`; `mapRow` sets
  `paymentConfigStatus` (`'none'` when no config row).
- `super-admin-tenants.repository.ts` — `createTenant` seeds `paymentConfigStatus:'pending'` (matches the real insert),
  and the in-memory demo set now carries realistic states (active / pending / error / disabled / none) so dev shows all four.
- `super-admin-tenants-core.spec.ts` — +6 derivation cases, +4 filter cases; corrected the pre-existing setup-filter
  test to the real model.

## Frontend (`apps/admin-web/src/screens/TenantsScreen.tsx`)
- New `setupBadge(paymentSetup)` → Complete (green ✓) · Pending (amber ◷) · Failed (red ⚠) · Incomplete (gray ○).
- The Payment Setup column now renders `setupBadge(r.paymentSetup)` instead of the subscription-derived `payBadge(r.pay)`.
- The Payment Setup filter gained **Pending** and **Failed** (now Complete / Pending / Failed / Incomplete), flowing through
  as `setup=` to the real backend filter. `TenantRow` type gained `paymentSetup`.

## No duplication
Reused the existing tenants module, `tenant_payment_config`, the list endpoint, and the screen. No new table, route,
endpoint, or component.

## How to test
- Backend: `bash scripts/run-core-specs.sh` (72 files / 473 tests, RESULT: PASS) — includes payment-setup derivation +
  the 4 filter states.
- Frontend: `cd apps/admin-web && npx vitest run` (88) + `npx vite build`.
- Manual: Tenants / Salons → Payment Setup filter → Complete / Pending / Failed / Incomplete each return the matching
  rows; the column badge colour matches the gateway state.

## Honest note
The Payment Setup column/filter now reflect **gateway config status**, not the subscription. The subscription label
(`r.pay` = Current / Past Due / Trial) is unchanged and still used by its own `pay` filter.

## Verification
backend: `tsc` clean; **473 tests** (72 files) + 22 harness suites; `RESULT: PASS`.
admin-web: `tsc` clean; **88 tests**; `vite build` clean.
