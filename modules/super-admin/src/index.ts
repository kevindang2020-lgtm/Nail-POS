// modules/super-admin — the super-admin domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { SuperAdminAiCheckoutUpsellModule } from './super-admin-ai-checkout-upsell/super-admin-ai-checkout-upsell.module';
export { SuperAdminAiInsightsModule } from './super-admin-ai-insights/super-admin-ai-insights.module';
export { SuperAdminAiOcrReceiptModule } from './super-admin-ai-ocr-receipt/super-admin-ai-ocr-receipt.module';
export { AiReportsModule } from './super-admin-ai-reports/ai-reports.module';
export { SuperAdminAiReviewReputationModule } from './super-admin-ai-review-reputation/super-admin-ai-review-reputation.module';
export { SuperAdminAiSchedulingOptimizerModule } from './super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.module';
export { SuperAdminAlertsModule } from './super-admin-alerts/alerts.module';
export { AuditLogsOverviewModule } from './super-admin-audit-logs/audit-logs.module';
export { SuperAdminBillingModule } from './super-admin-billing/super-admin-billing.module';
export { SuperAdminBookingCheckinModule } from './super-admin-booking-checkin/super-admin-booking-checkin.module';
export { BusinessCategoriesModule } from './super-admin-business-categories/business-categories.module';
export { SuperAdminCatalogModule } from './super-admin-catalog/super-admin-catalog.module';
export { SuperAdminCheckinModule } from './super-admin-checkin/super-admin-checkin.module';
export { SuperAdminCompensationModule } from './super-admin-compensation/super-admin-compensation.module';
export { SuperAdminCustomerDataModule } from './super-admin-customer-data/super-admin-customer-data.module';
export { SuperAdminDashboardModule } from './super-admin-dashboard/dashboard.module';
export { SuperAdminDisputesModule } from './super-admin-disputes/super-admin-disputes.module';
export { ForecastingOversightModule } from './super-admin-forecasting/forecasting-oversight.module';
export { GiftCardProgramsModule } from './super-admin-gift-card-programs/gift-card-programs.module';
export { GiftCardSettlementModule } from './super-admin-gift-card-settlement/gift-card-settlement.module';
export { SuperAdminHardwarePackagesModule } from './super-admin-hardware-packages/super-admin-hardware-packages.module';
export { SystemHealthModule } from './super-admin-health/system-health.module';
export { LegalDocumentsModule } from './super-admin-legal/legal-documents.module';
export { SuperAdminLoyaltyModule } from './super-admin-loyalty/super-admin-loyalty.module';
export { MaintenanceModule } from './super-admin-maintenance/maintenance.module';
export { SuperAdminMembershipProgramsModule } from './super-admin-membership-programs/super-admin-membership-programs.module';
export { SuperAdminMembershipsModule } from './super-admin-memberships/super-admin-memberships.module';
export { SuperAdminOverviewModule } from './super-admin-overview/overview.module';
export { SuperAdminProductCatalogModule } from './super-admin-product-catalog/super-admin-product-catalog.module';
export { PromotionsOversightModule } from './super-admin-promotions/promotions-oversight.module';
export { SuperAdminReconModule } from './super-admin-reconciliation/super-admin-reconciliation.module';
export { SuperAdminSettingsModule } from './super-admin-settings/super-admin-settings.module';
export { SmartRemindersModule } from './super-admin-smart-reminders/smart-reminders.module';
export { TenantPresetsModule } from './super-admin-tenant-presets/tenant-presets.module';
export { TenantWarningDispatchModule } from './super-admin-tenant-warnings/tenant-warning-dispatch.module';
export { SuperAdminWebsiteLeadsModule } from './super-admin-website-leads/super-admin-website-leads.module';
export * from './super-admin-billing/billing.dto';
export * from './super-admin-dashboard/dashboard.dto';
export * from './super-admin-overview/overview.dto';
export { buildPlatformOverview } from './super-admin-ai-checkout-upsell/super-admin-ai-checkout-upsell.service';   // used by the API today
export { KyselyBillingRepository } from './super-admin-billing/billing.kysely.repository';   // used by the API today
export { planPricesFromEnv } from './super-admin-billing/billing.repository';   // used by the API today
export { MaintenanceMiddleware } from './super-admin-maintenance/maintenance.middleware';   // used by the API today
export { MaintenanceService } from './super-admin-maintenance/maintenance.service';   // BUILD_PLAN Phase 13 B: /app-config reads the maintenance state + banner
// joined by --into (onboarding, super-admin-tenants, super-admin-platform):
export { OnboardingModule } from './onboarding/onboarding.module';
export { SuperAdminPlatformModule } from './super-admin-platform/super-admin-platform.module';
export { SuperAdminTenantsModule } from './super-admin-tenants/super-admin-tenants.module';
export * from './super-admin-tenants/super-admin-tenants.dto';
export { emailSenderFromEnv, smsSenderFromEnv } from './super-admin-platform/application-confirmation';   // used by the API today
export { KyselySuperAdminPlatformRepo } from './super-admin-platform/super-admin-platform.repository';   // used by the API today
// joined by --into (super-admin-analytics, super-admin-report-builder, super-admin-scheduled-reports, super-admin-revenue-residuals, super-admin-appointment-oversight, super-admin-tenant-activity):
export { SuperAdminAnalyticsModule } from './super-admin-analytics/super-admin-analytics.module';
export { SuperAdminAppointmentOversightModule } from './super-admin-appointment-oversight/super-admin-appointment-oversight.module';
export { SuperAdminReportBuilderModule } from './super-admin-report-builder/super-admin-report-builder.module';
export { SuperAdminRevenueResidualsModule } from './super-admin-revenue-residuals/super-admin-revenue-residuals.module';
export { SuperAdminScheduledReportsModule } from './super-admin-scheduled-reports/super-admin-scheduled-reports.module';
export { SuperAdminTenantActivityModule } from './super-admin-tenant-activity/tenant-activity.module';
export { SuperAdminAnalyticsController } from './super-admin-analytics/super-admin-analytics.controller';   // used by the API today
export { KyselyAnalyticsGapRepo } from './super-admin-analytics/super-admin-analytics.kysely.repository';   // used by the API today
export { SuperAdminAnalyticsService } from './super-admin-analytics/super-admin-analytics.service';   // used by the API today
export { SuperAdminReportBuilderController } from './super-admin-report-builder/super-admin-report-builder.controller';   // used by the API today
export { SuperAdminScheduledReportsController } from './super-admin-scheduled-reports/super-admin-scheduled-reports.controller';   // used by the API today
// joined by --into (super-admin-queue, super-admin-settlements, super-admin-support):
export { SuperAdminQueueModule } from './super-admin-queue/super-admin-queue.module';
export { SuperAdminSettlementsModule } from './super-admin-settlements/super-admin-settlements.module';
export { SuperAdminSupportModule } from './super-admin-support/super-admin-support.module';
// joined by --into (super-admin-ai-usage, super-admin-merchant-accounts, super-admin-ticket-removal, super-admin-integrations):
export { SuperAdminAiUsageModule } from './super-admin-ai-usage/super-admin-ai-usage.module';
export { SuperAdminIntegrationsModule } from './super-admin-integrations/super-admin-integrations.module';
export { SuperAdminMerchantAccountsModule } from './super-admin-merchant-accounts/super-admin-merchant-accounts.module';
export { TicketRemovalModule } from './super-admin-ticket-removal/ticket-removal.module';
export { generateDeletionCode, verifyDeletionCode } from './super-admin-ticket-removal/deletion-code';   // used by the API today
// joined by --into (tenant-ai, super-admin-ai):
export { SuperAdminAiModule } from './super-admin-ai/super-admin-ai.module';
export { TenantAiModule } from './tenant-ai/tenant-ai.module';
// joined by --into (super-admin-device-management, super-admin-owners, super-admin-tickets):
export { SuperAdminDeviceManagementModule } from './super-admin-device-management/super-admin-device-management.module';
export { SuperAdminOwnersModule } from './super-admin-owners/super-admin-owners.module';
export { SuperAdminTicketsModule } from './super-admin-tickets/super-admin-tickets.module';
// joined by --into (super-admin-staff, super-admin-voice):
export { SuperAdminStaffModule } from './super-admin-staff/super-admin-staff.module';
export { SuperAdminVoiceModule } from './super-admin-voice/super-admin-voice.module';
// joined by --into (super-admin-overview-aggregate, tenant-billing):
export { OverviewAggregateModule } from './super-admin-overview-aggregate/overview-aggregate.module';
export { TenantBillingModule } from './tenant-billing/tenant-billing.module';
// joined by --into (super-admin-ai-customer-profile):
export { SuperAdminAiCustomerProfileModule } from './super-admin-ai-customer-profile/super-admin-ai-customer-profile.module';
// joined by --into (super-admin-security):
export { SecurityModule } from './super-admin-security/security.module';
// Security Deep Scan §136 / §29: the enforced Super Admin network policy (ip_block_rules + SUPER_ADMIN_IP_ALLOWLIST)
export { PlatformNetworkPolicy, DEFAULT_NETWORK_POLICY_CACHE_MS } from './super-admin-security/network-policy';
export { decidePlatformAccess, ipMatches, parseAllowlistEnv, networkPolicyMode, allowlistWouldLockOut, type PlatformAccessDecision, type NetworkRules, type NetworkPolicyMode } from './super-admin-security/network-policy-core';
export { CATEGORIES, SEVERITIES, STATUSES, sevLevel } from './super-admin-security/incident-core';   // used by the API today
export { SecurityService } from './super-admin-security/security.service';   // used by the API today
export { RetentionExecutorService, type RetentionRunResult, type RetentionTableResult } from './super-admin-security/retention-executor.service';   // Phase 10: the central retention executor (the Database page reads its runs)
export { KyselySuperAdminTenantsRepo } from './super-admin-tenants/super-admin-tenants.kysely.repository';   // used by the API's tenant-status producer pgtest
export { SuperAdminPlatformStaffModule } from './super-admin-platform-staff/platform-staff.module';   // Constitution 7 §24-26
export { KyselyPlatformStaffRepository } from './super-admin-platform-staff/platform-staff.repository';   // used by the API's platform-staff pgtest
export { SuperAdminTenantsService } from './super-admin-tenants/super-admin-tenants.service';   // used by the API's tenant-lifecycle pgtest
export { TenantPosLanguageService, TenantPosLanguageError } from './super-admin-tenants/tenant-pos-language';   // Vietnamese POS WP-A — the API's language pgtest
export { SuperAdminPlatformSearchModule, PlatformSearchService } from './super-admin-platform-search/platform-search';   // Constitution 7 §140-141
export { SuperAdminKillSwitchesModule, KillSwitchService } from './super-admin-kill-switches/kill-switches';   // Constitution 7 §34
export { SuperAdminPlatformService } from './super-admin-platform/super-admin-platform.service';   // used by the API's platform-invite pgtest
export { MembershipProgramsRepository } from './super-admin-membership-programs/membership-programs.repository';   // Constitution 7: one Support Mode store (API pgtest)
// BUILD_PLAN Phase 10 (agent E): Super Admin → System Operations → Database
export { SuperAdminDatabaseModule } from './super-admin-database/database.module';
export { DB_CONSTRAINT_RETRIER, type DbConstraintRetrier } from './super-admin-database/database.service';
// BUILD_PLAN Phase 10 (audit bug 2): the daily summary writer + its hourly job (the backfill script and the live proof use them)
export { writeDailySummaries, type SummaryWriteOptions, type SummaryWriteResult } from './super-admin-overview/daily-summaries.writer';
export { DailySummariesScheduler, summariesDailyEnabled } from './super-admin-overview/daily-summaries.scheduler';
export { USER_INVITATION } from './super-admin-platform/invitation-lifecycle';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
export { ALERT, TENANT_WEBHOOK } from './lifecycles';   // BUILD_PLAN Phase 12: shared with apps/api (one machine per lifecycle)
