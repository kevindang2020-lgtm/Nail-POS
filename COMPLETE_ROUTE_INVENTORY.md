# COMPLETE_ROUTE_INVENTORY.md

_Generated 2026-07-09 from the actual codebase (tenant-nav.tsx, AdminLayout.tsx, each App.tsx, and the controller decorators). Every row below is derived from source, not hand-authored._

## Summary

| App | Router | Nav/routes | Screens | Dead links | Dup routes | Contract |
|---|---|---|---|---|---|---|
| pos-web (Tenant POS) | react-router | 187 nav items / 191 routes | 167 | 0 | 0 | clean |
| admin-web (Super Admin) | react-router | 129 nav dests / 124 routes | 133 | 0 | 0 | clean |
| owner-web | tab switch | 6 tabs / 32 screens | 32 | 0 | n/a | clean |
| tech-web | tab switch | 4 tabs / 20 screens | 20 | 0 | n/a | clean |
| customer-web | react-router | 47 routes | 58 | 0 | 0 | clean |
| manager-pay-web | screen switch | 7 screens | 7 | 0 | n/a | clean |
| customer-display | SSE state machine | 1 view | 0 | n/a | n/a | clean |
| go-check-in-admin / -kiosk | Capacitor static | — | — | n/a | n/a | n/a |

Backend: **266 controllers, ~2,142 routes** (incl. 6 SSE streams), empty global prefix (same-origin). Every frontend API namespace across all apps resolves to a real backend controller — 0 mismatches.

## Tenant POS (pos-web) — every sidebar item

| Sidebar label | Frontend route | Backend namespace | Status |
|---|---|---|---|
| Overview | `/overview` | `/pos/overview` | Fully connected (POSOverviewScreen) |
| Live Operations | `/dashboard` | `/pos/dashboard` | Fully connected (POSDashboardScreen) |
| Check-In | `/check-in` | `/pos/check-in` | Fully connected (POSCheckInScreen) |
| Booking | `/booking` | `/pos/booking` | Fully connected (POSBookingScreen) |
| Tech Queue | `/tech-queue` | `/pos/tech-queue` | Fully connected (POSTechQueueScreen) |
| Customer Queue | `/queue` | `/pos/queue` | Fully connected (POSQueueScreen) |
| Serving | `/serving` | `/pos/serving` | Fully connected (POSServingScreen) |
| Service Done | `/service-done` | `/pos/service-done` | Fully connected (POSServiceDoneScreen) |
| Checkout | `/checkout` | `/pos/checkout` | Fully connected (POSCheckoutScreen) |
| Customer Directory | `/customers` | `/pos/customers` | Fully connected (POSCustomersScreen) |
| Customer Profiles | `/tenant/customers/profiles` | `/pos/customers` | Fully connected (POSCustomerProfileScreen) |
| Appointment History | `/tenant/customers/appointment-history` | `/pos/customers` | Fully connected (POSAppointmentHistoryScreen) |
| Loyalty & Rewards | `/tenant/customers/loyalty` | `/pos/customers` | Fully connected (POSLoyaltyScreen) |
| Memberships | `/tenant/customers/memberships` | `/pos/customers` | Fully connected (POSMembershipsScreen) |
| Gift Cards | `/tenant/customers/gift-cards` | `/pos/customers` | Fully connected (POSGiftCardsScreen) |
| Customer Notes | `/tenant/customers/notes` | `/pos/customers` | Fully connected (POSCustomerNotesScreen) |
| Saved Cards | `/tenant/customers/saved-cards` | `/pos/customers` | Fully connected (POSSavedCardsScreen) |
| Customer Retention | `/tenant/customers/retention` | `/pos/customers` | Fully connected (POSRetentionScreen) |
| NailShowcase | `/nail-showcase` | `/pos/nail-showcase` | Fully connected (POSNailShowcaseModerationScreen) |
| All Team Members | `/tenant/team/members` | `/pos/team` | Fully connected (POSTeamScreen) |
| Technicians | `/technicians` | `/pos/technicians` | Fully connected (POSTechniciansScreen) |
| Technician Appointments | `/tech-appointments` | `/pos/tech-appointments` | Fully connected (POSTechAppointmentsScreen) |
| Skill Requests | `/technicians/skill-requests` | `/pos/technicians` | Fully connected (POSSkillRequestsScreen) |
| Staff Schedule | `/technicians/schedule` | `/pos/technicians` | Fully connected (POSLiveTechnicianScheduleScreen) |
| Time Clock | `/tenant/team/time-clock` | `/pos/team` | Fully connected (POSTimeClockScreen) |
| Technician Queue | `/tech-queue` | `/pos/tech-queue` | Fully connected (POSTechQueueScreen) |
| Commission | `/tenant/team/commission` | `/pos/team` | Fully connected (Navigate) |
| Tips | `/tenant/team/tips` | `/pos/team` | Fully connected (POSTeamTipsScreen) |
| Payroll | `/tenant/team/payroll` | `/pos/team` | Fully connected (POSPayrollScreen) |
| Performance | `/tenant/team/performance` | `/pos/team` | Fully connected (POSTeamPerformanceScreen) |
| Technician Profiles | `/tenant/team/profiles` | `/pos/team` | Fully connected (POSTeamProfilesScreen) |
| Staff Permissions | `/tenant/team/permissions` | `/pos/team` | Fully connected (POSTeamPermissionsScreen) |
| Services | `/services` | `/pos/services` | Fully connected (POSServicesScreen) |
| Service Categories | `/tenant/services/categories` | `/pos/services` | Fully connected (POSServiceCategoriesScreen) |
| Pricing | `/tenant/services/pricing` | `/pos/services` | Fully connected (POSServicePricingScreen) |
| Add-On Services | `/tenant/services/add-ons` | `/pos/services` | Fully connected (POSServiceAddOnsScreen) |
| Service Packages | `/tenant/services/packages` | `/pos/services` | Fully connected (Navigate) |
| Discounts | `/tenant/services/discounts` | `/pos/services` | Fully connected (POSDiscountsScreen) |
| Products | `/tenant/products` | `/pos/products` | Fully connected (POSProductsScreen) |
| Inventory | `/tenant/inventory` | `/pos/inventory` | Fully connected (TenantInventoryScreen) |
| Purchase Orders | `/tenant/inventory/purchase-orders` | `/pos/inventory` | Fully connected (POSPurchaseOrdersScreen) |
| Vendors | `/tenant/inventory/vendors` | `/pos/inventory` | Fully connected (TenantSuppliersScreen) |
| Low-Stock Alerts | `/tenant/inventory/alerts` | `/pos/inventory` | Fully connected (POSInventoryAlertsScreen) |
| Payments Overview | `/tenant/payments/overview` | `/pos/payments` | Fully connected (POSPaymentsOverviewScreen) |
| Transactions | `/tenant/payments/transactions` | `/pos/payments` | Fully connected (POSTransactionsScreen) |
| Cash Drawer | `/cash-drawer` | `/pos/cash-drawer` | Fully connected (POSCashDrawerScreen) |
| Daily Closeout | `/cash-handoffs` | `/pos/cash-handoffs` | Fully connected (POSCashHandoffScreen) |
| Refunds & Voids | `/tenant/payments/refunds-voids` | `/pos/payments` | Fully connected (POSRefundsVoidsScreen) |
| Split Payments | `/tenant/payments/split-payments` | `/pos/payments` | Fully connected (POSSplitPaymentsScreen) |
| Tips & Gratuity | `/tenant/payments/tips` | `/pos/payments` | Fully connected (POSTipsScreen) |
| Gift Card Payments | `/tenant/payments/gift-cards` | `/pos/payments` | Fully connected (Navigate) |
| Payment Terminal Status | `/tenant/payments/terminals` | `/pos/payments` | Fully connected (Navigate) |
| Deposits & Settlements | `/tenant/payments/settlements` | `/pos/payments` | Fully connected (POSSettlementsScreen) |
| AI Deposit Reconciliation | `/tenant/payments/deposit-reconciliation` | `/pos/payments` | Fully connected (POSDepositReconScreen) |
| Invoices | `/tenant/payments/invoices` | `/pos/payments` | Fully connected (POSInvoicesScreen) |
| Expenses | `/tenant/payments/expenses` | `/pos/payments` | Fully connected (POSExpensesScreen) |
| AI Receipt Recognition | `/tenant/ai/ocr-receipt` | `/pos/ai` | Fully connected (POSAIOcrReceiptScreen) |
| Phone & Caller ID | `/tenant/communications/phone` | `/pos/communications` | Fully connected (POSPhoneScreen) |
| AI Receptionist | `/tenant/communications/ai-receptionist` | `/pos/communications` | Fully connected (POSAIReceptionistScreen) |
| Messages | `/messages` | `/pos/messages` | Fully connected (POSMessagesScreen) |
| SMS Inbox | `/tenant/communications/sms` | `/pos/communications` | Fully connected (POSCommunicationsScreen) |
| Email | `/tenant/communications/email` | `/pos/communications` | Fully connected (POSEmailScreen) |
| Appointment Reminders | `/tenant/communications/reminders` | `/pos/communications` | Fully connected (POSRemindersScreen) |
| Missed Call Follow-Up | `/follow-ups` | `/pos/follow-ups` | Fully connected (POSFollowUpsScreen) |
| Follow-Up Settings | `/settings/follow-ups` | `/pos/settings` | Fully connected (EndOfDayFollowUpSettings) |
| Text Messaging Setup | `/tenant/communications/messaging-setup` | `/pos/communications` | Fully connected (POSMessagingSetupScreen) |
| Customer Notifications | `/tenant/communications/notifications` | `/pos/communications` | Fully connected (POSNotificationsScreen) |
| Message Templates | `/tenant/communications/templates` | `/pos/communications` | Fully connected (POSMessageTemplatesScreen) |
| Marketing Dashboard | `/tenant/marketing` | `/pos/marketing` | Fully connected (Navigate) |
| Campaigns | `/tenant/marketing/campaigns` | `/pos/marketing` | Fully connected (POSCampaignCenterScreen) |
| SMS Marketing | `/tenant/marketing/sms` | `/pos/marketing` | Fully connected (POSCampaignCenterScreen) |
| Email Marketing | `/tenant/marketing/email` | `/pos/marketing` | Fully connected (POSCampaignCenterScreen) |
| Promotions | `/tenant/marketing/promotions` | `/pos/marketing` | Fully connected (POSPromotionsScreen) |
| Coupons | `/tenant/marketing/coupons` | `/pos/marketing` | Fully connected (POSPromotionsScreen) |
| Customer Segments | `/tenant/marketing/segments` | `/pos/marketing` | Fully connected (POSSegmentsScreen) |
| Birthday Campaigns | `/tenant/marketing/birthdays` | `/pos/marketing` | Fully connected (POSBirthdaysScreen) |
| Win-Back Campaigns | `/tenant/marketing/win-back` | `/pos/marketing` | Fully connected (POSRetentionScreen) |
| Referrals | `/tenant/marketing/referrals` | `/pos/marketing` | Fully connected (POSReferralsScreen) |
| Reviews | `/tenant/marketing/reviews` | `/pos/marketing` | Fully connected (POSReviewsScreen) |
| Social Content | `/tenant/marketing/social` | `/pos/marketing` | Fully connected (POSSocialScreen) |
| AI Command Center | `/tenant/ai/command-center` | `/pos/ai` | Fully connected (POSAICenterScreen) |
| Reception Copilot | `/tenant/ai/copilot` | `/pos/ai` | Fully connected (POSReceptionCopilotScreen) |
| AI Receptionist | `/tenant/ai/receptionist` | `/pos/ai` | Fully connected (POSAIReceptionistScreen) |
| AI Front Desk | `/tenant/ai/receptionist/front-desk` | `/pos/ai` | Fully connected (POSAIFrontDeskScreen) |
| AI Follow-Ups | `/tenant/ai/receptionist/follow-ups` | `/pos/ai` | Fully connected (POSAIFollowUpsScreen) |
| AI Business Setup | `/tenant/ai/receptionist/business-setup` | `/pos/ai` | Fully connected (POSAIBusinessSetupScreen) |
| AI Calendar | `/tenant/ai/receptionist/calendar` | `/pos/ai` | Fully connected (POSAICalendarScreen) |
| AI Calls | `/tenant/ai/receptionist/calls` | `/pos/ai` | Fully connected (POSAICallsScreen) |
| AI Receptionist Settings | `/tenant/ai/receptionist/settings` | `/pos/ai` | Fully connected (POSAISettingsScreen) |
| AI Reception Copilot | `/tenant/ai/reception-copilot` | `/pos/ai` | Fully connected (POSReceptionCopilotScreen) |
| AI Booking Assistant | `/tenant/ai/booking` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Queue Assistant | `/tenant/ai/queue` | `/pos/ai` | Fully connected (POSAIQueueAssignmentScreen) |
| AI Scheduling Optimizer | `/tenant/ai/scheduling` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Business Assistant | `/tenant/ai/business` | `/pos/ai` | Fully connected (POSAiBusinessScreen) |
| AI Branch Comparison | `/tenant/ai/business/branches` | `/pos/ai` | Fully connected (POSAiBranchCompareScreen) |
| AI Business Alerts | `/tenant/ai/business/alerts` | `/pos/ai` | Fully connected (POSAiAlertsScreen) |
| AI Business Reports | `/tenant/ai/business/reports` | `/pos/ai` | Fully connected (POSAiReportsScreen) |
| AI Marketing Assistant | `/tenant/ai/marketing` | `/pos/ai` | Fully connected (POSAIMarketingScreen) |
| Campaign Builder | `/tenant/ai/marketing/builder` | `/pos/ai` | Fully connected (POSAICampaignBuilderScreen) |
| Message Studio | `/tenant/ai/marketing/studio` | `/pos/ai` | Fully connected (POSAIMessageStudioScreen) |
| Audience Builder | `/tenant/ai/marketing/audiences` | `/pos/ai` | Fully connected (POSAIAudienceBuilderScreen) |
| Campaign Results | `/tenant/ai/marketing/results` | `/pos/ai` | Fully connected (POSAICampaignResultsScreen) |
| AI Money Protection | `/tenant/ai/money-protection` | `/pos/ai` | Fully connected (POSAIMoneyProtectionScreen) |
| Money Protection · Alerts | `/tenant/ai/money-protection/alerts` | `/pos/ai` | Fully connected (POSAIMoneyProtectionAlertsScreen) |
| Money Protection · Investigations | `/tenant/ai/money-protection/investigations` | `/pos/ai` | Fully connected (POSAIMoneyProtectionInvestigationsScreen) |
| Money Protection · Rules | `/tenant/ai/money-protection/rules` | `/pos/ai` | Fully connected (POSAIMoneyProtectionRulesScreen) |
| Money Protection · Settings | `/tenant/ai/money-protection/settings` | `/pos/ai` | Fully connected (POSAIMoneyProtectionSettingsScreen) |
| AI Customer Insights | `/tenant/ai/customer-insights` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Checkout & Upsell | `/tenant/ai/checkout-upsell` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Fraud Protection | `/tenant/ai/fraud-protection` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Inventory Assistant | `/tenant/ai/inventory` | `/pos/ai` | Fully connected (POSAiInventoryScreen) |
| AI Review Assistant | `/tenant/ai/reviews` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Voice Transcription | `/tenant/ai/voice-transcription` | `/pos/ai` | Fully connected (POSAIVoiceTranscriptionScreen) |
| Voice · Call History | `/tenant/ai/voice-transcription/history` | `/pos/ai` | Fully connected (POSAIVoiceTranscriptionHistoryScreen) |
| Voice · Search | `/tenant/ai/voice-transcription/search` | `/pos/ai` | Fully connected (POSAIVoiceTranscriptionSearchScreen) |
| Voice · Follow-ups | `/tenant/ai/voice-transcription/unresolved` | `/pos/ai` | Fully connected (POSAIVoiceTranscriptionUnresolvedScreen) |
| Voice · Settings | `/tenant/ai/voice-transcription/settings` | `/pos/ai` | Fully connected (POSAIVoiceTranscriptionSettingsScreen) |
| AI Receipt Scanner | `/tenant/ai/receipt-scanner` | `/pos/ai` | Fully connected (POSAiPackageScreen) |
| AI Analytics & Forecasting | `/tenant/ai/analytics` | `/pos/ai` | Fully connected (POSAiForecastingScreen) |
| AI Plans & Packages | `/tenant/ai/plans` | `/pos/ai` | Fully connected (POSAIPlansScreen) |
| Customer Profile AI | `/tenant/ai/customer-profile` | `/pos/ai` | Fully connected (POSAICustomerProfileOverviewScreen) |
| Customer Search | `/tenant/ai/customer-profile/search` | `/pos/ai` | Fully connected (POSAICustomerSearchScreen) |
| Duplicate Review | `/tenant/ai/customer-profile/duplicates` | `/pos/ai` | Fully connected (POSAICustomerDuplicateReviewScreen) |
| Churn Watch | `/tenant/ai/customer-profile/churn` | `/pos/ai` | Fully connected (POSAICustomerChurnWatchScreen) |
| Rebooking | `/tenant/ai/customer-profile/rebooking` | `/pos/ai` | Fully connected (POSAICustomerRebookingScreen) |
| Service Recommendations | `/tenant/ai/customer-profile/recommendations` | `/pos/ai` | Fully connected (POSAICustomerRecommendationsScreen) |
| Customer AI Settings | `/tenant/ai/customer-profile/settings` | `/pos/ai` | Fully connected (POSAICustomerSettingsScreen) |
| Checkout Upsell AI | `/tenant/ai/checkout-upsell/settings` | `/pos/ai` | Fully connected (AICheckoutUpsellSettingsScreen) |
| Review & Reputation AI | `/tenant/ai/reputation` | `/pos/ai` | Fully connected (POSAIReviewReputationScreen) |
| AI Scheduling Optimizer | `/tenant/ai/scheduling-optimizer` | `/pos/ai` | Fully connected (POSAISchedulingOptimizerScreen) |
| Reputation AI Settings | `/tenant/ai/reputation/settings` | `/pos/ai` | Fully connected (POSAIReviewReputationSettingsScreen) |
| Customer Timeline | `/tenant/ai/customer-profile/timeline` | `/pos/ai` | Fully connected (POSAICustomerTimelineScreen) |
| AI Usage & Limits | `/tenant/ai/usage` | `/pos/ai` | Fully connected (POSAiUsageScreen) |
| Daily Summary | `/reports` | `/pos/reports` | Fully connected (POSReportsScreen) |
| Sales Reports | `/tenant/reports/sales` | `/pos/reports` | Fully connected (POSSalesReportScreen) |
| Appointment Reports | `/tenant/reports/appointments` | `/pos/reports` | Fully connected (POSAppointmentsReportScreen) |
| Technician Reports | `/tenant/reports/technicians` | `/pos/reports` | Fully connected (POSTechniciansReportScreen) |
| Commission Reports | `/tenant/reports/commission` | `/pos/reports` | Fully connected (POSCommissionReportScreen) |
| Payroll Reports | `/tenant/reports/payroll` | `/pos/reports` | Fully connected (Navigate) |
| Customer Reports | `/tenant/reports/customers` | `/pos/reports` | Fully connected (POSCustomersReportScreen) |
| Service Reports | `/tenant/reports/services` | `/pos/reports` | Fully connected (POSServicesReportScreen) |
| Inventory Reports | `/tenant/reports/inventory` | `/pos/reports` | Fully connected (POSInventoryReportScreen) |
| Marketing Reports | `/tenant/reports/marketing` | `/pos/reports` | Fully connected (POSMarketingReportScreen) |
| AI Reports | `/tenant/reports/ai` | `/pos/reports` | Fully connected (POSAiAnalyticsScreen) |
| Payment Reports | `/tenant/reports/payments` | `/pos/reports` | Fully connected (POSPaymentsReportScreen) |
| Tax Reports | `/tenant/reports/tax` | `/pos/reports` | Fully connected (POSTaxReportScreen) |
| Multi-Location Reports | `/tenant/reports/multi-location` | `/pos/reports` | Fully connected (POSMultiLocationScreen) |
| Management Overview | `/tenant/management/overview` | `/pos/management` | Fully connected (POSManagementScreen) |
| Salon Profile | `/tenant/management/salon-profile` | `/pos/management` | Fully connected (Navigate) |
| Locations | `/tenant/management/locations` | `/pos/management` | Fully connected (TenantLocationsScreen) |
| Business Hours | `/tenant/management/business-hours` | `/pos/management` | Fully connected (Navigate) |
| Tax & Tip Rules | `/tenant/management/tax-tip-rules` | `/pos/management` | Fully connected (Navigate) |
| Booking Rules | `/tenant/management/booking-rules` | `/pos/management` | Fully connected (Navigate) |
| Queue Rules | `/tenant/management/queue-rules` | `/pos/management` | Fully connected (Navigate) |
| Checkout Rules | `/tenant/management/checkout-rules` | `/pos/management` | Fully connected (Navigate) |
| Cancellation Policy | `/tenant/management/cancellation-policy` | `/pos/management` | Fully connected (Navigate) |
| No-Show Policy | `/tenant/management/no-show-policy` | `/pos/management` | Fully connected (Navigate) |
| Membership Rules | `/tenant/management/membership-rules` | `/pos/management` | Fully connected (Navigate) |
| Loyalty Rules | `/tenant/management/loyalty-rules` | `/pos/management` | Fully connected (Navigate) |
| Auto-Logout Rules | `/tenant/management/auto-logout` | `/pos/management` | Fully connected (Navigate) |
| Feature Access | `/tenant/management/features` | `/pos/management` | Fully connected (POSFeaturesScreen) |
| Devices Overview | `/tenant/devices/overview` | `/pos/devices` | Fully connected (POSDevicesScreen) |
| Reception POS | `/tenant/devices/reception-pos` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Customer Check-In Kiosk | `/tenant/devices/check-in-kiosk` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Payment Terminals | `/tenant/devices/payment-terminals` | `/pos/devices` | Fully connected (POSPaymentTerminalsScreen) |
| iPads & Tablets | `/tenant/devices/tablets` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Receipt Devices | `/tenant/devices/receipt-devices` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Device Assignments | `/tenant/devices/assignments` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Device Health | `/tenant/devices/health` | `/pos/devices` | Fully connected (POSDeviceFleetScreen) |
| Device Logs | `/tenant/devices/logs` | `/pos/devices` | Fully connected (TenantLogsScreen) |
| Payment Gateway | `/tenant/integrations/payment-gateway` | `/pos/integrations` | Fully connected (POSPaymentGatewayScreen) |
| Phone Integration | `/tenant/integrations/phone` | `/pos/integrations` | Fully connected (POSPhoneScreen) |
| SMS Integration | `/tenant/integrations/sms` | `/pos/integrations` | Fully connected (POSMessagingSetupScreen) |
| Email Integration | `/tenant/integrations/email` | `/pos/integrations` | Fully connected (POSEmailScreen) |
| API & Webhooks | `/tenant/integrations/api-webhooks` | `/pos/integrations` | Fully connected (TenantApiWebhooksScreen) |
| Connected Apps | `/tenant/integrations/apps` | `/pos/integrations` | Fully connected (POSIntegrationsScreen) |
| Account Overview | `/tenant/account/overview` | `/pos/account` | Fully connected (POSAccountScreen) |
| Subscription | `/tenant/account/subscription` | `/pos/account` | Fully connected (POSSubscriptionScreen) |
| AI Packages | `/tenant/ai/plans` | `/pos/ai` | Fully connected (POSAIPlansScreen) |
| Usage Limits | `/tenant/account/usage-limits` | `/pos/account` | Fully connected (POSUsageLimitsScreen) |
| Billing | `/tenant/account/billing` | `/pos/account` | Fully connected (Navigate) |
| Invoices | `/tenant/account/invoices` | `/pos/account` | Fully connected (POSAccountInvoicesScreen) |
| Users & Roles | `/tenant/account/users-roles` | `/pos/account` | Fully connected (POSUsersRolesScreen) |
| Security & 2FA | `/tenant/account/security` | `/pos/account` | Fully connected (POSSecurityScreen) |
| Activity Logs | `/tenant/account/activity-logs` | `/pos/account` | Fully connected (POSActivityLogsScreen) |
| Help & Support | `/tenant/account/support` | `/pos/account` | Fully connected (POSHelpCenterScreen) |
| Settings | `/settings` | `/pos/settings` | Fully connected (POSSettingsScreen) |

## Super Admin (admin-web) — every sidebar item + child

| Section | Sidebar label | Frontend route | Page component | Status |
|---|---|---|---|---|
| Platform Overview | Overview | `/dashboard` | DashboardScreen | Fully connected |
| Platform Overview | Platform Dashboard | `/platform-dashboard` | PlatformDashboardScreen | Fully connected |
| Platform Overview | Live Operations | `/live-operations` | LiveOperationsScreen | Fully connected |
| Platform Overview | Analytics | `/analytics` | AnalyticsScreen | Fully connected |
| Platform Overview | Report Builder | `/report-builder` | ReportBuilderScreen | Fully connected |
| Platform Overview | Scheduled Reports | `/scheduled-reports` | ScheduledReportsScreen | Fully connected |
| Tenant Management | Tenants | `/tenants` | TenantsScreen | Fully connected |
| Tenant Management | Branches | `/branches` | BranchesScreen | Fully connected |
| Tenant Management | Users & Roles | `/users-roles` | UsersRolesScreen | Fully connected |
| Tenant Management | Onboarding & Approvals | `/onboarding` | OnboardingScreen | Fully connected |
| Tenant Management | All Applications | `/onboarding` | OnboardingScreen | Fully connected |
| Tenant Management | Business Info | `/onboarding/business-info` | OnboardingScreen | Fully connected |
| Tenant Management | Identity Verification | `/onboarding/identity` | OnboardingScreen | Fully connected |
| Tenant Management | Legal Documents | `/onboarding/legal` | OnboardingScreen | Fully connected |
| Tenant Management | Merchant Setup | `/onboarding/merchant` | OnboardingScreen | Fully connected |
| Tenant Management | Bank Verification | `/onboarding/bank` | OnboardingScreen | Fully connected |
| Tenant Management | Hardware Assignment | `/onboarding/hardware` | OnboardingScreen | Fully connected |
| Tenant Management | Data Import | `/onboarding/data-import` | OnboardingScreen | Fully connected |
| Tenant Management | Training | `/onboarding/training` | OnboardingScreen | Fully connected |
| Tenant Management | Final Review | `/onboarding/final-review` | OnboardingScreen | Fully connected |
| Tenant Management | Activations | `/onboarding/activations` | OnboardingScreen | Fully connected |
| Tenant Management | Approvals | `/onboarding/approvals` | OnboardingScreen | Fully connected |
| Tenant Management | Tenant Applications | `/tenant-applications` | ApplicationsScreen | Fully connected |
| Tenant Management | Plans & Feature Limits | `/plans` | PlansScreen | Fully connected |
| Tenant Management | Website Leads | `/website-leads` | WebsiteLeadsScreen | Fully connected |
| Tenant Management | Owner Salons | `/owner-salons` | SuperAdminOwnersScreen | Fully connected |
| Tenant Management | Tenant Activity | `/tenant-activity` | TenantActivityScreen | Fully connected |
| Operations Oversight | Appointment Oversight | `/appointment-oversight` | AppointmentOversightScreen | Fully connected |
| Operations Oversight | Overview | `/appointment-oversight` | AppointmentOversightScreen | Fully connected |
| Operations Oversight | Appointment Search | `/appointment-oversight/search` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Booking Source | `/appointment-oversight/booking-source` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Failures & Issues | `/appointment-oversight/failures` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Duplicates | `/appointment-oversight/duplicates` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Overlapping Appointments | `/appointment-oversight/overlapping` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Rescheduled Appointments | `/appointment-oversight/rescheduled` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Change History | `/appointment-oversight/change-history` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Missing Information | `/appointment-oversight/missing-info` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Synchronization Failures | `/appointment-oversight/sync-failures` | AppointmentOversightSubScreen | Fully connected |
| Operations Oversight | Customer Data Oversight | `/customer-data-oversight` | CustomerDataOversightScreen | Fully connected |
| Operations Oversight | All Customers | `/customer-data-oversight` | CustomerDataOversightScreen | Fully connected |
| Operations Oversight | Duplicate Detection | `/customer-data-oversight/duplicate-detection` | DuplicateDetectionScreen | Fully connected |
| Operations Oversight | Import History | `/customer-data-oversight/import-history` | ImportHistoryScreen | Fully connected |
| Operations Oversight | Merge History | `/customer-data-oversight/merge-history` | MergeHistoryScreen | Fully connected |
| Operations Oversight | Privacy Requests | `/customer-data-oversight/privacy-requests` | PrivacyRequestsScreen | Fully connected |
| Operations Oversight | Data Exports | `/customer-data-oversight/data-exports` | DataExportsScreen | Fully connected |
| Operations Oversight | Deletion Requests | `/customer-data-oversight/deletion-requests` | DeletionRequestsScreen | Fully connected |
| Operations Oversight | Consent Status | `/customer-data-oversight/consent-status` | CustomerDataOversightScreen (:param) | Fully connected |
| Operations Oversight | Audit History | `/customer-data-oversight/audit-history` | AuditHistoryScreen | Fully connected |
| Operations Oversight | Legal Hold | `/customer-data-oversight/legal-hold` | LegalHoldScreen | Fully connected |
| Operations Oversight | Workforce Oversight | `/staff` | StaffOverviewScreen | Fully connected |
| Operations Oversight | All Workers | `/staff` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Technicians | `/staff?role=technician` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Receptionists | `/staff?role=receptionist` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Managers | `/staff?role=manager` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Transfers | `/staff?panel=transfers` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Access & Connectivity | `/staff?status=suspended` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Payroll Sync | `/staff?panel=payroll` | StaffOverviewScreen | Fully connected |
| Operations Oversight | Audit Events | `/audit-logs` | AuditLogsOverviewScreen | Fully connected |
| Operations Oversight | Booking & Check-In Monitor | `/booking-checkin` | BookingCheckinScreen | Fully connected |
| Operations Oversight | Overview | `/booking-checkin` | BookingCheckinScreen | Fully connected |
| Operations Oversight | Booking Sources | `/booking-checkin/booking-sources` | BookingSourcesScreen | Fully connected |
| Operations Oversight | Check-In Performance | `/booking-checkin/check-in-performance` | CheckinPerformanceScreen | Fully connected |
| Operations Oversight | Failed Events | `/booking-checkin/failed-events` | FailedEventsScreen | Fully connected |
| Operations Oversight | Wait-Time Analysis | `/booking-checkin/wait-time-analysis` | WaitTimeAnalysisScreen | Fully connected |
| Operations Oversight | Device Status | `/booking-checkin/device-status` | DeviceStatusScreen | Fully connected |
| Operations Oversight | AI Handoffs | `/booking-checkin/ai-handoffs` | AiHandoffsScreen | Fully connected |
| Operations Oversight | Live Queue Monitor | `/queue-management` | QueueManagementScreen | Fully connected |
| Operations Oversight | All Queues | `/queue-management` | QueueManagementScreen | Fully connected |
| Operations Oversight | Queue Timelines | `/queue-management/timelines` | QueueManagementScreen | Fully connected |
| Operations Oversight | Stuck Records | `/queue-management/stuck` | QueueManagementScreen | Fully connected |
| Operations Oversight | Sync Status | `/queue-management/sync` | QueueManagementScreen | Fully connected |
| Operations Oversight | Wait-Time Analytics | `/queue-management/wait-times` | QueueManagementScreen | Fully connected |
| Operations Oversight | Catalog Management | `/services` | ServicesScreen | Fully connected |
| Operations Oversight | Service Templates | `/service-templates` | ServiceTemplatesScreen | Fully connected |
| Operations Oversight | Product Catalog | `/product-catalog` | ProductCatalogScreen | Fully connected |
| Operations Oversight | Ticket Oversight | `/ticket-oversight` | TicketOversightScreen | Fully connected |
| Payments & Revenue | Payments & Transactions | `/payments-transactions` | PaymentsScreen | Fully connected |
| Payments & Revenue | Payment Gateways | `/payment-gateways` | PaymentGatewaysScreen | Fully connected |
| Payments & Revenue | Merchant Accounts | `/merchant-accounts` | MerchantAccountsScreen | Fully connected |
| Payments & Revenue | Settlements & Deposits | `/settlements-deposits` | SettlementsScreen | Fully connected |
| Payments & Revenue | Chargebacks & Disputes | `/chargebacks-disputes` | ChargebacksDisputesScreen | Fully connected |
| Payments & Revenue | Revenue & Refunds | `/platform-reports` | PlatformReportsScreen | Fully connected |
| Payments & Revenue | Revenue & Residuals | `/revenue-residuals` | RevenueResidualsScreen | Fully connected |
| Payments & Revenue | Hardware Packages | `/hardware-packages` | HardwarePackagesScreen | Fully connected |
| Payments & Revenue | Hardware Payments | `/hardware-payments` | HardwarePaymentsScreen | Fully connected |
| Payments & Revenue | HW Payment Reports | `/hardware-payment-reports` | HardwarePaymentReportsScreen | Fully connected |
| Business Management | Marketing & Campaigns | `/marketing-campaigns` | SuperAdminCampaignsScreen | Fully connected |
| Business Management | Promotions & Offers | `/promotions-offers` | PromotionsScreen | Fully connected |
| Business Management | Membership Programs | `/membership-programs` | MembershipProgramsScreen | Fully connected |
| Business Management | Loyalty Programs | `/loyalty-programs` | LoyaltyProgramsScreen | Fully connected |
| Business Management | Communications | `/communications` | CommunicationsOverviewScreen | Fully connected |
| Business Management | Overview | `/communications` | CommunicationsOverviewScreen | Fully connected |
| Business Management | Inbox | `/communications/inbox` | CommunicationsScreen | Fully connected |
| Business Management | NailShowcase | `/nail-showcase` | SuperAdminNailShowcaseModerationScreen | Fully connected |
| AI & Automation | AI Insights | `/ai-insights` | AiInsightsScreen | Fully connected |
| AI & Automation | AI Receptionist | `/ai-receptionist` | AiReceptionistScreen | Fully connected |
| AI & Automation | Reception Copilot | `/reception-copilot` | ReceptionCopilotUsageScreen | Fully connected |
| AI & Automation | Tenant Messaging (Twilio) | `/tenant-messaging` | TenantMessagingSetupScreen | Fully connected |
| AI & Automation | A2P 10DLC Registration | `/a2p-registration` | TenantA2pScreen | Fully connected |
| AI & Automation | Messaging Environment | `/messaging-environment` | MessagingReadinessScreen | Fully connected |
| AI & Automation | AI Booking Analytics | `/ai-booking-analytics` | AiBookingAnalyticsScreen | Fully connected |
| AI & Automation | AI Customer Profile | `/ai-customer-profile` | AiCustomerProfileOversightScreen | Fully connected |
| AI & Automation | AI Checkout Upsell | `/ai-checkout-upsell` | AiCheckoutUpsellOversightScreen | Fully connected |
| AI & Automation | AI Reports | `/ai-reports` | AiReportsScreen | Fully connected |
| AI & Automation | AI Forecasting | `/ai-forecasting` | AiForecastingScreen | Fully connected |
| AI & Automation | Smart Reminders | `/smart-reminders` | SmartRemindersOverviewScreen | Fully connected |
| AI & Automation | Overview | `/smart-reminders` | SmartRemindersOverviewScreen | Fully connected |
| AI & Automation | Performance | `/smart-reminders/performance` | SmartRemindersScreen | Fully connected |
| AI & Automation | Automation Rules | `/automation-rules` | AutomationRulesScreen | Fully connected |
| AI & Automation | AI Usage & Configuration | `/ai-usage-configuration` | AiUsageConfigScreen | Fully connected |
| AI & Automation | AI Business Assistant | `/ai-business-adoption` | SuperAdminAiBusinessScreen | Fully connected |
| AI & Automation | AI Packages | `/ai-packages` | AIPackagesScreen | Fully connected |
| AI & Automation | AI Plans | `/ai-plans` | AIPlansScreen | Fully connected |
| AI & Automation | AI Subscriptions | `/ai-subscriptions` | AiSubscriptionsScreen | Fully connected |
| AI & Automation | Usage Limits | `/usage-limits` | UsageLimitsScreen | Fully connected |
| System Settings | General Settings | `/settings` | GeneralSettingsScreen | Fully connected |
| System Settings | Billing & Subscriptions | `/subscriptions` | BillingScreen | Fully connected |
| System Settings | Integrations | `/integrations` | IntegrationsScreen | Fully connected |
| System Settings | Device Management | `/devices-management` | DevicesScreen | Fully connected |
| System Settings | Security & Compliance | `/security-compliance` | SecurityScreen | Fully connected |
| System Settings | Audit Logs | `/audit-logs` | AuditLogsOverviewScreen | Fully connected |
| System Settings | Overview | `/audit-logs` | AuditLogsOverviewScreen | Fully connected |
| System Settings | Browse Events | `/audit-logs/browse` | AuditLogsScreen | Fully connected |
| System Settings | Check-In Devices | `/check-in-devices` | CheckInDevicesScreen | Fully connected |
| Support | Support Center | `/support-access` | SupportAccessScreen | Fully connected |
| Support | System Status | `/system-status` | SystemStatusScreen | Fully connected |
| Support | System Health | `/system-health` | SystemHealthScreen | Fully connected |
| Support | Project Status | `/project-status` | ProjectStatusScreen | Fully connected |
| Support | Alerts | `/alerts` | AlertsScreen | Fully connected |
