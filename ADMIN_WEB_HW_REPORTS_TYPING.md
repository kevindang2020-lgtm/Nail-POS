# admin-web hardening — Super Admin hardware-payment reports typing

Typed `superAdminApi.hwReports` — the monthly-totals payload behind the Super Admin HardwarePaymentReportsScreen (a screen
this sweep audited clean). Pure regression-guard on a previously-`any` GET return, plus two provable simplifications.

## What changed
- **New `HwReportRow` type** mirroring `reportMonthlyTotals` exactly: the repo aggregate (`billingMonth`, `invoiceCount`,
  `cardVolumeCents`, `hardwareCreditCents`, `dueCents`, `shortfallCents`, `chargedCents`, `paidCount`, `failedCount`) plus the
  three figures the service derives (`collectedCents`, `outstandingCents`, `collectionRatePct`).
- **`hwReports` typed** `=> HwReportRow[]` (was `any`).
- **HardwarePaymentReportsScreen de-`any`-ed:** `rows` state → `HwReportRow[]`, table map dropped `(r: any)`. The fetch shed an
  `as Promise<any>` cast and a defensive `Array.isArray(d) ? d : d?.rows ?? []` unwrap — the endpoint always returns the array,
  so `setRows(d)` is the same behavior with the shape now compiler-checked. All ~11 `r.*` reads (table + CSV export) verified
  against the type.

## Verification
admin-web `tsc` clean, **151 tests pass** (30 files, incl. the existing HardwarePaymentReportsScreen test), `vite build` clean.
(pos-web 75, owner-web 85, tech-web 74, customer-web 136, backend 603 / PASS — all unchanged; types + two provable simplifications.)

## Still `any` in this client (next units)
`hwPlan` / `hwInvoices` / `hwLedger` / `hwTenantSettings` (HardwarePaymentsScreen) and `alerts` / `alertsSummary` / `alert`
(AlertsScreen) — both screens audited clean, so these are doc/guard typings rather than fix-locking.
