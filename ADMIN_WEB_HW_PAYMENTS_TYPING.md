# admin-web hardening — Super Admin per-tenant hardware-payment typing

Typed the four remaining `any` GET returns behind the Super Admin HardwarePaymentsScreen (per-tenant plan, settings,
invoices, ledger). With the reports screen done previously, the entire admin hardware-payment client is now typed.

## What changed
- **New types in `superAdminApi.ts`** mirroring the backend exactly:
  - `HwPlan` (full plan row) + `HwPlanResponse` `{ plan, savedPaymentMethod }` — the admin plan endpoint reuses `ownerPlan`,
    so it returns the same envelope.
  - `HwSplitSettings` (the five revenue-split rate fields) + `HwTenantSettingsResponse` `{ effective, hasOverride }` —
    matching `getTenantSettings`' own backend signature.
  - `HwInvoice` (full invoice row, incl. the Fiserv-internal figures the owner view strips: `netMarginCents`,
    `platformShareCents`, `fiservShareCents`, etc.) and `HwLedgerRow`.
- **Wired** `hwPlan => HwPlanResponse`, `hwTenantSettings => HwTenantSettingsResponse`, `hwInvoices => HwInvoice[]`,
  `hwLedger => HwLedgerRow[]` (all were `any`).
- **HardwarePaymentsScreen de-`any`-ed:** all five state vars typed (`plan`, `settings` as `HwSplitSettings & {hasOverride}`,
  `draft`, `invoices`, `ledger`); invoice + ledger maps dropped `(i: any)`/`(l: any)`. Behavior-preserving touch-ups the types
  made provable: the plan-unwrap and settings-unwrap each shed a dead `?? <envelope>` fallback (the endpoints always return the
  envelope), and two `plan.id` reads inside `disabled={!plan ...}` buttons became `plan!.id` (the disabled guard already
  guarantees non-null when clickable). All plan/settings/invoice/ledger reads verified against the types.

## Verification
admin-web `tsc` clean, **151 tests pass** (30 files, incl. the existing HardwarePaymentsScreen test), `vite build` clean.
(pos-web 75, owner-web 85, tech-web 74, customer-web 136, backend 603 / PASS — all unchanged; types + provable simplifications.)

## Remaining `any` in this client
Only the alerts trio — `alerts` / `alertsSummary` / `alert` (AlertsScreen) — left as the last cluster.
