# ROUTE_INVENTORY.md — generated from the merged code (admin-web routes, nav, API controllers)

_Generated during the seven-package consolidation by parsing `App.tsx`, `AdminLayout.tsx`, and every_
_`@Controller` in `apps/api/src`. Regenerate rather than hand-edit._
_Sidebar flags updated 2026-07-03 by the full-wiring pass (see SIDEBAR_FULL_WIRING_REPORT.md): every built admin module is now sidebar-reachable._

## admin-web (Super Admin) — 112 routes

| Path | Screen | In sidebar |
|---|---|---|
| // | AdminLayout | — |
| /dashboard | DashboardScreen | yes |
| /tenants | TenantsScreen | yes |
| /tenant-applications | ApplicationsScreen | yes |
| /alerts | AlertsScreen | yes |
| /website-leads | WebsiteLeadsScreen | yes |
| /hardware-packages | HardwarePackagesScreen | yes |
| /hardware-payments | HardwarePaymentsScreen | yes |
| /hardware-payment-reports | HardwarePaymentReportsScreen | yes |
| /payment-gateways | PaymentGatewaysScreen | yes |
| /check-in-devices | CheckInDevicesScreen | yes |
| /subscriptions | BillingScreen | yes |
| /billing | Navigate | — |
| /ai-packages | AIPackagesScreen | yes |
| /ai-plans | AIPlansScreen | yes |
| /ai-subscriptions | AiSubscriptionsScreen | yes |
| /usage-limits | UsageLimitsScreen | yes |
| /plans | PlansScreen | yes |
| /users-roles | UsersRolesScreen | yes |
| /owner-salons | SuperAdminOwnersScreen | yes |
| /support-access | SupportAccessScreen | yes |
| /platform-reports | PlatformReportsScreen | yes |
| /nail-showcase | SuperAdminNailShowcaseModerationScreen | yes |
| /system-health | SystemHealthScreen | yes |
| /audit-logs | AuditLogsOverviewScreen | yes |
| /audit-logs/browse | AuditLogsScreen | yes |
| /tenant-activity | TenantActivityScreen | yes |
| /report-builder | ReportBuilderScreen | yes |
| /scheduled-reports | ScheduledReportsScreen | yes |
| /revenue-residuals | RevenueResidualsScreen | yes |
| /appointment-oversight/search | AppointmentOversightSubScreen | yes |
| /appointment-oversight/booking-source | AppointmentOversightSubScreen | yes |
| /appointment-oversight/failures | AppointmentOversightSubScreen | yes |
| /appointment-oversight/duplicates | AppointmentOversightSubScreen | yes |
| /appointment-oversight/overlapping | AppointmentOversightSubScreen | yes |
| /appointment-oversight/rescheduled | AppointmentOversightSubScreen | yes |
| /appointment-oversight/change-history | AppointmentOversightSubScreen | yes |
| /appointment-oversight/missing-info | AppointmentOversightSubScreen | yes |
| /appointment-oversight/sync-failures | AppointmentOversightSubScreen | yes |
| /settlements-deposits | SettlementsScreen | yes |
| /onboarding | OnboardingScreen | yes |
| /onboarding/business-info | OnboardingScreen | yes |
| /onboarding/identity | OnboardingScreen | yes |
| /onboarding/legal | OnboardingScreen | yes |
| /onboarding/merchant | OnboardingScreen | yes |
| /onboarding/bank | OnboardingScreen | yes |
| /onboarding/hardware | OnboardingScreen | yes |
| /onboarding/data-import | OnboardingScreen | yes |
| /onboarding/training | OnboardingScreen | yes |
| /onboarding/final-review | OnboardingScreen | yes |
| /onboarding/activations | OnboardingScreen | yes |
| /onboarding/approvals | OnboardingScreen | yes |
| /queue-management | QueueManagementScreen | yes |
| /queue-management/timelines | QueueManagementScreen | yes |
| /queue-management/stuck | QueueManagementScreen | yes |
| /queue-management/sync | QueueManagementScreen | yes |
| /queue-management/wait-times | QueueManagementScreen | yes |
| /settings | GeneralSettingsScreen | yes |
| /account | SettingsScreen | — |
| /project-status | ProjectStatusScreen | yes |
| /live-operations | LiveOperationsScreen | yes |
| /platform-dashboard | PlatformDashboardScreen | yes |
| /analytics | AnalyticsScreen | yes |
| /branches | BranchesScreen | yes |
| /services | ServicesScreen | yes |
| /product-catalog | ProductCatalogScreen | yes |
| /service-templates | ServiceTemplatesScreen | yes |
| /products | Navigate | — |
| /appointment-oversight | AppointmentOversightScreen | yes |
| /ticket-oversight | TicketOversightScreen | yes |
| /membership-programs | MembershipProgramsScreen | yes |
| /memberships | Navigate | — |
| /appointments | Navigate | — |
| /customer-data-oversight | CustomerDataOversightScreen | yes |
| /customer-data-oversight/import-history | ImportHistoryScreen | yes |
| /customer-data-oversight/legal-hold | LegalHoldScreen | yes |
| /customer-data-oversight/deletion-requests | DeletionRequestsScreen | yes |
| /customer-data-oversight/duplicate-detection | DuplicateDetectionScreen | yes |
| /customer-data-oversight/merge-history | MergeHistoryScreen | yes |
| /customer-data-oversight/audit-history | AuditHistoryScreen | yes |
| /customer-data-oversight/privacy-requests | PrivacyRequestsScreen | yes |
| /customer-data-oversight/data-exports | DataExportsScreen | yes |
| /customer-data-oversight/:view | CustomerDataOversightScreen | yes |
| /ai-usage-configuration | AiUsageConfigScreen | yes |
| /system-status | SystemStatusScreen | yes |
| /merchant-accounts | MerchantAccountsScreen | yes |
| /booking-checkin/failed-events | FailedEventsScreen | yes |
| /booking-checkin/device-status | DeviceStatusScreen | yes |
| /booking-checkin/ai-handoffs | AiHandoffsScreen | yes |
| /booking-checkin/booking-sources | BookingSourcesScreen | yes |
| /booking-checkin/check-in-performance | CheckinPerformanceScreen | yes |
| /booking-checkin/wait-time-analysis | WaitTimeAnalysisScreen | yes |
| /customers | Navigate | — |
| /staff | StaffOverviewScreen | yes |
| /booking-checkin | BookingCheckinScreen | yes |
| /payments-transactions | PaymentsScreen | yes |
| /chargebacks-disputes | ChargebacksDisputesScreen | yes |
| /marketing-campaigns | SuperAdminCampaignsScreen | yes |
| /promotions-offers | PromotionsScreen | yes |
| /loyalty-programs | LoyaltyProgramsScreen | yes |
| /communications | CommunicationsOverviewScreen | yes |
| /communications/inbox | CommunicationsScreen | yes |
| /ai-insights | AiInsightsScreen | yes |
| /ai-reports | AiReportsScreen | yes |
| /smart-reminders | SmartRemindersOverviewScreen | yes |
| /smart-reminders/performance | SmartRemindersScreen | yes |
| /automation-rules | AutomationRulesScreen | yes |
| /integrations | IntegrationsScreen | yes |
| /devices-management | DevicesScreen | yes |
| /security-compliance | SecurityScreen | yes |
| /help-center | HelpCenterScreen | — |
| /* | Navigate | — |

## pos-web — 50 routes

`//`, `/overview`, `/tenant/overview`, `/dashboard`, `/live-operations`, `/tenant/dashboard`, `/check-in`, `/queue`, `/serving`, `/service-done`, `/checkout`, `/cash-handoffs`, `/cash-drawer`, `/booking`, `/tech-queue`, `/tech-appointments`, `/technicians`, `/technicians/schedule`, `/technicians/skill-requests`, `/services`, `/tenant/payments/overview`, `/tenant/ai/command-center`, `/tenant/ai/plans`, `/tenant/management/overview`, `/tenant/devices/overview`, `/tenant/account/overview`, `/tenant/account/activity-logs`, `/tenant/account/security`, `/tenant/account/subscription`, `/tenant/account/users-roles`, `/tenant/account/billing`, `/tenant/account/support`, `/customers`, `/tenant/customers/memberships`, `/messages`, `/nail-showcase`, `/follow-ups`, `/settings/follow-ups`, `/reports`, `/settings`, `/tenant/management/locations`, `/tenant/inventory`, `/tenant/inventory/vendors`, `/tenant/integrations/api-webhooks`, `/tenant/devices/logs`, `/tenant/marketing/campaigns`, `/tenant/communications/sms`, `/tenant/team/payroll`, `/tenant/team/members`, `/*`

## owner-web — 0 routes

_single-screen app_

## tech-web — 0 routes

_single-screen app_

## customer-web — 46 routes

`//`, `//visit`, `//appointments`, `//find-salons`, `//find-techs`, `//salons/:salonId/techs`, `//techs/:slug`, `//rate-tech/:ticketId/:technicianId`, `//appointments/:appointmentId`, `//queue`, `//notifications`, `//deals`, `//membership`, `//profile/addresses`, `//profile/settings`, `//profile/help`, `//legal/privacy`, `//legal/terms`, `//profile/delete-account`, `//profile/payment-methods`, `//check-in`, `//appointments/:id/reschedule`, `//transactions`, `//book`, `//assistant`, `//nail-showcase`, `//nail-showcase/create`, `//nail-showcase/share/:ticketId`, `//nail-showcase/leaderboard`, `//nail-showcase/:postId`, `//social/me`, `//social/edit`, `//social/following-feed`, `//social/profile/:customerId`, `//social/profile/:customerId/followers`, `//social/profile/:customerId/following`, `//receipts`, `//follow-ups`, `//follow-ups/:id`, `//rewards`, `//wallet`, `//pay`, `//profile`, `//profile/my-photos`, `//profile/edit`, `/*`

## customer-display — 0 routes

_single-screen app_

## manager-pay-web — 0 routes

_single-screen app_

## API controllers

| Prefix | Declared in | Endpoints | Guard(s) |
|---|---|---|---|
| /ai | ai-assistant.controller.ts | 2 | session |
| /auth | account.controller.ts | 1 | session |
| /auth | auth.controller.ts | 5 | session |
| /auth | system-reset.controller.ts | 4 | session |
| /auth/mfa | mfa.controller.ts | 3 | session |
| /auth/password-reset | password-reset.controller.ts | 3 | session |
| /customer | account.controllers.ts | 1 | session |
| /customer | customer-payments.controller.ts | 5 | session |
| /customer | customer-realtime.controller.ts | 0 | session |
| /customer | customer-skip-line.controller.ts | 5 | session |
| /customer | customer-tech.controller.ts | 12 | session |
| /customer | customer-wallet.controller.ts | 1 | session |
| /customer | customer.controller.ts | 24 | session |
| /customer | nail-photo-consent.controller.ts | 2 | session |
| /customer | nail-showcase-social.controller.ts | 16 | session |
| /customer | nail-showcase.controller.ts | 15 | session |
| /customer-display | customer-display-admin.controller.ts | 1 | session |
| /customer-display | customer-display.controller.ts | 10 | session |
| /customer/auth | customer-registration.controller.ts | 1 | session |
| /customer/booking | customer-booking.controller.ts | 4 | session |
| /customer/follow-ups | end-of-day-followups.customer.controller.ts | 5 | session |
| /customer/me/favorite-salons | customer-favorites.controller.ts | 3 | session |
| /customer/salons | customer-salons.controller.ts | 3 | session |
| /go-check-in | go-check-in.public.controller.ts | 13 | session |
| /health | health.controller.ts | 1 | session |
| /integrations/inbound | integration-webhook.controller.ts | 1 | session |
| /internal/ai-billing | ai-subscription-billing.service.ts | 4 | session |
| /internal/hardware-payment | hardware-payment.cron.controller.ts | 1 | session |
| /internal/membership-billing | membership-billing.controller.ts | 5 | session |
| /internal/scheduled-reports | scheduled-reports.cron.controller.ts | 1 | session |
| /internal/tenant-warnings | tenant-warning-dispatch.cron.controller.ts | 1 | session |
| /jobs | reminders.controller.ts | 1 | session |
| /me/access-requests | my-access-requests.controller.ts | 3 | session |
| /mobile-checkout | mobile-checkout.controller.ts | 17 | session |
| /owner | account.controllers.ts | 1 | session |
| /owner | owner-realtime.controller.ts | 0 | session |
| /owner | owner.controller.ts | 53 | session |
| /owner/compensation | compensation.controller.ts | 8 | session |
| /owner/hardware-payment | hardware-payment.owner.controller.ts | 5 | session |
| /platform | branding.controller.ts | 1 | SuperAdminGuard |
| /pos | cash-drawer.pos.controller.ts | 6 | session |
| /pos | pos-skip-line.controller.ts | 5 | session |
| /pos | tech-cash-handoff.pos.controller.ts | 3 | session |
| /pos/api-keys | api-webhooks.controller.ts | 4 | session |
| /pos/audit | audit.controller.ts | 1 | SuperAdminGuard |
| /pos/booking | booking.controller.ts | 17 | session |
| /pos/bundles | bundles.controller.ts | 8 | session |
| /pos/campaigns | campaigns.controller.ts | 9 | session |
| /pos/check-in | check-in.controller.ts | 18 | session |
| /pos/checkout | checkout.controller.ts | 26 | session |
| /pos/communications | communications.controller.ts | 7 | session |
| /pos/customer-display | checkout.controller.ts | 4 | session |
| /pos/customers | customers.controller.ts | 28 | session |
| /pos/dashboard | dashboard.controller.ts | 14 | session |
| /pos/deployments | deployments.controller.ts | 3 | session |
| /pos/devices | devices.controller.ts | 1 | session |
| /pos/follow-ups | end-of-day-followups.pos.controller.ts | 10 | session |
| /pos/logs | logs.controller.ts | 1 | session |
| /pos/me | profile.controller.ts | 15 | session |
| /pos/memberships | membership-comms.controller.ts | 2 | session |
| /pos/memberships | membership-compensation.controller.ts | 1 | session |
| /pos/memberships | membership-enroll.controller.ts | 11 | session |
| /pos/memberships | memberships.controller.ts | 8 | session |
| /pos/menu-insights | menu-insights.controller.ts | 2 | session |
| /pos/nail-showcase | nail-showcase.pos.controller.ts | 6 | session |
| /pos/notifications | notifications.controller.ts | 5 | session |
| /pos/overview | overview-board.controller.ts | 1 | session |
| /pos/overview | overview.controller.ts | 9 | session |
| /pos/payment-gateway | pos-payment-gateway.controller.ts | 1 | session |
| /pos/payments | payment-reconciliation.controller.ts | 2 | session |
| /pos/payroll | payroll.controller.ts | 9 | session |
| /pos/project-status | pos-project-status.controller.ts | 4 | session |
| /pos/queue | queue.controller.ts | 21 | session |
| /pos/reminders | reminders.controller.ts | 2 | session |
| /pos/reports | reports.controller.ts | 17 | session |
| /pos/search | pos-search.controller.ts | 2 | session |
| /pos/service-done | service-done.controller.ts | 13 | session |
| /pos/services | pos-tech-profile.controller.ts | 1 | TenantAuthGuard |
| /pos/services | services.controller.ts | 26 | session |
| /pos/serving | serving.controller.ts | 23 | session |
| /pos/settings | go-check-in.admin.controller.ts | 2 | session |
| /pos/settings | settings.controller.ts | 59 | session |
| /pos/settings | skip-line-settings.controller.ts | 2 | session |
| /pos/team | pos-team.controller.ts | 3 | session |
| /pos/tech-appointments | tech-appointments.controller.ts | 16 | session |
| /pos/tech-queue | tech-queue.controller.ts | 17 | session |
| /pos/technician-membership | pos-tech-profile.controller.ts | 3 | TenantAuthGuard |
| /pos/technicians | live-technician-schedule.controller.ts | 8 | session |
| /pos/technicians | pos-tech-profile.controller.ts | 8 | TenantAuthGuard |
| /pos/technicians | technicians.controller.ts | 28 | session |
| /pos/tickets | ticket-history.controller.ts | 1 | session |
| /pos/webhooks | api-webhooks.controller.ts | 9 | session |
| /promotions | promotions.controller.ts | 3 | session |
| /public/website | public-website.controller.ts | 3 | session |
| /push | push.controller.ts | 2 | session |
| /realtime | realtime.controller.ts | 0 | session |
| /super-admin | hardware-payment.super-admin.controller.ts | 17 | session |
| /super-admin | skip-line-settings.controller.ts | 2 | SuperAdminGuard |
| /super-admin | super-admin-customer-data.controller.ts | 16 | session |
| /super-admin | super-admin-owners.module.ts | 9 | session |
| /super-admin | super-admin-product-catalog.controller.ts | 13 | session |
| /super-admin | super-admin-tenants.controller.ts | 25 | session |
| /super-admin/ai | ai-admin.controller.ts | 7 | SuperAdminGuard |
| /super-admin/ai-insights | super-admin-ai-insights.module.ts | 6 | session |
| /super-admin/ai-narrative-model-versions | narrative-provenance.controller.ts | 3 | session |
| /super-admin/ai-plans | ai-plans-admin.controller.ts | 7 | SuperAdminGuard |
| /super-admin/ai-report-deliveries | report-delivery.controller.ts | 1 | session |
| /super-admin/ai-report-schedules | report-schedule.controller.ts | 4 | session |
| /super-admin/ai-report-templates | report-template.controller.ts | 4 | session |
| /super-admin/ai-reports | ai-reports.controller.ts | 1 | session |
| /super-admin/ai-reports | narrative-provenance.controller.ts | 2 | session |
| /super-admin/ai-reports | report-delivery.controller.ts | 2 | session |
| /super-admin/ai-reports | report-run.controller.ts | 2 | session |
| /super-admin/ai-reports | report-template.controller.ts | 1 | session |
| /super-admin/ai-usage | super-admin-ai-usage.module.ts | 5 | session |
| /super-admin/alerts | alerts.controller.ts | 9 | session |
| /super-admin/analytics | super-admin-analytics.controller.ts | 2 | SuperAdminGuard |
| /super-admin/appointment-oversight | super-admin-appointment-oversight.controller.ts | 11 | SuperAdminGuard |
| /super-admin/audit-events | audit.controller.ts | 1 | session |
| /super-admin/audit-logs | audit-logs.module.ts | 24 | session |
| /super-admin/automation-rules | super-admin-automation.controller.ts | 7 | session |
| /super-admin/billing | billing.controller.ts | 22 | session |
| /super-admin/booking-checkin | super-admin-booking-checkin.controller.ts | 9 | session |
| /super-admin/campaigns | campaigns.controller.ts | 22 | session |
| /super-admin/catalog | service-templates.controller.ts | 15 | session |
| /super-admin/checkin | super-admin-checkin.controller.ts | 1 | session |
| /super-admin/communications | communications.controller.ts | 19 | session |
| /super-admin/dashboard | dashboard.controller.ts | 1 | SuperAdminGuard |
| /super-admin/device-management | super-admin-device-management.module.ts | 3 | session |
| /super-admin/disputes | disputes.controller.ts | 16 | session |
| /super-admin/hardware-packages | super-admin-hardware-packages.module.ts | 19 | SuperAdminGuard |
| /super-admin/help | sla-sweep.controller.ts | 1 | session |
| /super-admin/integrations | integration-lifecycle.controller.ts | 11 | SuperAdminGuard |
| /super-admin/integrations | integration-scheduler.controller.ts | 1 | SuperAdminGuard |
| /super-admin/integrations | integration-sync.controller.ts | 4 | SuperAdminGuard |
| /super-admin/integrations | integration-webhook.controller.ts | 3 | SuperAdminGuard |
| /super-admin/integrations | provider-reliability.controller.ts | 2 | SuperAdminGuard |
| /super-admin/integrations | super-admin-integrations.controller.ts | 10 | SuperAdminGuard |
| /super-admin/loyalty | super-admin-loyalty.controller.ts | 14 | session |
| /super-admin/membership-programs | membership-programs.controller.ts | 23 | session |
| /super-admin/memberships | super-admin-memberships.controller.ts | 3 | session |
| /super-admin/merchant-accounts | super-admin-merchant-accounts.controller.ts | 10 | session |
| /super-admin/nail-showcase | nail-showcase.super-admin.controller.ts | 7 | SuperAdminGuard |
| /super-admin/onboarding | onboarding.module.ts | 18 | SuperAdminGuard |
| /super-admin/overview | overview-aggregate.controller.ts | 1 | session |
| /super-admin/overview | overview.controller.ts | 3 | SuperAdminGuard |
| /super-admin/payroll | payroll.controller.ts | 1 | session |
| /super-admin/plans | plans.controller.ts | 6 | session |
| /super-admin/plans/grandfathered | grandfather.controller.ts | 2 | session |
| /super-admin/plans/overage | overage.controller.ts | 3 | session |
| /super-admin/plans/scheduled-changes | scheduled-changes.controller.ts | 1 | session |
| /super-admin/plans/tenants | entitlements.controller.ts | 5 | session |
| /super-admin/plans/tenants/:tenantId/offers | tenant-offers.controller.ts | 4 | session |
| /super-admin/plans/tenants/:tenantId/subscription | subscription-change.controller.ts | 4 | session |
| /super-admin/plans/utilization | utilization.controller.ts | 3 | session |
| /super-admin/platform | super-admin-platform.controller.ts | 112 | session |
| /super-admin/project-status | project-status.controller.ts | 5 | session |
| /super-admin/promotions | promotion-management.controller.ts | 4 | session |
| /super-admin/promotions | promotions-oversight.controller.ts | 1 | session |
| /super-admin/queue | super-admin-queue.controller.ts | 10 | session |
| /super-admin/report-builder | super-admin-report-builder.controller.ts | 6 | SuperAdminGuard |
| /super-admin/revenue-residuals | super-admin-revenue-residuals.controller.ts | 34 | SuperAdminGuard |
| /super-admin/scheduled-reports | super-admin-scheduled-reports.controller.ts | 8 | SuperAdminGuard |
| /super-admin/security | policy.controller.ts | 6 | session |
| /super-admin/security | security.controller.ts | 1 | session |
| /super-admin/security/incidents | incident.controller.ts | 5 | session |
| /super-admin/security/ip-blocks | ip-block.controller.ts | 5 | session |
| /super-admin/security/lockdowns | lockdown.controller.ts | 7 | session |
| /super-admin/security/privileged-access | grant.controller.ts | 8 | session |
| /super-admin/security/retention-rules | retention.controller.ts | 4 | session |
| /super-admin/security/sessions | session-revoke.controller.ts | 3 | session |
| /super-admin/settings/branding | branding.controller.ts | 4 | session |
| /super-admin/settings/general | super-admin-settings.controller.ts | 9 | SuperAdminGuard |
| /super-admin/settings/general/business-categories | business-categories.controller.ts | 7 | SuperAdminGuard |
| /super-admin/settings/general/legal-documents | legal-documents.controller.ts | 8 | SuperAdminGuard |
| /super-admin/settings/general/maintenance | maintenance.controller.ts | 7 | SuperAdminGuard |
| /super-admin/settings/general/tenant-presets | tenant-presets.controller.ts | 6 | SuperAdminGuard |
| /super-admin/settlements | super-admin-settlements.controller.ts | 8 | session |
| /super-admin/smart-reminders | smart-reminders.module.ts | 26 | session |
| /super-admin/staff | super-admin-staff.controller.ts | 24 | session |
| /super-admin/support | super-admin-support.module.ts | 6 | session |
| /super-admin/system-health | system-health.controller.ts | 1 | SuperAdminGuard |
| /super-admin/system-status | super-admin-system-status.module.ts | 7 | session |
| /super-admin/tenant-activity | tenant-activity.controller.ts | 4 | session |
| /super-admin/tenant-locations | super-admin-locations.controller.ts | 7 | session |
| /super-admin/tenants | super-admin-hardware-packages.module.ts | 1 | SuperAdminGuard |
| /super-admin/tenants/:tenantId/go-check-in | go-check-in.admin.controller.ts | 7 | session |
| /super-admin/tickets | super-admin-tickets.controller.ts | 2 | session |
| /super-admin/tickets | ticket-removal.controller.ts | 3 | session |
| /super-admin/website-leads | super-admin-website-leads.module.ts | 17 | SuperAdminGuard |
| /tech | account.controllers.ts | 1 | session |
| /tech | tech-cash-confirmation.controller.ts | 4 | session |
| /tech | tech-cash-handoff.tech.controller.ts | 2 | session |
| /tech | tech-realtime.controller.ts | 0 | session |
| /tech | tech.controller.ts | 39 | session |
| /tech/follow-ups | end-of-day-followups.tech.controller.ts | 9 | session |
| /tech/profile | tech-profile.controller.ts | 19 | session |
| /technician/inventory | technician-inventory.controller.ts | 4 | session |
| /tenant | tenant-navigation.controller.ts | 4 | session |
| /tenant/ai | tenant-ai.controller.ts | 8 | session |
| /tenant/ai/call-intelligence | call-intelligence.controller.ts | 2 | session |
| /tenant/ai/center | ai-center.controller.ts | 1 | session |
| /tenant/ai/control-modes | ai-governance.controller.ts | 2 | session |
| /tenant/ai/revenue | ai-revenue.controller.ts | 2 | session |
| /tenant/ai/workflows | workflow-runs.controller.ts | 2 | session |
| /tenant/help | help.controller.ts | 25 | session |
| /tenant/inventory | inventory.controller.ts | 51 | session |
| /tenant/locations | tenant-locations.controller.ts | 11 | session |
| /webhooks/payments | payment-webhook.controller.ts | 1 | session |

**Totals: 112 admin-web routes · 209 controllers · 1760 HTTP endpoints.**

## Booking calendar arc addition (2026-07-03)
- `GET /pos/booking/day-grid?date=` — schedule-aware day grid for the reception calendar: per-technician windows (store hours ∩ technician schedule − lunch − blocked times), open ranges with exact gap minutes, open-slot counts, avatars, and the day's appointments. Guarded by `pos.booking.view`; tenant derived from session. Total: **1,765**.
