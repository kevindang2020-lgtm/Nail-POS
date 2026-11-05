// smoke.test.tsx — mount smoke for every owner screen. Each renders inside the real OwnerNavProvider + OwnerBranchProvider
// with the fetch client mocked to stay pending, so screens render their initial/loading state. Exercises the true render
// path (imports, hooks, provider wiring, effect setup) and fails loudly if any screen throws on mount.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { OwnerNavProvider } from '../shell/nav';
import { OwnerBranchProvider } from '../shell/OwnerBranchContext';

vi.mock('../api/client', () => {
  const pending = () => new Promise(() => {}); // never resolves → screens stay in their initial state
  const t = { get: pending, post: pending, put: pending, patch: pending, del: pending, upload: pending, request: pending, apiUrl: (p: string) => p, apiBase: () => '' };
  return { api: t, transport: t, apiBase: () => '' };
});

import { AlertsScreen } from '../screens/AlertsScreen';
import { AuditScreen } from '../screens/AuditScreen';
import { BookingOverviewScreen } from '../screens/BookingOverviewScreen';
import { BranchPerformanceScreen } from '../screens/BranchPerformanceScreen';
import { ExpensesScreen } from '../screens/ExpensesScreen';
import { FinanceReportsScreen } from '../screens/FinanceReportsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { OwnerHomeScreen } from '../screens/OwnerHomeScreen';
import { StaffPerformanceScreen } from '../screens/StaffPerformanceScreen';
import { TechnicianDetailScreen } from '../screens/TechnicianDetailScreen';

const screens: [string, ReactElement][] = [
  ['AlertsScreen', <AlertsScreen />],
  ['AuditScreen', <AuditScreen />],
  ['BookingOverviewScreen', <BookingOverviewScreen />],
  ['BranchPerformanceScreen', <BranchPerformanceScreen />],
  ['ExpensesScreen', <ExpensesScreen />],
  ['FinanceReportsScreen', <FinanceReportsScreen />],
  ['LoginScreen', <LoginScreen />],
  ['MoreScreen', <MoreScreen />],
  ['OwnerHomeScreen', <OwnerHomeScreen />],
  ['StaffPerformanceScreen', <StaffPerformanceScreen />],
  ['TechnicianDetailScreen', <TechnicianDetailScreen technicianId="x1" />],
];

describe('owner-web screen mount smoke', () => {
  for (const [name, el] of screens) {
    it(`${name} mounts and renders its initial state without throwing`, () => {
      const { container } = render(<OwnerNavProvider><OwnerBranchProvider>{el}</OwnerBranchProvider></OwnerNavProvider>);
      expect(container.firstChild).not.toBeNull();
    });
  }
});
