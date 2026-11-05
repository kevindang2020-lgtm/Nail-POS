# owner-web hardening — hardware-payment typing (corrects stale types + locks two fixes)

Typed `ownerHardwarePaymentApi.plan` / `.invoices` — the payloads behind the Owner hardware-payment screen, where this sweep
fixed two field-mismatch bugs (the invoice `key` and the saved-card `last4`). They were still `any`, and worse, the file
carried **stale, wrong** interfaces that no one used.

## What the stale types got wrong
`OwnerHwInvoice` claimed an `id` and a `cardVolumeCents` field. The owner endpoint (`ownerInvoices`) deliberately strips
Fiserv-internal figures **and the row id** — it returns exactly six fields (`billingMonth`, `hardwareMonthlyDueCents`,
`salonHardwareCreditCents`, `shortfallCents`, `autoChargeAmountCents`, `status`). Any future code trusting the old type would
have read `i.id` / `i.cardVolumeCents` and silently gotten `undefined` — the exact defect class this sweep has been closing.

## What changed
- **Corrected `OwnerHwInvoice`** to the real six-field owner DTO (dropped the phantom `id` + `cardVolumeCents`).
- **Added the response envelope** `OwnerHwPlanResponse = { plan: OwnerHwPlan | null; savedPaymentMethod: OwnerHwSavedMethod | null }`
  (plus `OwnerHwSavedMethod { brand; last4; status }`), matching `ownerPlan`'s real `{ plan, savedPaymentMethod }` shape.
- **Wired the methods:** `plan() => OwnerHwPlanResponse`, `invoices() => OwnerHwInvoice[]` (were `any`).
- **`HardwarePaymentScreen` de-`any`-ed:** `plan` state → `OwnerHwPlan | null`, `invoices` → `OwnerHwInvoice[]`, invoice map
  dropped `(i: any)`. Two behavior-preserving simplifications the types made provable:
  - the invoice key `i.id ?? i.billingMonth` → `i.billingMonth` (the DTO never sends `id`, so the `?? ` branch was the only
    one ever taken; `billingMonth` is unique per invoice),
  - the plan-unwrap `pval?.plan ?? pval ?? null` → `pval?.plan ?? null` (the `?? pval` fallback was for a flattened response
    that the typed contract shows never occurs).

## Verification
owner-web `tsc` clean, **85 tests pass** (18 files, incl. the existing HardwarePaymentScreen test), `vite build` clean.
(admin-web 151, pos-web 75, tech-web 74, customer-web 136, backend 603 / PASS — all unchanged; types + two provable simplifications.)
