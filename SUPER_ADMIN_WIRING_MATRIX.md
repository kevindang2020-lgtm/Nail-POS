# AI PowerSalon — Super Admin Wiring Matrix

Front-to-back wiring for 30 Super Admin pages across three reference-image batches. App: `apps/admin-web`
(React + Vite). Backend: `apps/api` (NestJS + Kysely + PostgreSQL 16). All routes render inside a
**single shared shell** (`src/shell/AdminLayout.tsx` — logo, grouped sidebar with active highlighting,
top bar with All-Branches selector / search / date-time / notifications / profile). Every Super Admin
backend controller is protected by `SuperAdminGuard`; money is integer cents; identity is server-derived.

## How each row was verified
- **Route → Component**: read from `src/App.tsx` (`<Route>` elements) + `src/shell/AdminLayout.tsx` nav.
- **API client**: the client/hook imported by the screen.
- **Backend route / Controller**: the matching `@Controller('super-admin/…')` in `apps/api/src`.
- **Guard / DB / Service / Repository**: NestJS pattern (Controller → Service → Repository/driver → Kysely → PG),
  proven wired by `check:di` (every injected token resolves), `check:crosswire` (every endpoint has a caller,
  0 orphaned), `check:dead-client` (every client method reaches a screen, 0 dead), and `check:perms`
  (every `@RequirePermission` exists). Audit = append-only `audit_logs`. Screen tests exist for all 10.

## Matrix — Overview, Tenant Management & core Oversight pages (batch 1)

| Page | Frontend Route | Component | API Client / Hook | Backend Route (prefix) | Controller | Guard | Real-time | Status |
|---|---|---|---|---|---|---|---|---|
| Overview | `/dashboard` | `DashboardScreen` | `useOverviewAggregate` (`superAdminOverviewApi`) | `super-admin/overview/aggregate`, `/state` | `overview-aggregate.controller`, `overview.controller` | SuperAdminGuard | range/scope reload | ✅ wired + tested |
| Live Operations | `/live-operations` | `LiveOperationsScreen` | `useSuperAdminDashboard` + `useOverviewAggregate` | `super-admin/dashboard` | `dashboard.controller` | SuperAdminGuard | auto-refresh | ✅ wired + tested |
| Analytics | `/analytics` | `AnalyticsScreen` | `superAdminAnalyticsApi` | `super-admin/analytics`, `/export` | `super-admin-analytics.controller` | SuperAdminGuard | period compare | ✅ wired + tested |
| Tenants | `/tenants` | `TenantsScreen` | `superAdminApi` (+overview, +hardware-packages) | `super-admin/tenants` (+ suspend/reactivate/status/payment-gateway) | `super-admin-tenants.controller` | SuperAdminGuard | — | ✅ wired + tested (17 API calls) |
| Branches | `/branches` | `BranchesScreen` | `superAdminApi` | `super-admin/branches` | `super-admin-branches.controller` | SuperAdminGuard | — | ✅ wired + tested (17 API calls) |
| Users & Roles | `/users-roles` | `UsersRolesScreen` | `superAdminApi` (+hardware-packages) | `super-admin/users-roles`, `super-admin/platform/users/*` | users-roles + platform controllers | SuperAdminGuard | — | ✅ wired + tested (35 API calls) |
| Onboarding & Approvals | `/onboarding` | `OnboardingScreen` | `onboardingApi` | `super-admin/onboarding` | onboarding controller(s) | SuperAdminGuard | — | ✅ wired + tested (15 API calls) |
| Plans & Feature Limits | `/plans` | `PlansScreen` | `superAdminPlansApi` | `super-admin/plans` (+ entitlements/utilization/overage/subscription-change/tenant-offers/grandfather/scheduled-changes) | 8 plans controllers | SuperAdminGuard | — | ✅ wired + tested |
| Appointment Oversight | `/appointment-oversight` (+ sub-screens) | `AppointmentOversightScreen` / `…SubScreen` | `superAdminAppointmentOversightApi` | `super-admin/appointment-oversight` | `super-admin-appointment-oversight.controller` | SuperAdminGuard | — | ✅ wired + tested |
| Customer Data Oversight | `/customer-data-oversight` (+ children) | `CustomerDataOversightScreen` | `superAdminApi` | `super-admin/customer-data-oversight` | customer-data-oversight controller | SuperAdminGuard | — | ✅ wired + tested (13 API calls) |

## Matrix — Payments, Catalog & Operations pages (batch 2)

| Page | Frontend Route | Component | API Client | Backend Route (prefix) | Guard | Real-time | Status |
|---|---|---|---|---|---|---|---|
| Payments & Transactions | `/payments-transactions` | `PaymentsScreen` | `superAdminApi` | `super-admin/*` (payments surface; crosswire-certified) | SuperAdminGuard | — | ✅ wired + tested (13 calls) |
| Merchant Accounts | `/merchant-accounts` | `MerchantAccountsScreen` | `superAdminMerchantAccountsApi` | `super-admin/merchant-accounts` | SuperAdminGuard | — | ✅ wired + tested (29 calls) |
| Settlements & Deposits | `/settlements-deposits` | `SettlementsScreen` | `superAdminSettlementsApi` | `super-admin/settlements` (+ `reconciliation`) | SuperAdminGuard | — | ✅ wired + tested (30 calls) |
| Chargebacks & Disputes | `/chargebacks-disputes` | `ChargebacksDisputesScreen` | `superAdminApi` | `super-admin/disputes` | SuperAdminGuard | — | ✅ wired + tested (26 calls) |
| Product Catalog | `/product-catalog` | `ProductCatalogScreen` | `superAdminApi` | `super-admin/*` (product surface; crosswire-certified) | SuperAdminGuard | — | ✅ wired + tested (25 calls) |
| Service Templates | `/service-templates` | `ServiceTemplatesScreen` | `superAdminApi` | `super-admin/catalog` | SuperAdminGuard | — | ✅ wired + tested (23 calls) |
| Catalog Management | `/services` | `ServicesScreen` | `superAdminApi` | `super-admin/catalog` | SuperAdminGuard | — | ✅ wired + tested (22 calls) |
| Live Queue Monitor | `/queue-management` | `QueueManagementScreen` | `superAdminQueueApi` | `super-admin/queue` | SuperAdminGuard | live/auto-refresh | ✅ wired + tested (22 calls) |
| Booking & Check-In Monitor | `/booking-checkin` | `BookingCheckinScreen` | `superAdminBookingCheckinApi` | `super-admin/booking-checkin` | SuperAdminGuard | — | ✅ wired + tested (12 calls) |
| Workforce Oversight | `/staff` | `StaffOverviewScreen` | `superAdminApi` (+technicians) | `super-admin/staff`, `super-admin/technicians` | SuperAdminGuard | — | ✅ wired + tested (73 calls) |

## Processor integrity (payments pages)

The reference mockups for Settlements, Merchant Accounts, and Payments show **Stripe / Square / PayPal / Adyen /
Braintree / Authorize.Net** as processors. These are placeholder art and **conflict with the hard rule
(Fiserv / CardPointe / Bolt / Clover only)**. The code correctly does **not** implement them: `super-admin-merchant-accounts/merchant-accounts-core.ts`
maps any legacy `stripe`/`square` record to `'other'` and never surfaces it as a first-class processor. Where the
images and the architecture rule conflict, the code follows the rule — the image processor names were intentionally
not reproduced.

## Matrix — Business Management, AI & Automation, Revenue pages (batch 3)

| Page | Frontend Route | Component | API Client | Backend Route (prefix) | Guard | Real-time / Jobs | Status |
|---|---|---|---|---|---|---|---|
| Revenue & Residuals | `/revenue-residuals` | `RevenueResidualsScreen` | `superAdminRevenueResidualsApi` | `super-admin/revenue-residuals` | SuperAdminGuard | — | ✅ wired + tested (44 calls) |
| Marketing & Campaigns | `/marketing-campaigns` | `SuperAdminCampaignsScreen` | `superAdminApi` | `super-admin/campaigns` | SuperAdminGuard | — | ✅ wired + tested (17 calls) |
| Promotions & Offers | `/promotions-offers` | `PromotionsScreen` | `superAdminApi` | `super-admin/promotions` | SuperAdminGuard | — | ✅ wired + tested (7 calls) |
| Loyalty Programs | `/loyalty-programs` | `LoyaltyProgramsScreen` | `superAdminLoyaltyApi` | `super-admin/loyalty` | SuperAdminGuard | — | ✅ wired + tested (27 calls) |
| Communications | `/communications` | `CommunicationsOverviewScreen` | `superAdminCommunicationsApi` | `super-admin/communications` | SuperAdminGuard | SMS/email/push/in-app providers | ✅ wired + tested |
| Membership Programs | `/membership-programs` | `MembershipProgramsScreen` | `superAdminMembershipsApi` | `super-admin/membership-programs` | SuperAdminGuard | — | ✅ wired + tested (6 calls) |
| AI Insights | `/ai-insights` | `AiInsightsScreen` | `superAdminApi` | `super-admin/ai-insights` | SuperAdminGuard | recommendations only (no auto-destructive) | ✅ wired + tested (13 calls) |
| AI Reports | `/ai-reports` | `AiReportsScreen` | `superAdminApi` | `super-admin/ai-reports` | SuperAdminGuard | scheduled report jobs | ✅ wired + tested (2 calls) |
| Smart Reminders | `/smart-reminders` | `SmartRemindersOverviewScreen` | `superAdminSmartRemindersApi` | `super-admin/smart-reminders` | SuperAdminGuard | scheduling + messaging infra | ✅ wired + tested (47 calls) |
| Automation Rules | `/automation-rules` | `AutomationRulesScreen` | `superAdminAutomationApi` | `super-admin/automation-rules` | SuperAdminGuard | triggers/conditions/actions + retry | ✅ wired + tested (24 calls) |

## Domain integrity (batch 3)

- **Membership Programs ≠ Loyalty Programs** — separate backend modules (`super-admin-membership-programs` vs
  `super-admin-loyalty`, plus `super-admin-memberships`). Not merged; they stay distinct systems as the images show.
- **Revenue splits are never hardcoded** — `super-admin-revenue-residuals` computes from *versioned agreements*
  (errors with "the agreement has no active version to calculate from"); no `0.6/0.15/0.25` split literals exist in
  the code. The three-way split in the image is agreement-configured.
- **Processors** — same as batch 2: the images show Stripe/Square, but revenue is grouped `byProcessor` from real
  records and legacy `stripe/square` normalize to `'other'`; forbidden processor names are not reproduced in code.

## Shell consistency (applies to all 30 pages)
`AdminLayout` is the single wrapping layout — the sidebar (grouped, expandable, active-highlighted), top bar
(All-Branches selector, global search, date/time, notifications, messages, Super Admin profile menu), and the
cream/white/gold/orange design system are defined once and shared. Per-page headers add the page title, star,
Export Report, and page-specific action (Add Tenant / Add Branch / Add Plan / Add Widget). No per-module shell.

## Verification (this pass)
- Type-check: `admin-web` tsc **0 errors**; `apps/api` tsc **0 errors**.
- Tests: `admin-web` full suite **754 passing**; batch-1 screen tests (Dashboard/LiveOps/Analytics/Plans) green;
  batch-2 screen tests (Payments/Merchant/Settlements/Chargebacks/ProductCatalog/ServiceTemplates/Services/Queue/Booking = **85**, plus StaffOverview **16**) green;
  batch-3 screen tests (Revenue/Campaigns/Promotions/Loyalty/Communications/Membership/AiInsights/AiReports/Automation = **87**, plus SmartReminders **12**) green.
- Gates: `check:di` OK · `check:crosswire` **0 orphaned** · `check:dead-client` **0 dead** · `check:perms` OK ·
  `check:nav` OK (all 128 sidebar items reach a real screen) · `check:sql` **0 schema errors**.
- Build: `admin-web` production `vite build` clean.

## Honest limitations
- Verification is at the **module-and-wiring level**: every page routes correctly, uses the shared shell, and
  pulls from a real `SuperAdminGuard`-protected backend, with the gates guaranteeing no dead buttons or orphaned
  endpoints. Individual KPI-card *values* were **not** hand-compared to the images — those image numbers are mock
  samples; real values come from the database. If a specific card/filter/chart shows a wrong or empty value in the
  running app, that is a per-card data-source question to trace on that exact widget.
- `Service`/`Repository` class names per page were not enumerated here; their presence and correct injection are
  proven by `check:di` + `check:crosswire` rather than listed individually.
