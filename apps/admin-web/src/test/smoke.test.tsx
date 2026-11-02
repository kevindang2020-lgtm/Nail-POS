// smoke.test.tsx — mount smoke for every routed Super Admin screen. Each renders inside a MemoryRouter (screens use
// react-router navigation + search params) with the fetch client mocked to stay pending, so screens render their
// initial/loading state. Exercises the true render path; fails if any screen throws on mount.
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
import { TenantsScreen } from '../screens/TenantsScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SystemHealthScreen } from '../screens/SystemHealthScreen';
import { ProjectStatusScreen } from '../screens/ProjectStatusScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { ApplicationsScreen } from '../screens/ApplicationsScreen';
import { LeadsScreen } from '../screens/LeadsScreen';
import { HardwareScreen } from '../screens/HardwareScreen';
import { SupportAccessScreen } from '../screens/SupportAccessScreen';
import { AuditLogsScreen } from '../screens/AuditLogsScreen';
import { PaymentGatewaysScreen } from '../screens/PaymentGatewaysScreen';
import { AIPackagesScreen } from '../screens/AIPackagesScreen';
import { UsageLimitsScreen } from '../screens/UsageLimitsScreen';
import { UsersRolesScreen } from '../screens/UsersRolesScreen';
import { SuperAdminOwnersScreen } from '../screens/SuperAdminOwnersScreen';
import { PlatformReportsScreen } from '../screens/PlatformReportsScreen';
import { SuperAdminNailShowcaseModerationScreen } from '../screens/SuperAdminNailShowcaseModerationScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const screens: [string, ReactElement][] = [
  ['LoginScreen', <LoginScreen />],
  ['TenantsScreen', <TenantsScreen />],
  ['DashboardScreen', <DashboardScreen />],
  ['SystemHealthScreen', <SystemHealthScreen />],
  ['ProjectStatusScreen', <ProjectStatusScreen />],
  ['BillingScreen', <BillingScreen />],
  ['ApplicationsScreen', <ApplicationsScreen />],
  ['LeadsScreen', <LeadsScreen />],
  ['HardwareScreen', <HardwareScreen />],
  ['SupportAccessScreen', <SupportAccessScreen />],
  ['AuditLogsScreen', <AuditLogsScreen />],
  ['PaymentGatewaysScreen', <PaymentGatewaysScreen />],
  ['AIPackagesScreen', <AIPackagesScreen />],
  ['UsageLimitsScreen', <UsageLimitsScreen />],
  ['UsersRolesScreen', <UsersRolesScreen />],
  ['SuperAdminOwnersScreen', <SuperAdminOwnersScreen />],
  ['PlatformReportsScreen', <PlatformReportsScreen />],
  ['SuperAdminNailShowcaseModerationScreen', <SuperAdminNailShowcaseModerationScreen />],
  ['SettingsScreen', <SettingsScreen />],
];

describe('admin-web screen mount smoke', () => {
  for (const [name, el] of screens) {
    it(`${name} mounts and renders its initial state without throwing`, () => {
      const { container } = render(<MemoryRouter>{el}</MemoryRouter>);
      expect(container.firstChild).not.toBeNull();
    });
  }
});
