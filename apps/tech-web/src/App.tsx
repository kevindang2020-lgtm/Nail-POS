import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginScreen } from './screens/LoginScreen';
import { AcceptInviteScreen } from './screens/AcceptInviteScreen';
import { TechLayout } from './shell/TechLayout';
import { TechNavProvider, useTechNav } from './shell/nav';
import { TechDashboardScreen } from './screens/TechDashboardScreen';
import { TechScheduleScreen } from './screens/TechScheduleScreen';
import { TicketsListScreen } from './screens/TicketsListScreen';
import { TechEarningsScreen } from './screens/TechEarningsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { TechMessagesScreen } from './screens/TechMessagesScreen';
import { TicketDetailScreen } from './screens/TicketDetailScreen';
import { QueueScreen } from './screens/QueueScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TechProfileScreen } from './screens/TechProfileScreen';
import { TechFollowUpsScreen } from './screens/TechFollowUpsScreen';
import { CashPendingScreen } from './screens/CashPendingScreen';
import { TechServiceHistoryScreen } from './screens/TechServiceHistoryScreen';
import { TechCashHandoffScreen } from './screens/TechCashHandoffScreen';
import { TechPrivacyScreen } from './screens/TechPrivacyScreen';
import { TechTermsScreen } from './screens/TechTermsScreen';
import { TechDeleteAccountScreen } from './screens/TechDeleteAccountScreen';
import { TechReportProductScreen } from './screens/TechReportProductScreen';
import { TechWorkplacesScreen } from './screens/TechWorkplacesScreen';
import { TechPayrollScreen } from './screens/TechPayrollScreen';
import { MyDealsScreen } from './screens/MyDealsScreen';
import { TechHelpScreen } from './screens/TechHelpScreen';

function Router() {
  const { tab, pushed } = useTechNav();
  let screen;
  if (pushed?.kind === 'ticket') screen = <TicketDetailScreen ticketId={pushed.ticketId} />;
  else if (pushed?.kind === 'queue') screen = <QueueScreen />;
  else if (pushed?.kind === 'notifications') screen = <NotificationsScreen />;
  else if (pushed?.kind === 'settings') screen = <SettingsScreen />;
  else if (pushed?.kind === 'profile') screen = <TechProfileScreen />;
  else if (pushed?.kind === 'followups') screen = <TechFollowUpsScreen />;
  else if (pushed?.kind === 'cashPending') screen = <CashPendingScreen />;
  else if (pushed?.kind === 'serviceHistory') screen = <TechServiceHistoryScreen />;
  else if (pushed?.kind === 'cashHandoff') screen = <TechCashHandoffScreen />;
  else if (pushed?.kind === 'privacy') screen = <TechPrivacyScreen />;
  else if (pushed?.kind === 'terms') screen = <TechTermsScreen />;
  else if (pushed?.kind === 'deleteAccount') screen = <TechDeleteAccountScreen />;
  else if (pushed?.kind === 'reportProduct') screen = <TechReportProductScreen />;
  else if (pushed?.kind === 'workplaces') screen = <TechWorkplacesScreen />;
  else if (pushed?.kind === 'payroll') screen = <TechPayrollScreen />;
  else if (pushed?.kind === 'myDeals') screen = <MyDealsScreen />;
  else if (pushed?.kind === 'messages') screen = <TechMessagesScreen />;
  else if (pushed?.kind === 'help') screen = <TechHelpScreen />;
  else if (tab === 'home') screen = <TechDashboardScreen />;
  else if (tab === 'schedule') screen = <TechScheduleScreen />;
  else if (tab === 'tickets') screen = <TicketsListScreen />;
  else if (tab === 'earnings') screen = <TechEarningsScreen />;
  else screen = <MoreScreen />;
  return <TechLayout>{screen}</TechLayout>;
}

function Gate() {
  const { principal, loading } = useAuth();
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  if (loading) return null;
  if (!principal) return <LoginScreen />;
  return <TechNavProvider><Router /></TechNavProvider>;
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
