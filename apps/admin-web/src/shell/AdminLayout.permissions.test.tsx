// AdminLayout.permissions.test.tsx — SCAN (Oct 12 2026), found by the real-browser run of every Super Admin route as each
// platform role: the shell polled /platform/state (analytics.view), /alerts/unread-count and /system-health
// (system_operations.view) for EVERY signed-in role, so a PLATFORM_SUPPORT user got three 403s on every page, every minute.
// The shell now asks only for what the role may read; and "/" lands on the first destination the role can open
// instead of /dashboard (analytics.view), which a support / onboarding role cannot read.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let perms: string[] = [];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'Sam Support', permissions: perms }, logout: vi.fn(), loading: false }) }));
const platformState = vi.fn(() => Promise.resolve({ counts: { newApplications: 0, newLeads: 0, hardwarePending: 0, activeSupportSessions: 2 } }));
const alertsUnreadCount = vi.fn(() => Promise.resolve(0));
const systemHealth = vi.fn(() => Promise.resolve({ ok: true, database: { ok: true }, gateway: { ok: true } }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { platformState: () => platformState(), alertsUnreadCount: () => alertsUnreadCount(), systemHealth: () => systemHealth() } }));

import { AdminLayout } from './AdminLayout';
import { landingPath } from './navPermissions';

const mount = () => render(<MemoryRouter initialEntries={['/support-access']}><Routes><Route path="/" element={<AdminLayout />}><Route path="support-access" element={<div>support</div>} /></Route></Routes></MemoryRouter>);
beforeEach(() => { platformState.mockClear(); alertsUnreadCount.mockClear(); systemHealth.mockClear(); });

describe('Super Admin shell asks only for what the role may read', () => {
  it('a support-only role triggers none of the analytics / system-operations polls', async () => {
    perms = ['super_admin.support.view'];
    mount();
    expect(await screen.findByText('support')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(platformState).not.toHaveBeenCalled();
    expect(alertsUnreadCount).not.toHaveBeenCalled();
    expect(systemHealth).not.toHaveBeenCalled();
  });
  it('a role holding the keys still gets its badges and health', async () => {
    perms = ['super_admin.support.view', 'super_admin.analytics.view', 'super_admin.system_operations.view'];
    mount();
    await waitFor(() => expect(platformState).toHaveBeenCalledTimes(1));
    expect(alertsUnreadCount).toHaveBeenCalledTimes(1);
    expect(systemHealth).toHaveBeenCalledTimes(1);
  });
  it('"/" lands on the first destination the role can open', () => {
    expect(landingPath(['super_admin.analytics.view', 'super_admin.support.view'])).toBe('/dashboard');
    expect(landingPath(['super_admin.support.view'])).toBe('/support-access');
    expect(landingPath(['super_admin.onboarding.view'])).toMatch(/^\/(onboarding|tenant-applications|website-leads)/);
    expect(landingPath([])).toBe('/account');
  });
});
