// smoke.test.tsx — mount smoke for every technician screen. Each renders inside the real TechNavProvider with the
// fetch client mocked to stay pending, so screens render their initial/loading state. This exercises the true render
// path (imports, hooks, provider wiring, effect setup) and fails loudly if any screen throws on mount.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TechNavProvider } from '../shell/nav';

vi.mock('../api/client', () => {
  const pending = () => new Promise(() => {}); // never resolves → screens stay in their initial state
  // Phase 13: authApi + the realtime hook use the transport itself (sign-in calls; native stream tickets)
  const transport = { app: 'test', request: pending, get: pending, post: pending, put: pending, patch: pending, del: pending, upload: pending, raw: pending, apiUrl: (p: string) => '/api/v1' + p, apiBase: () => '', clientHeaders: async () => ({}) };
  return { api: { get: pending, post: pending, patch: pending, del: pending, upload: pending }, apiUrl: (p: string) => '/api/v1' + p, apiBase: () => '', transport };
});

import { LoginScreen } from '../screens/LoginScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { QueueScreen } from '../screens/QueueScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TechDashboardScreen } from '../screens/TechDashboardScreen';
import { TechEarningsScreen } from '../screens/TechEarningsScreen';
import { TechFollowUpsScreen } from '../screens/TechFollowUpsScreen';
import { TechProfileScreen } from '../screens/TechProfileScreen';
import { TechScheduleScreen } from '../screens/TechScheduleScreen';
import { TicketDetailScreen } from '../screens/TicketDetailScreen';
import { TicketsListScreen } from '../screens/TicketsListScreen';
import { TechTimeOffScreen } from '../screens/TechTimeOffScreen';
import { TechCertificationsScreen } from '../screens/TechCertificationsScreen';
import { TechTimeClockScreen, TechPerformanceScreen, TechTipsScreen, TechCustomersScreen } from '../screens/TechMyWorkScreens';

const screens: [string, ReactElement][] = [
  ['LoginScreen', <LoginScreen />],
  ['MoreScreen', <MoreScreen />],
  ['NotificationsScreen', <NotificationsScreen />],
  ['QueueScreen', <QueueScreen />],
  ['SettingsScreen', <SettingsScreen />],
  ['TechDashboardScreen', <TechDashboardScreen />],
  ['TechEarningsScreen', <TechEarningsScreen />],
  ['TechFollowUpsScreen', <TechFollowUpsScreen />],
  ['TechProfileScreen', <TechProfileScreen />],
  ['TechScheduleScreen', <TechScheduleScreen />],
  ['TicketDetailScreen', <TicketDetailScreen ticketId="t1" />],
  ['TicketsListScreen', <TicketsListScreen />],
  ['TechTimeOffScreen', <TechTimeOffScreen />],
  ['TechCertificationsScreen', <TechCertificationsScreen />],
  ['TechTimeClockScreen', <TechTimeClockScreen />],
  ['TechPerformanceScreen', <TechPerformanceScreen />],
  ['TechTipsScreen', <TechTipsScreen />],
  ['TechCustomersScreen', <TechCustomersScreen />],
];

describe('tech-web screen mount smoke', () => {
  for (const [name, el] of screens) {
    it(`${name} mounts and renders its initial state without throwing`, () => {
      const { container } = render(<TechNavProvider>{el}</TechNavProvider>);
      expect(container.firstChild).not.toBeNull();
    });
  }
});
