# FRONTEND_ROUTE_STATUS.md

**GENERATED FROM CODE — do not hand-edit.**
*Generated on 2026-11-06 by `apps/api/scripts/generate-frontend-route-status.mjs`*

Mandate §248: Authoritative status of all routes, screens, permissions, and backend API connections across all 9 frontend applications in AI PowerSalon POS.

## 1. Executive Summary Across All Frontends

| Application | Router / Architecture | Routes / Screens | Crosswire Status | Nav Status | Overall Status |
| --- | --- | ---: | --- | --- | --- |
| **Tenant POS (pos-web)** | React 18 SPA (react-router-dom) | 221 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Super Admin (admin-web)** | React 18 SPA (react-router-dom) | 157 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Owner Portal (owner-web)** | React 18 SPA (Tab Navigation) | 35 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Technician App (tech-web)** | React 18 SPA (Tab Navigation) | 29 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Customer Web (customer-web)** | React 18 SPA (react-router-dom) | 54 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Manager Pay App (manager-pay-web)** | React 18 SPA (Mobile Tab + Flow Stack) | 9 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Customer Facing Display (customer-display)** | React 18 SPA (SSE State Machine) | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Self-Service Check-In Kiosk (go-check-in-kiosk)** | Single-File HTML5 / Capacitor App | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Public Booking Widget (booking-public)** | Single-File HTML5 Standalone Widget | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |

**Total Frontend API Calls:** 2,525 calls catalogued | **Orphaned (404) Calls:** 0 | **Dead Sidebar Items:** 0

---

## Tenant POS (pos-web)

- **Architecture:** React 18 SPA (react-router-dom)
- **Target Role / Plane:** Salon Staff / Receptionist / Manager
- **Total Managed Routes / Screens:** 221
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/oauth/authorize` | authorize | `OAuthConsentScreen` | `apps/pos-web/src/screens/OAuthConsentScreen.tsx` | `GET /oauth/authorize?`<br>`POST /oauth/authorize` | `settings.edit` | ✅ PASS |
| `/` | Root | `POSLayout` | `apps/pos-web/src/shell/POSLayout.tsx` | `GET /tech/manager-messages`<br>`PATCH /tech/manager-messages` | `pos.technicians.view` | ✅ PASS |
| `/overview` | overview | `POSOverviewScreen` | `apps/pos-web/src/screens/POSOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/overview` | overview | `POSOverviewScreen` | `apps/pos-web/src/screens/POSOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/dashboard` | dashboard | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/live-operations` | live-operations | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/dashboard` | dashboard | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/check-in` | check-in | `POSCheckInScreen` | `apps/pos-web/src/screens/POSCheckInScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue` | queue | `POSQueueScreen` | `apps/pos-web/src/screens/POSQueueScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/serving` | serving | `POSServingScreen` | `apps/pos-web/src/screens/POSServingScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/service-done` | service-done | `POSServiceDoneScreen` | `apps/pos-web/src/screens/POSServiceDoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/checkout` | checkout | `POSCheckoutScreen` | `apps/pos-web/src/screens/POSCheckoutScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/cash-handoffs` | cash-handoffs | `POSCashHandoffScreen` | `apps/pos-web/src/screens/POSCashHandoffScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/cash-drawer` | cash-drawer | `POSCashDrawerScreen` | `apps/pos-web/src/screens/POSCashDrawerScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking` | booking | `POSBookingScreen` | `apps/pos-web/src/screens/POSBookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking/walk-in` | walk-in | `POSWalkInScreen` | `apps/pos-web/src/screens/POSWalkInScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking/new` | new | `POSNewBookingScreen` | `apps/pos-web/src/screens/POSNewBookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tech-queue` | tech-queue | `POSTechQueueScreen` | `apps/pos-web/src/screens/POSTechQueueScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tech-appointments` | tech-appointments | `POSTechAppointmentsScreen` | `apps/pos-web/src/screens/POSTechAppointmentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians` | technicians | `POSTechniciansScreen` | `apps/pos-web/src/screens/POSTechniciansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians/schedule` | schedule | `POSLiveTechnicianScheduleScreen` | `apps/pos-web/src/screens/POSLiveTechnicianScheduleScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians/skill-requests` | skill-requests | `POSSkillRequestsScreen` | `apps/pos-web/src/screens/POSSkillRequestsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians/:technicianId` | :technicianId | `POSTechnicianProfileScreen` | `apps/pos-web/src/screens/POSTechnicianProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/services` | services | `POSServicesScreen` | `apps/pos-web/src/screens/POSServicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/overview` | overview | `POSPaymentsOverviewScreen` | `apps/pos-web/src/screens/POSPaymentsOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/command-center` | command-center | `POSAICenterScreen` | `apps/pos-web/src/screens/POSAICenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/copilot` | copilot | `POSReceptionCopilotScreen` | `apps/pos-web/src/screens/POSReceptionCopilotScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/messaging-setup` | messaging-setup | `POSMessagingSetupScreen` | `apps/pos-web/src/screens/POSMessagingSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist` | receptionist | `POSAIReceptionistScreen` | `apps/pos-web/src/screens/POSAIReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/front-desk` | front-desk | `POSAIFrontDeskScreen` | `apps/pos-web/src/screens/POSAIFrontDeskScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/follow-ups` | follow-ups | `POSAIFollowUpsScreen` | `apps/pos-web/src/screens/POSAIFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/business-setup` | business-setup | `POSAIBusinessSetupScreen` | `apps/pos-web/src/screens/POSAIBusinessSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/calendar` | calendar | `POSAICalendarScreen` | `apps/pos-web/src/screens/POSAICalendarScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/calls` | calls | `POSAICallsScreen` | `apps/pos-web/src/screens/POSAICallsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/queue` | queue | `POSAIQueueAssignmentScreen` | `apps/pos-web/src/screens/POSAIQueueAssignmentScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/tenant/ai/receptionist/settings` | settings | `POSAISettingsScreen` | `apps/pos-web/src/screens/POSAISettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/plans` | plans | `POSAIPlansScreen` | `apps/pos-web/src/screens/POSAIPlansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/overview` | overview | `POSManagementScreen` | `apps/pos-web/src/screens/POSManagementScreen.tsx` | `GET /pos/technicians/state`<br>`GET /pos/payroll/state` | `pos.technicians.view` | ✅ PASS |
| `/tenant/devices/overview` | overview | `POSDevicesScreen` | `apps/pos-web/src/screens/POSDevicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/customer-displays` | customer-displays | `POSCustomerDisplaysScreen` | `apps/pos-web/src/screens/POSCustomerDisplaysScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/overview` | overview | `POSAccountScreen` | `apps/pos-web/src/screens/POSAccountScreen.tsx` | `GET /pos/me/profile`<br>`GET /auth/mfa/status` | `self.profile.view` | ✅ PASS |
| `/tenant/account/activity-logs` | activity-logs | `POSActivityLogsScreen` | `apps/pos-web/src/screens/POSActivityLogsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/security` | security | `POSSecurityScreen` | `apps/pos-web/src/screens/POSSecurityScreen.tsx` | `GET /pos/me/profile` | `self.profile.view` | ✅ PASS |
| `/tenant/account/subscription` | subscription | `POSSubscriptionScreen` | `apps/pos-web/src/screens/POSSubscriptionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/users-roles` | users-roles | `Navigate -> /tenant/team/permissions` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/billing` | billing | `Navigate -> /tenant/account/subscription` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/support` | support | `POSHelpCenterScreen` | `apps/pos-web/src/screens/POSHelpCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customers` | customers | `POSCustomersScreen` | `apps/pos-web/src/screens/POSCustomersScreen.tsx` | `GET /pos/customers/state` | `pos.customers.view` | ✅ PASS |
| `/tenant/customers/memberships` | memberships | `POSMembershipsScreen` | `apps/pos-web/src/screens/POSMembershipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/messages` | messages | `POSMessagesScreen` | `apps/pos-web/src/screens/POSMessagesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase` | nail-showcase | `POSNailShowcaseModerationScreen` | `apps/pos-web/src/screens/POSNailShowcaseModerationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/follow-ups` | follow-ups | `POSFollowUpsScreen` | `apps/pos-web/src/screens/POSFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/settings/follow-ups` | follow-ups | `EndOfDayFollowUpSettings` | `apps/pos-web/src/screens/EndOfDayFollowUpSettings.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/reports` | reports | `POSReportsScreen` | `apps/pos-web/src/screens/POSReportsScreen.tsx` | `GET /pos/reports/state` | `pos.reports.view` | ✅ PASS |
| `/settings` | settings | `POSSettingsScreen` | `apps/pos-web/src/screens/POSSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/locations` | locations | `TenantLocationsScreen` | `apps/pos-web/src/screens/TenantLocationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory` | inventory | `TenantInventoryScreen` | `apps/pos-web/src/screens/TenantInventoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/vendors` | vendors | `TenantSuppliersScreen` | `apps/pos-web/src/screens/TenantSuppliersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/api-webhooks` | api-webhooks | `TenantApiWebhooksScreen` | `apps/pos-web/src/screens/TenantApiWebhooksScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/logs` | logs | `TenantLogsScreen` | `apps/pos-web/src/screens/TenantLogsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/campaigns` | campaigns | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/deals` | deals | `POSDealsScreen` | `apps/pos-web/src/screens/POSDealsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/display-ads` | display-ads | `POSDisplayAdsScreen` | `apps/pos-web/src/screens/POSDisplayAdsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/sms` | sms | `POSCommunicationsScreen` | `apps/pos-web/src/screens/POSCommunicationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/payroll` | payroll | `POSPayrollScreen` | `apps/pos-web/src/screens/POSPayrollScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/members` | members | `POSTeamScreen` | `apps/pos-web/src/screens/POSTeamScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/sales` | sales | `POSSalesReportScreen` | `apps/pos-web/src/screens/POSSalesReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/services` | services | `POSServicesReportScreen` | `apps/pos-web/src/screens/POSServicesReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/technicians` | technicians | `POSTechniciansReportScreen` | `apps/pos-web/src/screens/POSTechniciansReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/commission` | commission | `POSCommissionReportScreen` | `apps/pos-web/src/screens/POSCommissionReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/payroll` | payroll | `Navigate -> /tenant/team/payroll` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/commission` | commission | `Navigate -> /tenant/reports/commission` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/tips` | tips | `POSTeamTipsScreen` | `apps/pos-web/src/screens/POSTeamTipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/packages` | packages | `Navigate -> /tenant/customers/memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/payments` | payments | `POSPaymentsReportScreen` | `apps/pos-web/src/screens/POSPaymentsReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/customers` | customers | `POSCustomersReportScreen` | `apps/pos-web/src/screens/POSCustomersReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/appointments` | appointments | `POSAppointmentsReportScreen` | `apps/pos-web/src/screens/POSAppointmentsReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/tax` | tax | `POSTaxReportScreen` | `apps/pos-web/src/screens/POSTaxReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/transactions` | transactions | `POSTransactionsScreen` | `apps/pos-web/src/screens/POSTransactionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/tips` | tips | `POSTipsScreen` | `apps/pos-web/src/screens/POSTipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/settlements` | settlements | `POSSettlementsScreen` | `apps/pos-web/src/screens/POSSettlementsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/profiles` | profiles | `POSTeamProfilesScreen` | `apps/pos-web/src/screens/POSTeamProfilesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/categories` | categories | `POSServiceCategoriesScreen` | `apps/pos-web/src/screens/POSServiceCategoriesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/pricing` | pricing | `POSServicePricingScreen` | `apps/pos-web/src/screens/POSServicePricingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/performance` | performance | `POSTeamPerformanceScreen` | `apps/pos-web/src/screens/POSTeamPerformanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/payment-terminals` | payment-terminals | `POSPaymentTerminalsScreen` | `apps/pos-web/src/screens/POSPaymentTerminalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/gift-cards` | gift-cards | `POSGiftCardsScreen` | `apps/pos-web/src/screens/POSGiftCardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-cards` | gift-cards | `Navigate -> /tenant/customers/gift-cards` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/refunds-voids` | refunds-voids | `POSRefundsVoidsScreen` | `apps/pos-web/src/screens/POSRefundsVoidsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/loyalty` | loyalty | `POSLoyaltyScreen` | `apps/pos-web/src/screens/POSLoyaltyScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing` | marketing | `POSAIMarketingScreen` | `apps/pos-web/src/screens/POSAIMarketingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection` | money-protection | `POSAIMoneyProtectionScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/alerts` | alerts | `POSAIMoneyProtectionAlertsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/investigations` | investigations | `POSAIMoneyProtectionInvestigationsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionInvestigationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/rules` | rules | `POSAIMoneyProtectionRulesScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionRulesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/settings` | settings | `POSAIMoneyProtectionSettingsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription` | voice-transcription | `POSAIVoiceTranscriptionScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/history` | history | `POSAIVoiceTranscriptionHistoryScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/search` | search | `POSAIVoiceTranscriptionSearchScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionSearchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/unresolved` | unresolved | `POSAIVoiceTranscriptionUnresolvedScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionUnresolvedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/settings` | settings | `POSAIVoiceTranscriptionSettingsScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/transcripts/:id` | :id | `POSAIVoiceTranscriptionDetailScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionDetailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/studio` | studio | `POSAIMessageStudioScreen` | `apps/pos-web/src/screens/POSAIMessageStudioScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/audiences` | audiences | `POSAIAudienceBuilderScreen` | `apps/pos-web/src/screens/POSAIAudienceBuilderScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/results` | results | `POSAICampaignResultsScreen` | `apps/pos-web/src/screens/POSAICampaignResultsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/builder` | builder | `POSAICampaignBuilderScreen` | `apps/pos-web/src/screens/POSAICampaignBuilderScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business` | business | `POSAiBusinessScreen` | `apps/pos-web/src/screens/POSAiBusinessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/inventory` | inventory | `POSAiInventoryScreen` | `apps/pos-web/src/screens/POSAiInventoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/analytics` | analytics | `POSAiForecastingScreen` | `apps/pos-web/src/screens/POSAiForecastingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/branches` | branches | `POSAiBranchCompareScreen` | `apps/pos-web/src/screens/POSAiBranchCompareScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/alerts` | alerts | `POSAiAlertsScreen` | `apps/pos-web/src/screens/POSAiAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/reports` | reports | `POSAiReportsScreen` | `apps/pos-web/src/screens/POSAiReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile` | customer-profile | `POSAICustomerProfileOverviewScreen` | `apps/pos-web/src/screens/POSAICustomerProfileOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/duplicates` | duplicates | `POSAICustomerDuplicateReviewScreen` | `apps/pos-web/src/screens/POSAICustomerDuplicateReviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/churn` | churn | `POSAICustomerChurnWatchScreen` | `apps/pos-web/src/screens/POSAICustomerChurnWatchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/rebooking` | rebooking | `POSAICustomerRebookingScreen` | `apps/pos-web/src/screens/POSAICustomerRebookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/recommendations` | recommendations | `POSAICustomerRecommendationsScreen` | `apps/pos-web/src/screens/POSAICustomerRecommendationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/settings` | settings | `POSAICustomerSettingsScreen` | `apps/pos-web/src/screens/POSAICustomerSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/checkout-upsell/settings` | settings | `AICheckoutUpsellSettingsScreen` | `apps/pos-web/src/screens/AICheckoutUpsellSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/platform` | platform | `POSAiGovernanceScreen` | `apps/pos-web/src/screens/POSAiGovernanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/platform/settings` | settings | `POSAiSettingsEditor` | `apps/pos-web/src/screens/POSAiSettingsEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-cards/settings` | settings | `POSGiftCardSettingsScreen` | `apps/pos-web/src/screens/POSGiftCardSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/sell-gift-card` | sell-gift-card | `POSSellGiftCardScreen` | `apps/pos-web/src/screens/POSSellGiftCardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/reload-gift-card` | reload-gift-card | `POSReloadGiftCardScreen` | `apps/pos-web/src/screens/POSReloadGiftCardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-card-stock` | gift-card-stock | `POSGiftCardStockScreen` | `apps/pos-web/src/screens/POSGiftCardStockScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-card-lookup` | gift-card-lookup | `POSGiftCardLookupScreen` | `apps/pos-web/src/screens/POSGiftCardLookupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reputation` | reputation | `POSAIReviewReputationScreen` | `apps/pos-web/src/screens/POSAIReviewReputationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/scheduling-optimizer` | scheduling-optimizer | `POSAISchedulingOptimizerScreen` | `apps/pos-web/src/screens/POSAISchedulingOptimizerScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/approvals` | approvals | `POSApprovalsScreen` | `apps/pos-web/src/screens/approvals/POSApprovalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community` | community | `CommunityFeedScreen` | `apps/pos-web/src/screens/community/CommunityFeedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/posts/:id` | :id | `CommunityPostScreen` | `apps/pos-web/src/screens/community/CommunityPostScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/new` | new | `CommunityAdvisoryEditor` | `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/drafts` | drafts | `CommunityDraftsScreen` | `apps/pos-web/src/screens/community/CommunityDraftsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/drafts/:id` | :id | `CommunityAdvisoryEditor` | `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/approvals` | approvals | `CommunityApprovalsScreen` | `apps/pos-web/src/screens/community/CommunityApprovalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/incidents` | incidents | `CommunityIncidentsScreen` | `apps/pos-web/src/screens/community/CommunityIncidentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/settings` | settings | `CommunitySettingsScreen` | `apps/pos-web/src/screens/community/CommunitySettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/ocr-receipt` | ocr-receipt | `POSAIOcrReceiptScreen` | `apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/phone-verification` | phone-verification | `POSBookingVerificationScreen` | `apps/pos-web/src/screens/POSBookingVerificationScreen.tsx` | `GET /pos/booking/verification-override/pending`<br>`GET /pos/settings/booking-phone-verification/usage?days=30`<br>`POST /pos/booking/verification-override` | `pos.booking.verification_pending` | ✅ PASS |
| `/tenant/customers/phone-management` | phone-management | `PhoneManagementCenter` | `apps/pos-web/src/screens/PhoneManagementCenter.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reputation/settings` | settings | `POSAIReviewReputationSettingsScreen` | `apps/pos-web/src/screens/POSAIReviewReputationSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/timeline` | timeline | `POSAICustomerTimelineScreen` | `apps/pos-web/src/screens/POSAICustomerTimelineScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/search` | search | `POSAICustomerSearchScreen` | `apps/pos-web/src/screens/POSAICustomerSearchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reception-copilot` | reception-copilot | `POSReceptionCopilotScreen` | `apps/pos-web/src/screens/POSReceptionCopilotScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/reception-pos` | reception-pos | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/check-in-kiosk` | check-in-kiosk | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/tablets` | tablets | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/receipt-devices` | receipt-devices | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/assignments` | assignments | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/health` | health | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/usage-limits` | usage-limits | `POSUsageLimitsScreen` | `apps/pos-web/src/screens/POSUsageLimitsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/invoices` | invoices | `POSAccountInvoicesScreen` | `apps/pos-web/src/screens/POSAccountInvoicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/alerts` | alerts | `POSInventoryAlertsScreen` | `apps/pos-web/src/screens/POSInventoryAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/purchase-orders` | purchase-orders | `POSPurchaseOrdersScreen` | `apps/pos-web/src/screens/POSPurchaseOrdersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/products` | products | `POSProductsScreen` | `apps/pos-web/src/screens/POSProductsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/features` | features | `POSFeaturesScreen` | `apps/pos-web/src/screens/POSFeaturesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/setup-health` | setup-health | `POSSetupHealthScreen` | `apps/pos-web/src/screens/POSSetupHealthScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/usage` | usage | `POSAiUsageScreen` | `apps/pos-web/src/screens/POSAiUsageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/notifications` | notifications | `POSNotificationsScreen` | `apps/pos-web/src/screens/POSNotificationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/reminders` | reminders | `POSRemindersScreen` | `apps/pos-web/src/screens/POSRemindersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/templates` | templates | `POSMessageTemplatesScreen` | `apps/pos-web/src/screens/POSMessageTemplatesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/system-status` | system-status | `POSSystemStatusScreen` | `apps/pos-web/src/screens/POSSystemStatusScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/ai-receptionist` | ai-receptionist | `POSAIReceptionistScreen` | `apps/pos-web/src/screens/POSAIReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/win-back` | win-back | `POSRetentionScreen` | `apps/pos-web/src/screens/POSRetentionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/payment-gateway` | payment-gateway | `POSPaymentGatewayScreen` | `apps/pos-web/src/screens/POSPaymentGatewayScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/segments` | segments | `POSSegmentsScreen` | `apps/pos-web/src/screens/POSSegmentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/birthdays` | birthdays | `POSBirthdaysScreen` | `apps/pos-web/src/screens/POSBirthdaysScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/referrals` | referrals | `POSReferralsScreen` | `apps/pos-web/src/screens/POSReferralsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/phone` | phone | `POSPhoneScreen` | `apps/pos-web/src/screens/POSPhoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/phone` | phone | `POSPhoneScreen` | `apps/pos-web/src/screens/POSPhoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/email` | email | `POSEmailScreen` | `apps/pos-web/src/screens/POSEmailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/email` | email | `POSEmailScreen` | `apps/pos-web/src/screens/POSEmailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/social` | social | `POSSocialScreen` | `apps/pos-web/src/screens/POSSocialScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/apps` | apps | `POSIntegrationsScreen` | `apps/pos-web/src/screens/POSIntegrationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/deposit-reconciliation` | deposit-reconciliation | `POSDepositReconScreen` | `apps/pos-web/src/screens/POSDepositReconScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/sms` | sms | `POSMessagingSetupScreen` | `apps/pos-web/src/screens/POSMessagingSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/ai` | ai | `POSAiAnalyticsScreen` | `apps/pos-web/src/screens/POSAiAnalyticsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/booking` | booking | `POSAIBookingScreen` | `apps/pos-web/src/screens/POSAIBookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/scheduling` | scheduling | `Navigate -> /tenant/ai/scheduling-optimizer` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-insights` | customer-insights | `POSAICustomerProfileAssistantScreen` | `apps/pos-web/src/screens/POSAICustomerProfileAssistantScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/checkout-upsell` | checkout-upsell | `POSAICheckoutUpsellAssistantScreen` | `apps/pos-web/src/screens/POSAICheckoutUpsellAssistantScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/fraud-protection` | fraud-protection | `POSAIFraudProtectionAssistantScreen` | `apps/pos-web/src/screens/POSAIFraudProtectionAssistantScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reviews` | reviews | `POSAIReviewAssistantScreen` | `apps/pos-web/src/screens/POSAIReviewAssistantScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receipt-scanner` | receipt-scanner | `POSAIReceiptScannerScreen` | `apps/pos-web/src/screens/POSAIReceiptScannerScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/sms` | sms | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/email` | email | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/coupons` | coupons | `POSCouponsScreen` | `apps/pos-web/src/screens/POSCouponsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/multi-location` | multi-location | `POSMultiLocationScreen` | `apps/pos-web/src/screens/POSMultiLocationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/marketing` | marketing | `POSMarketingReportScreen` | `apps/pos-web/src/screens/POSMarketingReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/inventory` | inventory | `POSInventoryReportScreen` | `apps/pos-web/src/screens/POSInventoryReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/time-clock` | time-clock | `POSTimeClockScreen` | `apps/pos-web/src/screens/POSTimeClockScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/turn-queue` | turn-queue | `POSTurnQueueScreen` | `apps/pos-web/src/screens/POSTurnQueueScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/permissions` | permissions | `POSTeamPermissionsScreen` | `apps/pos-web/src/screens/POSTeamPermissionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/permissions/:userId` | :userId | `POSMemberAccessScreen` | `apps/pos-web/src/screens/access/POSMemberAccessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/security/access` | access | `POSAccessGovernanceScreen` | `apps/pos-web/src/screens/access/POSAccessGovernanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/discounts` | discounts | `POSDiscountsScreen` | `apps/pos-web/src/screens/POSDiscountsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/add-ons` | add-ons | `POSServiceAddOnsScreen` | `apps/pos-web/src/screens/POSServiceAddOnsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/appointment-history` | appointment-history | `POSAppointmentHistoryScreen` | `apps/pos-web/src/screens/POSAppointmentHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/notes` | notes | `POSCustomerNotesScreen` | `apps/pos-web/src/screens/POSCustomerNotesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/profiles` | profiles | `POSCustomerProfileScreen` | `apps/pos-web/src/screens/POSCustomerProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/retention` | retention | `POSRetentionScreen` | `apps/pos-web/src/screens/POSRetentionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/saved-cards` | saved-cards | `POSSavedCardsScreen` | `apps/pos-web/src/screens/POSSavedCardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/terminals` | terminals | `Navigate -> /tenant/devices/payment-terminals` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/expenses` | expenses | `POSExpensesScreen` | `apps/pos-web/src/screens/POSExpensesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/split-payments` | split-payments | `POSSplitPaymentsScreen` | `apps/pos-web/src/screens/POSSplitPaymentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/invoices` | invoices | `POSInvoicesScreen` | `apps/pos-web/src/screens/POSInvoicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing` | marketing | `POSMarketingLandingScreen` | `apps/pos-web/src/screens/POSMarketingLandingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/promotions` | promotions | `POSPromotionsScreen` | `apps/pos-web/src/screens/POSPromotionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/reviews` | reviews | `POSReviewsScreen` | `apps/pos-web/src/screens/POSReviewsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/salon-profile` | salon-profile | `Navigate -> /settings?section=business-branch` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/business-hours` | business-hours | `Navigate -> /settings?section=auto-logout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/auto-logout` | auto-logout | `Navigate -> /settings?section=auto-logout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/booking-rules` | booking-rules | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/no-show-policy` | no-show-policy | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/cancellation-policy` | cancellation-policy | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/checkout-rules` | checkout-rules | `Navigate -> /settings?section=payments-checkout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/tax-tip-rules` | tax-tip-rules | `Navigate -> /settings?section=tax` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/loyalty-rules` | loyalty-rules | `Navigate -> /settings?section=loyalty-memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/membership-rules` | membership-rules | `Navigate -> /settings?section=loyalty-memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/queue-rules` | queue-rules | `Navigate -> /settings?section=queue-workflow` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/*` | * | `Navigate -> /overview` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |

---

## Super Admin (admin-web)

- **Architecture:** React 18 SPA (react-router-dom)
- **Target Role / Plane:** Platform Super Admin
- **Total Managed Routes / Screens:** 157
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Root | `AdminLayout` | `apps/admin-web/src/shell/AdminLayout.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/dashboard` | dashboard | `DashboardScreen` | `apps/admin-web/src/screens/DashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenants` | tenants | `TenantsScreen` | `apps/admin-web/src/screens/TenantsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant-applications` | tenant-applications | `ApplicationsScreen` | `apps/admin-web/src/screens/ApplicationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/alerts` | alerts | `AlertsScreen` | `apps/admin-web/src/screens/AlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/website-leads` | website-leads | `WebsiteLeadsScreen` | `apps/admin-web/src/screens/WebsiteLeadsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/hardware-packages` | hardware-packages | `HardwarePackagesScreen` | `apps/admin-web/src/screens/HardwarePackagesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/hardware-payments` | hardware-payments | `HardwarePaymentsScreen` | `apps/admin-web/src/screens/HardwarePaymentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/hardware-payment-reports` | hardware-payment-reports | `HardwarePaymentReportsScreen` | `apps/admin-web/src/screens/HardwarePaymentReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/payment-gateways` | payment-gateways | `PaymentGatewaysScreen` | `apps/admin-web/src/screens/PaymentGatewaysScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tap-to-pay` | tap-to-pay | `TapToPayAdminScreen` | `apps/admin-web/src/screens/TapToPayAdminScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/check-in-devices` | check-in-devices | `CheckInDevicesScreen` | `apps/admin-web/src/screens/CheckInDevicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/subscriptions` | subscriptions | `BillingScreen` | `apps/admin-web/src/screens/BillingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/billing-cycle` | billing-cycle | `BillingCycleScreen` | `apps/admin-web/src/screens/BillingCycleScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/loyalty-network` | loyalty-network | `LoyaltyNetworkScreen` | `apps/admin-web/src/screens/LoyaltyNetworkScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/billing` | billing | `Navigate -> /subscriptions` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-platform` | ai-platform | `SuperAdminAiPlatformScreen` | `apps/admin-web/src/screens/SuperAdminAiPlatformScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-packages` | ai-packages | `AIPackagesScreen` | `apps/admin-web/src/screens/AIPackagesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-business-adoption` | ai-business-adoption | `SuperAdminAiBusinessScreen` | `apps/admin-web/src/screens/SuperAdminAiBusinessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-plans` | ai-plans | `AIPlansScreen` | `apps/admin-web/src/screens/AIPlansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-subscriptions` | ai-subscriptions | `AiSubscriptionsScreen` | `apps/admin-web/src/screens/AiSubscriptionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/reception-copilot` | reception-copilot | `ReceptionCopilotUsageScreen` | `apps/admin-web/src/screens/ReceptionCopilotUsageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant-messaging` | tenant-messaging | `TenantMessagingSetupScreen` | `apps/admin-web/src/screens/TenantMessagingSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/a2p-registration` | a2p-registration | `TenantA2pScreen` | `apps/admin-web/src/screens/TenantA2pScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/messaging-environment` | messaging-environment | `MessagingReadinessScreen` | `apps/admin-web/src/screens/MessagingReadinessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-booking-analytics` | ai-booking-analytics | `AiBookingAnalyticsScreen` | `apps/admin-web/src/screens/AiBookingAnalyticsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-customer-profile` | ai-customer-profile | `AiCustomerProfileOversightScreen` | `apps/admin-web/src/screens/AiCustomerProfileOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-checkout-upsell` | ai-checkout-upsell | `AiCheckoutUpsellOversightScreen` | `apps/admin-web/src/screens/AiCheckoutUpsellOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/advertising` | advertising | `AdvertisingScreen` | `apps/admin-web/src/screens/advertising/AdvertisingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-review-reputation` | ai-review-reputation | `AiReviewReputationOversightScreen` | `apps/admin-web/src/screens/AiReviewReputationOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-scheduling-optimizer` | ai-scheduling-optimizer | `AiSchedulingOversightScreen` | `apps/admin-web/src/screens/AiSchedulingOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-ocr-receipt` | ai-ocr-receipt | `AiOcrReceiptOversightScreen` | `apps/admin-web/src/screens/AiOcrReceiptOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenants/:tenantId/messaging` | messaging | `TenantMessagingSetupScreen` | `apps/admin-web/src/screens/TenantMessagingSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenants/:tenantId/a2p` | a2p | `TenantA2pScreen` | `apps/admin-web/src/screens/TenantA2pScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/usage-limits` | usage-limits | `UsageLimitsScreen` | `apps/admin-web/src/screens/UsageLimitsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/plans` | plans | `PlansScreen` | `apps/admin-web/src/screens/PlansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/sms-verification-packages` | sms-verification-packages | `SmsVerificationPackagesScreen` | `apps/admin-web/src/screens/SmsVerificationPackagesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/users-roles` | users-roles | `UsersRolesScreen` | `apps/admin-web/src/screens/UsersRolesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/platform-staff` | platform-staff | `PlatformStaffScreen` | `apps/admin-web/src/screens/PlatformStaffScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/approvals` | approvals | `ApprovalsScreen` | `apps/admin-web/src/screens/ApprovalsScreen.tsx` | `GET /super-admin/approvals`<br>`GET /super-admin/approvals/policies`<br>`POST /super-admin/approvals` | `super_admin.tenants.view` | ✅ PASS |
| `/feature-registry` | feature-registry | `FeatureRegistryScreen` | `apps/admin-web/src/screens/FeatureRegistryScreen.tsx` | `GET /super-admin/features`<br>`GET /super-admin/features/rollouts`<br>`PUT /super-admin/features` | `super_admin.plans.view` | ✅ PASS |
| `/owner-salons` | owner-salons | `SuperAdminOwnersScreen` | `apps/admin-web/src/screens/SuperAdminOwnersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/support-access` | support-access | `SupportAccessScreen` | `apps/admin-web/src/screens/SupportAccessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/platform-reports` | platform-reports | `PlatformReportsScreen` | `apps/admin-web/src/screens/PlatformReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/compensation-oversight` | compensation-oversight | `SuperAdminCompensationScreen` | `apps/admin-web/src/screens/SuperAdminCompensationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase` | nail-showcase | `SuperAdminNailShowcaseModerationScreen` | `apps/admin-web/src/screens/SuperAdminNailShowcaseModerationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tech-profiles` | tech-profiles | `SuperAdminTechProfileModerationScreen` | `apps/admin-web/src/screens/SuperAdminTechProfileModerationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community-moderation` | community-moderation | `CommunityModerationScreen` | `apps/admin-web/src/screens/CommunityModerationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/system-health` | system-health | `SystemHealthScreen` | `apps/admin-web/src/screens/SystemHealthScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/system-operations` | system-operations | `SystemOperationsScreen` | `apps/admin-web/src/screens/SystemOperationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/jobs` | jobs | `JobsDeadLettersScreen` | `apps/admin-web/src/screens/JobsDeadLettersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/database` | database | `DatabaseScreen` | `apps/admin-web/src/screens/DatabaseScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/backups` | backups | `BackupCenterScreen` | `apps/admin-web/src/screens/backup/BackupCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/mobile-versions` | mobile-versions | `MobileVersionsScreen` | `apps/admin-web/src/screens/MobileVersionsScreen.tsx` | `GET /super-admin/mobile-versions`<br>`PUT /super-admin/mobile-versions` | `super_admin.mobile_versions.view` | ✅ PASS |
| `/request-search` | request-search | `RequestSearchScreen` | `apps/admin-web/src/screens/RequestSearchScreen.tsx` | `GET /super-admin/observability/requests`<br>`GET /super-admin/observability/traces`<br>`GET /super-admin/observability/correlations` | `super_admin.telemetry.view` | ✅ PASS |
| `/oncall` | oncall | `OnCallScreen` | `apps/admin-web/src/screens/OnCallScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ops-dashboards` | ops-dashboards | `OpsDashboardsScreen` | `apps/admin-web/src/screens/OpsDashboardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/branch-health` | branch-health | `BranchHealthScreen` | `apps/admin-web/src/screens/BranchHealthScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/audit-logs` | audit-logs | `AuditLogsOverviewScreen` | `apps/admin-web/src/screens/AuditLogsOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/audit-logs/browse` | browse | `AuditLogsScreen` | `apps/admin-web/src/screens/AuditLogsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant-activity` | tenant-activity | `TenantActivityScreen` | `apps/admin-web/src/screens/TenantActivityScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/report-builder` | report-builder | `ReportBuilderScreen` | `apps/admin-web/src/screens/ReportBuilderScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/scheduled-reports` | scheduled-reports | `ScheduledReportsScreen` | `apps/admin-web/src/screens/ScheduledReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/revenue-residuals` | revenue-residuals | `RevenueResidualsScreen` | `apps/admin-web/src/screens/RevenueResidualsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/search` | search | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/booking-source` | booking-source | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/failures` | failures | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/duplicates` | duplicates | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/overlapping` | overlapping | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/rescheduled` | rescheduled | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/change-history` | change-history | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/missing-info` | missing-info | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight/sync-failures` | sync-failures | `AppointmentOversightSubScreen` | `apps/admin-web/src/screens/AppointmentOversightSubScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/settlements-deposits` | settlements-deposits | `SettlementsScreen` | `apps/admin-web/src/screens/SettlementsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding` | onboarding | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/business-info` | business-info | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/identity` | identity | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/legal` | legal | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/merchant` | merchant | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/bank` | bank | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/hardware` | hardware | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/data-import` | data-import | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/training` | training | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/final-review` | final-review | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/activations` | activations | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/onboarding/approvals` | approvals | `OnboardingScreen` | `apps/admin-web/src/screens/OnboardingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue-management` | queue-management | `QueueManagementScreen` | `apps/admin-web/src/screens/QueueManagementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue-management/timelines` | timelines | `QueueManagementScreen` | `apps/admin-web/src/screens/QueueManagementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue-management/stuck` | stuck | `QueueManagementScreen` | `apps/admin-web/src/screens/QueueManagementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue-management/sync` | sync | `QueueManagementScreen` | `apps/admin-web/src/screens/QueueManagementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue-management/wait-times` | wait-times | `QueueManagementScreen` | `apps/admin-web/src/screens/QueueManagementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-queue-assignment` | ai-queue-assignment | `AiQueueAssignmentOversightScreen` | `apps/admin-web/src/screens/AiQueueAssignmentOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/settings` | settings | `GeneralSettingsScreen` | `apps/admin-web/src/screens/GeneralSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/account` | account | `SettingsScreen` | `apps/admin-web/src/screens/SettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/project-status` | project-status | `ProjectStatusScreen` | `apps/admin-web/src/screens/ProjectStatusScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/live-operations` | live-operations | `LiveOperationsScreen` | `apps/admin-web/src/screens/LiveOperationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/platform-dashboard` | platform-dashboard | `PlatformDashboardScreen` | `apps/admin-web/src/screens/PlatformDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/analytics` | analytics | `AnalyticsScreen` | `apps/admin-web/src/screens/AnalyticsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/branches` | branches | `BranchesScreen` | `apps/admin-web/src/screens/BranchesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/services` | services | `ServicesScreen` | `apps/admin-web/src/screens/ServicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/product-catalog` | product-catalog | `ProductCatalogScreen` | `apps/admin-web/src/screens/ProductCatalogScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/service-templates` | service-templates | `ServiceTemplatesScreen` | `apps/admin-web/src/screens/ServiceTemplatesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/products` | products | `Navigate -> /product-catalog` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointment-oversight` | appointment-oversight | `AppointmentOversightScreen` | `apps/admin-web/src/screens/AppointmentOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ticket-oversight` | ticket-oversight | `TicketOversightScreen` | `apps/admin-web/src/screens/TicketOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/membership-programs` | membership-programs | `MembershipProgramsScreen` | `apps/admin-web/src/screens/MembershipProgramsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/memberships` | memberships | `Navigate -> /membership-programs` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointments` | appointments | `Navigate -> /appointment-oversight` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight` | customer-data-oversight | `CustomerDataOversightScreen` | `apps/admin-web/src/screens/CustomerDataOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-phone-oversight` | customer-phone-oversight | `CustomerPhoneOversightScreen` | `apps/admin-web/src/screens/CustomerPhoneOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-verification-oversight` | booking-verification-oversight | `BookingVerificationOversightScreen` | `apps/admin-web/src/screens/BookingVerificationOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/deals-oversight` | deals-oversight | `DealsOversightScreen` | `apps/admin-web/src/screens/DealsOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/import-history` | import-history | `ImportHistoryScreen` | `apps/admin-web/src/screens/ImportHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/legal-hold` | legal-hold | `LegalHoldScreen` | `apps/admin-web/src/screens/LegalHoldScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/deletion-requests` | deletion-requests | `DeletionRequestsScreen` | `apps/admin-web/src/screens/DeletionRequestsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/duplicate-detection` | duplicate-detection | `DuplicateDetectionScreen` | `apps/admin-web/src/screens/DuplicateDetectionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/merge-history` | merge-history | `MergeHistoryScreen` | `apps/admin-web/src/screens/MergeHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/audit-history` | audit-history | `AuditHistoryScreen` | `apps/admin-web/src/screens/AuditHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/consent-status` | consent-status | `SuperAdminPlaceholder` | `apps/admin-web/src/screens/SuperAdminPlaceholder.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/privacy-requests` | privacy-requests | `PrivacyRequestsScreen` | `apps/admin-web/src/screens/PrivacyRequestsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/data-exports` | data-exports | `DataExportsScreen` | `apps/admin-web/src/screens/DataExportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customer-data-oversight/:view` | :view | `CustomerDataOversightScreen` | `apps/admin-web/src/screens/CustomerDataOversightScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-usage-configuration` | ai-usage-configuration | `AiUsageConfigScreen` | `apps/admin-web/src/screens/AiUsageConfigScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/system-status` | system-status | `SystemStatusScreen` | `apps/admin-web/src/screens/SystemStatusScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/merchant-accounts` | merchant-accounts | `MerchantAccountsScreen` | `apps/admin-web/src/screens/MerchantAccountsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/failed-events` | failed-events | `FailedEventsScreen` | `apps/admin-web/src/screens/FailedEventsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/device-status` | device-status | `DeviceStatusScreen` | `apps/admin-web/src/screens/DeviceStatusScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/ai-handoffs` | ai-handoffs | `AiHandoffsScreen` | `apps/admin-web/src/screens/AiHandoffsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/booking-sources` | booking-sources | `BookingSourcesScreen` | `apps/admin-web/src/screens/BookingSourcesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/check-in-performance` | check-in-performance | `CheckinPerformanceScreen` | `apps/admin-web/src/screens/CheckinPerformanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin/wait-time-analysis` | wait-time-analysis | `WaitTimeAnalysisScreen` | `apps/admin-web/src/screens/WaitTimeAnalysisScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customers` | customers | `Navigate -> /customer-data-oversight` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/staff` | staff | `StaffOverviewScreen` | `apps/admin-web/src/screens/StaffOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/staff/technicians` | technicians | `GlobalTechniciansScreen` | `apps/admin-web/src/screens/GlobalTechniciansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking-checkin` | booking-checkin | `BookingCheckinScreen` | `apps/admin-web/src/screens/BookingCheckinScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/payments-transactions` | payments-transactions | `PaymentsScreen` | `apps/admin-web/src/screens/PaymentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/chargebacks-disputes` | chargebacks-disputes | `ChargebacksDisputesScreen` | `apps/admin-web/src/screens/ChargebacksDisputesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/marketing-campaigns` | marketing-campaigns | `SuperAdminCampaignsScreen` | `apps/admin-web/src/screens/SuperAdminCampaignsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/promotions-offers` | promotions-offers | `PromotionsScreen` | `apps/admin-web/src/screens/PromotionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/loyalty-programs` | loyalty-programs | `LoyaltyProgramsScreen` | `apps/admin-web/src/screens/LoyaltyProgramsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/gift-card-programs` | gift-card-programs | `GiftCardProgramsScreen` | `apps/admin-web/src/screens/GiftCardProgramsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/gift-card-settlement` | gift-card-settlement | `GiftCardSettlementScreen` | `apps/admin-web/src/screens/GiftCardSettlementScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/communications` | communications | `CommunicationsOverviewScreen` | `apps/admin-web/src/screens/CommunicationsOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/communications/inbox` | inbox | `CommunicationsScreen` | `apps/admin-web/src/screens/CommunicationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/communications/platform-announcements` | platform-announcements | `PlatformAnnouncementsScreen` | `apps/admin-web/src/screens/PlatformAnnouncementsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-insights` | ai-insights | `AiInsightsScreen` | `apps/admin-web/src/screens/AiInsightsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-receptionist` | ai-receptionist | `AiReceptionistScreen` | `apps/admin-web/src/screens/AiReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-reports` | ai-reports | `AiReportsScreen` | `apps/admin-web/src/screens/AiReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/ai-forecasting` | ai-forecasting | `AiForecastingScreen` | `apps/admin-web/src/screens/AiForecastingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/smart-reminders` | smart-reminders | `SmartRemindersOverviewScreen` | `apps/admin-web/src/screens/SmartRemindersOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/smart-reminders/performance` | performance | `SmartRemindersScreen` | `apps/admin-web/src/screens/SmartRemindersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/automation-rules` | automation-rules | `AutomationRulesScreen` | `apps/admin-web/src/screens/AutomationRulesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/integrations` | integrations | `IntegrationsScreen` | `apps/admin-web/src/screens/IntegrationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/devices-management` | devices-management | `DevicesScreen` | `apps/admin-web/src/screens/DevicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/security-compliance` | security-compliance | `SecurityScreen` | `apps/admin-web/src/screens/SecurityScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/help-center` | help-center | `HelpCenterScreen` | `apps/admin-web/src/screens/HelpCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/*` | * | `Navigate` | `apps/admin-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |

---

## Owner Portal (owner-web)

- **Architecture:** React 18 SPA (Tab Navigation)
- **Target Role / Plane:** Salon Owner / Multi-Unit Operator
- **Total Managed Routes / Screens:** 35
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `tab:pushed:bookings` | Pushed:bookings | `BookingOverviewScreen` | `apps/owner-web/src/screens/BookingOverviewScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:techDetail` | Pushed:techDetail | `TechnicianDetailScreen` | `apps/owner-web/src/screens/TechnicianDetailScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:alerts` | Pushed:alerts | `AlertsScreen` | `apps/owner-web/src/screens/AlertsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:settings` | Pushed:settings | `OwnerSettingScreen` | `apps/owner-web/src/screens/OwnerSettingScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:notifications` | Pushed:notifications | `OwnerNotificationScreen` | `apps/owner-web/src/screens/OwnerNotificationScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:audit` | Pushed:audit | `AuditScreen` | `apps/owner-web/src/screens/AuditScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:expenses` | Pushed:expenses | `ExpensesScreen` | `apps/owner-web/src/screens/ExpensesScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:hardwarePayment` | Pushed:hardwarePayment | `HardwarePaymentScreen` | `apps/owner-web/src/screens/HardwarePaymentScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:paymentDevices` | Pushed:paymentDevices | `PaymentDevicesScreen` | `apps/owner-web/src/screens/PaymentDevicesScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:cashHandoff` | Pushed:cashHandoff | `OwnerCashHandoffScreen` | `apps/owner-web/src/screens/OwnerCashHandoffScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:cashDrawer` | Pushed:cashDrawer | `OwnerCashDrawerScreen` | `apps/owner-web/src/screens/OwnerCashDrawerScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:cashSummary` | Pushed:cashSummary | `OwnerCashSummaryScreen` | `apps/owner-web/src/screens/OwnerCashSummaryScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:privacy` | Pushed:privacy | `OwnerPrivacyScreen` | `apps/owner-web/src/screens/OwnerPrivacyScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:terms` | Pushed:terms | `OwnerTermsScreen` | `apps/owner-web/src/screens/OwnerTermsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:deleteAccount` | Pushed:deleteAccount | `OwnerDeleteAccountScreen` | `apps/owner-web/src/screens/OwnerDeleteAccountScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:aiPackages` | Pushed:aiPackages | `AiPackagesScreen` | `apps/owner-web/src/screens/AiPackagesScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:tickets` | Pushed:tickets | `OwnerTicketOversightScreen` | `apps/owner-web/src/screens/OwnerTicketOversightScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:profile` | Pushed:profile | `OwnerProfileScreen` | `apps/owner-web/src/screens/OwnerProfileScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:payroll` | Pushed:payroll | `CommissionPayrollScreen` | `apps/owner-web/src/screens/CommissionPayrollScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:customers` | Pushed:customers | `CustomersLoyaltyScreen` | `apps/owner-web/src/screens/CustomersLoyaltyScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:rewards` | Pushed:rewards | `OwnerRewardsScreen` | `apps/owner-web/src/screens/OwnerRewardsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:giftCards` | Pushed:giftCards | `GiftCardReportScreen` | `apps/owner-web/src/screens/GiftCardReportScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:inventory` | Pushed:inventory | `InventoryProductsScreen` | `apps/owner-web/src/screens/InventoryProductsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:marketing` | Pushed:marketing | `MarketingGrowthScreen` | `apps/owner-web/src/screens/MarketingGrowthScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:payments` | Pushed:payments | `PaymentsMoneyScreen` | `apps/owner-web/src/screens/PaymentsMoneyScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:aiCenter` | Pushed:aiCenter | `AiCenterScreen` | `apps/owner-web/src/screens/AiCenterScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:memberships` | Pushed:memberships | `OwnerMembershipsScreen` | `apps/owner-web/src/screens/OwnerMembershipsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:communitySettings` | Pushed:communitySettings | `OwnerCommunitySettingsScreen` | `apps/owner-web/src/screens/OwnerCommunitySettingsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:home` | Tab:home | `OwnerHomeScreen` | `apps/owner-web/src/screens/OwnerHomeScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:live` | Tab:live | `LiveOperationsScreen` | `apps/owner-web/src/screens/LiveOperationsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:approvals` | Tab:approvals | `ApprovalCenterScreen` | `apps/owner-web/src/screens/ApprovalCenterScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:branches` | Tab:branches | `BranchPerformanceScreen` | `apps/owner-web/src/screens/BranchPerformanceScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:reports` | Tab:reports | `FinanceReportsScreen` | `apps/owner-web/src/screens/FinanceReportsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:staff` | Tab:staff | `StaffPerformanceScreen` | `apps/owner-web/src/screens/StaffPerformanceScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:more (default)` | Tab:more (default) | `MoreScreen` | `apps/owner-web/src/screens/MoreScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |

---

## Technician App (tech-web)

- **Architecture:** React 18 SPA (Tab Navigation)
- **Target Role / Plane:** Salon Technician / Stylist
- **Total Managed Routes / Screens:** 29
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `tab:pushed:ticket` | Pushed:ticket | `TicketDetailScreen` | `apps/tech-web/src/screens/TicketDetailScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:queue` | Pushed:queue | `QueueScreen` | `apps/tech-web/src/screens/QueueScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:notifications` | Pushed:notifications | `NotificationsScreen` | `apps/tech-web/src/screens/NotificationsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:settings` | Pushed:settings | `SettingsScreen` | `apps/tech-web/src/screens/SettingsScreen.tsx` | `POST /auth/change-password` | `Session Authenticated` | ✅ PASS |
| `tab:pushed:profile` | Pushed:profile | `TechProfileScreen` | `apps/tech-web/src/screens/TechProfileScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:followups` | Pushed:followups | `TechFollowUpsScreen` | `apps/tech-web/src/screens/TechFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:cashPending` | Pushed:cashPending | `CashPendingScreen` | `apps/tech-web/src/screens/CashPendingScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:serviceHistory` | Pushed:serviceHistory | `TechServiceHistoryScreen` | `apps/tech-web/src/screens/TechServiceHistoryScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:cashHandoff` | Pushed:cashHandoff | `TechCashHandoffScreen` | `apps/tech-web/src/screens/TechCashHandoffScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:privacy` | Pushed:privacy | `TechPrivacyScreen` | `apps/tech-web/src/screens/TechPrivacyScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:terms` | Pushed:terms | `TechTermsScreen` | `apps/tech-web/src/screens/TechTermsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:deleteAccount` | Pushed:deleteAccount | `TechDeleteAccountScreen` | `apps/tech-web/src/screens/TechDeleteAccountScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:reportProduct` | Pushed:reportProduct | `TechReportProductScreen` | `apps/tech-web/src/screens/TechReportProductScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:workplaces` | Pushed:workplaces | `TechWorkplacesScreen` | `apps/tech-web/src/screens/TechWorkplacesScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:payroll` | Pushed:payroll | `TechPayrollScreen` | `apps/tech-web/src/screens/TechPayrollScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:myDeals` | Pushed:myDeals | `MyDealsScreen` | `apps/tech-web/src/screens/MyDealsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:messages` | Pushed:messages | `TechMessagesScreen` | `apps/tech-web/src/screens/TechMessagesScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:help` | Pushed:help | `TechHelpScreen` | `apps/tech-web/src/screens/TechHelpScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:timeOff` | Pushed:timeOff | `TechTimeOffScreen` | `apps/tech-web/src/screens/TechTimeOffScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:certifications` | Pushed:certifications | `TechCertificationsScreen` | `apps/tech-web/src/screens/TechCertificationsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:timeClock` | Pushed:timeClock | `TechTimeClockScreen` | `apps/tech-web/src/screens/TechMyWorkScreens.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:performance` | Pushed:performance | `TechPerformanceScreen` | `apps/tech-web/src/screens/TechMyWorkScreens.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:tips` | Pushed:tips | `TechTipsScreen` | `apps/tech-web/src/screens/TechMyWorkScreens.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:myClients` | Pushed:myClients | `TechCustomersScreen` | `apps/tech-web/src/screens/TechMyWorkScreens.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:home` | Tab:home | `TechDashboardScreen` | `apps/tech-web/src/screens/TechDashboardScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:schedule` | Tab:schedule | `TechScheduleScreen` | `apps/tech-web/src/screens/TechScheduleScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:tickets` | Tab:tickets | `TicketsListScreen` | `apps/tech-web/src/screens/TicketsListScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:earnings` | Tab:earnings | `TechEarningsScreen` | `apps/tech-web/src/screens/TechEarningsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:more (default)` | Tab:more (default) | `MoreScreen` | `apps/tech-web/src/screens/MoreScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |

---

## Customer Web (customer-web)

- **Architecture:** React 18 SPA (react-router-dom)
- **Target Role / Plane:** Salon Customer
- **Total Managed Routes / Screens:** 54
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Root | `HomeScreen` | `apps/customer-web/src/screens/HomeScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/visit` | visit | `VisitScreen` | `apps/customer-web/src/screens/VisitScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointments` | Appointments | `AppointmentsScreen` | `apps/customer-web/src/screens/AppointmentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointments/proposals` | proposals | `ScheduleProposalsScreen` | `apps/customer-web/src/screens/ScheduleProposalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/find-salons` | find-salons | `FindSalonsScreen` | `apps/customer-web/src/screens/FindSalonsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/find-techs` | find-techs | `FindTechsScreen` | `apps/customer-web/src/screens/FindTechsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/salons/:salonId/techs` | techs | `SalonTechsScreen` | `apps/customer-web/src/screens/SalonTechsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/techs/:slug` | :slug | `CustomerTechProfileScreen` | `apps/customer-web/src/screens/CustomerTechProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/rate-tech/:ticketId/:technicianId` | :technicianId | `RateTechScreen` | `apps/customer-web/src/screens/RateTechScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointments/:appointmentId` | :appointmentId | `AppointmentDetailsScreen` | `apps/customer-web/src/screens/AppointmentDetailsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue` | queue | `LiveQueueScreen` | `apps/customer-web/src/screens/LiveQueueScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/notifications` | notifications | `NotificationsScreen` | `apps/customer-web/src/screens/NotificationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/deals` | Deals | `DealsScreen` | `apps/customer-web/src/screens/DealsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/deals/:id` | :id | `DealDetailScreen` | `apps/customer-web/src/screens/DealDetailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/membership` | membership | `MembershipScreen` | `apps/customer-web/src/screens/MembershipScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/rewards` | rewards | `MyRewardsScreen` | `apps/customer-web/src/screens/MyRewardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/addresses` | addresses | `AddressesScreen` | `apps/customer-web/src/screens/AddressesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/settings` | settings | `SettingsScreen` | `apps/customer-web/src/screens/SettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/security` | security | `ProfileSecurityScreen` | `apps/customer-web/src/screens/ProfileSecurityScreen.tsx` | `GET /customer/me/security/status`<br>`GET /customer/me/security/sessions`<br>`POST /customer/me/security/password/change` | `Session Authenticated` | ✅ PASS |
| `/profile/help` | help | `HelpScreen` | `apps/customer-web/src/screens/HelpScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/legal/privacy` | privacy | `PrivacyPolicyScreen` | `apps/customer-web/src/screens/PrivacyPolicyScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/legal/terms` | terms | `TermsScreen` | `apps/customer-web/src/screens/TermsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/delete-account` | delete-account | `DeleteAccountScreen` | `apps/customer-web/src/screens/DeleteAccountScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/payment-methods` | payment-methods | `PaymentMethodsScreen` | `apps/customer-web/src/screens/PaymentMethodsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/check-in` | check-in | `CheckInScreen` | `apps/customer-web/src/screens/CheckInScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/appointments/:id/reschedule` | reschedule | `RescheduleScreen` | `apps/customer-web/src/screens/RescheduleScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/transactions` | transactions | `TransactionHistoryScreen` | `apps/customer-web/src/screens/TransactionHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/book` | book | `BookScreen` | `apps/customer-web/src/screens/BookScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/assistant` | assistant | `AIReceptionistScreen` | `apps/customer-web/src/screens/AIReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase` | nail-showcase | `NailShowcaseFeedScreen` | `apps/customer-web/src/screens/NailShowcaseFeedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase/create` | create | `NailShowcaseCreatePostScreen` | `apps/customer-web/src/screens/NailShowcaseCreatePostScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase/share/:ticketId` | :ticketId | `NailShowcaseShareFromTicketScreen` | `apps/customer-web/src/screens/NailShowcaseShareFromTicketScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase/leaderboard` | leaderboard | `NailShowcaseLeaderboardScreen` | `apps/customer-web/src/screens/NailShowcaseLeaderboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase/:postId` | :postId | `NailShowcasePostDetailScreen` | `apps/customer-web/src/screens/NailShowcasePostDetailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/me` | me | `CustomerSocialProfileScreen` | `apps/customer-web/src/screens/CustomerSocialProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/edit` | edit | `CustomerEditSocialProfileScreen` | `apps/customer-web/src/screens/CustomerEditSocialProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/following-feed` | following-feed | `NailShowcaseFollowingFeedScreen` | `apps/customer-web/src/screens/NailShowcaseFollowingFeedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/profile/:customerId` | :customerId | `CustomerSocialProfileScreen` | `apps/customer-web/src/screens/CustomerSocialProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/profile/:customerId/followers` | followers | `CustomerFollowersScreen` | `apps/customer-web/src/screens/CustomerFollowersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/social/profile/:customerId/following` | following | `CustomerFollowingScreen` | `apps/customer-web/src/screens/CustomerFollowingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/receipts` | receipts | `ReceiptsScreen` | `apps/customer-web/src/screens/ReceiptsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/invoices` | invoices | `CustomerInvoicesScreen` | `apps/customer-web/src/screens/CustomerInvoicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/follow-ups` | follow-ups | `CustomerFollowUpsScreen` | `apps/customer-web/src/screens/CustomerFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/follow-ups/:id` | :id | `CustomerFollowUpDetailScreen` | `apps/customer-web/src/screens/CustomerFollowUpDetailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/rewards` | rewards | `RewardsScreen` | `apps/customer-web/src/screens/RewardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/wallet` | Wallet | `WalletScreen` | `apps/customer-web/src/screens/WalletScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/gift-cards` | gift-cards | `GiftCardsScreen` | `apps/customer-web/src/screens/GiftCardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/gift-cards/claim` | claim | `ClaimGiftCardScreen` | `apps/customer-web/src/screens/ClaimGiftCardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/pay` | pay | `PayScreen` | `apps/customer-web/src/screens/PayScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile` | Profile | `ProfileScreen` | `apps/customer-web/src/screens/ProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/my-photos` | my-photos | `MyPhotoConsentScreen` | `apps/customer-web/src/screens/MyPhotoConsentScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/profile/edit` | edit | `EditProfileScreen` | `apps/customer-web/src/screens/EditProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/messages/:threadId` | :threadId | `CustomerTechChatScreen` | `apps/customer-web/src/screens/CustomerTechChatScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/*` | * | `Navigate -> /` | `apps/customer-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |

---

## Manager Pay App (manager-pay-web)

- **Architecture:** React 18 SPA (Mobile Tab + Flow Stack)
- **Target Role / Plane:** Manager / Terminal Operator
- **Total Managed Routes / Screens:** 9
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `tab:tab:checkout` | Tab:checkout | `CheckoutQueueScreen` | `apps/manager-pay-web/src/screens/CheckoutQueueScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:history` | Tab:history | `HistoryScreen` | `apps/manager-pay-web/src/screens/HistoryScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:reports` | Tab:reports | `ReportsScreen` | `apps/manager-pay-web/src/screens/ReportsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:tab:account` | Tab:account | `AccountScreen` | `apps/manager-pay-web/src/screens/AccountScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:flow:ticket` | Flow:ticket | `TicketScreen` | `apps/manager-pay-web/src/screens/TicketScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:flow:handoff` | Flow:handoff | `HandoffScreen` | `apps/manager-pay-web/src/screens/HandoffScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:flow:tapToPay` | Flow:tapToPay | `TapToPayScreen` | `apps/manager-pay-web/src/screens/TapToPayScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:flow:verifying` | Flow:verifying | `TapToPayScreen` | `apps/manager-pay-web/src/screens/TapToPayScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:flow:success` | Flow:success | `SuccessScreen` | `apps/manager-pay-web/src/screens/SuccessScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |

---

## Customer Facing Display (customer-display)

- **Architecture:** React 18 SPA (SSE State Machine)
- **Target Role / Plane:** Countertop Secondary Display
- **Total Managed Routes / Screens:** 1
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Live Cart / Terminal Handoff Display | `DisplayView (App.tsx)` | `apps/customer-display/src/App.tsx` | `/pos/customer-displays/session`<br>`/realtime/customer-display` | `Public / Station Linked` | ✅ PASS |

---

## Self-Service Check-In Kiosk (go-check-in-kiosk)

- **Architecture:** Single-File HTML5 / Capacitor App
- **Target Role / Plane:** Walk-In Customer
- **Total Managed Routes / Screens:** 1
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Self Check-In Main | `KioskScreen (index.html)` | `apps/go-check-in-kiosk/index.html` | *(Inherited / Local State)* | `Public` | ✅ PASS |

---

## Public Booking Widget (booking-public)

- **Architecture:** Single-File HTML5 Standalone Widget
- **Target Role / Plane:** Public Booking Client
- **Total Managed Routes / Screens:** 1
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | Public Online Booking Flow | `BookingWidget (index.html)` | `apps/booking-public/index.html` | *(Inherited / Local State)* | `Public` | ✅ PASS |

---


---

## Earlier hand-written status (Oct 20 / Oct 22 2026, kept for history — the generated part above is current, Nov 6 2026)


## Oct 22 2026 update (measured on this tree with the same extractors)

| Measure | Value | Command |
|---|---|---|
| Frontend API call sites | **2,637**, all **2,637 wired** to a real backend route, **0 orphaned** | `node apps/api/scripts/audit-crosswire.js` |
| Backend routes | **3,085** | `node apps/api/scripts/audit-routes.js` |
| Unreached routes | **0 new**; 157 on the reviewed ledger; 339 super-admin / customer / native-only (listed with `--verbose`) | `node apps/api/scripts/audit-unreached-routes.js` |
| App typecheck | all 7 SPAs type-check | `node tooling/ci/check-app-types.mjs` |

Screens changed Oct 22 (each with tests; wiring proved live by the pilot day, phase 10):

| App · screen | Before | Now |
|---|---|---|
| POS · New Booking → Available Start Times | a fixed list 9:00 AM – 4:00 PM, whatever the services / technician / day | `GET /pos/booking/availability` for the selected services **and add-ons**, technician and day; nothing open → says so; the call failing → the standard list, labelled "not checked"; accepts `?time=HH:MM` (Best Matches) and `?serviceId=` hand-offs |
| POS · Booking board → Find an Opening / Best Matches | a fixed "Gel Manicure · 45 min" label; Best Matches = the first free 45-minute gap of any technician | a real service picker; Best Matches = the earliest open start from the availability API (only technicians who may do the service; never a time already past); Find an Opening opens New Booking with the service selected |
| POS · Booking board (day) | drew only the first 50 appointments | `loadAllBookings` follows the pages (100 each) to the end of the day |
| POS · Save Draft (B-22, earlier Oct 22) | booked a real appointment | a real draft (resume / discard strip) |
| Owner App · Finance (dashboard, report, list, export, vendor spend) | "All branches" sent no branch → the API used the branch picked at sign-in | sends `branchId=all`; salon-wide expenses included |
| POS / Owner App · Receipt upload | every upload answered 500 | accepted; quarantined honestly until object storage + scanner + Textract exist |

Open (frontend) — B-22 is closed; B-24 (i18n beyond POS / display / manager-pay / customer) and B-25 (a11y pass) remain; see `NEXT_STEPS.md`.


Measured from the tree at the final-run commit with the same extractors CI runs (`apps/api/scripts/audit-crosswire.js`, `audit-unreached-routes.js`, `frontend-calls.js`) plus a parse of each app's router / navigation shell. Browser proofs: lane `live-pilot-day` (screenshots in `final-run/pilot-shots/`) and lane `e2e-html` (TEST_REPORT.md).

## 1. Headline (this tree)

| Measure | Value |
|---|---|
| Frontend API call sites | **2,527** — **2,527 wired** to a real backend route, **0 orphaned** (`audit-crosswire`) |
| Backend routes | **2,991** (`audit-routes`): `/pos` 998 · `/super-admin` 1,126 · `/tenant` 183 · `/customer` 157 · `/tech` 136 · `/owner` 122 · `/mobile-checkout` 45 · `/auth` 42 · `/community` 42 · machine/public/webhook/health the rest |
| Routes with no frontend caller | 518: 24 machine surfaces (webhooks / jobs / public — expected), 337 super-admin / customer / native-only, **157 on the reviewed debt ledger — 0 newly dead** (`unreached-routes.baseline.json`, `check:unreached` gate) |
| Placeholder screens | **0** — `featureRoutes()` (POS nav items without a dedicated screen → gated `FeaturePage`) resolves to an empty list: all 196 tenant-nav items have a screen |
| Builds | all web apps build in lane `build-frontends` (rc in TEST_REPORT.md); typecheck lane `typecheck-api` covers apps |

## 2. Per app

| App (`apps/`) | Shell / navigation | Routes or screens | Wired | Static by design | Status |
|---|---|---|---|---|---|
| `pos-web` (POS, Owner desktop, Manager) | React Router, `App.tsx` + data-driven `shell/tenant-nav.tsx` (196 nav items, `EXISTING_ROUTES` = 199) | **219** distinct route paths (57 `/ai/*`, 16 `/payments/*`, 14 `/marketing/*`, 14 `/management/*`, 13 `/reports/*`, 10 `/team/*`, 10 `/devices/*`, 9 `/customers/*`, 9 `/communications/*`, 9 `/account/*`, 6 `/integrations/*`, 25 top-level) + 21 `<Navigate>` redirects for old settings URLs | all screens call `src/api/*` clients (47 modules) | Help Center, legal pages | PASS — pilot day drives check-in → queue → serving → checkout → refund (incl. the new "being verified" section) → reports |
| `admin-web` (Super Admin) | React Router, `App.tsx` | **153** route paths (107 top-level sections; tenant detail `/:tenantId/*`) | 18 API-client modules, 100 % resolve | — | PASS |
| `customer-web` (Customer app, Capacitor) | React Router, `App.tsx` | **53** route paths (`/profile` 9, `/social` 6, `/nail-showcase` 5, `/appointments` 4, `/gift-cards`, `/deals`, `/follow-ups`, `/wallet`, `/visit`, `/transactions`, `/legal`) | `src/api/*` | legal | PASS; booking now refuses an unskilled technician (B-05) |
| `owner-web` (Owner mobile, Capacitor) | in-memory nav `shell/nav.tsx`: 7 tabs (`home live approvals branches reports staff more`) + **27 pushed screens** (bookings, techDetail, alerts, audit, expenses, payroll, payments, paymentDevices, hardwarePayment, cashDrawer, cashHandoff, cashSummary, customers, giftCards, inventory, marketing, memberships, notifications, aiCenter, aiPackages, communitySettings, tickets, settings, profile, privacy, terms, deleteAccount) | 54 screen files | `src/api/*` | privacy, terms | PASS; screen names tracked as route templates for analytics / crash reports |
| `tech-web` (Technician mobile, Capacitor) | in-memory nav: 5 tabs (`home schedule tickets earnings more`) + **24 pushed screens** (queue, ticket, timeClock, timeOff, tips, payroll, cashHandoff, cashPending, performance, serviceHistory, myClients, myDeals, followups, messages, certifications, workplaces, reportProduct, notifications, settings, profile, help, privacy, terms, deleteAccount) | 30 screen files | `src/api/*` | help, privacy, terms | PASS |
| `manager-pay-web` (Owner & Manager Payment / Tap to Pay, Capacitor) | in-memory nav: 4 tabs (`checkout history reports account`) + Login, Ticket, TapToPay, Success, Handoff, ReturnToStaff | 10 screens | `/mobile-checkout/*` (45 routes) | — | PASS on the loopback processor; real Tap to Pay = BLOCKED_EXTERNAL (K-13) |
| `customer-display` (23" second screen + Go Check-In kiosk mode, Windows/Android) | mode switch `App.tsx`: device pairing, `Display23` (checkout ticket, tip, signature, ads), `CheckIn23`, `GoCheckIn`, ADVERTISEMENT / MAINTENANCE / OFFLINE | 5 modes | `/customer-display/*` (22), `/go-check-in/*` (18) | — | PASS (dual-screen final report); real 23" hardware test = Kevin |
| `go-check-in-kiosk` | Capacitor wrapper around the display's kiosk build (`www/`) | — | same | — | PASS (wrapper only) |
| `booking-public` | static `index.html` + `public/` (the public booking link is served by the API's `/public/book/*` + customer-web) | 1 | — | — | PASS |

## 3. Every screen's state model (§246)

Each routed screen in the five React apps renders the four states through the shared `@aipowersalon/ui` primitives: loading skeleton, empty state, error with retry (`ApiError` → registry message, `RETRY` codes get the retry button — e.g. the new `CARD_PROCESSOR_UNAVAILABLE`), and refused (`403` → `AccessDenied`, with step-up prompts via `useStepUp()` for money / role mutations). Realtime: screens subscribe through `useRealtime(screens)` and refetch their own snapshot on a frame (REALTIME_INVENTORY.md §2) — no second read path.

## 4. Open (frontend)

| ID | Item |
|---|---|
| B-22 | POS booking "Save Draft" books a real appointment (Kevin decision) |
| B-24 | i18n catalogs: POS / Super Admin English-only; Vietnamese only in display, manager-pay, part of customer app |
| B-25 | zoom lock in 6 `index.html`; no automated a11y pass |
| K-13 | iOS build machine; Play upload keys; real display hardware |
