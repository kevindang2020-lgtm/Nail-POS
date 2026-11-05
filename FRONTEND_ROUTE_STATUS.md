# FRONTEND_ROUTE_STATUS.md

**GENERATED FROM CODE — do not hand-edit.**
*Generated on 2026-10-14 by `apps/api/scripts/generate-frontend-route-status.mjs`*

Mandate §248: Authoritative status of all routes, screens, permissions, and backend API connections across all 9 frontend applications in AI PowerSalon POS.

## 1. Executive Summary Across All Frontends

| Application | Router / Architecture | Routes / Screens | Crosswire Status | Nav Status | Overall Status |
| --- | --- | ---: | --- | --- | --- |
| **Tenant POS (pos-web)** | React 18 SPA (react-router-dom) | 220 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Super Admin (admin-web)** | React 18 SPA (react-router-dom) | 153 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Owner Portal (owner-web)** | React 18 SPA (Tab Navigation) | 34 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Technician App (tech-web)** | React 18 SPA (Tab Navigation) | 29 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Customer Web (customer-web)** | React 18 SPA (react-router-dom) | 53 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Manager Pay App (manager-pay-web)** | React 18 SPA (Mobile Tab + Flow Stack) | 9 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Customer Facing Display (customer-display)** | React 18 SPA (SSE State Machine) | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Self-Service Check-In Kiosk (go-check-in-kiosk)** | Single-File HTML5 / Capacitor App | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |
| **Public Booking Widget (booking-public)** | Single-File HTML5 Standalone Widget | 1 | 0 Orphans | 0 Dead Links | **100% WIRED (PASS)** |

**Total Frontend API Calls:** 2,525 calls catalogued | **Orphaned (404) Calls:** 0 | **Dead Sidebar Items:** 0

---

## Tenant POS (pos-web)

- **Architecture:** React 18 SPA (react-router-dom)
- **Target Role / Plane:** Salon Staff / Receptionist / Manager
- **Total Managed Routes / Screens:** 220
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `/oauth/authorize` | authorize | `OAuthConsentScreen` | `apps/pos-web/src/screens/OAuthConsentScreen.tsx` | `GET /oauth/authorize?`<br>`POST /oauth/authorize` | `settings.edit` | ✅ PASS |
| `/` | Root | `POSLayout` | `apps/pos-web/src/shell/POSLayout.tsx` | `GET /tech/manager-messages`<br>`PATCH /tech/manager-messages` | `pos.technicians.view` | ✅ PASS |
| `/overview` | Overview | `POSOverviewScreen` | `apps/pos-web/src/screens/POSOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/overview` | overview | `POSOverviewScreen` | `apps/pos-web/src/screens/POSOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/dashboard` | Live Operations | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/live-operations` | live-operations | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/dashboard` | dashboard | `POSDashboardScreen` | `apps/pos-web/src/screens/POSDashboardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/check-in` | Check-In | `POSCheckInScreen` | `apps/pos-web/src/screens/POSCheckInScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/queue` | Customer Queue | `POSQueueScreen` | `apps/pos-web/src/screens/POSQueueScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/serving` | Serving | `POSServingScreen` | `apps/pos-web/src/screens/POSServingScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/service-done` | Service Done | `POSServiceDoneScreen` | `apps/pos-web/src/screens/POSServiceDoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/checkout` | Checkout | `POSCheckoutScreen` | `apps/pos-web/src/screens/POSCheckoutScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/cash-handoffs` | Daily Closeout | `POSCashHandoffScreen` | `apps/pos-web/src/screens/POSCashHandoffScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/cash-drawer` | Cash Drawer | `POSCashDrawerScreen` | `apps/pos-web/src/screens/POSCashDrawerScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking` | Booking | `POSBookingScreen` | `apps/pos-web/src/screens/POSBookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking/walk-in` | walk-in | `POSWalkInScreen` | `apps/pos-web/src/screens/POSWalkInScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/booking/new` | new | `POSNewBookingScreen` | `apps/pos-web/src/screens/POSNewBookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tech-queue` | Technician Queue | `POSTechQueueScreen` | `apps/pos-web/src/screens/POSTechQueueScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tech-appointments` | Technician Appointments | `POSTechAppointmentsScreen` | `apps/pos-web/src/screens/POSTechAppointmentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians` | Technicians | `POSTechniciansScreen` | `apps/pos-web/src/screens/POSTechniciansScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/technicians/schedule` | Staff Schedule | `POSLiveTechnicianScheduleScreen` | `apps/pos-web/src/screens/POSLiveTechnicianScheduleScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians/skill-requests` | Skill Requests | `POSSkillRequestsScreen` | `apps/pos-web/src/screens/POSSkillRequestsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/technicians/:technicianId` | :technicianId | `POSTechnicianProfileScreen` | `apps/pos-web/src/screens/POSTechnicianProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/services` | Services | `POSServicesScreen` | `apps/pos-web/src/screens/POSServicesScreen.tsx` | `GET /pos/services/state` | `pos.services.view` | ✅ PASS |
| `/tenant/payments/overview` | Payments Overview | `POSPaymentsOverviewScreen` | `apps/pos-web/src/screens/POSPaymentsOverviewScreen.tsx` | `GET /pos/payments/overview` | `pos.reports.view` | ✅ PASS |
| `/tenant/ai/command-center` | AI Command Center | `POSAICenterScreen` | `apps/pos-web/src/screens/POSAICenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/copilot` | Reception Copilot | `POSReceptionCopilotScreen` | `apps/pos-web/src/screens/POSReceptionCopilotScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/messaging-setup` | Text Messaging Setup | `POSMessagingSetupScreen` | `apps/pos-web/src/screens/POSMessagingSetupScreen.tsx` | `GET /tenant/messaging/number`<br>`GET /tenant/messaging/number/search`<br>`POST /tenant/messaging/number/buy` | `settings.view` | ✅ PASS |
| `/tenant/ai/receptionist` | AI Receptionist | `POSAIReceptionistScreen` | `apps/pos-web/src/screens/POSAIReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/front-desk` | AI Front Desk | `POSAIFrontDeskScreen` | `apps/pos-web/src/screens/POSAIFrontDeskScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/follow-ups` | AI Follow-Ups | `POSAIFollowUpsScreen` | `apps/pos-web/src/screens/POSAIFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/business-setup` | AI Business Setup | `POSAIBusinessSetupScreen` | `apps/pos-web/src/screens/POSAIBusinessSetupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/calendar` | AI Calendar | `POSAICalendarScreen` | `apps/pos-web/src/screens/POSAICalendarScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receptionist/calls` | AI Calls | `POSAICallsScreen` | `apps/pos-web/src/screens/POSAICallsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/queue` | AI Queue Assistant | `POSAIQueueAssignmentScreen` | `apps/pos-web/src/screens/POSAIQueueAssignmentScreen.tsx` | `GET /pos/technicians/state` | `pos.technicians.view` | ✅ PASS |
| `/tenant/ai/receptionist/settings` | AI Receptionist Settings | `POSAISettingsScreen` | `apps/pos-web/src/screens/POSAISettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/plans` | AI Packages | `POSAIPlansScreen` | `apps/pos-web/src/screens/POSAIPlansScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/overview` | Management Overview | `POSManagementScreen` | `apps/pos-web/src/screens/POSManagementScreen.tsx` | `GET /pos/technicians/state`<br>`GET /pos/payroll/state` | `pos.technicians.view` | ✅ PASS |
| `/tenant/devices/overview` | Devices Overview | `POSDevicesScreen` | `apps/pos-web/src/screens/POSDevicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/customer-displays` | Customer Displays | `POSCustomerDisplaysScreen` | `apps/pos-web/src/screens/POSCustomerDisplaysScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/overview` | Account Overview | `POSAccountScreen` | `apps/pos-web/src/screens/POSAccountScreen.tsx` | `GET /pos/me/profile`<br>`GET /auth/mfa/status` | `self.profile.view` | ✅ PASS |
| `/tenant/account/activity-logs` | Activity Logs | `POSActivityLogsScreen` | `apps/pos-web/src/screens/POSActivityLogsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/security` | Security & 2FA | `POSSecurityScreen` | `apps/pos-web/src/screens/POSSecurityScreen.tsx` | `GET /pos/me/profile` | `self.profile.view` | ✅ PASS |
| `/tenant/account/subscription` | Billing | `POSSubscriptionScreen` | `apps/pos-web/src/screens/POSSubscriptionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/users-roles` | users-roles | `Navigate -> /tenant/team/permissions` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/billing` | billing | `Navigate -> /tenant/account/subscription` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/support` | Help & Support | `POSHelpCenterScreen` | `apps/pos-web/src/screens/POSHelpCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/customers` | Customer Directory | `POSCustomersScreen` | `apps/pos-web/src/screens/POSCustomersScreen.tsx` | `GET /pos/customers/state` | `pos.customers.view` | ✅ PASS |
| `/tenant/customers/memberships` | Service Packages | `POSMembershipsScreen` | `apps/pos-web/src/screens/POSMembershipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/messages` | Messages | `POSMessagesScreen` | `apps/pos-web/src/screens/POSMessagesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/nail-showcase` | NailShowcase | `POSNailShowcaseModerationScreen` | `apps/pos-web/src/screens/POSNailShowcaseModerationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/follow-ups` | Missed Call Follow-Up | `POSFollowUpsScreen` | `apps/pos-web/src/screens/POSFollowUpsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/settings/follow-ups` | Follow-Up Settings | `EndOfDayFollowUpSettings` | `apps/pos-web/src/screens/EndOfDayFollowUpSettings.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/reports` | Daily Summary | `POSReportsScreen` | `apps/pos-web/src/screens/POSReportsScreen.tsx` | `GET /pos/reports/state` | `pos.reports.view` | ✅ PASS |
| `/settings` | Settings | `POSSettingsScreen` | `apps/pos-web/src/screens/POSSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/locations` | Locations | `TenantLocationsScreen` | `apps/pos-web/src/screens/TenantLocationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory` | Inventory | `TenantInventoryScreen` | `apps/pos-web/src/screens/TenantInventoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/vendors` | Vendors | `TenantSuppliersScreen` | `apps/pos-web/src/screens/TenantSuppliersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/api-webhooks` | API & Webhooks | `TenantApiWebhooksScreen` | `apps/pos-web/src/screens/TenantApiWebhooksScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/logs` | Device Logs | `TenantLogsScreen` | `apps/pos-web/src/screens/TenantLogsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/campaigns` | Campaigns | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/deals` | Deals & Offers | `POSDealsScreen` | `apps/pos-web/src/screens/POSDealsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/display-ads` | Customer Display Advertising | `POSDisplayAdsScreen` | `apps/pos-web/src/screens/POSDisplayAdsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/sms` | SMS Inbox | `POSCommunicationsScreen` | `apps/pos-web/src/screens/POSCommunicationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/payroll` | Payroll Reports | `POSPayrollScreen` | `apps/pos-web/src/screens/POSPayrollScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/members` | All Team Members | `POSTeamScreen` | `apps/pos-web/src/screens/POSTeamScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/sales` | Sales Reports | `POSSalesReportScreen` | `apps/pos-web/src/screens/POSSalesReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/services` | Service Reports | `POSServicesReportScreen` | `apps/pos-web/src/screens/POSServicesReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/technicians` | Technician Reports | `POSTechniciansReportScreen` | `apps/pos-web/src/screens/POSTechniciansReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/commission` | Commission Reports | `POSCommissionReportScreen` | `apps/pos-web/src/screens/POSCommissionReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/payroll` | payroll | `Navigate -> /tenant/team/payroll` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/commission` | commission | `Navigate -> /tenant/reports/commission` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/tips` | Tips | `POSTeamTipsScreen` | `apps/pos-web/src/screens/POSTeamTipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/packages` | packages | `Navigate -> /tenant/customers/memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/payments` | Payment Reports | `POSPaymentsReportScreen` | `apps/pos-web/src/screens/POSPaymentsReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/customers` | Customer Reports | `POSCustomersReportScreen` | `apps/pos-web/src/screens/POSCustomersReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/appointments` | Appointment Reports | `POSAppointmentsReportScreen` | `apps/pos-web/src/screens/POSAppointmentsReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/tax` | Tax Reports | `POSTaxReportScreen` | `apps/pos-web/src/screens/POSTaxReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/transactions` | Transactions | `POSTransactionsScreen` | `apps/pos-web/src/screens/POSTransactionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/tips` | Tips & Gratuity | `POSTipsScreen` | `apps/pos-web/src/screens/POSTipsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/settlements` | Deposits & Settlements | `POSSettlementsScreen` | `apps/pos-web/src/screens/POSSettlementsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/profiles` | Technician Profiles | `POSTeamProfilesScreen` | `apps/pos-web/src/screens/POSTeamProfilesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/categories` | Service Categories | `POSServiceCategoriesScreen` | `apps/pos-web/src/screens/POSServiceCategoriesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/pricing` | Pricing | `POSServicePricingScreen` | `apps/pos-web/src/screens/POSServicePricingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/performance` | Performance | `POSTeamPerformanceScreen` | `apps/pos-web/src/screens/POSTeamPerformanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/payment-terminals` | Payment Terminals | `POSPaymentTerminalsScreen` | `apps/pos-web/src/screens/POSPaymentTerminalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/gift-cards` | Gift Card Payments | `POSGiftCardsScreen` | `apps/pos-web/src/screens/POSGiftCardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-cards` | gift-cards | `Navigate -> /tenant/customers/gift-cards` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/refunds-voids` | Refunds & Voids | `POSRefundsVoidsScreen` | `apps/pos-web/src/screens/POSRefundsVoidsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/loyalty` | Loyalty & Rewards | `POSLoyaltyScreen` | `apps/pos-web/src/screens/POSLoyaltyScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing` | AI Marketing Assistant | `POSAIMarketingScreen` | `apps/pos-web/src/screens/POSAIMarketingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection` | AI Money Protection | `POSAIMoneyProtectionScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/alerts` | Money Protection · Alerts | `POSAIMoneyProtectionAlertsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/investigations` | Money Protection · Investigations | `POSAIMoneyProtectionInvestigationsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionInvestigationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/rules` | Money Protection · Rules | `POSAIMoneyProtectionRulesScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionRulesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/money-protection/settings` | Money Protection · Settings | `POSAIMoneyProtectionSettingsScreen` | `apps/pos-web/src/screens/POSAIMoneyProtectionSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription` | AI Voice Transcription | `POSAIVoiceTranscriptionScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/history` | Voice · Call History | `POSAIVoiceTranscriptionHistoryScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/search` | Voice · Search | `POSAIVoiceTranscriptionSearchScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionSearchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/unresolved` | Voice · Follow-ups | `POSAIVoiceTranscriptionUnresolvedScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionUnresolvedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/settings` | Voice · Settings | `POSAIVoiceTranscriptionSettingsScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/voice-transcription/transcripts/:id` | :id | `POSAIVoiceTranscriptionDetailScreen` | `apps/pos-web/src/screens/POSAIVoiceTranscriptionDetailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/studio` | Message Studio | `POSAIMessageStudioScreen` | `apps/pos-web/src/screens/POSAIMessageStudioScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/audiences` | Audience Builder | `POSAIAudienceBuilderScreen` | `apps/pos-web/src/screens/POSAIAudienceBuilderScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/results` | Campaign Results | `POSAICampaignResultsScreen` | `apps/pos-web/src/screens/POSAICampaignResultsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/marketing/builder` | Campaign Builder | `POSAICampaignBuilderScreen` | `apps/pos-web/src/screens/POSAICampaignBuilderScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business` | AI Business Assistant | `POSAiBusinessScreen` | `apps/pos-web/src/screens/POSAiBusinessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/inventory` | AI Inventory Assistant | `POSAiInventoryScreen` | `apps/pos-web/src/screens/POSAiInventoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/analytics` | AI Analytics & Forecasting | `POSAiForecastingScreen` | `apps/pos-web/src/screens/POSAiForecastingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/branches` | AI Branch Comparison | `POSAiBranchCompareScreen` | `apps/pos-web/src/screens/POSAiBranchCompareScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/alerts` | AI Business Alerts | `POSAiAlertsScreen` | `apps/pos-web/src/screens/POSAiAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/business/reports` | AI Business Reports | `POSAiReportsScreen` | `apps/pos-web/src/screens/POSAiReportsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile` | Customer Profile AI | `POSAICustomerProfileOverviewScreen` | `apps/pos-web/src/screens/POSAICustomerProfileOverviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/duplicates` | Duplicate Review | `POSAICustomerDuplicateReviewScreen` | `apps/pos-web/src/screens/POSAICustomerDuplicateReviewScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/churn` | Churn Watch | `POSAICustomerChurnWatchScreen` | `apps/pos-web/src/screens/POSAICustomerChurnWatchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/rebooking` | Rebooking | `POSAICustomerRebookingScreen` | `apps/pos-web/src/screens/POSAICustomerRebookingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/recommendations` | Service Recommendations | `POSAICustomerRecommendationsScreen` | `apps/pos-web/src/screens/POSAICustomerRecommendationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/settings` | Customer AI Settings | `POSAICustomerSettingsScreen` | `apps/pos-web/src/screens/POSAICustomerSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/checkout-upsell/settings` | Checkout Upsell AI | `AICheckoutUpsellSettingsScreen` | `apps/pos-web/src/screens/AICheckoutUpsellSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/platform` | AI Platform & Limits | `POSAiGovernanceScreen` | `apps/pos-web/src/screens/POSAiGovernanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/platform/settings` | AI Settings | `POSAiSettingsEditor` | `apps/pos-web/src/screens/POSAiSettingsEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-cards` | gift-cards | `POSGiftCardSettingsScreen` | `apps/pos-web/src/screens/POSGiftCardSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/sell-gift-card` | sell-gift-card | `POSSellGiftCardScreen` | `apps/pos-web/src/screens/POSSellGiftCardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/reload-gift-card` | reload-gift-card | `POSReloadGiftCardScreen` | `apps/pos-web/src/screens/POSReloadGiftCardScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-card-stock` | gift-card-stock | `POSGiftCardStockScreen` | `apps/pos-web/src/screens/POSGiftCardStockScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/gift-card-lookup` | gift-card-lookup | `POSGiftCardLookupScreen` | `apps/pos-web/src/screens/POSGiftCardLookupScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reputation` | Review & Reputation AI | `POSAIReviewReputationScreen` | `apps/pos-web/src/screens/POSAIReviewReputationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/scheduling-optimizer` | AI Scheduling Optimizer | `POSAISchedulingOptimizerScreen` | `apps/pos-web/src/screens/POSAISchedulingOptimizerScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/approvals` | Approvals | `POSApprovalsScreen` | `apps/pos-web/src/screens/approvals/POSApprovalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community` | Safety Community | `CommunityFeedScreen` | `apps/pos-web/src/screens/community/CommunityFeedScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/posts/:id` | :id | `CommunityPostScreen` | `apps/pos-web/src/screens/community/CommunityPostScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/new` | new | `CommunityAdvisoryEditor` | `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/drafts` | drafts | `CommunityDraftsScreen` | `apps/pos-web/src/screens/community/CommunityDraftsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/drafts/:id` | :id | `CommunityAdvisoryEditor` | `apps/pos-web/src/screens/community/CommunityAdvisoryEditor.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/approvals` | approvals | `CommunityApprovalsScreen` | `apps/pos-web/src/screens/community/CommunityApprovalsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/incidents` | incidents | `CommunityIncidentsScreen` | `apps/pos-web/src/screens/community/CommunityIncidentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/community/settings` | settings | `CommunitySettingsScreen` | `apps/pos-web/src/screens/community/CommunitySettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/ocr-receipt` | Receipt & Document AI | `POSAIOcrReceiptScreen` | `apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/phone-verification` | Booking Phone Verification | `POSBookingVerificationScreen` | `apps/pos-web/src/screens/POSBookingVerificationScreen.tsx` | `GET /pos/booking/verification-override/pending`<br>`GET /pos/settings/booking-phone-verification/usage?days=30`<br>`POST /pos/booking/verification-override` | `pos.booking.verification_pending` | ✅ PASS |
| `/tenant/customers/phone-management` | Customer Phone Management | `POSCustomerPhoneSettingsScreen` | `apps/pos-web/src/screens/POSCustomerPhoneSettingsScreen.tsx` | `GET /pos/settings/customer-phone/branches`<br>`GET /pos/settings/customer-phone`<br>`PATCH /pos/settings/customer-phone/branches` | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reputation/settings` | Reputation AI Settings | `POSAIReviewReputationSettingsScreen` | `apps/pos-web/src/screens/POSAIReviewReputationSettingsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/timeline` | Customer Timeline | `POSAICustomerTimelineScreen` | `apps/pos-web/src/screens/POSAICustomerTimelineScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-profile/search` | Customer Search | `POSAICustomerSearchScreen` | `apps/pos-web/src/screens/POSAICustomerSearchScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reception-copilot` | AI Reception Copilot | `POSReceptionCopilotScreen` | `apps/pos-web/src/screens/POSReceptionCopilotScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/reception-pos` | Reception POS | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/check-in-kiosk` | Customer Check-In Kiosk | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/tablets` | iPads & Tablets | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/receipt-devices` | Receipt Devices | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/assignments` | Device Assignments | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/devices/health` | Device Health | `POSDeviceFleetScreen` | `apps/pos-web/src/screens/POSDeviceFleetScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/usage-limits` | Usage Limits | `POSUsageLimitsScreen` | `apps/pos-web/src/screens/POSUsageLimitsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/account/invoices` | Invoices | `POSAccountInvoicesScreen` | `apps/pos-web/src/screens/POSAccountInvoicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/alerts` | Low-Stock Alerts | `POSInventoryAlertsScreen` | `apps/pos-web/src/screens/POSInventoryAlertsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/inventory/purchase-orders` | Purchase Orders | `POSPurchaseOrdersScreen` | `apps/pos-web/src/screens/POSPurchaseOrdersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/products` | Products | `POSProductsScreen` | `apps/pos-web/src/screens/POSProductsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/features` | Feature Access | `POSFeaturesScreen` | `apps/pos-web/src/screens/POSFeaturesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/usage` | AI Usage & Limits | `POSAiUsageScreen` | `apps/pos-web/src/screens/POSAiUsageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/notifications` | Customer Notifications | `POSNotificationsScreen` | `apps/pos-web/src/screens/POSNotificationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/reminders` | Appointment Reminders | `POSRemindersScreen` | `apps/pos-web/src/screens/POSRemindersScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/templates` | Message Templates | `POSMessageTemplatesScreen` | `apps/pos-web/src/screens/POSMessageTemplatesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/system-status` | system-status | `POSSystemStatusScreen` | `apps/pos-web/src/screens/POSSystemStatusScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/ai-receptionist` | AI Receptionist | `POSAIReceptionistScreen` | `apps/pos-web/src/screens/POSAIReceptionistScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/win-back` | Win-Back Campaigns | `POSRetentionScreen` | `apps/pos-web/src/screens/POSRetentionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/payment-gateway` | Payment Gateway | `POSPaymentGatewayScreen` | `apps/pos-web/src/screens/POSPaymentGatewayScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/segments` | Customer Segments | `POSSegmentsScreen` | `apps/pos-web/src/screens/POSSegmentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/birthdays` | Birthday Campaigns | `POSBirthdaysScreen` | `apps/pos-web/src/screens/POSBirthdaysScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/referrals` | Referrals | `POSReferralsScreen` | `apps/pos-web/src/screens/POSReferralsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/phone` | Phone & Caller ID | `POSPhoneScreen` | `apps/pos-web/src/screens/POSPhoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/phone` | Phone Integration | `POSPhoneScreen` | `apps/pos-web/src/screens/POSPhoneScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/communications/email` | Email | `POSEmailScreen` | `apps/pos-web/src/screens/POSEmailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/email` | Email Integration | `POSEmailScreen` | `apps/pos-web/src/screens/POSEmailScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/social` | Social Content | `POSSocialScreen` | `apps/pos-web/src/screens/POSSocialScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/apps` | Connected Apps | `POSIntegrationsScreen` | `apps/pos-web/src/screens/POSIntegrationsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/deposit-reconciliation` | AI Deposit Reconciliation | `POSDepositReconScreen` | `apps/pos-web/src/screens/POSDepositReconScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/integrations/sms` | SMS Integration | `POSMessagingSetupScreen` | `apps/pos-web/src/screens/POSMessagingSetupScreen.tsx` | `GET /tenant/messaging/number`<br>`GET /tenant/messaging/number/search`<br>`POST /tenant/messaging/number/buy` | `settings.view` | ✅ PASS |
| `/tenant/reports/ai` | AI Reports | `POSAiAnalyticsScreen` | `apps/pos-web/src/screens/POSAiAnalyticsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/booking` | AI Booking Assistant | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/scheduling` | scheduling | `Navigate -> /tenant/ai/scheduling-optimizer` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/customer-insights` | AI Customer Insights | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/checkout-upsell` | AI Checkout & Upsell | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/fraud-protection` | AI Fraud Protection | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/reviews` | AI Review Assistant | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/ai/receipt-scanner` | AI Receipt Scanner | `POSAiPackageScreen` | `apps/pos-web/src/screens/POSAiPackageScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/sms` | SMS Marketing | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/email` | Email Marketing | `POSCampaignCenterScreen` | `apps/pos-web/src/screens/POSCampaignCenterScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/coupons` | Coupons | `POSPromotionsScreen` | `apps/pos-web/src/screens/POSPromotionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/multi-location` | Multi-Location Reports | `POSMultiLocationScreen` | `apps/pos-web/src/screens/POSMultiLocationScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/marketing` | Marketing Reports | `POSMarketingReportScreen` | `apps/pos-web/src/screens/POSMarketingReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/reports/inventory` | Inventory Reports | `POSInventoryReportScreen` | `apps/pos-web/src/screens/POSInventoryReportScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/time-clock` | Time Clock | `POSTimeClockScreen` | `apps/pos-web/src/screens/POSTimeClockScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/turn-queue` | Turn Queue | `POSTurnQueueScreen` | `apps/pos-web/src/screens/POSTurnQueueScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/permissions` | Roles & Permissions | `POSTeamPermissionsScreen` | `apps/pos-web/src/screens/POSTeamPermissionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/team/permissions/:userId` | :userId | `POSMemberAccessScreen` | `apps/pos-web/src/screens/access/POSMemberAccessScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/security/access` | Access Reviews & Risk | `POSAccessGovernanceScreen` | `apps/pos-web/src/screens/access/POSAccessGovernanceScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/discounts` | Discounts | `POSDiscountsScreen` | `apps/pos-web/src/screens/POSDiscountsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/services/add-ons` | Add-On Services | `POSServiceAddOnsScreen` | `apps/pos-web/src/screens/POSServiceAddOnsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/appointment-history` | Appointment History | `POSAppointmentHistoryScreen` | `apps/pos-web/src/screens/POSAppointmentHistoryScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/notes` | Customer Notes | `POSCustomerNotesScreen` | `apps/pos-web/src/screens/POSCustomerNotesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/profiles` | Customer Profiles | `POSCustomerProfileScreen` | `apps/pos-web/src/screens/POSCustomerProfileScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/retention` | Customer Retention | `POSRetentionScreen` | `apps/pos-web/src/screens/POSRetentionScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/customers/saved-cards` | Saved Cards | `POSSavedCardsScreen` | `apps/pos-web/src/screens/POSSavedCardsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/terminals` | terminals | `Navigate -> /tenant/devices/payment-terminals` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/expenses` | Expenses | `POSExpensesScreen` | `apps/pos-web/src/screens/POSExpensesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/split-payments` | Split Payments | `POSSplitPaymentsScreen` | `apps/pos-web/src/screens/POSSplitPaymentsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/payments/invoices` | Invoices | `POSInvoicesScreen` | `apps/pos-web/src/screens/POSInvoicesScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing` | Marketing Dashboard | `POSMarketingLandingScreen` | `apps/pos-web/src/screens/POSMarketingLandingScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/promotions` | Promotions | `POSPromotionsScreen` | `apps/pos-web/src/screens/POSPromotionsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/marketing/reviews` | Reviews | `POSReviewsScreen` | `apps/pos-web/src/screens/POSReviewsScreen.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/salon-profile` | Salon Profile | `Navigate -> /settings?section=business-branch` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/business-hours` | Business Hours | `Navigate -> /settings?section=auto-logout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/auto-logout` | Auto-Logout Rules | `Navigate -> /settings?section=auto-logout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/booking-rules` | Booking Rules | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/no-show-policy` | No-Show Policy | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/cancellation-policy` | Cancellation Policy | `Navigate -> /settings?section=booking-appointments` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/checkout-rules` | Checkout Rules | `Navigate -> /settings?section=payments-checkout` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/tax-tip-rules` | Tax & Tip Rules | `Navigate -> /settings?section=tax` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/loyalty-rules` | Loyalty Rules | `Navigate -> /settings?section=loyalty-memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/membership-rules` | Membership Rules | `Navigate -> /settings?section=loyalty-memberships` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/tenant/management/queue-rules` | Queue Rules | `Navigate -> /settings?section=queue-workflow` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |
| `/*` | * | `Navigate -> /overview` | `apps/pos-web/src/screens/Navigate.tsx` | *(Inherited / Local State)* | `Role / Authenticated` | ✅ PASS |

---

## Super Admin (admin-web)

- **Architecture:** React 18 SPA (react-router-dom)
- **Target Role / Plane:** Platform Super Admin
- **Total Managed Routes / Screens:** 153
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
- **Total Managed Routes / Screens:** 34
- **Integrity Status:** ✅ Fully Connected (Zero 404s, Zero Broken Links)

| Route / Destination | Nav Label | Screen Component | Source File | Connected Backend APIs | Enforcing Permission | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `tab:pushed:bookings` | Pushed:bookings | `BookingOverviewScreen` | `apps/owner-web/src/screens/BookingOverviewScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:techDetail` | Pushed:techDetail | `TechnicianDetailScreen` | `apps/owner-web/src/screens/TechnicianDetailScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:alerts` | Pushed:alerts | `AlertsScreen` | `apps/owner-web/src/screens/AlertsScreen.tsx` | *(Inherited / Local State)* | `Authenticated Staff` | ✅ PASS |
| `tab:pushed:settings` | Pushed:settings | `OwnerSettingScreen` | `apps/owner-web/src/screens/OwnerSettingScreen.tsx` | `PUT /owner/me/language` | `self.profile.edit` | ✅ PASS |
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
- **Total Managed Routes / Screens:** 53
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

