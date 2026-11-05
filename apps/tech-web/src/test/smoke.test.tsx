// smoke.test.tsx — mount smoke for every technician screen. Each renders inside the real TechNavProvider with the
// fetch client mocked to stay pending, so screens render their initial/loading state. This exercises the true render
// path (imports, hooks, provider wiring, effect setup) and fails loudly if any screen throws on mount.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TechNavProvider } from '../shell/nav';

vi.mock('../api/client', () => {
  const pending = () => new Promise(() => {}); // never resolves → screens stay in their initial state
  return { api: { get: pending, post: pending, patch: pending, del: pending, upload: pending } };
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
];

describe('tech-web screen mount smoke', () => {
  for (const [name, el] of screens) {
    it(`${name} mounts and renders its initial state without throwing`, () => {
      const { container } = render(<TechNavProvider>{el}</TechNavProvider>);
      expect(container.firstChild).not.toBeNull();
    });
  }
});
