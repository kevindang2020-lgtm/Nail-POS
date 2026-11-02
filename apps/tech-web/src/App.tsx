import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapApp } from '@capacitor/app';
import { AppLock } from '@aipowersalon/mobile-sdk';
import { TechMobileRoutes } from './lib/mobile';
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
import { TechTimeOffScreen } from './screens/TechTimeOffScreen';
import { TechCertificationsScreen } from './screens/TechCertificationsScreen';
import { TechTimeClockScreen, TechPerformanceScreen, TechTipsScreen, TechCustomersScreen } from './screens/TechMyWorkScreens';

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
  else if (pushed?.kind === 'timeOff') screen = <TechTimeOffScreen />;
  else if (pushed?.kind === 'certifications') screen = <TechCertificationsScreen />;
  else if (pushed?.kind === 'timeClock') screen = <TechTimeClockScreen />;
  else if (pushed?.kind === 'performance') screen = <TechPerformanceScreen />;
  else if (pushed?.kind === 'tips') screen = <TechTipsScreen />;
  else if (pushed?.kind === 'myClients') screen = <TechCustomersScreen />;
  else if (tab === 'home') screen = <TechDashboardScreen />;
  else if (tab === 'schedule') screen = <TechScheduleScreen />;
  else if (tab === 'tickets') screen = <TicketsListScreen />;
  else if (tab === 'earnings') screen = <TechEarningsScreen />;
  else screen = <MoreScreen />;
  return <TechLayout>{screen}</TechLayout>;
}

function Gate() {
  const { principal, loading, logout } = useAuth();
  if (typeof window !== 'undefined' && window.location.pathname === '/accept-invite') return <AcceptInviteScreen />;
  if (loading) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--tech-background)' }} className="tech-muted">Loading…</div>;
  if (!principal) return <LoginScreen />;
  // Phase 13 D: push-tap / universal-link routes open only inside the signed-in tree; the app switcher shows a neutral cover
  return (
    <AppLock active privacyScreen plugin={CapApp} onSignOut={() => { void logout(); }} label="AIPowerSalon Tech">
      <TechNavProvider><TechMobileRoutes /><Router /></TechNavProvider>
    </AppLock>
  );
}

import { AnimatedSplash } from '@aipowersalon/ui';
import { TechQueryLayer } from './lib/queryLayer';

export function App() {
  return (
    <AuthProvider>
      <AnimatedSplash onMount={() => { SplashScreen.hide().catch(() => {}); }} />
      {/* BUILD_PLAN Phase 13: the server-state layer — scoped to the signed-in principal; logout / switch wipe it */}
      <TechQueryLayer><Gate /></TechQueryLayer>
    </AuthProvider>
  );
}
