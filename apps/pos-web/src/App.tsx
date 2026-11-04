import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { IPadViewProvider } from './components/IPadViewProvider';
import './components/ipad-modules';
import { LoginScreen } from './screens/LoginScreen';
import { landingPathForRole } from './auth/role-landing';
import { crossAppRedirect } from './auth/portal-redirect';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { SecurityNotMeScreen } from './screens/SecurityNotMeScreen';
import { OAuthConsentScreen } from './screens/OAuthConsentScreen';
import { AcceptInviteScreen } from './screens/AcceptInviteScreen';
import { POSLayout } from './shell/POSLayout';
import { POSOverviewScreen } from './screens/POSOverviewScreen';
import { POSDashboardScreen } from './screens/POSDashboardScreen';
import { POSCheckInScreen } from './screens/POSCheckInScreen';
import { POSQueueScreen } from './screens/POSQueueScreen';
import { POSServingScreen } from './screens/POSServingScreen';
import { POSServiceDoneScreen } from './screens/POSServiceDoneScreen';
import { POSCheckoutScreen } from './screens/POSCheckoutScreen';
import { POSBookingScreen } from './screens/POSBookingScreen';
import { POSTechQueueScreen } from './screens/POSTechQueueScreen';
import { POSTechAppointmentsScreen } from './screens/POSTechAppointmentsScreen';
import { POSTechniciansScreen } from './screens/POSTechniciansScreen';
import { POSTechnicianProfileScreen } from './screens/POSTechnicianProfileScreen';
import { POSLiveTechnicianScheduleScreen } from './screens/POSLiveTechnicianScheduleScreen';
import { POSSkillRequestsScreen } from './screens/POSSkillRequestsScreen';
import { POSServicesScreen } from './screens/POSServicesScreen';
import { POSPaymentsOverviewScreen } from './screens/POSPaymentsOverviewScreen';
import { POSAICenterScreen } from './screens/POSAICenterScreen';
import { POSReceptionCopilotScreen } from './screens/POSReceptionCopilotScreen';
import { POSMessagingSetupScreen } from './screens/POSMessagingSetupScreen';
import { POSAIReceptionistScreen } from './screens/POSAIReceptionistScreen';
import { POSAIFrontDeskScreen } from './screens/POSAIFrontDeskScreen';
import { POSAIFollowUpsScreen } from './screens/POSAIFollowUpsScreen';
import { POSAIBusinessSetupScreen } from './screens/POSAIBusinessSetupScreen';
import { POSAICalendarScreen } from './screens/POSAICalendarScreen';
import { POSAICallsScreen } from './screens/POSAICallsScreen';
import { POSAIQueueAssignmentScreen } from './screens/POSAIQueueAssignmentScreen';
import { POSAiBusinessScreen } from './screens/POSAiBusinessScreen';
import { POSAiInventoryScreen } from './screens/POSAiInventoryScreen';
import { POSAiForecastingScreen } from './screens/POSAiForecastingScreen';
import { POSAiBranchCompareScreen } from './screens/POSAiBranchCompareScreen';
import { POSAiAlertsScreen } from './screens/POSAiAlertsScreen';
import { POSAiReportsScreen } from './screens/POSAiReportsScreen';
import { POSAICustomerProfileOverviewScreen } from './screens/POSAICustomerProfileOverviewScreen';
import { POSAICustomerDuplicateReviewScreen } from './screens/POSAICustomerDuplicateReviewScreen';
import { POSAICustomerChurnWatchScreen } from './screens/POSAICustomerChurnWatchScreen';
import { POSAICustomerRebookingScreen } from './screens/POSAICustomerRebookingScreen';
import { POSAICustomerRecommendationsScreen } from './screens/POSAICustomerRecommendationsScreen';
import { POSAICustomerSettingsScreen } from './screens/POSAICustomerSettingsScreen';
import { AICheckoutUpsellSettingsScreen } from './screens/AICheckoutUpsellSettingsScreen';
import { POSAiGovernanceScreen } from './screens/POSAiGovernanceScreen';
import { POSAiSettingsEditor } from './screens/POSAiSettingsEditor';
import { POSGiftCardSettingsScreen } from './screens/POSGiftCardSettingsScreen';
import { POSSellGiftCardScreen } from './screens/POSSellGiftCardScreen';
import { POSReloadGiftCardScreen } from './screens/POSReloadGiftCardScreen';
import { POSGiftCardLookupScreen } from './screens/POSGiftCardLookupScreen';
import { POSGiftCardStockScreen } from './screens/POSGiftCardStockScreen';
import { POSAIReviewReputationScreen } from './screens/POSAIReviewReputationScreen';
import { POSAISchedulingOptimizerScreen } from './screens/POSAISchedulingOptimizerScreen';
// BUILD_PLAN Phase 8: the Safety Community (feed, the /community/posts/:id deep link, drafts, approvals, incidents, settings)
import { CommunityFeedScreen } from './screens/community/CommunityFeedScreen';
import { CommunityPostScreen } from './screens/community/CommunityPostScreen';
import { CommunityAdvisoryEditor } from './screens/community/CommunityAdvisoryEditor';
import { CommunityDraftsScreen } from './screens/community/CommunityDraftsScreen';
import { CommunityApprovalsScreen } from './screens/community/CommunityApprovalsScreen';
import { CommunityIncidentsScreen } from './screens/community/CommunityIncidentsScreen';
import { CommunitySettingsScreen } from './screens/community/CommunitySettingsScreen';
// BUILD_PLAN Phase 9 (agent D): the salon's one approvals inbox (refunds over the limit, deals, purchase orders, …)
import { POSApprovalsScreen } from './screens/approvals/POSApprovalsScreen';
import { POSAIOcrReceiptScreen } from './screens/POSAIOcrReceiptScreen';
import { POSBookingVerificationScreen } from './screens/POSBookingVerificationScreen';
import { PhoneManagementCenter } from './screens/PhoneManagementCenter';
import { POSAIReviewReputationSettingsScreen } from './screens/POSAIReviewReputationSettingsScreen';
import { POSAICustomerTimelineScreen } from './screens/POSAICustomerTimelineScreen';
import { POSAICustomerSearchScreen } from './screens/POSAICustomerSearchScreen';
import { POSDeviceFleetScreen } from './screens/POSDeviceFleetScreen';
import { POSDiscountsScreen } from './screens/POSDiscountsScreen';
import { POSMultiLocationScreen } from './screens/POSMultiLocationScreen';
import { POSMarketingReportScreen } from './screens/POSMarketingReportScreen';
import { POSTimeClockScreen } from './screens/POSTimeClockScreen';
import { POSTurnQueueScreen } from './screens/POSTurnQueueScreen';
import { POSExpensesScreen } from './screens/POSExpensesScreen';
import { POSSplitPaymentsScreen } from './screens/POSSplitPaymentsScreen';
import { POSInvoicesScreen } from './screens/POSInvoicesScreen';
import { POSInventoryReportScreen } from './screens/POSInventoryReportScreen';
import { POSInventoryAlertsScreen } from './screens/POSInventoryAlertsScreen';
import { POSPurchaseOrdersScreen } from './screens/POSPurchaseOrdersScreen';
import { POSProductsScreen } from './screens/POSProductsScreen';
import { POSFeaturesScreen } from './screens/POSFeaturesScreen';
import { POSSetupHealthScreen } from './screens/POSSetupHealthScreen';
import { POSAiUsageScreen } from './screens/POSAiUsageScreen';
import { POSNotificationsScreen } from './screens/POSNotificationsScreen';
import { POSRemindersScreen } from './screens/POSRemindersScreen';
import { POSMessageTemplatesScreen } from './screens/POSMessageTemplatesScreen';
import { POSSystemStatusScreen } from './screens/POSSystemStatusScreen';
import { POSPaymentGatewayScreen } from './screens/POSPaymentGatewayScreen';
import { POSSegmentsScreen } from './screens/POSSegmentsScreen';
import { POSBirthdaysScreen } from './screens/POSBirthdaysScreen';
import { POSReferralsScreen } from './screens/POSReferralsScreen';
import { POSPhoneScreen } from './screens/POSPhoneScreen';
import { POSEmailScreen } from './screens/POSEmailScreen';
import { POSSocialScreen } from './screens/POSSocialScreen';
import { POSIntegrationsScreen } from './screens/POSIntegrationsScreen';
import { POSDepositReconScreen } from './screens/POSDepositReconScreen';
import { POSAiAnalyticsScreen } from './screens/POSAiAnalyticsScreen';
import { POSAiPackageScreen } from './screens/POSAiPackageScreen';
import { POSAIBookingScreen } from './screens/POSAIBookingScreen';
import { POSAIReviewAssistantScreen } from './screens/POSAIReviewAssistantScreen';
import { POSAIFraudProtectionAssistantScreen } from './screens/POSAIFraudProtectionAssistantScreen';
import { POSAICustomerProfileAssistantScreen } from './screens/POSAICustomerProfileAssistantScreen';
import { POSAICheckoutUpsellAssistantScreen } from './screens/POSAICheckoutUpsellAssistantScreen';
import { POSAIReceiptScannerScreen } from './screens/POSAIReceiptScannerScreen';
import { POSUsageLimitsScreen } from './screens/POSUsageLimitsScreen';
import { POSAccountInvoicesScreen } from './screens/POSAccountInvoicesScreen';
import { SuspendedBillingOnly } from './screens/SuspendedBillingOnly';
import { POSAppointmentHistoryScreen } from './screens/POSAppointmentHistoryScreen';
import { POSCustomerNotesScreen } from './screens/POSCustomerNotesScreen';
import { POSCustomerProfileScreen } from './screens/POSCustomerProfileScreen';
import { POSRetentionScreen } from './screens/POSRetentionScreen';
import { POSSavedCardsScreen } from './screens/POSSavedCardsScreen';
import { POSTeamPermissionsScreen } from './screens/POSTeamPermissionsScreen';
import { POSServiceAddOnsScreen } from './screens/POSServiceAddOnsScreen';
import { POSAISettingsScreen } from './screens/POSAISettingsScreen';
import { POSAIPlansScreen } from './screens/POSAIPlansScreen';
import { POSManagementScreen } from './screens/POSManagementScreen';
import { POSMarketingLandingScreen } from './screens/POSMarketingLandingScreen';
import { POSDevicesScreen } from './screens/POSDevicesScreen';
import { POSCustomerDisplaysScreen } from './screens/POSCustomerDisplaysScreen';
import { POSAccountScreen } from './screens/POSAccountScreen';
import { POSActivityLogsScreen } from './screens/POSActivityLogsScreen';
import { POSSecurityScreen } from './screens/POSSecurityScreen';
import { POSSubscriptionScreen } from './screens/POSSubscriptionScreen';
import { POSMemberAccessScreen } from './screens/access/POSMemberAccessScreen';
import { POSAccessGovernanceScreen } from './screens/access/POSAccessGovernanceScreen';
import { POSHelpCenterScreen } from './screens/POSHelpCenterScreen';
import { POSCustomersScreen } from './screens/POSCustomersScreen';
import { POSSalesReportScreen } from './screens/POSSalesReportScreen';
import { POSServicesReportScreen } from './screens/POSServicesReportScreen';
import { POSTechniciansReportScreen } from './screens/POSTechniciansReportScreen';
import { POSPaymentsReportScreen } from './screens/POSPaymentsReportScreen';
import { POSCustomersReportScreen } from './screens/POSCustomersReportScreen';
import { POSAppointmentsReportScreen } from './screens/POSAppointmentsReportScreen';
import { POSTaxReportScreen } from './screens/POSTaxReportScreen';
import { POSTransactionsScreen } from './screens/POSTransactionsScreen';
import { POSTipsScreen } from './screens/POSTipsScreen';
import { POSSettlementsScreen } from './screens/POSSettlementsScreen';
import { POSTeamProfilesScreen } from './screens/POSTeamProfilesScreen';
import { POSServiceCategoriesScreen } from './screens/POSServiceCategoriesScreen';
import { POSServicePricingScreen } from './screens/POSServicePricingScreen';
import { POSTeamPerformanceScreen } from './screens/POSTeamPerformanceScreen';
import { POSPaymentTerminalsScreen } from './screens/POSPaymentTerminalsScreen';
import { POSGiftCardsScreen } from './screens/POSGiftCardsScreen';
import { POSLoyaltyScreen } from './screens/POSLoyaltyScreen';
import { POSAIMarketingScreen } from './screens/POSAIMarketingScreen';
import { POSAIMoneyProtectionScreen } from './screens/POSAIMoneyProtectionScreen';
import { POSAIMoneyProtectionAlertsScreen } from './screens/POSAIMoneyProtectionAlertsScreen';
import { POSAIMoneyProtectionInvestigationsScreen } from './screens/POSAIMoneyProtectionInvestigationsScreen';
import { POSAIMoneyProtectionRulesScreen } from './screens/POSAIMoneyProtectionRulesScreen';
import { POSAIMoneyProtectionSettingsScreen } from './screens/POSAIMoneyProtectionSettingsScreen';
import { POSAIVoiceTranscriptionScreen } from './screens/POSAIVoiceTranscriptionScreen';
import { POSAIVoiceTranscriptionHistoryScreen } from './screens/POSAIVoiceTranscriptionHistoryScreen';
import { POSAIVoiceTranscriptionDetailScreen } from './screens/POSAIVoiceTranscriptionDetailScreen';
import { POSAIVoiceTranscriptionSearchScreen } from './screens/POSAIVoiceTranscriptionSearchScreen';
import { POSAIVoiceTranscriptionUnresolvedScreen } from './screens/POSAIVoiceTranscriptionUnresolvedScreen';
import { POSAIVoiceTranscriptionSettingsScreen } from './screens/POSAIVoiceTranscriptionSettingsScreen';
import { POSAIMessageStudioScreen } from './screens/POSAIMessageStudioScreen';
import { POSAIAudienceBuilderScreen } from './screens/POSAIAudienceBuilderScreen';
import { POSAICampaignResultsScreen } from './screens/POSAICampaignResultsScreen';
import { POSAICampaignBuilderScreen } from './screens/POSAICampaignBuilderScreen';
import { POSPromotionsScreen } from './screens/POSPromotionsScreen';
import { POSCouponsScreen } from './screens/POSCouponsScreen';
import { POSDealsScreen } from './screens/POSDealsScreen';
import { POSDisplayAdsScreen } from './screens/POSDisplayAdsScreen';
import { POSReviewsScreen } from './screens/POSReviewsScreen';
import { POSMembershipsScreen } from './screens/POSMembershipsScreen';
import { POSTeamScreen } from './screens/POSTeamScreen';
import { POSMessagesScreen } from './screens/POSMessagesScreen';
import { POSReportsScreen } from './screens/POSReportsScreen';
import { POSSettingsScreen } from './screens/POSSettingsScreen';
import { POSNailShowcaseModerationScreen } from './screens/POSNailShowcaseModerationScreen';
import { POSFollowUpsScreen } from './screens/POSFollowUpsScreen';
import { POSCashHandoffScreen } from './screens/POSCashHandoffScreen';
import { POSCashDrawerScreen } from './screens/POSCashDrawerScreen';
import { EndOfDayFollowUpSettings } from './screens/EndOfDayFollowUpSettings';
import { FeaturePage } from './screens/FeaturePage';
import { TenantLocationsScreen } from './screens/TenantLocationsScreen';
import { TenantInventoryScreen } from './screens/TenantInventoryScreen';
import { TenantSuppliersScreen } from './screens/TenantSuppliersScreen';
import { TenantApiWebhooksScreen } from './screens/TenantApiWebhooksScreen';
import { TenantLogsScreen } from './screens/TenantLogsScreen';
import { POSCampaignCenterScreen } from './screens/POSCampaignCenterScreen';
import { POSCommunicationsScreen } from './screens/POSCommunicationsScreen';
import { POSPayrollScreen } from './screens/POSPayrollScreen';
import { POSCommissionReportScreen } from './screens/POSCommissionReportScreen';
import { POSRefundsVoidsScreen } from './screens/POSRefundsVoidsScreen';
import { POSTeamTipsScreen } from './screens/POSTeamTipsScreen';
import { featureRoutes } from './shell/tenant-nav';
import { POSWalkInScreen } from './screens/POSWalkInScreen';
import { POSNewBookingScreen } from './screens/POSNewBookingScreen';
import { t, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { usePosLanguage } from './i18n/use-pos-language';

// POSRoutes. All 15 POS screens are converted from the original HTML and mapped to their real backend state.
// (Front-desk write actions are wired where the request body is unambiguous; the rest render real data read-only.)

function POSRoutes() {
  // Vietnamese POS mandate (WP-B): subscribing here re-creates every route element on a language switch, so React UPDATES
  // (never remounts) the mounted screen and its subtree — every render-time t() re-runs while state, refs, realtime
  // listeners and the SSE connection survive. Never put the language in a `key`.
  useLanguage();
  const { principal } = useAuth();          // server-issued principal — the role is not client-chosen
  // Constitution 7 §19: a billing-only session (suspended salon's owner) gets the invoices screen and nothing else
  if (principal?.restriction === 'SUSPENDED_BILLING_ONLY') return <SuspendedBillingOnly />;
  return (
    <Routes>
      {/* Constitution 3 Step 10d: an app's connection request (owner signed in) */}
      <Route path="/oauth/authorize" element={<OAuthConsentScreen />} />
      <Route path="/" element={<POSLayout />}>
        {/* Role-based landing (spec §5). The role comes from the SERVER-ISSUED principal — the frontend never
            picks its own role, and this grants nothing: every screen behind it is still gated by the backend's
            RolePermissionGuard. */}
        <Route index element={<Navigate to={landingPathForRole(principal?.role)} replace />} />
        <Route path="overview" element={<POSOverviewScreen />} />
        <Route path="tenant/overview" element={<POSOverviewScreen />} />
        <Route path="dashboard" element={<POSDashboardScreen />} />
        <Route path="live-operations" element={<POSDashboardScreen />} />
        <Route path="tenant/dashboard" element={<POSDashboardScreen />} />
        <Route path="check-in" element={<POSCheckInScreen />} />
        <Route path="queue" element={<POSQueueScreen />} />
        <Route path="serving" element={<POSServingScreen />} />
        <Route path="service-done" element={<POSServiceDoneScreen />} />
        <Route path="checkout" element={<POSCheckoutScreen />} />
        <Route path="cash-handoffs" element={<POSCashHandoffScreen />} />
        <Route path="cash-drawer" element={<POSCashDrawerScreen />} />
        <Route path="booking" element={<POSBookingScreen />} />
        <Route path="booking/walk-in" element={<POSWalkInScreen />} />
        <Route path="booking/new" element={<POSNewBookingScreen />} />
        <Route path="tech-queue" element={<POSTechQueueScreen />} />
        <Route path="tech-appointments" element={<POSTechAppointmentsScreen />} />
        <Route path="technicians" element={<POSTechniciansScreen />} />
        <Route path="technicians/schedule" element={<POSLiveTechnicianScheduleScreen />} />
        <Route path="technicians/skill-requests" element={<POSSkillRequestsScreen />} />
        <Route path="technicians/:technicianId" element={<POSTechnicianProfileScreen />} />   {/* Technician Profile mandate §8/§141 */}
        <Route path="services" element={<POSServicesScreen />} />
        <Route path="tenant/payments/overview" element={<POSPaymentsOverviewScreen />} />
        <Route path="tenant/ai/command-center" element={<POSAICenterScreen />} />
        <Route path="tenant/ai/copilot" element={<POSReceptionCopilotScreen />} />
        <Route path="tenant/communications/messaging-setup" element={<POSMessagingSetupScreen />} />
        <Route path="tenant/ai/receptionist" element={<POSAIReceptionistScreen />} />
        <Route path="tenant/ai/receptionist/front-desk" element={<POSAIFrontDeskScreen />} />
        <Route path="tenant/ai/receptionist/follow-ups" element={<POSAIFollowUpsScreen />} />
        <Route path="tenant/ai/receptionist/business-setup" element={<POSAIBusinessSetupScreen />} />
        <Route path="tenant/ai/receptionist/calendar" element={<POSAICalendarScreen />} />
        <Route path="tenant/ai/receptionist/calls" element={<POSAICallsScreen />} />
        <Route path="tenant/ai/queue" element={<POSAIQueueAssignmentScreen />} />
        <Route path="tenant/ai/receptionist/settings" element={<POSAISettingsScreen />} />
        <Route path="tenant/ai/plans" element={<POSAIPlansScreen />} />
        <Route path="tenant/management/overview" element={<POSManagementScreen />} />
        <Route path="tenant/devices/overview" element={<POSDevicesScreen />} />
        <Route path="tenant/devices/customer-displays" element={<POSCustomerDisplaysScreen />} />
        <Route path="tenant/account/overview" element={<POSAccountScreen />} />
        <Route path="tenant/account/activity-logs" element={<POSActivityLogsScreen />} />
        <Route path="tenant/account/security" element={<POSSecurityScreen />} />
        <Route path="tenant/account/subscription" element={<POSSubscriptionScreen />} />
        {/* Phase 9: one roster — Users & Roles merged into Team › Roles & Permissions */}
        <Route path="tenant/account/users-roles" element={<Navigate to="/tenant/team/permissions" replace />} />
        {/* No separate billing data source exists (no invoice/payment-method tables; payments run at the Fiserv/Clover
            transaction level, not subscription billing). Point Billing at Subscription, which carries the real
            plan + recurring-charge data — rather than show a fabricated invoices/payment-method facade. */}
        <Route path="tenant/account/billing" element={<Navigate to="/tenant/account/subscription" replace />} />
        <Route path="tenant/account/support" element={<POSHelpCenterScreen />} />
        <Route path="customers" element={<POSCustomersScreen />} />
        <Route path="tenant/customers/memberships" element={<POSMembershipsScreen />} />
        <Route path="messages" element={<POSMessagesScreen />} />
        <Route path="nail-showcase" element={<POSNailShowcaseModerationScreen />} />
        <Route path="follow-ups" element={<POSFollowUpsScreen />} />
        <Route path="settings/follow-ups" element={<EndOfDayFollowUpSettings />} />
        <Route path="reports" element={<POSReportsScreen />} />
        <Route path="settings" element={<POSSettingsScreen />} />
        <Route path="tenant/management/locations" element={<TenantLocationsScreen />} />
        <Route path="tenant/inventory" element={<TenantInventoryScreen />} />
        <Route path="tenant/inventory/vendors" element={<TenantSuppliersScreen />} />
        <Route path="tenant/integrations/api-webhooks" element={<TenantApiWebhooksScreen />} />
        <Route path="tenant/devices/logs" element={<TenantLogsScreen />} />
        <Route path="tenant/marketing/campaigns" element={<POSCampaignCenterScreen />} />
        <Route path="tenant/marketing/deals" element={<POSDealsScreen />} />
        <Route path="tenant/marketing/display-ads" element={<POSDisplayAdsScreen />} />
        <Route path="tenant/communications/sms" element={<POSCommunicationsScreen />} />
        <Route path="tenant/team/payroll" element={<POSPayrollScreen />} />
        <Route path="tenant/team/members" element={<POSTeamScreen />} />
        <Route path="tenant/reports/sales" element={<POSSalesReportScreen />} />
        <Route path="tenant/reports/services" element={<POSServicesReportScreen />} />
        <Route path="tenant/reports/technicians" element={<POSTechniciansReportScreen />} />
        <Route path="tenant/reports/commission" element={<POSCommissionReportScreen />} />
        <Route path="tenant/reports/payroll" element={<Navigate to="/tenant/team/payroll" replace />} />
        <Route path="tenant/team/commission" element={<Navigate to="/tenant/reports/commission" replace />} />
        <Route path="tenant/team/tips" element={<POSTeamTipsScreen />} />
        <Route path="tenant/services/packages" element={<Navigate to="/tenant/customers/memberships" replace />} />
        <Route path="tenant/reports/payments" element={<POSPaymentsReportScreen />} />
        <Route path="tenant/reports/customers" element={<POSCustomersReportScreen />} />
        <Route path="tenant/reports/appointments" element={<POSAppointmentsReportScreen />} />
        <Route path="tenant/reports/tax" element={<POSTaxReportScreen />} />
        <Route path="tenant/payments/transactions" element={<POSTransactionsScreen />} />
        <Route path="tenant/payments/tips" element={<POSTipsScreen />} />
        <Route path="tenant/payments/settlements" element={<POSSettlementsScreen />} />
        <Route path="tenant/team/profiles" element={<POSTeamProfilesScreen />} />
        <Route path="tenant/services/categories" element={<POSServiceCategoriesScreen />} />
        <Route path="tenant/services/pricing" element={<POSServicePricingScreen />} />
        <Route path="tenant/team/performance" element={<POSTeamPerformanceScreen />} />
        <Route path="tenant/devices/payment-terminals" element={<POSPaymentTerminalsScreen />} />
        <Route path="tenant/customers/gift-cards" element={<POSGiftCardsScreen />} />
        <Route path="tenant/payments/gift-cards" element={<Navigate to="/tenant/customers/gift-cards" replace />} />
        <Route path="tenant/payments/refunds-voids" element={<POSRefundsVoidsScreen />} />
        <Route path="tenant/customers/loyalty" element={<POSLoyaltyScreen />} />
        <Route path="tenant/ai/marketing" element={<POSAIMarketingScreen />} />
        <Route path="tenant/ai/money-protection" element={<POSAIMoneyProtectionScreen />} />
        <Route path="tenant/ai/money-protection/alerts" element={<POSAIMoneyProtectionAlertsScreen />} />
        <Route path="tenant/ai/money-protection/investigations" element={<POSAIMoneyProtectionInvestigationsScreen />} />
        <Route path="tenant/ai/money-protection/rules" element={<POSAIMoneyProtectionRulesScreen />} />
        <Route path="tenant/ai/money-protection/settings" element={<POSAIMoneyProtectionSettingsScreen />} />
        <Route path="tenant/ai/voice-transcription" element={<POSAIVoiceTranscriptionScreen />} />
        <Route path="tenant/ai/voice-transcription/history" element={<POSAIVoiceTranscriptionHistoryScreen />} />
        <Route path="tenant/ai/voice-transcription/search" element={<POSAIVoiceTranscriptionSearchScreen />} />
        <Route path="tenant/ai/voice-transcription/unresolved" element={<POSAIVoiceTranscriptionUnresolvedScreen />} />
        <Route path="tenant/ai/voice-transcription/settings" element={<POSAIVoiceTranscriptionSettingsScreen />} />
        <Route path="tenant/ai/voice-transcription/transcripts/:id" element={<POSAIVoiceTranscriptionDetailScreen />} />
        <Route path="tenant/ai/marketing/studio" element={<POSAIMessageStudioScreen />} />
        <Route path="tenant/ai/marketing/audiences" element={<POSAIAudienceBuilderScreen />} />
        <Route path="tenant/ai/marketing/results" element={<POSAICampaignResultsScreen />} />
        <Route path="tenant/ai/marketing/builder" element={<POSAICampaignBuilderScreen />} />
        <Route path="tenant/ai/business" element={<POSAiBusinessScreen />} />
        <Route path="tenant/ai/inventory" element={<POSAiInventoryScreen />} />
        <Route path="tenant/ai/analytics" element={<POSAiForecastingScreen />} />
        <Route path="tenant/ai/business/branches" element={<POSAiBranchCompareScreen />} />
        <Route path="tenant/ai/business/alerts" element={<POSAiAlertsScreen />} />
        <Route path="tenant/ai/business/reports" element={<POSAiReportsScreen />} />
        <Route path="tenant/ai/customer-profile" element={<POSAICustomerProfileOverviewScreen />} />
        <Route path="tenant/ai/customer-profile/duplicates" element={<POSAICustomerDuplicateReviewScreen />} />
        <Route path="tenant/ai/customer-profile/churn" element={<POSAICustomerChurnWatchScreen />} />
        <Route path="tenant/ai/customer-profile/rebooking" element={<POSAICustomerRebookingScreen />} />
        <Route path="tenant/ai/customer-profile/recommendations" element={<POSAICustomerRecommendationsScreen />} />
        <Route path="tenant/ai/customer-profile/settings" element={<POSAICustomerSettingsScreen />} />
        <Route path="tenant/ai/checkout-upsell/settings" element={<AICheckoutUpsellSettingsScreen />} />
        <Route path="tenant/ai/platform" element={<POSAiGovernanceScreen />} />
        <Route path="tenant/ai/platform/settings" element={<POSAiSettingsEditor />} />
        {/* Gift Cards guide (Nov 4 2026): the settings screen had the same path as the redirect above and could never open */}
        <Route path="tenant/payments/gift-cards/settings" element={<POSGiftCardSettingsScreen />} />
        <Route path="tenant/payments/sell-gift-card" element={<POSSellGiftCardScreen />} />
        <Route path="tenant/payments/reload-gift-card" element={<POSReloadGiftCardScreen />} />
        <Route path="tenant/payments/gift-card-stock" element={<POSGiftCardStockScreen />} />
        <Route path="tenant/payments/gift-card-lookup" element={<POSGiftCardLookupScreen />} />
        <Route path="tenant/ai/reputation" element={<POSAIReviewReputationScreen />} />
        <Route path="tenant/ai/scheduling-optimizer" element={<POSAISchedulingOptimizerScreen />} />
        <Route path="approvals" element={<POSApprovalsScreen />} />
        <Route path="community" element={<CommunityFeedScreen />} />
        <Route path="community/posts/:id" element={<CommunityPostScreen />} />
        <Route path="community/new" element={<CommunityAdvisoryEditor />} />
        <Route path="community/drafts" element={<CommunityDraftsScreen />} />
        <Route path="community/drafts/:id" element={<CommunityAdvisoryEditor />} />
        <Route path="community/approvals" element={<CommunityApprovalsScreen />} />
        <Route path="community/incidents" element={<CommunityIncidentsScreen />} />
        <Route path="community/settings" element={<CommunitySettingsScreen />} />
        <Route path="tenant/ai/ocr-receipt" element={<POSAIOcrReceiptScreen />} />
        <Route path="tenant/communications/phone-verification" element={<POSBookingVerificationScreen />} />
        <Route path="tenant/customers/phone-management" element={<PhoneManagementCenter />} />
        <Route path="tenant/ai/reputation/settings" element={<POSAIReviewReputationSettingsScreen />} />
        <Route path="tenant/ai/customer-profile/timeline" element={<POSAICustomerTimelineScreen />} />
        <Route path="tenant/ai/customer-profile/search" element={<POSAICustomerSearchScreen />} />
        <Route path="tenant/ai/reception-copilot" element={<POSReceptionCopilotScreen />} />
        <Route path="tenant/devices/reception-pos" element={<POSDeviceFleetScreen view="reception-pos" />} />
        <Route path="tenant/devices/check-in-kiosk" element={<POSDeviceFleetScreen view="check-in-kiosk" />} />
        <Route path="tenant/devices/tablets" element={<POSDeviceFleetScreen view="tablets" />} />
        <Route path="tenant/devices/receipt-devices" element={<POSDeviceFleetScreen view="receipt-devices" />} />
        <Route path="tenant/devices/assignments" element={<POSDeviceFleetScreen view="assignments" />} />
        <Route path="tenant/devices/health" element={<POSDeviceFleetScreen view="health" />} />
        <Route path="tenant/account/usage-limits" element={<POSUsageLimitsScreen />} />
        <Route path="tenant/account/invoices" element={<POSAccountInvoicesScreen />} />
        <Route path="tenant/inventory/alerts" element={<POSInventoryAlertsScreen />} />
        <Route path="tenant/inventory/purchase-orders" element={<POSPurchaseOrdersScreen />} />
        <Route path="tenant/products" element={<POSProductsScreen />} />
        <Route path="tenant/management/features" element={<POSFeaturesScreen />} />
        <Route path="tenant/management/setup-health" element={<POSSetupHealthScreen />} />
        <Route path="tenant/ai/usage" element={<POSAiUsageScreen />} />
        <Route path="tenant/communications/notifications" element={<POSNotificationsScreen />} />
        <Route path="tenant/communications/reminders" element={<POSRemindersScreen />} />
        <Route path="tenant/communications/templates" element={<POSMessageTemplatesScreen />} />
        <Route path="tenant/system-status" element={<POSSystemStatusScreen />} />
        <Route path="tenant/communications/ai-receptionist" element={<POSAIReceptionistScreen />} />
        <Route path="tenant/marketing/win-back" element={<POSRetentionScreen />} />
        <Route path="tenant/integrations/payment-gateway" element={<POSPaymentGatewayScreen />} />
        <Route path="tenant/marketing/segments" element={<POSSegmentsScreen />} />
        <Route path="tenant/marketing/birthdays" element={<POSBirthdaysScreen />} />
        <Route path="tenant/marketing/referrals" element={<POSReferralsScreen />} />
        <Route path="tenant/communications/phone" element={<POSPhoneScreen />} />
        <Route path="tenant/integrations/phone" element={<POSPhoneScreen />} />
        <Route path="tenant/communications/email" element={<POSEmailScreen />} />
        <Route path="tenant/integrations/email" element={<POSEmailScreen />} />
        <Route path="tenant/marketing/social" element={<POSSocialScreen />} />
        <Route path="tenant/integrations/apps" element={<POSIntegrationsScreen />} />
        <Route path="tenant/payments/deposit-reconciliation" element={<POSDepositReconScreen />} />
        <Route path="tenant/integrations/sms" element={<POSMessagingSetupScreen />} />
        <Route path="tenant/reports/ai" element={<POSAiAnalyticsScreen />} />
        <Route path="tenant/ai/booking" element={<POSAIBookingScreen />} />
        <Route path="tenant/ai/scheduling" element={<Navigate to="/tenant/ai/scheduling-optimizer" replace />} />{/* BUILD_PLAN Phase 7: one optimizer entry */}
        <Route path="tenant/ai/customer-insights" element={<POSAICustomerProfileAssistantScreen />} />
        <Route path="tenant/ai/checkout-upsell" element={<POSAICheckoutUpsellAssistantScreen />} />
        <Route path="tenant/ai/fraud-protection" element={<POSAIFraudProtectionAssistantScreen />} />
        <Route path="tenant/ai/reviews" element={<POSAIReviewAssistantScreen />} />
        <Route path="tenant/ai/receipt-scanner" element={<POSAIReceiptScannerScreen />} />
        <Route path="tenant/marketing/sms" element={<POSCampaignCenterScreen defaultChannel="sms" />} />
        <Route path="tenant/marketing/email" element={<POSCampaignCenterScreen defaultChannel="email" />} />
        <Route path="tenant/marketing/coupons" element={<POSCouponsScreen />} />
        <Route path="tenant/reports/multi-location" element={<POSMultiLocationScreen />} />
        <Route path="tenant/reports/marketing" element={<POSMarketingReportScreen />} />
        <Route path="tenant/reports/inventory" element={<POSInventoryReportScreen />} />
        <Route path="tenant/team/time-clock" element={<POSTimeClockScreen />} />
        <Route path="tenant/team/turn-queue" element={<POSTurnQueueScreen />} />
        <Route path="tenant/team/permissions" element={<POSTeamPermissionsScreen />} />
        <Route path="tenant/team/permissions/:userId" element={<POSMemberAccessScreen />} />
        <Route path="tenant/security/access" element={<POSAccessGovernanceScreen />} />
        <Route path="tenant/services/discounts" element={<POSDiscountsScreen />} />
        <Route path="tenant/services/add-ons" element={<POSServiceAddOnsScreen />} />
        <Route path="tenant/customers/appointment-history" element={<POSAppointmentHistoryScreen />} />
        <Route path="tenant/customers/notes" element={<POSCustomerNotesScreen />} />
        <Route path="tenant/customers/profiles" element={<POSCustomerProfileScreen />} />
        <Route path="tenant/customers/retention" element={<POSRetentionScreen />} />
        <Route path="tenant/customers/saved-cards" element={<POSSavedCardsScreen />} />
        <Route path="tenant/payments/terminals" element={<Navigate to="/tenant/devices/payment-terminals" replace />} />
        <Route path="tenant/payments/expenses" element={<POSExpensesScreen />} />
        <Route path="tenant/payments/split-payments" element={<POSSplitPaymentsScreen />} />
        <Route path="tenant/payments/invoices" element={<POSInvoicesScreen />} />
        <Route path="tenant/marketing" element={<POSMarketingLandingScreen />} />
        <Route path="tenant/marketing/promotions" element={<POSPromotionsScreen />} />
        <Route path="tenant/marketing/reviews" element={<POSReviewsScreen />} />
        <Route path="tenant/management/salon-profile" element={<Navigate to="/settings?section=business-branch" replace />} />
        <Route path="tenant/management/business-hours" element={<Navigate to="/settings?section=auto-logout" replace />} />
        <Route path="tenant/management/auto-logout" element={<Navigate to="/settings?section=auto-logout" replace />} />
        <Route path="tenant/management/booking-rules" element={<Navigate to="/settings?section=booking-appointments" replace />} />
        <Route path="tenant/management/no-show-policy" element={<Navigate to="/settings?section=booking-appointments" replace />} />
        <Route path="tenant/management/cancellation-policy" element={<Navigate to="/settings?section=booking-appointments" replace />} />
        <Route path="tenant/management/checkout-rules" element={<Navigate to="/settings?section=payments-checkout" replace />} />
        <Route path="tenant/management/tax-tip-rules" element={<Navigate to="/settings?section=tax" replace />} />
        <Route path="tenant/management/loyalty-rules" element={<Navigate to="/settings?section=loyalty-memberships" replace />} />
        <Route path="tenant/management/membership-rules" element={<Navigate to="/settings?section=loyalty-memberships" replace />} />
        <Route path="tenant/management/queue-rules" element={<Navigate to="/settings?section=queue-workflow" replace />} />
        {/* Data-driven tenant nav routes without a dedicated screen yet → shared gated FeaturePage (never blank/dead).
            featureRoutes() already excludes every route in EXISTING_ROUTES (tenant-nav.tsx) — the single source of
            truth for which routes have a dedicated screen. No inline filtering here, so the two can never drift. */}
        {featureRoutes().map((it) => (
          <Route key={it.id} path={it.route.replace(/^\//, '')} element={<FeaturePage />} />
        ))}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}

function Gate() {
  const { principal, loading } = useAuth();
  // the POS language: signed in → user's choice ?? salon default ?? English (GET pos/me/locale); signed out → English.
  // Gate stays mounted across sign-in / sign-out, and subscribes so the login / recovery screens follow a switch too.
  usePosLanguage(principal?.userId);
  useLanguage();
  // Invitee accept link is pre-auth: render it before the loading/login gate so a logged-out tenant invitee can redeem it.
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  // Password recovery is pre-auth too — a locked-out staff member must reach it without a session.
  if (typeof window !== 'undefined' && window.location.pathname === '/forgot-password') return <ForgotPasswordScreen />;
  // Constitution 3 Step 10a: the "This wasn't me" link from a new-device alert — pre-auth by design
  if (typeof window !== 'undefined' && window.location.pathname === '/security/not-me') return <SecurityNotMeScreen />;
  if (loading) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><div className="muted">{t('pos.loading')}</div></div>;
  // Cross-app routing (spec §5): a role that belongs in a DIFFERENT deployment (technician → tech-web) is sent
  // there — but ONLY when that portal is configured. With nothing configured this is a no-op and everyone stays
  // in the POS, exactly as before. The destination comes solely from the SERVER-ISSUED role; there is no
  // client-supplied input, so it cannot be turned into an open redirect.
  if (principal && typeof window !== 'undefined') {
    const portal = crossAppRedirect((principal as any).role, (import.meta as any).env ?? {}, window.location.origin);
    if (portal) { window.location.replace(portal); return null; }
  }

  if (!principal) return <LoginScreen />;
  return <POSRoutes />;
}

export function App() {
  return <AuthProvider><IPadViewProvider><Gate /></IPadViewProvider></AuthProvider>;
}
