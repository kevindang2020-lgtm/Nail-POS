# MODULE_WIRING_MATRIX.md — Four-Package Merge

_Supersedes the seven-package matrix (archived at `docs/history/seven-package-merge/`)._
Chain audited per module: **migration → kysely.types → repository → service → controller → app.module →
frontend api client → screen → App.tsx route → tenant-nav item / EXISTING_ROUTES**. The full Nest DI graph
instantiates clean (`node apps/api/scripts/di-check.mjs` → `DI_GRAPH_OK`).

## Modules new in this merge, by source branch

| Module (api src) | Migrations | app.module | Tenant route(s) | Nav | Notes |
|---|---|---|---|---|---|
| **A** ai-business | 336–338 | ✓ | /tenant/ai/business (+branches/alerts/reports) | ✓ (3 sub-items added) | prompt upgraded to A's guardrailed version |
| **A** ai-analytics-forecasting | 340 | ✓ | /tenant/ai/analytics (POSAiForecastingScreen) | ✓ | also the optimizer's ForecastPort source |
| **A** ai-inventory (recipes layer) | 339 | ✓ | /tenant/ai/inventory | ✓ | approval-gated proposals |
| **A** super-admin-forecasting | — | ✓ | admin /ai-forecasting, /ai-business-adoption | admin nav ✓ | |
| **B** ai-marketing (+send) | 320–322 | ✓ | /tenant/ai/marketing/* | ✓ | canonical base |
| **B** ai-money-protection | 323–325 | ✓ | /tenant/ai/money-protection/* | ✓ | |
| **B** ai-voice-transcription | 326–330 | ✓ | /tenant/ai/voice-transcription/* | ✓ | disjoint from D's call-intelligence |
| **B** ai-queue-assignment | 331–335 | ✓ | /tenant/ai/queue | ✓ | + registration guard spec |
| **C** ai-customer-profile | 341 | ✓ | /tenant/ai/customer-profile/* (7 screens) | ✓ (7 items) | scan scheduler opt-in |
| **C** ai-checkout-upsell | 342 | ✓ | /tenant/ai/checkout-upsell/settings | ✓ | tools now honor async contract |
| **C** ai-review-reputation | 343 | ✓ | /tenant/ai/reputation (+settings) | ✓ | capability alias → real marketing.* (rbac fix) |
| **C** ai-ocr-receipt | 344 | ✓ | /tenant/ai/ocr-receipt | ✓ (pay-ai-receipts) | alias → inventory.* (rbac fix) |
| **C** ai-scheduling-optimizer | 345 | ✓ **(registered in this merge)** | /tenant/ai/scheduling-optimizer | ✓ | BookingReadPort + ForecastPort bound in this merge |
| **C** super-admin-ai-* (5 oversight) | — | ✓ | admin /ai-customer-profile, /ai-checkout-upsell | admin nav ✓ | |
| **D** deposit-reconciliation (+SA) | 351–355 | ✓ (+webhook exclusion) | /tenant/payments/deposit-reconciliation | ✓ (pay-recon) | RECON_SWEEP_* env documented |
| **D** invoices | 348 | ✓ | /tenant/payments/invoices | ✓ (pre-existing item) | |
| **D** pos-referrals | 349 | ✓ | /tenant/marketing/referrals | ✓ | |
| **D** pos-social | 350 | ✓ | /tenant/marketing/social | ✓ | |
| **D** service-add-ons | 346 | ✓ | /tenant/services/add-ons | ✓ | |
| **D** split-payments | — | ✓ | /tenant/payments/split-payments | ✓ | |
| **D** team-permissions / time-clock | — | ✓ | /tenant/team/permissions, /tenant/team/time-clock | ✓ | |
| **D** tenant-billing / tenant-entitlements | — | ✓ | /tenant/account/* | ✓ | |
| **D** marketing-report | — | ✓ | /tenant/reports/marketing, /tenant/reports/ai | ✓ | analytics screen kept at reports/ai |
| **D** call-intelligence (edits) | — | ✓ | /tenant/ai/call-intelligence | — (existing surface) | disjoint from B voice module |

## Route-collision resolutions (pos-web App.tsx)

Six D `POSAiPackageScreen` routes were dropped where a real screen owns the path (B: queue/marketing/
voice-transcription; A: business/inventory/analytics). D's package screen keeps its seven non-colliding paths
(booking, scheduling, fraud-protection, customer-insights, checkout-upsell†, reviews†, receipt-scanner†).
† C's dedicated screens live at different paths (…/settings, /reputation, /ocr-receipt), so both surfaces coexist:
package/subscription page vs working screen.

Final counts: pos-web **191 routes** (0 dupes), admin-web **124 routes** (0 dupes), tenant-nav ids unique,
`EXISTING_ROUTES` 188 paths, wiring-invariant spec green (no FeaturePage double-registration).
