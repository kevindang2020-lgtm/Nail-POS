# COMPLETE_MODULE_WIRING_MATRIX.md

> **Historical snapshot (Jul 9 2026) — superseded for current status on Oct 10 2026 (BUILD_PLAN Phase 15).** Wiring is no
> longer tracked by hand: the gates in `tooling/ci/run-gates.mjs` prove it on every push — `check:di` (DI graph),
> `check:nav` (every sidebar item has a route), `check:crosswire` / `check:dead-client` / `check:unreached` (every
> frontend call has a route, no dead clients), `check:api-contract` / `check:openapi` (every route keyed and in the
> manifest), plus the module audits (`module entries`, `spec imports`). The route list is `API_INVENTORY.md`
> (generated). Re-checking the rows below against the code on Oct 10 found only naming drift, no missing wiring:
> - Backend paths moved since July: split payments are `/pos/payments/split-payments/*` and
>   `/pos/checkout/tickets/{id}/pay/split` (no top-level `/split-payments`); Super Admin owners are `/super-admin/owners`
>   (no `/super-admin/owner-salons` mount); live presence is `/super-admin/realtime/presence` (no `/super-admin/live`).
> - "AI oversight consoles (5) — 2 have admin screens, 3 backend-ready" is out of date: all five have Super Admin
>   screens (`SuperAdminAiBusinessScreen`, `AiForecastingScreen`, `AiCustomerProfileOversightScreen`,
>   `AiCheckoutUpsellOversightScreen`, `AiReviewReputationOversightScreen`).
> - Since Constitution 13 the domain code lives in `modules/*` (e.g. AI in `modules/ai`), not under `apps/api/src`.
> - `go-check-in-admin` (Other apps table) was removed in Phase 15 (Constitution 13 §388); kiosk devices are managed
>   in admin-web → Check-In Devices (`/check-in-devices`) — `REPOSITORY_ARCHITECTURE_AUDIT.md`.
> The July text is kept below as written.

_Generated 2026-07-09 from the codebase. The full Nest DI graph instantiates (`node apps/api/scripts/di-check.mjs`
→ `DI_GRAPH_OK`), which by construction proves **every controller is registered in a module and every injected
provider resolves** — so the "Nest module / provider / DI" columns are green for every row. "Own audit" = the module
imports AuditService directly; "via host" = its mutations flow through a canonical module (checkout / booking /
customers / reports) that writes the audit event. Money is integer cents everywhere; tenant/branch is server-derived._

Legend for Status: **Fully connected** = sidebar → route → screen → API client → controller → module → service →
repository → Kysely → Postgres → permission → tenant/branch scope all present and green.

## Tenant POS — AI modules (16)

| Module | UI route(s) | Backend prefix | DB migrations | Permission (sample) | Audit | Status |
|---|---|---|---|---|---|---|
| ai-booking (assistant) | /tenant/ai/receptionist/* | /api/ai-booking | base | booking.* | own | Fully connected |
| ai-queue-assignment | /tenant/ai/queue | /pos/ai-queue-assignment, /super-admin/ai-queue-assignment | 331–335 | ai_queue_assignment.assign | via host (queue) | Fully connected |
| ai-scheduling-optimizer | /tenant/ai/scheduling-optimizer | /pos/ai-scheduling-optimizer | 345 | pos.ai_scheduling_optimizer.* | own + via booking | Fully connected (registered + ports bound this merge) |
| ai-business (assistant) | /tenant/ai/business(+branches/alerts/reports) | /pos/ai-business, /super-admin/ai-business | 336–338 | pos.ai_business.view | via host (reports) | Fully connected |
| ai-marketing (+send) | /tenant/ai/marketing/* | /pos/ai-marketing | 320–322 | pos.marketing.manage | via host | Fully connected |
| ai-money-protection | /tenant/ai/money-protection/* | /pos/ai-money-protection | 323–325 | ai_money_protection.investigate | via host (payments) | Fully connected |
| ai-inventory | /tenant/ai/inventory | /pos/ai-inventory | 339 | ai_inventory.manage_recipes | own | Fully connected |
| ai-review-reputation | /tenant/ai/reputation(+settings) | /pos/ai-review-reputation | 343 | pos.ai_review_reputation.manage | own | Fully connected |
| ai-voice-transcription | /tenant/ai/voice-transcription/* | /pos/ai-voice-transcription, /super-admin/voice-transcription | 326–330 | ai_voice_transcription.delete | own | Fully connected |
| ai-ocr-receipt | /tenant/ai/ocr-receipt | /pos/ai-ocr-receipt | 344 | inventory.manage (alias) | own | Fully connected |
| ai-analytics-forecasting | /tenant/ai/analytics | /pos/ai-analytics | 340 | pos.ai_analytics.view | via host (reports) | Fully connected |
| ai-customer-profile | /tenant/ai/customer-profile/* (7) | /pos/ai-customer-profile | 341 | pos.ai_customer_profile.* | own | Fully connected |
| ai-checkout-upsell | /tenant/ai/checkout-upsell/settings | /pos/ai-checkout-upsell | 342 | pos.ai_checkout_upsell.view | own + via checkout | Fully connected |
| reception-copilot | /tenant/ai/copilot | /super-admin/copilot, ai-center | base | reception_copilot.* | own | Fully connected |
| command-center | /tenant/ai/command-center | ai-center | base | ai.use | via host | Fully connected |
| ai-plans/packages | /tenant/ai/plans | /pos/... (catalog) | base | subscription.manage | via host | Fully connected |

## Tenant POS — core operational domains

| Module | UI route | Backend prefix | Permission (sample) | Audit | Status |
|---|---|---|---|---|---|
| booking | /booking | /pos/booking | pos.booking.* | own | Fully connected |
| check-in | /check-in | /pos/check-in | checkin.* | own | Fully connected |
| queue / tech-queue / serving | /queue, /tech-queue, /serving | /pos/queue, /pos/tech-queue, /pos/serving | queue.*, serving.* | own | Fully connected |
| checkout | /checkout | /pos/checkout | pos.checkout.* | own | Fully connected |
| customers | /customers | /pos/customers | pos.customers.* | own | Fully connected |
| services / products / add-ons | /services, /products, /services/add-ons | /pos/services, /pos/service-add-ons | pos.services.* | own | Fully connected |
| technicians / team / time-clock | /technicians, /team/*, /team/time-clock | /pos/technicians, /pos/team, /pos/time-clock | pos.technicians.* | via host | Fully connected |
| payments / split / refunds | /payments/* | /pos/payments, /split-payments, /pos/refunds-voids | pos.checkout.process_payment | own | Fully connected |
| deposit-reconciliation | /payments/deposit-reconciliation | /pos/deposit-reconciliation, /webhooks/bank | reconciliation.* | via host | Fully connected |
| invoices | /payments/invoices | /pos/invoices, /customer/invoices | pos.checkout.process_payment | via host | Fully connected |
| memberships / loyalty | /customers/loyalty, /services/packages | /pos/memberships, /pos/loyalty | pos.memberships.* | own (memberships) | Fully connected |
| referrals / social | /marketing/referrals, /marketing/social | /pos/referrals, /pos/social-posts | pos.marketing.manage | via host | Fully connected |
| reports | /reports/* | /pos/reports | pos.reports.* | own | Fully connected |
| settings / management | /settings, /management/* | /pos/settings | settings.* | own | Fully connected |
| devices / integrations | /devices/*, /integrations/* | /pos/devices, /pos/api-keys, /pos/webhooks | settings.* | own | Fully connected |

## Super Admin — sections (34)

All 129 Super Admin sidebar destinations resolve to a screen (see COMPLETE_ROUTE_INVENTORY.md for the full list).
Representative backend bindings:

| Section | Backend prefix | Status |
|---|---|---|
| Overview / Live / Analytics / Report Builder / Scheduled Reports | /super-admin/{overview,live,analytics,report-builder,scheduled-reports} | Fully connected |
| Tenants / Branches / Users&Roles / Onboarding / Plans / Website Leads / Owner Salons / Tenant Activity | /super-admin/{tenants,tenant-locations,...,onboarding,plans,website-leads,owner-salons,tenant-activity} | Fully connected |
| Appointment / Customer-Data / Workforce Oversight, Booking-Checkin & Queue Monitors | /super-admin/{appointment-oversight,customer-data-oversight,staff,booking-checkin,queue} | Fully connected |
| Service Templates / Product Catalog | /super-admin/{catalog,product-catalog} | Fully connected |
| Payments / Merchant Accounts / Settlements / Disputes / Revenue&Residuals | /super-admin/{merchant-accounts,settlements,disputes,revenue-residuals} | Fully connected |
| Marketing / Promotions / Loyalty / Communications | /super-admin/{campaigns,promotions,loyalty,communications} | Fully connected |
| AI Insights / AI Reports / Smart Reminders / Automation Rules / AI Usage & Config | /super-admin/{ai,ai-reports,smart-reminders,automation-rules,ai-usage via config} | Fully connected |
| General Settings / Billing & Subscriptions / Integrations / Device Mgmt / Security & Compliance / Audit Logs / Support / System Status | /super-admin/{settings,billing,integrations,device...,security,audit-events,support,system-health} | Fully connected |
| AI oversight consoles (5) | /super-admin/{ai-business,ai-customer-profile,ai-checkout-upsell,ai-review-reputation,ai-forecasting} | Backend mounted; 2 have admin screens, 3 backend-ready |

## Other apps

| App | Nav model | Backend | Status |
|---|---|---|---|
| owner-web | 6-tab + drill-down | /owner/* | Fully connected |
| tech-web | 4-tab + drill-down | /tech/* | Fully connected |
| customer-web | react-router (47) | /customer/* (+ SSE /customer/stream) | Fully connected |
| manager-pay-web | screen switch | /mobile-checkout/* | Fully connected |
| customer-display | SSE state machine | /customer-display/* (+ SSE) | Fully connected |
| go-check-in-admin / -kiosk | Capacitor static wrappers | /go-check-in/* | Fully connected |

## No user-facing module left orphaned

Every sidebar item in both primary sidebars resolves to a real screen with a live backend (0 dead links, 0 contract
mismatches — verified by the two wiring specs and the contract scan). Internal modules correctly carry **no** sidebar
entry: realtime SSE gateways, scheduled workers (billing-export, reconciliation sweep, marketing send, follow-up
purge, customer-profile scan), webhook receivers (bank/payments/twilio), security-core, database adapters, and the
`packages/ui` shared component library.


## Cross-app reverse-alignment verification (2026-07-09)

Every app was checked in the reverse direction — does each app's role hold the backend permission for every
RBAC-gated surface it exposes? All clean after the fixes:

| App | Enforcement | Result |
|---|---|---|
| pos-web (tenant) | RBAC per-item roles + @RequirePermission | 134/187 nav items map to an RBAC gate — **0 violations** (53 unmapped are entitlement-gated AI / redirects / feature pages, no role gate) |
| admin-web (Super Admin) | SuperAdminGuard + super_admin.* | all 129 nav dests resolve; every super_admin.* gate reachable by SUPER_ADMIN |
| owner-web | OwnerService.require(owner.*) | OWNER passes **15/15** owner.* gates |
| tech-web | TechService.require(tech.*) | TECHNICIAN passes **14/14** tech.* gates |
| manager-pay-web | mobile_checkout.* | MANAGER passes **6/6** gates |
| customer-web | session/identity-scoped | no RBAC role gates by design (customers see only their own data) |
| customer-display / go-check-in | SSE / static | no role-gated navigation |

Observation (not a defect): a MANAGER using owner-web holds a curated read subset of owner.* (10 of ~16); the 6
withheld are owner-level actions/sensitive views (resolve alerts, manage expenses, export reports, settings.view,
staff.earnings, bookings.details). This reads as intentional graduated access; owner-web's frontend gates
visibility by permission, so a manager is not shown what they cannot use. Left unchanged pending product direction.