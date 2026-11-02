import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp } from '@capacitor/app';
import { useRef } from 'react';
import { AppLock } from '@aipowersalon/mobile-sdk';
import { OwnerMobileRoutes } from './lib/mobile';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { PortfolioOverviewScreen } from './screens/PortfolioOverviewScreen';
import { useOwnerSalon } from './shell/OwnerSalonContext';
import { OwnerSalonProvider } from './shell/OwnerSalonContext';
import { OwnerNavProvider, useOwnerNav } from './shell/nav';
import { OwnerBranchProvider } from './shell/OwnerBranchContext';
import { OwnerLayout } from './shell/OwnerLayout';
import { OwnerHomeScreen } from './screens/OwnerHomeScreen';
import { LiveOperationsScreen } from './screens/LiveOperationsScreen';
import { OwnerProfileScreen } from './screens/OwnerProfileScreen';
import { CommissionPayrollScreen } from './screens/CommissionPayrollScreen';
import { CustomersLoyaltyScreen } from './screens/CustomersLoyaltyScreen';
import { OwnerRewardsScreen } from './screens/OwnerRewardsScreen';   // Global Loyalty (Oct 30 2026)
import { GiftCardReportScreen } from './screens/GiftCardReportScreen';
import { OwnerMembershipsScreen } from './screens/OwnerMembershipsScreen';
import { InventoryProductsScreen } from './screens/InventoryProductsScreen';
import { MarketingGrowthScreen } from './screens/MarketingGrowthScreen';
import { PaymentsMoneyScreen } from './screens/PaymentsMoneyScreen';
import { AiCenterScreen } from './screens/AiCenterScreen';
import { ApprovalCenterScreen } from './screens/ApprovalCenterScreen';
import { BranchPerformanceScreen } from './screens/BranchPerformanceScreen';
import { BookingOverviewScreen } from './screens/BookingOverviewScreen';
import { StaffPerformanceScreen } from './screens/StaffPerformanceScreen';
import { FinanceReportsScreen } from './screens/FinanceReportsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { AiPackagesScreen } from './screens/AiPackagesScreen';
import { HardwarePaymentScreen } from './screens/HardwarePaymentScreen';
import { PaymentDevicesScreen } from './screens/PaymentDevicesScreen';
import { OwnerCashHandoffScreen } from './screens/OwnerCashHandoffScreen';
import { OwnerCashDrawerScreen } from './screens/OwnerCashDrawerScreen';
import { OwnerCashSummaryScreen } from './screens/OwnerCashSummaryScreen';
import { TechnicianDetailScreen } from './screens/TechnicianDetailScreen';
import { OwnerPrivacyScreen } from './screens/OwnerPrivacyScreen';
import { OwnerTermsScreen } from './screens/OwnerTermsScreen';
import { OwnerDeleteAccountScreen } from './screens/OwnerDeleteAccountScreen';
import { OwnerTicketOversightScreen } from './screens/OwnerTicketOversightScreen';
import { OwnerSettingScreen } from './screens/OwnerSettingScreen';
import { OwnerNotificationScreen } from './screens/OwnerNotificationScreen';
import { LoginScreen } from './screens/LoginScreen';
import { AcceptInviteScreen } from './screens/AcceptInviteScreen';
import { SuspendedBillingOnly } from './screens/SuspendedBillingOnly';
import { OwnerCommunitySettingsScreen } from './screens/OwnerCommunitySettingsScreen';

function Router() {
  const { tab, pushed } = useOwnerNav();
  const { viewingAllSalons } = useOwnerSalon();
  let screen;
  if (pushed?.kind === 'bookings') screen = <BookingOverviewScreen />;
  else if (pushed?.kind === 'techDetail') screen = <TechnicianDetailScreen technicianId={pushed.technicianId} />;
  else if (pushed?.kind === 'alerts') screen = <AlertsScreen />;
  else if (pushed?.kind === 'settings') screen = <OwnerSettingScreen />;
  else if (pushed?.kind === 'notifications') screen = <OwnerNotificationScreen />;
  else if (pushed?.kind === 'audit') screen = <AuditScreen />;
  else if (pushed?.kind === 'expenses') screen = <ExpensesScreen />;
  else if (pushed?.kind === 'hardwarePayment') screen = <HardwarePaymentScreen />;
  else if (pushed?.kind === 'paymentDevices') screen = <PaymentDevicesScreen />;
  else if (pushed?.kind === 'cashHandoff') screen = <OwnerCashHandoffScreen />;
  else if (pushed?.kind === 'cashDrawer') screen = <OwnerCashDrawerScreen />;
  else if (pushed?.kind === 'cashSummary') screen = <OwnerCashSummaryScreen />;
  else if (pushed?.kind === 'privacy') screen = <OwnerPrivacyScreen />;
  else if (pushed?.kind === 'terms') screen = <OwnerTermsScreen />;
  else if (pushed?.kind === 'deleteAccount') screen = <OwnerDeleteAccountScreen />;
  else if (pushed?.kind === 'aiPackages') screen = <AiPackagesScreen />;
  else if (pushed?.kind === 'tickets') screen = <OwnerTicketOversightScreen />;
  else if (pushed?.kind === 'profile') screen = <OwnerProfileScreen />;
  else if (pushed?.kind === 'payroll') screen = <CommissionPayrollScreen />;
  else if (pushed?.kind === 'customers') screen = <CustomersLoyaltyScreen />;
  else if (pushed?.kind === 'rewards') screen = <OwnerRewardsScreen />;
  else if (pushed?.kind === 'giftCards') screen = <GiftCardReportScreen />;
  else if (pushed?.kind === 'inventory') screen = <InventoryProductsScreen />;
  else if (pushed?.kind === 'marketing') screen = <MarketingGrowthScreen />;
  else if (pushed?.kind === 'payments') screen = <PaymentsMoneyScreen />;
  else if (pushed?.kind === 'aiCenter') screen = <AiCenterScreen />;
  else if (pushed?.kind === 'memberships') screen = <OwnerMembershipsScreen />;
  else if (pushed?.kind === 'communitySettings') screen = <OwnerCommunitySettingsScreen />;   // BUILD_PLAN Phase 8
  // The Overview tab shows the PORTFOLIO when "All Salons" is selected, and the single salon's home when one is.
  // Showing a single salon's numbers under an "All Salons" header would be the worst kind of wrong: it looks right.
  else if (tab === 'home') screen = viewingAllSalons ? <PortfolioOverviewScreen /> : <OwnerHomeScreen />;
  else if (tab === 'live') screen = <LiveOperationsScreen />;
  else if (tab === 'approvals') screen = <ApprovalCenterScreen />;
  else if (tab === 'branches') screen = <BranchPerformanceScreen />;
  else if (tab === 'reports') screen = <FinanceReportsScreen />;
  else if (tab === 'staff') screen = <StaffPerformanceScreen />;
  else screen = <MoreScreen />;
  return <OwnerLayout>{screen}</OwnerLayout>;
}

function Gate() {
  const { principal, loading, logout } = useAuth();
  // a session RESTORED at launch (principal present the first time loading ends) vs one just signed in with a password
  const restoredRef = useRef<boolean | null>(null);
  if (!loading && restoredRef.current === null) restoredRef.current = !!principal;
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  if (loading) return <div className="owner-app"><div className="owner-state"><div className="big owner-serif">Loading…</div></div></div>;
  if (!principal) return <LoginScreen />;
  // Constitution 7 §19: a billing-only session (suspended salon) gets billing and nothing else
  if (principal.restriction === 'SUSPENDED_BILLING_ONLY') return <SuspendedBillingOnly />;
  // The SALON layer wraps the BRANCH layer: a branch only means anything inside a salon. Switching salon
  // re-issues the session server-side, and the branch context re-reads from it.
  return (
    // Phase 13 D (C6 §179, §245–246): neutral cover in the app switcher; locks after 5 idle minutes (Face ID / device
    // passcode to unlock) and, on a phone with Face ID turned on, when a restored session opens the app
    <AppLock active privacyScreen idleMinutes={5} lockOnLaunch={restoredRef.current ? 'when-enrolled' : false} plugin={CapApp} onSignOut={() => { void logout(); }} label="AIPowerSalon Owner">
      <OwnerNavProvider>
        <OwnerMobileRoutes />
        <OwnerSalonProvider>
          <OwnerBranchProvider><Router /></OwnerBranchProvider>
        </OwnerSalonProvider>
      </OwnerNavProvider>
    </AppLock>
  );
}

import { AnimatedSplash } from '@aipowersalon/ui';
import { OwnerQueryLayer } from './lib/queryLayer';

export function App() {
  return (
    <AuthProvider>
      <AnimatedSplash onMount={() => { SplashScreen.hide().catch(() => {}); }} />
      {/* BUILD_PLAN Phase 13: the server-state layer — scoped to the signed-in principal; logout / salon switch wipe it */}
      <OwnerQueryLayer><Gate /></OwnerQueryLayer>
    </AuthProvider>
  );
}
