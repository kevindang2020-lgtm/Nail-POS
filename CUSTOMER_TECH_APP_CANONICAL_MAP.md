# CUSTOMER_TECH_APP_CANONICAL_MAP.md

```
CANONICAL_CUSTOMER_APP_PATH = apps/customer-web/            (workspace aipowersalon-customer-web)
CANONICAL_TECH_APP_PATH     = apps/tech-web/                (workspace aipowersalon-tech-web)
CANONICAL_BACKEND_PATH      = apps/api/                     (workspace @aipowersalon/api)
CANONICAL_SHARED_TYPES_PATH = apps/api/src/database/kysely.types.ts (+ per-app src/api/*Api.ts clients)
```

## Merged code sources
No merge/dedupe was required — there is a single canonical Customer App and a single canonical Technician App. No
second/duplicate copies of either app were found, so nothing was removed or deprecated.

## Backend modules connected
- Tech: `apps/api/src/tech/` (tech.module/controller/service/repository), reusing `apps/api/src/serving/` for the
  authoritative ticket recalc + change-request approval, and `apps/api/src/checkout/` for checkout totals.
- Customer: `apps/api/src/customer-salons/` (directory + nearby + Google provider + favorites),
  `apps/api/src/customer-booking/` (booking/availability), `apps/api/src/customer/` (profile/notifications),
  `apps/api/src/wallet/` + `apps/api/src/customer-payments/` (receipts/payment methods),
  `apps/api/src/check-in/` (check-in), `apps/api/src/realtime/` (live updates).

## Missing pieces built this pass
None structurally — the apps were already built. This pass verified builds + tests, confirmed the two spec-critical
features work (nearby search live; tech live-ticket-edit endpoints + backend-authoritative recalc via the shared bridge),
and confirmed the §19 security property (no Google key in the customer bundle). Remaining gaps are listed in
REMAINING_BLOCKERS.md.
