import { AuthProvider, useAuth } from './auth/AuthContext';
import { PortfolioOverviewScreen } from './screens/PortfolioOverviewScreen';
import { useOwnerSalon } from './shell/OwnerSalonContext';
import { OwnerSalonProvider } from './shell/OwnerSalonContext';
import { OwnerNavProvider, useOwnerNav } from './shell/nav';
import { useAppRoutes } from './lib/mobile-shell';
import { OwnerBranchProvider } from './shell/OwnerBranchContext';
import { OwnerLayout } from './shell/OwnerLayout';
import { OwnerHomeScreen } from './screens/OwnerHomeScreen';
import { LiveOperationsScreen } from './screens/LiveOperationsScreen';
import { OwnerProfileScreen } from './screens/OwnerProfileScreen';
import { CommissionPayrollScreen } from './screens/CommissionPayrollScreen';
import { CustomersLoyaltyScreen } from './screens/CustomersLoyaltyScreen';
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

// Deep links and push taps (signed-in only): each route name opens its screen; anything else is ignored.
function OwnerRoutes() {
  const nav = useOwnerNav();
  useAppRoutes({
    alerts: () => nav.openAlerts(),
    approvals: () => nav.go('approvals'),
    appointments: () => nav.openBookings(),
    appointment: () => nav.openBookings(),
    queue: () => nav.go('live'),
    payroll: () => nav.openPayroll(),
    receipts: () => nav.openPayments(),
    security: () => nav.openSettings(),
  });
  return null;
}

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
  else if (pushed?.kind === 'giftCards') screen = <GiftCardReportScreen />;
  else if (pushed?.kind === 'inventory') screen = <InventoryProductsScreen />;
  else if (pushed?.kind === 'marketing') screen = <MarketingGrowthScreen />;
  else if (pushed?.kind === 'payments') screen = <PaymentsMoneyScreen />;
  else if (pushed?.kind === 'aiCenter') screen = <AiCenterScreen />;
  else if (pushed?.kind === 'memberships') screen = <OwnerMembershipsScreen />;
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
  const { principal, loading } = useAuth();
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  if (loading) return null;
  if (!principal) return <LoginScreen />;
  // The SALON layer wraps the BRANCH layer: a branch only means anything inside a salon. Switching salon
  // re-issues the session server-side, and the branch context re-reads from it.
  return (
    <OwnerNavProvider>
      <OwnerRoutes />
      <OwnerSalonProvider>
        <OwnerBranchProvider><Router /></OwnerBranchProvider>
      </OwnerSalonProvider>
    </OwnerNavProvider>
  );
}

import { AnimatedSplash } from './components/AnimatedSplash';

export function App() {
  return (
    <AuthProvider>
      <AnimatedSplash />
      <Gate />
    </AuthProvider>
  );
}
