# Frontend ↔ Backend Connection Map

Generated from a live scan of the monorepo. Every frontend API call was matched against the backend controllers; the
result is **0 disconnected calls** — 368 frontend API calls across the apps all resolve to real route families.

Apps: `apps/api` (NestJS + Kysely + Postgres) · `pos-web` · `admin-web` (Super Admin) · `customer-web` · `tech-web` ·
`owner-web` · `customer-display`.

Auth is shared: every app authenticates via `/auth` (`auth.controller`, plus `/auth/mfa`, `/auth/password-reset`).
Realtime is delivered over Server-Sent Events from `/realtime` (`realtime.controller`) plus per-surface realtime
controllers (`owner-realtime`, `tech-realtime`, `customer-realtime`); the POS surfaces subscribe to the same push bus.

## POS (pos-web) modules

| Module | Frontend screen | API client | Backend route → controller | Service (module) | Primary DB table(s) | Realtime | Status |
|---|---|---|---|---|---|---|---|
| Dashboard | `DashboardScreen` | `posDashboardApi` | `/pos/dashboard` → `dashboard.controller` | dashboard | `appointments`, `tickets`, `branches` | SSE | ✅ connected |
| Overview | `POSOverviewScreen` | `posOverviewApi` | `/pos/overview` → `overview.controller` | overview | `tickets`, `appointments`, `customers` | SSE | ✅ connected |
| Check-In | `CheckInScreen` | `checkInApi` | `/pos/check-in` → `check-in.controller` | check-in | `appointments`, `customers` | SSE (check-in) | ✅ connected |
| Booking | `BookingScreen` | `bookingApi` | `/pos/booking` → `booking.controller` | booking | `appointments`, `appointment_service_lines` | SSE (booking) | ✅ connected |
| Tech Appointments | `TechAppointmentsScreen` | `techAppointmentsApi` | `/pos/tech-appointments` → `tech-appointments.controller` | tech-appointments | `appointments`, `technicians` | SSE | ✅ connected |
| Live Technician Schedule | `LiveScheduleScreen` | `liveScheduleApi` | `/pos/technicians` → `live-technician-schedule.controller` | live-technician-schedule | `appointments`, `technicians` | SSE | ✅ connected |
| Tech Queue | `TechQueueScreen` | `techQueueApi` | `/pos/tech-queue` → `tech-queue.controller` | tech-queue | `tickets`, queue projection | SSE | ✅ connected |
| Queue | `QueueScreen` | `queueApi` | `/pos/queue` → `queue.controller` | queue | `tickets` | SSE (queue) | ✅ connected |
| Serving | `ServingScreen` | `servingApi` | `/pos/serving` → `serving.controller` | serving | `tickets` | SSE | ✅ connected |
| Service Done | `ServiceDoneScreen` | `serviceDoneApi` | `/pos/service-done` → `service-done.controller` | service-done | `tickets` | SSE | ✅ connected |
| Checkout | `POSCheckoutScreen` | `posCheckoutApi`, `posPaymentGatewayApi` | `/pos/checkout`, `/pos/payment-gateway` → `checkout.controller`, `pos-payment-gateway.controller` | checkout | `tickets`, `payments` | SSE | ✅ connected |
| Customers | `CustomersScreen` | `customersApi` | `/pos/customers` → `customers.controller` | customers | `customers`, `customer_addresses` | — | ✅ connected |
| Technicians | `TechniciansScreen` | `techniciansApi` | `/pos/technicians` → `technicians.controller`, `pos-tech-profile.controller` | technicians | `technicians`, `users` | — | ✅ connected |
| Services | `ServicesScreen` | `servicesApi` | `/pos/services` → `services.controller` | services | `services` | — | ✅ connected |
| Reports | `ReportsScreen` | `reportsApi` | `/pos/reports` → `reports.controller` | reports | `tickets`, `payments`, `appointments` | — | ✅ connected |
| Settings | `SettingsScreen` | `settingsApi` | `/pos/settings` → `settings.controller` | settings | `tenant_settings` | SSE (settings) | ✅ connected |
| Payment reconciliation | (admin/reporting) | `paymentsApi` | `/pos/payments` → `payment-reconciliation.controller` | payments | `payments` | — | ✅ connected |
| Customer-display control | `CustomerDisplayAdminScreen` | `customerDisplayApi` | `/pos/customer-display` → `customer-display.controller` | customer-display | `customer_display_devices`, `customer_display_sessions` | SSE (device) | ✅ connected |
| NailShowcase (POS) | `NailShowcaseScreen` | `nailShowcaseApi` | `/pos/nail-showcase` → `nail-showcase.pos.controller` | nail-showcase | `nail_showcase_posts` | — | ✅ connected |
| Project status (POS) | `ProjectStatusScreen` | `posProjectStatusApi` | `/pos/project-status` → `pos-project-status.controller` | pos-project-status | project status tables | — | ✅ connected |
| End-of-day follow-ups | (POS) | `followUpsApi` | `/pos/follow-ups` → `end-of-day-followups.pos.controller` | end-of-day-followups | `follow_ups` | — | ✅ connected |

## Super Admin (admin-web)

| Module | Frontend screen | API client | Backend route → controller | DB table(s) | Status |
|---|---|---|---|---|---|
| SA Dashboard | `SuperAdminDashboardScreen` | `superAdminDashboardApi` | `/super-admin/dashboard` → `super-admin-dashboard/dashboard.controller` | tenants, aggregate metrics | ✅ connected |
| Tenants | `TenantsScreen` | `superAdminTenantsApi` | `/super-admin` → `super-admin-tenants.controller` | `tenants`, `branches`, `users` | ✅ connected |
| Billing | `BillingScreen` | `billingApi` | `/super-admin/billing` → `billing.controller` | subscription/usage tables | ✅ connected |
| Platform controls | `PlatformScreen` | `platformApi` | `/super-admin/platform` → `super-admin-platform.controller` | platform config | ✅ connected |
| System health | `SystemHealthScreen` | `systemHealthApi` | `/super-admin/system-health` → `system-health.controller` | health probes | ✅ connected |
| Project status | `ProjectStatusScreen` | `projectStatusApi` | `/super-admin/project-status` → `project-status.controller` | project status tables | ✅ connected |
| NailShowcase moderation | `NailShowcaseAdminScreen` | `nailShowcaseAdminApi` | `/super-admin/nail-showcase` → `nail-showcase.super-admin.controller` | `nail_showcase_posts` | ✅ connected |
| Public website content | (platform) | `publicWebsiteApi` | `/public/website` → `public-website.controller` | tenant public content | ✅ connected |

## Customer App (customer-web)

| Module | API client | Backend route → controller | DB table(s) | Status |
|---|---|---|---|---|
| Auth / registration | `customerAuthApi` | `/customer/auth` → `customer-registration.controller` | `customers`, `users` | ✅ connected |
| Profile / account | `customerApi` | `/customer` → `customer.controller`, `customer-realtime.controller` | `customers` | ✅ connected |
| Booking | `customerBookingApi` | `/customer/booking` → `customer-booking.controller` | `appointments` | ✅ connected |
| Salon directory | `customerSalonsApi` | `/customer/salons` → `customer-salons.controller` | `tenants`, `branches` | ✅ connected |
| Favorite salons / techs | `customerFavoritesApi` | `/customer/me/favorite-salons` → `customer-favorites.controller` | `customer_favorite_salons`, `customer_favorite_techs` | ✅ connected |
| Payments / wallet | `customerPaymentsApi`, `customerWalletApi` | `/customer` → `customer-payments.controller`, `customer-wallet.controller` | `payments`, wallet tables | ✅ connected |
| Social (follow/block/feed) | `customerSocialApi`, `customerFollowApi` | `/customer` → `nail-showcase-social.controller`, `nail-showcase.controller` | `customer_follows`, `customer_blocks`, `nail_showcase_posts` | ✅ connected |
| Follow-ups | `followUpsApi` | `/customer/follow-ups` → `end-of-day-followups.customer.controller` | `follow_ups` | ✅ connected |

## Technician App (tech-web)

| Module | API client | Backend route → controller | DB table(s) | Status |
|---|---|---|---|---|
| Auth / dashboard | `techApi` | `/tech` → `tech.controller`, `tech-realtime.controller` | `technicians`, `tickets` | ✅ connected |
| Profile | `techProfileApi` | `/tech/profile` → `tech-profile.controller` | `technicians`, media | ✅ connected |
| Tickets / schedule / queue | `techApi` | `/tech` (+ `/pos/tech-queue` projection) | `tickets`, `appointments` | ✅ connected |
| Follow-ups | `followUpsApi` | `/tech/follow-ups` → `end-of-day-followups.tech.controller` | `follow_ups` | ✅ connected |

## Owner App (owner-web)

| Module | Frontend screen | API client | Backend route → controller | DB table(s) | Status |
|---|---|---|---|---|---|
| Home / KPIs | `OwnerHomeScreen` | `ownerApi` | `/owner` → `owner.controller`, `owner-realtime.controller` | `branches`, `appointments`, `tickets` | ✅ connected |
| Branch performance | `BranchPerformanceScreen` | `ownerApi` | `/owner` | `branches`, `tickets` | ✅ connected |
| Booking overview | `BookingOverviewScreen` | `ownerApi` | `/owner` | `appointments` | ✅ connected |
| Staff performance | `StaffPerformanceScreen` | `ownerApi` | `/owner` | `technicians`, `tickets` | ✅ connected |
| Finance & Reports | `FinanceReportsScreen` | `ownerApi` | `/owner` | `payments`, `tickets`, `expenses` | ✅ connected |
| Alerts | `AlertsScreen` | `ownerApi` | `/owner` | alerts/audit tables | ✅ connected |
| Audit log | `AuditScreen` | `ownerApi` | `/owner` | audit tables | ✅ connected |
| Expenses | `ExpensesScreen` | `ownerApi` | `/owner` | `expenses` | ✅ connected |
| More | `MoreScreen` | `ownerApi` | `/owner` | — | ✅ connected |

## Customer Display (customer-display)

| Surface | Backend route → controller | DB table(s) | Realtime | Status |
|---|---|---|---|---|
| Token-scoped public display | `/customer-display` → `customer-display.controller` (public) + `customer-display-admin.controller` | `customer_display_devices`, `customer_display_sessions` | SSE (device push) | ✅ connected |

## Verification basis

- **Build (type alignment across the boundary):** all 7 apps build clean (`tsc --noEmit && vite build`; API `tsc` clean).
- **Static wiring:** 368 frontend API calls → all resolve to the controllers above (0 orphans).
- **Runtime:** e2e journeys drive real HTTP login → checkout → dashboards across POS/customer/tech/owner + RBAC + RLS,
  green in CI (`e2e-postgres`, `e2e-cardpointe`) and via `npm run e2e:live`.
