import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './shell/AdminLayout';
import { TenantsScreen } from './screens/TenantsScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { PlatformDashboardScreen } from './screens/PlatformDashboardScreen';
import { LiveOperationsScreen } from './screens/LiveOperationsScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { MembershipsOverviewScreen } from './screens/MembershipsOverviewScreen';
import MembershipProgramsScreen from './screens/MembershipProgramsScreen';
import GiftCardProgramsScreen from './screens/GiftCardProgramsScreen';
import GiftCardSettlementScreen from './screens/GiftCardSettlementScreen';
import StaffOverviewScreen from './screens/StaffOverviewScreen';
import { GlobalTechniciansScreen } from './screens/GlobalTechniciansScreen';
import BookingCheckinScreen from './screens/BookingCheckinScreen';
import QueueManagementScreen from './screens/QueueManagementScreen';
import LoyaltyProgramsScreen from './screens/LoyaltyProgramsScreen';
import { ServicesScreen } from './screens/ServicesScreen';
import { ProductCatalogScreen } from './screens/ProductCatalogScreen';
import { ServiceTemplatesScreen } from './screens/ServiceTemplatesScreen';
import { AppointmentOversightScreen } from './screens/AppointmentOversightScreen';
import { TicketOversightScreen } from './screens/TicketOversightScreen';
import { PaymentsScreen } from './screens/PaymentsScreen';
import ChargebacksDisputesScreen from './screens/ChargebacksDisputesScreen';
import { PromotionsScreen } from './screens/PromotionsScreen';
import { CommunicationsScreen } from './screens/CommunicationsScreen';
import { AiInsightsScreen } from './screens/AiInsightsScreen';
import { AiReportsScreen } from './screens/AiReportsScreen';
import { AiForecastingScreen } from './screens/AiForecastingScreen';
import { SmartRemindersScreen } from './screens/SmartRemindersScreen';
import { AutomationRulesScreen } from './screens/AutomationRulesScreen';
import { IntegrationsScreen } from './screens/IntegrationsScreen';
import { DevicesScreen } from './screens/DevicesScreen';
import { SecurityScreen } from './screens/SecurityScreen';
import { HelpCenterScreen } from './screens/HelpCenterScreen';
import { BranchesScreen } from './screens/BranchesScreen';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginScreen } from './screens/LoginScreen';
import { SystemHealthScreen } from './screens/SystemHealthScreen';
import { ProjectStatusScreen } from './screens/ProjectStatusScreen';
import { BillingScreen } from './screens/BillingScreen';
import { BillingCycleScreen } from './screens/BillingCycleScreen';
import { ApplicationsScreen } from './screens/ApplicationsScreen';
import { WebsiteLeadsScreen } from './screens/WebsiteLeadsScreen';
import { HardwarePackagesScreen } from './screens/HardwarePackagesScreen';
import { HardwarePaymentsScreen } from './screens/HardwarePaymentsScreen';
import { HardwarePaymentReportsScreen } from './screens/HardwarePaymentReportsScreen';
import { SupportAccessScreen } from './screens/SupportAccessScreen';
import { CustomerDataOversightScreen } from './screens/CustomerDataOversightScreen';
import { SuperAdminPlaceholder } from './screens/SuperAdminPlaceholder';
import { AuditLogsScreen } from './screens/AuditLogsScreen';
import { TenantActivityScreen } from './screens/TenantActivityScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { PaymentGatewaysScreen } from './screens/PaymentGatewaysScreen';
import { TapToPayAdminScreen } from './screens/TapToPayAdminScreen';
import { PlatformAnnouncementsScreen } from './screens/PlatformAnnouncementsScreen';
import { CheckInDevicesScreen } from './screens/CheckInDevicesScreen';
import { AIPackagesScreen } from './screens/AIPackagesScreen';
import { AIPlansScreen } from './screens/AIPlansScreen';
import { AiSubscriptionsScreen } from './screens/AiSubscriptionsScreen';
import { UsageLimitsScreen } from './screens/UsageLimitsScreen';
import { PlansScreen } from './screens/PlansScreen';
import SmsVerificationPackagesScreen from './screens/SmsVerificationPackagesScreen';
import { UsersRolesScreen } from './screens/UsersRolesScreen';
import { SuperAdminOwnersScreen } from './screens/SuperAdminOwnersScreen';
import { PlatformReportsScreen } from './screens/PlatformReportsScreen';
import { SuperAdminCompensationScreen } from './screens/SuperAdminCompensationScreen';
import { SuperAdminNailShowcaseModerationScreen } from './screens/SuperAdminNailShowcaseModerationScreen';
import { SuperAdminTechProfileModerationScreen } from './screens/SuperAdminTechProfileModerationScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { GeneralSettingsScreen } from './screens/GeneralSettingsScreen';
import { SettlementsScreen } from './screens/SettlementsScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { ReportBuilderScreen } from './screens/ReportBuilderScreen';
import { ScheduledReportsScreen } from './screens/ScheduledReportsScreen';
import { RevenueResidualsScreen } from './screens/RevenueResidualsScreen';
import { AppointmentOversightSubScreen } from './screens/AppointmentOversightSubScreen';
import { AiUsageConfigScreen } from './screens/AiUsageConfigScreen';
import { SuperAdminAiBusinessScreen } from './screens/SuperAdminAiBusinessScreen';
import { SystemStatusScreen } from './screens/SystemStatusScreen';
import { ImportHistoryScreen } from './screens/ImportHistoryScreen';
import { LegalHoldScreen } from './screens/LegalHoldScreen';
import { DeletionRequestsScreen } from './screens/DeletionRequestsScreen';
import { DuplicateDetectionScreen } from './screens/DuplicateDetectionScreen';
import { MergeHistoryScreen } from './screens/MergeHistoryScreen';
import { AuditHistoryScreen } from './screens/AuditHistoryScreen';
import { PrivacyRequestsScreen } from './screens/PrivacyRequestsScreen';
import { DataExportsScreen } from './screens/DataExportsScreen';
import MerchantAccountsScreen from './screens/MerchantAccountsScreen';
import FailedEventsScreen from './screens/FailedEventsScreen';
import DeviceStatusScreen from './screens/DeviceStatusScreen';
import AiHandoffsScreen from './screens/AiHandoffsScreen';
import ReceptionCopilotUsageScreen from './screens/ReceptionCopilotUsageScreen';
import TenantMessagingSetupScreen from './screens/TenantMessagingSetupScreen';
import TenantA2pScreen from './screens/TenantA2pScreen';
import MessagingReadinessScreen from './screens/MessagingReadinessScreen';
import AiBookingAnalyticsScreen from './screens/AiBookingAnalyticsScreen';
import AiCustomerProfileOversightScreen from './screens/AiCustomerProfileOversightScreen';
import AiCheckoutUpsellOversightScreen from './screens/AiCheckoutUpsellOversightScreen';
import AiReviewReputationOversightScreen from './screens/AiReviewReputationOversightScreen';
import { AiSchedulingOversightScreen } from './screens/AiSchedulingOversightScreen';
import AiOcrReceiptOversightScreen from './screens/AiOcrReceiptOversightScreen';
import AiReceptionistScreen from './screens/AiReceptionistScreen';
import BookingSourcesScreen from './screens/BookingSourcesScreen';
import CheckinPerformanceScreen from './screens/CheckinPerformanceScreen';
import WaitTimeAnalysisScreen from './screens/WaitTimeAnalysisScreen';
import { CommunicationsOverviewScreen } from './screens/CommunicationsOverviewScreen';
import { SmartRemindersOverviewScreen } from './screens/SmartRemindersOverviewScreen';
import { AuditLogsOverviewScreen } from './screens/AuditLogsOverviewScreen';
import { AcceptInviteScreen } from './screens/AcceptInviteScreen';
import { SuperAdminCampaignsScreen } from './screens/SuperAdminCampaignsScreen';

// AIPowerSalon Super-Admin — iPad Pro 13" command center. Gated behind login + SuperAdminGuard. Wired: Overview,
// Tenants, Tenant Applications, Website Leads, Hardware Packages, Subscriptions (billing), Support Access, System
// Health. Honest not-wired placeholders name the backend each remaining module binds to.

function Gate() {
  const { principal, loading } = useAuth();
  // Invitee accept link is pre-auth: render it before the loading/login gate so a logged-out invitee can redeem it.
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  if (loading) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><div className="muted">Loading…</div></div>;
  if (!principal) return <LoginScreen />;
  return (
    <Routes>
      <Route path="/" element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardScreen />} />
        <Route path="tenants" element={<TenantsScreen />} />
        <Route path="tenant-applications" element={<ApplicationsScreen />} />
        <Route path="alerts" element={<AlertsScreen />} />
        <Route path="website-leads" element={<WebsiteLeadsScreen />} />
        <Route path="hardware-packages" element={<HardwarePackagesScreen />} />
        <Route path="hardware-payments" element={<HardwarePaymentsScreen />} />
        <Route path="hardware-payment-reports" element={<HardwarePaymentReportsScreen />} />
        <Route path="payment-gateways" element={<PaymentGatewaysScreen />} />
        <Route path="tap-to-pay" element={<TapToPayAdminScreen />} />
        <Route path="communications/platform-announcements" element={<PlatformAnnouncementsScreen />} />
        <Route path="platform-announcements" element={<Navigate to="/communications/platform-announcements" replace />} />
        <Route path="check-in-devices" element={<CheckInDevicesScreen />} />
        <Route path="subscriptions" element={<BillingScreen />} />
        <Route path="billing-cycle" element={<BillingCycleScreen />} />
        <Route path="billing" element={<Navigate to="/subscriptions" replace />} />
        <Route path="ai-packages" element={<AIPackagesScreen />} />
        <Route path="ai-business-adoption" element={<SuperAdminAiBusinessScreen />} />
        <Route path="ai-plans" element={<AIPlansScreen />} />
        <Route path="ai-subscriptions" element={<AiSubscriptionsScreen />} />
        <Route path="reception-copilot" element={<ReceptionCopilotUsageScreen />} />
        <Route path="tenant-messaging" element={<TenantMessagingSetupScreen />} />
        <Route path="a2p-registration" element={<TenantA2pScreen />} />
        <Route path="messaging-environment" element={<MessagingReadinessScreen />} />
        <Route path="ai-booking-analytics" element={<AiBookingAnalyticsScreen />} />
        <Route path="ai-customer-profile" element={<AiCustomerProfileOversightScreen />} />
        <Route path="ai-checkout-upsell" element={<AiCheckoutUpsellOversightScreen />} />
        <Route path="ai-review-reputation" element={<AiReviewReputationOversightScreen />} />
        <Route path="ai-scheduling-optimizer" element={<AiSchedulingOversightScreen />} />
        <Route path="ai-ocr-receipt" element={<AiOcrReceiptOversightScreen />} />
        <Route path="tenants/:tenantId/messaging" element={<TenantMessagingSetupScreen />} />
        <Route path="tenants/:tenantId/a2p" element={<TenantA2pScreen />} />
        <Route path="usage-limits" element={<UsageLimitsScreen />} />
        <Route path="plans" element={<PlansScreen />} />
        <Route path="sms-verification-packages" element={<SmsVerificationPackagesScreen />} />
        <Route path="users-roles" element={<UsersRolesScreen />} />
        <Route path="owner-salons" element={<SuperAdminOwnersScreen />} />
        <Route path="support-access" element={<SupportAccessScreen />} />
        <Route path="platform-reports" element={<PlatformReportsScreen />} />
        <Route path="compensation-oversight" element={<SuperAdminCompensationScreen />} />
        <Route path="nail-showcase" element={<SuperAdminNailShowcaseModerationScreen />} />
        <Route path="tech-profiles" element={<SuperAdminTechProfileModerationScreen />} />
        <Route path="system-health" element={<SystemHealthScreen />} />
        <Route path="audit-logs" element={<AuditLogsOverviewScreen />} />
        <Route path="audit-logs/browse" element={<AuditLogsScreen />} />
        <Route path="tenant-activity" element={<TenantActivityScreen />} />
                        <Route path="report-builder" element={<ReportBuilderScreen />} />
        <Route path="scheduled-reports" element={<ScheduledReportsScreen />} />
        <Route path="revenue-residuals" element={<RevenueResidualsScreen />} />
        <Route path="appointment-oversight/search" element={<AppointmentOversightSubScreen view="search" />} />
        <Route path="appointment-oversight/booking-source" element={<AppointmentOversightSubScreen view="booking-source" />} />
        <Route path="appointment-oversight/failures" element={<AppointmentOversightSubScreen view="failures" />} />
        <Route path="appointment-oversight/duplicates" element={<AppointmentOversightSubScreen view="duplicates" />} />
        <Route path="appointment-oversight/overlapping" element={<AppointmentOversightSubScreen view="overlapping" />} />
        <Route path="appointment-oversight/rescheduled" element={<AppointmentOversightSubScreen view="rescheduled" />} />
        <Route path="appointment-oversight/change-history" element={<AppointmentOversightSubScreen view="change-history" />} />
        <Route path="appointment-oversight/missing-info" element={<AppointmentOversightSubScreen view="missing-info" />} />
        <Route path="appointment-oversight/sync-failures" element={<AppointmentOversightSubScreen view="sync-failures" />} />
        <Route path="settlements-deposits" element={<SettlementsScreen />} />
        <Route path="onboarding" element={<OnboardingScreen view="all" />} />
        <Route path="onboarding/business-info" element={<OnboardingScreen view="business-info" />} />
        <Route path="onboarding/identity" element={<OnboardingScreen view="identity" />} />
        <Route path="onboarding/legal" element={<OnboardingScreen view="legal" />} />
        <Route path="onboarding/merchant" element={<OnboardingScreen view="merchant" />} />
        <Route path="onboarding/bank" element={<OnboardingScreen view="bank" />} />
        <Route path="onboarding/hardware" element={<OnboardingScreen view="hardware" />} />
        <Route path="onboarding/data-import" element={<OnboardingScreen view="data-import" />} />
        <Route path="onboarding/training" element={<OnboardingScreen view="training" />} />
        <Route path="onboarding/final-review" element={<OnboardingScreen view="final-review" />} />
        <Route path="onboarding/activations" element={<OnboardingScreen view="activations" />} />
        <Route path="onboarding/approvals" element={<OnboardingScreen view="approvals" />} />
        <Route path="queue-management" element={<QueueManagementScreen view="all" />} />
        <Route path="queue-management/timelines" element={<QueueManagementScreen view="timelines" />} />
        <Route path="queue-management/stuck" element={<QueueManagementScreen view="stuck" />} />
        <Route path="queue-management/sync" element={<QueueManagementScreen view="sync" />} />
        <Route path="queue-management/wait-times" element={<QueueManagementScreen view="wait-times" />} />
        <Route path="settings" element={<GeneralSettingsScreen />} />
        <Route path="account" element={<SettingsScreen />} />
        <Route path="project-status" element={<ProjectStatusScreen />} />
        {/* Canonical S01 modules not yet built — routed to honest placeholders so no sidebar item is a dead link. */}
        <Route path="live-operations" element={<LiveOperationsScreen />} />
        <Route path="platform-dashboard" element={<PlatformDashboardScreen />} />
        <Route path="analytics" element={<AnalyticsScreen />} />
        <Route path="branches" element={<BranchesScreen />} />
        <Route path="services" element={<ServicesScreen />} />
        <Route path="product-catalog" element={<ProductCatalogScreen />} />
        <Route path="service-templates" element={<ServiceTemplatesScreen />} />
        <Route path="products" element={<Navigate to="/product-catalog" replace />} />
        <Route path="appointment-oversight" element={<AppointmentOversightScreen />} />
        <Route path="ticket-oversight" element={<TicketOversightScreen />} />
        <Route path="membership-programs" element={<MembershipProgramsScreen />} />
        <Route path="memberships" element={<Navigate to="/membership-programs" replace />} />
        <Route path="appointments" element={<Navigate to="/appointment-oversight" replace />} />
        <Route path="customer-data-oversight" element={<CustomerDataOversightScreen />} />
        <Route path="customer-data-oversight/import-history" element={<ImportHistoryScreen />} />
        <Route path="customer-data-oversight/legal-hold" element={<LegalHoldScreen />} />
        <Route path="customer-data-oversight/deletion-requests" element={<DeletionRequestsScreen />} />
        <Route path="customer-data-oversight/duplicate-detection" element={<DuplicateDetectionScreen />} />
        <Route path="customer-data-oversight/merge-history" element={<MergeHistoryScreen />} />
        <Route path="customer-data-oversight/audit-history" element={<AuditHistoryScreen />} />
        {/* Consent Status: sidebar item existed with no route → the catch-all silently bounced it to /dashboard.
            Wire it to the honest "not yet built" placeholder so the link lands on a clearly-labelled page. */}
        <Route path="customer-data-oversight/consent-status" element={<SuperAdminPlaceholder title="Consent Status" note="Consent tracking for customer data (marketing, SMS, photo, data-processing) will be shown here — per-customer status, history, and export — connected to live, tenant-safe platform data during its scheduled phase." />} />
        <Route path="customer-data-oversight/privacy-requests" element={<PrivacyRequestsScreen />} />
        <Route path="customer-data-oversight/data-exports" element={<DataExportsScreen />} />
        <Route path="customer-data-oversight/:view" element={<CustomerDataOversightScreen />} />
        <Route path="ai-usage-configuration" element={<AiUsageConfigScreen />} />
        <Route path="system-status" element={<SystemStatusScreen />} />
        <Route path="merchant-accounts" element={<MerchantAccountsScreen />} />
        <Route path="booking-checkin/failed-events" element={<FailedEventsScreen />} />
        <Route path="booking-checkin/device-status" element={<DeviceStatusScreen />} />
        <Route path="booking-checkin/ai-handoffs" element={<AiHandoffsScreen />} />
        <Route path="booking-checkin/booking-sources" element={<BookingSourcesScreen />} />
        <Route path="booking-checkin/check-in-performance" element={<CheckinPerformanceScreen />} />
        <Route path="booking-checkin/wait-time-analysis" element={<WaitTimeAnalysisScreen />} />
        <Route path="customers" element={<Navigate to="/customer-data-oversight" replace />} />
        <Route path="staff" element={<StaffOverviewScreen />} />
        <Route path="staff/technicians" element={<GlobalTechniciansScreen />} />
        <Route path="booking-checkin" element={<BookingCheckinScreen />} />
        <Route path="payments-transactions" element={<PaymentsScreen />} />
        <Route path="chargebacks-disputes" element={<ChargebacksDisputesScreen />} />
        <Route path="marketing-campaigns" element={<SuperAdminCampaignsScreen />} />
        <Route path="promotions-offers" element={<PromotionsScreen />} />
        <Route path="loyalty-programs" element={<LoyaltyProgramsScreen />} />
        <Route path="gift-card-programs" element={<GiftCardProgramsScreen />} />
        <Route path="gift-card-settlement" element={<GiftCardSettlementScreen />} />        <Route path="communications" element={<CommunicationsOverviewScreen />} />
        <Route path="communications/inbox" element={<CommunicationsScreen />} />
        <Route path="ai-insights" element={<AiInsightsScreen />} />
        <Route path="ai-receptionist" element={<AiReceptionistScreen />} />
        <Route path="ai-reports" element={<AiReportsScreen />} />
        <Route path="ai-forecasting" element={<AiForecastingScreen />} />
        <Route path="smart-reminders" element={<SmartRemindersOverviewScreen />} />
        <Route path="smart-reminders/performance" element={<SmartRemindersScreen />} />
        <Route path="automation-rules" element={<AutomationRulesScreen />} />
        <Route path="integrations" element={<IntegrationsScreen />} />
        <Route path="devices-management" element={<DevicesScreen />} />
        <Route path="security-compliance" element={<SecurityScreen />} />
        <Route path="help-center" element={<HelpCenterScreen />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return <AuthProvider><Gate /></AuthProvider>;
}
