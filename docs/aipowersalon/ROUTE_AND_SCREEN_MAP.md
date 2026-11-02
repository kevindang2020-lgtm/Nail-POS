# ROUTE & SCREEN MAP — AI PowerSalon (Phase 0)

## Existing API namespaces (reuse; do not invent parallel paths)
`/pos/*` (35 controllers) · `/super-admin/*` (16) · `/owner/*` (3) · `/tenant/*` (4) · `/tech/*` (6) · `/technician/*` · `/customer/*` (13) · `/customer-display/*` · `/go-check-in/*` · `/ai/*` · `/platform/*` · `/webhooks/*` · `/push`, `/realtime` (SSE) · `/auth/*` · `/jobs`, `/internal`, `/health`, `/public`.

Tenant screens call `/pos/*` (+ `/tenant/*`, `/ai/*`). Super Admin screens call `/super-admin/*` (+ `/platform/*`). New endpoints extend these namespaces; they are not new top-level prefixes.

## Tenant screen → route/screen (pos-web)
| Ref | Existing pos-web screen | Existing route/api | Action |
|---|---|---|---|
| T01 Dashboard | POSDashboardScreen / POSOverviewScreen | /pos/* dashboards | refactor to T01 layout |
| T02 Analytics | (FeaturePage stub) | — | build (reuse report/analytics services) |
| T03 Check-In | POSCheckInScreen | /pos/check-in/* | keep + align |
| T04 Booking | POSBookingScreen | /pos/booking/* | keep + align |
| T05 Tech Queue | POSTechQueueScreen | /pos/tech-queue/* | keep + align |
| T06 Customer Queue | POSQueueScreen | /pos/queue/* | keep + align |
| T07 Serving | POSServingScreen | /pos/serving/* | keep + align |
| T08 Service Done | POSServiceDoneScreen | /pos/service-done/* | keep + align |
| T09 Checkout | POSCheckoutScreen | /pos/checkout/* | keep + align |
| T10 Customers | POSCustomersScreen | /pos/customers/* | keep + expand |
| T11 Team | POSTechniciansScreen | /pos/technicians/* | keep + expand to Team |
| T12 Services & Products | POSServicesScreen + TenantInventoryScreen | /pos/services, inventory | merge into one Services & Products |
| T13 Payments & Money | (partial; cash drawer/handoff exist) | /pos/checkout, cash | build subsections (overview/txns/refunds/payouts/tips/due) |
| T14 Communications | POSMessagesScreen | /pos/messages/* | expand to unified inbox |
| T15 Marketing & Growth | (FeaturePage stub) | — | build (new campaigns/promotions) |
| T16 AI Center | (AI packages exist; admin-side) | /ai/*, AI packages | build tenant AI center |
| T17 Reports | POSReportsScreen | /pos/reports/* | keep + align to report list |
| T18 Management | (partial; follow-ups, skill requests) | /pos/* | build manager command center |
| T19 Devices & Integrations | CheckInDevices (admin) / terminals | device tables | build tenant device+integration view |
| T20 Account | POSSettingsScreen | /pos/settings/* | refactor to Account |
| T21 Help Center | ComingSoon / FeaturePage | — | build help center |

## Super Admin screen → route/screen (admin-web)
| Ref | Existing admin-web screen | Action |
|---|---|---|
| S01 Overview / S02 Dashboard | DashboardScreen | split into Overview + Dashboard (no dup route) |
| S03 Analytics | PlatformReportsScreen (partial) | build Analytics |
| S04 Branches | (tenant/branch in TenantsScreen) | build Branches |
| S05 Users & Roles | UsersRolesScreen | keep + align |
| S06 Services / S07 Products / S08 Appointments | — | build (platform-wide, tenant-aware) |
| S09 Payments & Transactions | PaymentGatewaysScreen, HardwarePayments* | build txn explorer/reconciliation |
| S10 Marketing / S11 Promotions / S12 Communications | — | build |
| S13 AI Insights / S14 AI Reports / S15 Reminders / S16 Automation | AIPackages/AiSubscriptions (partial) | build |
| S17 General Settings | SettingsScreen | keep + align tabs |
| S18 Billing & Subscription | BillingScreen, UsageLimitsScreen, SubscriptionsScreen | merge + align |
| S19 Integrations | PaymentGatewaysScreen (partial) | build |
| S20 Devices Management | CheckInDevicesScreen, HardwareScreen | build fleet view |
| S21 Security & Compliance | (auth/mfa exist) | build |
| S22 Audit Logs | AuditLogsScreen | keep + align |
| S23 Help Center | — | build |
| SA Customers / Staff / Booking&Check-in / Queue / Loyalty (pictureless) | — | build on SA shell, tenant-aware, audited |

Existing admin-web modules with no direct ref (TenantApplications, WebsiteLeads, Hardware*, Support Access, System Health) are **kept** under the appropriate S-group (Operations/System), never deleted.
