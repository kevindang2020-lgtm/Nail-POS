// smoke.test.tsx — mount smoke for every routed POS screen. Each renders inside a MemoryRouter (screens use
// react-router navigation) with the fetch client mocked to stay pending, so screens render their initial/loading
// state. Exercises the true render path (imports, hooks, router wiring, effects); fails if any screen throws on mount.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('../api/client', async (orig) => {
  const actual = await orig<typeof import('../api/client')>();
  const pending = () => new Promise(() => {}); // never resolves → screens stay in their initial state
  return { ...actual, api: { get: pending, post: pending, patch: pending, put: pending, del: pending, upload: pending } };
});

import { LoginScreen } from '../screens/LoginScreen';
import { POSOverviewScreen } from '../screens/POSOverviewScreen';
import { POSDashboardScreen } from '../screens/POSDashboardScreen';
import { POSCheckInScreen } from '../screens/POSCheckInScreen';
import { POSQueueScreen } from '../screens/POSQueueScreen';
import { POSServingScreen } from '../screens/POSServingScreen';
import { POSServiceDoneScreen } from '../screens/POSServiceDoneScreen';
import { POSCheckoutScreen } from '../screens/POSCheckoutScreen';
import { POSBookingScreen } from '../screens/POSBookingScreen';
import { POSTechQueueScreen } from '../screens/POSTechQueueScreen';
import { POSTechAppointmentsScreen } from '../screens/POSTechAppointmentsScreen';
import { POSTechniciansScreen } from '../screens/POSTechniciansScreen';
import { POSLiveTechnicianScheduleScreen } from '../screens/POSLiveTechnicianScheduleScreen';
import { POSSkillRequestsScreen } from '../screens/POSSkillRequestsScreen';
import { POSServicesScreen } from '../screens/POSServicesScreen';
import { POSCustomersScreen } from '../screens/POSCustomersScreen';
import { POSReportsScreen } from '../screens/POSReportsScreen';
import { POSSettingsScreen } from '../screens/POSSettingsScreen';
import { POSNailShowcaseModerationScreen } from '../screens/POSNailShowcaseModerationScreen';
import { POSFollowUpsScreen } from '../screens/POSFollowUpsScreen';
import { EndOfDayFollowUpSettings } from '../screens/EndOfDayFollowUpSettings';

const screens: [string, ReactElement][] = [
  ['LoginScreen', <LoginScreen />],
  ['POSOverviewScreen', <POSOverviewScreen />],
  ['POSDashboardScreen', <POSDashboardScreen />],
  ['POSCheckInScreen', <POSCheckInScreen />],
  ['POSQueueScreen', <POSQueueScreen />],
  ['POSServingScreen', <POSServingScreen />],
  ['POSServiceDoneScreen', <POSServiceDoneScreen />],
  ['POSCheckoutScreen', <POSCheckoutScreen />],
  ['POSBookingScreen', <POSBookingScreen />],
  ['POSTechQueueScreen', <POSTechQueueScreen />],
  ['POSTechAppointmentsScreen', <POSTechAppointmentsScreen />],
  ['POSTechniciansScreen', <POSTechniciansScreen />],
  ['POSLiveTechnicianScheduleScreen', <POSLiveTechnicianScheduleScreen />],
  ['POSSkillRequestsScreen', <POSSkillRequestsScreen />],
  ['POSServicesScreen', <POSServicesScreen />],
  ['POSCustomersScreen', <POSCustomersScreen />],
  ['POSReportsScreen', <POSReportsScreen />],
  ['POSSettingsScreen', <POSSettingsScreen />],
  ['POSNailShowcaseModerationScreen', <POSNailShowcaseModerationScreen />],
  ['POSFollowUpsScreen', <POSFollowUpsScreen />],
  ['EndOfDayFollowUpSettings', <EndOfDayFollowUpSettings />],
];

describe('pos-web screen mount smoke', () => {
  for (const [name, el] of screens) {
    it(`${name} mounts and renders its initial state without throwing`, () => {
      const { container } = render(<MemoryRouter>{el}</MemoryRouter>);
      expect(container.firstChild).not.toBeNull();
    });
  }
});
