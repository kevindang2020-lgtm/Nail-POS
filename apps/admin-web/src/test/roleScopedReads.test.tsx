// roleScopedReads.test.tsx — SCAN (Oct 12 2026). The real-browser run of every Super Admin route as each platform role
// recorded the reads a screen made that its role is refused (403 + a console error, every visit). Each screen now skips
// the read its role cannot make. Every call goes through the one client, so the test records the paths requested: as a
// narrow role the refused reads are absent, and as a full role they are present (so the check can never go vacuous).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const asked: string[] = [];
vi.mock('../api/client', async (orig) => {
  const actual = await orig<typeof import('../api/client')>();
  const pending = (p: string) => { asked.push(p); return new Promise(() => {}); };
  return { ...actual, api: { ...actual.api, get: pending, post: pending, patch: pending, put: pending, del: pending, getText: pending, getBlob: pending, exportAsync: pending } };
});
let perms: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'R', permissions: perms }, logout: vi.fn(), loading: false }) }));

import { ApplicationsScreen } from '../screens/ApplicationsScreen';
import { BranchesScreen } from '../screens/BranchesScreen';
import MessagingReadinessScreen from '../screens/MessagingReadinessScreen';
import AiReceptionistScreen from '../screens/AiReceptionistScreen';
import { CustomerDataOversightScreen } from '../screens/CustomerDataOversightScreen';
import { UsersRolesScreen } from '../screens/UsersRolesScreen';
import { TenantsScreen } from '../screens/TenantsScreen';
import SmsVerificationPackagesScreen from '../screens/SmsVerificationPackagesScreen';
import { LiveOperationsScreen } from '../screens/LiveOperationsScreen';

const ALL = ['super_admin.analytics.view', 'super_admin.tenants.view', 'super_admin.users.view', 'super_admin.onboarding.view', 'super_admin.applications.view',
  'super_admin.communications.view', 'super_admin.ai.view', 'super_admin.customers.view', 'super_admin.customer_sync.review', 'super_admin.billing.view',
  'super_admin.plans.view', 'super_admin.system_operations.view', 'super_admin.support.view', 'super_admin.sms_packages.view', 'super_admin.sms_tenant_plan.view',
  'super_admin.sms_usage.view', 'super_admin.sms_billing.view'];
const cases: [string, ReactElement, string[], string[]][] = [
  // screen, element, the narrow role's keys, the reads that role must not make
  ['Applications', <ApplicationsScreen />, ['super_admin.onboarding.view'], ['/super-admin/platform/applications/metrics']],
  ['Branches', <BranchesScreen />, ['super_admin.tenants.view'], ['/super-admin/platform/branches-dashboard']],
  ['Messaging environment', <MessagingReadinessScreen />, ['super_admin.communications.view'], ['/super-admin/ai/readiness']],
  ['AI receptionist', <AiReceptionistScreen />, ['super_admin.ai.view'], ['/super-admin/voice/fleet', '/super-admin/voice/provisioning-metrics']],
  ['Customer data', <CustomerDataOversightScreen />, ['super_admin.customers.view'], ['/super-admin/customer-data-oversight/sync/conflicts']],
  ['Users & roles', <UsersRolesScreen />, ['super_admin.users.view'], ['/super-admin/platform/users-dashboard', '/super-admin/hardware-packages/tenants']],
  ['Tenants', <TenantsScreen />, ['super_admin.tenants.view'], ['/super-admin/overview/state', '/super-admin/platform/top-performing-tenants']],
  // run 2: a billing admin got an ERROR PAGE here — one refused read failed the screen's Promise.all
  ['SMS packages', <SmsVerificationPackagesScreen />, ['super_admin.sms_packages.view', 'super_admin.sms_tenant_plan.view'], ['/super-admin/sms-tenant-plan/reconciliation/findings', '/super-admin/sms-tenant-plan/billing/analytics', '/super-admin/sms-tenant-plan/billing/charges']],
  ['Live operations', <LiveOperationsScreen />, ['super_admin.analytics.view'], ['/super-admin/system-health']],
];
const hit = (p: string) => asked.some((a) => a.split('?')[0].startsWith(p));
beforeEach(() => { asked.length = 0; });

describe('screens skip the reads their platform role is refused', () => {
  for (const [name, el, narrow, refused] of cases) {
    it(`${name}: a narrow role does not ask; a full role does`, async () => {
      perms = narrow;
      const a = render(<MemoryRouter>{el}</MemoryRouter>); await new Promise((r) => setTimeout(r, 30)); a.unmount();
      expect(refused.filter(hit)).toEqual([]);
      asked.length = 0; perms = ALL;
      const b = render(<MemoryRouter>{el}</MemoryRouter>); await new Promise((r) => setTimeout(r, 30)); b.unmount();
      expect(refused.filter((p) => !hit(p))).toEqual([]);
    });
  }
});
