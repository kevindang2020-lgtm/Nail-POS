// Users & Roles · All Users (reference IA). Renders the directory table from /super-admin/platform/users and the
// aggregate from /super-admin/platform/users-dashboard, then exercises the REAL audited routes: invite (role+scope),
// per-row role change / disable / reset password / 2FA / sessions / resend-invite (all via the ⋯ actions menu), and
// branch-access within an active support session. Server-side pagination defaults to 10/page.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  users: vi.fn(), usersDashboard: vi.fn(), roles: vi.fn(), inviteUser: vi.fn(), disableUser: vi.fn(), enableUser: vi.fn(), resetUserPassword: vi.fn(), setUserRole: vi.fn(), setUserMfa: vi.fn(), resendInvite: vi.fn(), cancelInvite: vi.fn(), userSessions: vi.fn(), revokeSession: vi.fn(), revokeAllUserSessions: vi.fn(), supportSessions: vi.fn(), tenantUsersAndBranches: vi.fn(), assignUserBranch: vi.fn(), revokeUserBranch: vi.fn(), approveAccessRequest: vi.fn().mockResolvedValue({}), cancelInvitationToken: vi.fn().mockResolvedValue({}), createInvitation: vi.fn().mockResolvedValue({}), createScheduledReport: vi.fn().mockResolvedValue({}), deleteScheduledReport: vi.fn().mockResolvedValue({}), exportUsers: vi.fn().mockResolvedValue({}), listAccessRequests: vi.fn().mockResolvedValue({}), listInvitations: vi.fn().mockResolvedValue({}), listScheduledReports: vi.fn().mockResolvedValue({}), rejectAccessRequest: vi.fn().mockResolvedValue({}), resendInvitationToken: vi.fn().mockResolvedValue({}), runScheduledReportNow: vi.fn().mockResolvedValue({}), state: vi.fn().mockResolvedValue({ tenants: [{ id: 'tenant-1', n: 'Kim Nails', email: 'kim@salon.com', code: 'KIM01' }] }), toggleScheduledReport: vi.fn().mockResolvedValue({})   // Sep 2026 redesign: invite tenant list (state) and the new session/branch calls
} }));
// the directory's All Tenants filter lazy-loads tenants via hwApi.listTenants — stub it so the screen renders cleanly
vi.mock('../api/superAdminHardwarePackagesApi', () => ({ hwApi: { listTenants: vi.fn().mockResolvedValue([{ id: 't1', name: 'Luxe Nails & Spa', code: 'LUX' }]) } }));

import { superAdminApi } from '../api/superAdminApi';
import { UsersRolesScreen } from './UsersRolesScreen';

const user = (over: any = {}) => ({
  id: 'u1', fullName: 'Emily Johnson', email: 'emily@luxenails.com', role: 'OWNER', status: 'active',
  mfaEnabled: false, tenantName: 'Luxe Nails & Spa', tenantId: 't1', branchName: 'Downtown', branchId: 'b1',
  lastLoginAt: null, assignedDevices: 3, permissionLevel: 'Full Access', ...over,
});

const dashboard = {
  kpis: { totalUsers: 156, activeUsers: 142, admins: 7, managers: 32, staff: 110, pendingInvites: 14, deactivated: 12 },
  kpiCards: [
    { key: 'totalUsers', label: 'Total Users', value: 156, available: true },
    { key: 'activeUsers', label: 'Active Users', value: 142, available: true },
    { key: 'totalRoles', label: 'Total Roles', value: 6, available: true },
    { key: 'pendingInvites', label: 'Pending Invites', value: 14, available: true },
    { key: 'suspended', label: 'Suspended Users', value: 12, available: true },
    { key: 'branchManagers', label: 'Branch Managers', value: 32, available: true },
    { key: 'technicians', label: 'Technicians', value: 110, available: true },
    { key: 'receptionists', label: 'Receptionists', value: 20, available: true },
    { key: 'ownersAdmins', label: 'Owners / Admins', value: 7, available: true },
    { key: 'openAccessRequests', label: 'Open Access Requests', value: null, available: false },
  ],
  roleHealth: [
    { key: 'inactive30d', label: 'Inactive Users (30+ days)', count: 12, severity: 'warn', available: true, to: '/users-roles?status=inactive' },
    { key: 'overPermissioned', label: 'Over-Permissioned Users', count: null, severity: 'critical', available: false, to: '/users-roles' },
    { key: 'suspended', label: 'Suspended Users', count: 12, severity: 'critical', available: true, to: '/users-roles?status=suspended' },
  ],
  rolesDistribution: [{ label: 'Admin', count: 7 }, { label: 'Manager', count: 32 }, { label: 'Staff', count: 110 }, { label: 'Other', count: 7 }],
  permissionLevels: [{ level: 'Full Access', count: 7, pct: 4.8 }, { level: 'Branch Admin', count: 32, pct: 20.5 }, { level: 'Limited Access', count: 110, pct: 70.5 }, { level: 'Basic Access', count: 7, pct: 4.5 }],
  permissions: { total: 86, byCategory: [] },
  branchAllocation: { totalAssignments: 0, rows: [] },
  branchAccess: { totalBranches: 12, branchesWithoutAdmin: 2, byLevel: [{ level: 'owner', count: 5, pct: 41.7 }, { level: 'manager', count: 7, pct: 58.3 }] },
  topTenants: { totalUsers: 156, rows: [{ tenantId: 't1', tenantName: 'Luxe Nails & Spa', users: 80 }] },
  pendingInvitations: { total: 14, rows: [{ tenant: 'Luxe Nails & Spa', branch: 'Downtown', count: 3, lastInvitedAt: '2026-06-28T10:00:00Z' }] },
  growth: [{ month: 'May', count: 12 }],
  growthDaily: { series: [{ label: 'May 01', newUsers: 2, activeUsers: 5 }, { label: 'May 02', newUsers: 3, activeUsers: 6 }], newUsersThisMonth: 12 },
  recentActivity: [{ action: 'user_deactivated', entityType: 'user', actorName: 'Admin', actorRole: 'SUPER_ADMIN', at: '2026-06-20T10:00:00Z' }],
  accessAlerts: [], mfaAdoptionPct: 64.1, securityScore: null, avgLoginTime: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.users as any).mockResolvedValue({ rows: [user()], total: 73 });
  (superAdminApi.roles as any).mockResolvedValue({ SUPER_ADMIN: ['*'], OWNER: ['tenant.view'] });
  (superAdminApi.usersDashboard as any).mockResolvedValue(dashboard);
  (superAdminApi.disableUser as any).mockResolvedValue({ id: 'u1', status: 'suspended' });
  (superAdminApi.enableUser as any).mockResolvedValue({ id: 'u1', status: 'active' });
  // Security Deep Scan C2/C3: no temporary password ever comes back — resets name the channel + a MASKED destination,
  // invites are the secure single-use invitation
  (superAdminApi.resetUserPassword as any).mockResolvedValue({ ok: true, id: 'u1', delivery: 'email', sentTo: 'e***@luxenails.com', expiresAt: '2026-10-23T20:00:00Z' });
  (superAdminApi.inviteUser as any).mockResolvedValue({ id: 'inv-1', status: 'pending', reused: false, email: 'new.manager@salon.com', role: 'MANAGER', tokenPrefix: 'abcd', expiresAt: '2026-10-30T00:00:00Z', deliveryStatus: 'sent' });
  (superAdminApi.createInvitation as any).mockResolvedValue({ id: 'inv-2', status: 'pending', reused: false, email: 'new@aipowersalon.com', role: 'SUPER_ADMIN', tokenPrefix: 'efgh', expiresAt: '2026-10-30T00:00:00Z', deliveryStatus: 'sent' });
  (superAdminApi.supportSessions as any).mockResolvedValue([{ id: 'sess-1', tenant_id: 't1-uuid-aaaa', reason: 'support', expires_at: new Date(Date.now() + 3600_000).toISOString(), ended_at: null }]);
  (superAdminApi.tenantUsersAndBranches as any).mockResolvedValue({ tenantName: 'Luxe Nails & Spa', users: [{ id: 'u1', fullName: 'Emily Johnson', email: 'emily@luxenails.com', role: 'OWNER' }], branches: [{ id: 'b1', name: 'Downtown Branch' }] });
  (superAdminApi.assignUserBranch as any).mockResolvedValue({ ok: true, userId: 'u1', branchId: 'b1', accessLevel: 'manager' });
  (superAdminApi.revokeUserBranch as any).mockResolvedValue({ ok: true, userId: 'u1', branchId: 'b1', removed: 1 });
  (superAdminApi.setUserRole as any).mockResolvedValue({ id: 'u1', before: 'OWNER', after: 'MANAGER' });
  (superAdminApi.setUserMfa as any).mockResolvedValue({ id: 'u1', mfaEnabled: true, changed: true });
  (superAdminApi.resendInvite as any).mockResolvedValue({ ok: true, id: 'u9', email: 'pending@salon.com', delivery: 'sms', sentTo: '***1234', expiresAt: '2026-10-23T20:00:00Z' });
  (superAdminApi.cancelInvite as any).mockResolvedValue({ id: 'u9', status: 'inactive' });
  (superAdminApi.userSessions as any).mockResolvedValue([{ id: 's1', deviceId: 'iPad', ipAddress: '10.0.0.2', userAgent: 'Safari', createdAt: '2026-06-24T10:00:00Z', expiresAt: '2026-07-24T10:00:00Z' }]);
  (superAdminApi.revokeSession as any).mockResolvedValue({ sessionId: 's1', revoked: true });
  (superAdminApi.revokeAllUserSessions as any).mockResolvedValue({ userId: 'u1', revoked: 1 });
});

const renderScreen = () => render(<MemoryRouter><UsersRolesScreen /></MemoryRouter>);
const openRowMenu = async (name: string) => { fireEvent.click(screen.getByLabelText(`Actions for ${name}`)); await screen.findByRole('menu'); };

describe('UsersRolesScreen (reference IA)', () => {
  it('renders the 10 KPI cards, directory row, and the reference analytics panels with honest gaps', async () => {
    renderScreen();
    expect(await screen.findByText(/Emily Johnson/)).toBeInTheDocument();
    expect(screen.getAllByText('Total Users').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('All Users Directory')).toBeInTheDocument();
    expect(screen.getByText('Role Health & Alerts')).toBeInTheDocument();
    expect(screen.getByText('Role Distribution')).toBeInTheDocument();
    expect(screen.getByText('Permissions Overview')).toBeInTheDocument();
    expect(screen.getByText('User Growth Trend')).toBeInTheDocument();
    expect(screen.getByText('Top Tenants by Users')).toBeInTheDocument();   // Sep 2026 redesign title
    expect(screen.getByText('Branch Access Overview')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // honest gaps must be surfaced (Open Access Requests unavailable + the no-fabricated-trend note)
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(1);
  });

  it('requests the directory server-side at the default 10/page', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await waitFor(() => expect(superAdminApi.users).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 })));
    expect(screen.getByText(/1–10 of 73/)).toBeInTheDocument();
  });

  it('filters by role through the All Roles dropdown (server-side)', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    fireEvent.change(screen.getByLabelText('All Roles'), { target: { value: 'SUPER_ADMIN' } });
    await waitFor(() => expect(superAdminApi.users).toHaveBeenCalledWith(expect.objectContaining({ role: 'SUPER_ADMIN', page: 1 })));
  });

  it('adds a user (role + scope) through the secure invitation — no temporary password is set or shown', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    fireEvent.click(screen.getByText('+ Add User'));
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new.manager@salon.com' } });
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Manager' } });
    // Sep 2026 redesign: the tenant is CHOSEN from the list (no free-text ID); the list comes from the platform state
    fireEvent.change(await screen.findByLabelText('Select Tenant (required)'), { target: { value: 'tenant-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));
    await waitFor(() => expect(superAdminApi.inviteUser as any).toHaveBeenCalledWith(expect.objectContaining({ email: 'new.manager@salon.com', role: 'MANAGER', tenantId: 'tenant-1' })));
    expect(await screen.findByText(/Secure invite created for new\.manager@salon\.com · delivery: sent/)).toBeInTheDocument();
    expect(screen.queryByText(/temporary password:/i)).toBeNull();
  });

  it('a Super Admin invite needs the platform role it will hold and sends it (C3)', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    fireEvent.click(screen.getByText('+ Add User'));
    fireEvent.change(screen.getByLabelText('Invite role'), { target: { value: 'SUPER_ADMIN' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ops@aipowersalon.com' } });
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Ops Person' } });
    const send = screen.getByRole('button', { name: 'Send Invitation' });
    expect(send).toBeDisabled();                                                           // no platform role yet
    fireEvent.change(screen.getByLabelText('Platform role'), { target: { value: 'PLATFORM_SUPPORT' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(superAdminApi.inviteUser as any).toHaveBeenCalledWith(expect.objectContaining({ email: 'ops@aipowersalon.com', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT', tenantId: null })));
  });

  it('changes a user role from the row actions menu and surfaces the before→after audit line', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await openRowMenu('Emily Johnson');
    fireEvent.change(screen.getByLabelText(/Change role for Emily Johnson/i), { target: { value: 'MANAGER' } });
    await waitFor(() => expect(superAdminApi.setUserRole as any).toHaveBeenCalledWith('u1', 'MANAGER'));
    expect(await screen.findByText(/role changed OWNER → MANAGER/i)).toBeInTheDocument();
  });

  it('requires 2FA on a user from the row actions menu, audited', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await openRowMenu('Emily Johnson');
    fireEvent.click(screen.getByText('Require 2FA'));
    await waitFor(() => expect(superAdminApi.setUserMfa as any).toHaveBeenCalledWith('u1', true));
    expect(await screen.findByText(/2FA required \(audited\)/i)).toBeInTheDocument();
  });

  it('disables an active user via the real route', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await openRowMenu('Emily Johnson');
    fireEvent.click(screen.getByText('Disable'));
    await waitFor(() => expect(superAdminApi.disableUser).toHaveBeenCalledWith('u1'));
  });

  it('resets a user password with a reason; the screen shows only where it was sent (C2)', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await openRowMenu('Emily Johnson');
    fireEvent.click(screen.getByText('Reset Password'));
    const box = await screen.findByRole('group', { name: /Why are you resetting the password for Emily Johnson/ });
    const input = box.querySelector('input, textarea') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Reset password' }));
    expect(await within(box).findByText(/at least 10 characters/)).toBeInTheDocument();     // too short: nothing sent
    expect(superAdminApi.resetUserPassword).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Owner called in, verified by callback' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(superAdminApi.resetUserPassword).toHaveBeenCalledWith('u1', { reason: 'Owner called in, verified by callback' }));
    expect(await screen.findByText(/Temporary password sent by email to e\*\*\*@luxenails\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Tmp-/)).toBeNull();
  });

  it('resends a pending invite — the new temporary password goes to the invitee, the screen shows only where (C2)', async () => {
    (superAdminApi.users as any).mockResolvedValue({ rows: [user({ id: 'u9', fullName: 'Pending Person', email: 'pending@salon.com', role: 'MANAGER', status: 'invited' })], total: 1 });
    renderScreen();
    await screen.findByText(/Pending Person/);
    await openRowMenu('Pending Person');
    fireEvent.click(screen.getByText('Resend Invite'));
    await waitFor(() => expect(superAdminApi.resendInvite as any).toHaveBeenCalledWith('u9'));
    expect(await screen.findByText(/invite resent · Temporary password sent by text message to \*\*\*1234/)).toBeInTheDocument();
  });

  it('lists active sessions and revokes them all, audited', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    await openRowMenu('Emily Johnson');
    fireEvent.click(screen.getByText('Sessions'));
    expect(await screen.findByRole('dialog', { name: /active sessions/i })).toBeInTheDocument();
    await waitFor(() => expect(superAdminApi.userSessions as any).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText(/iPad/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Revoke all sessions'));
    await waitFor(() => expect(superAdminApi.revokeAllUserSessions as any).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText(/session\(s\) revoked \(audited\)/i)).toBeInTheDocument();
  });

  it('assigns branch access through an active support session, gated and audited', async () => {
    const { findByText, getByText, findByRole } = renderScreen();
    await findByText(/Emily Johnson/);
    fireEvent.click(getByText('Branch Access'));
    const dialog = await findByRole('dialog', { name: /branch access/i });
    expect((getByText('Assign') as HTMLButtonElement).disabled).toBe(true);
    const sel = dialog.querySelectorAll('select');
    fireEvent.change(sel[0], { target: { value: 'sess-1' } });
    expect(await within(dialog).findByText(/Luxe Nails/)).toBeInTheDocument();
    const after = dialog.querySelectorAll('select');
    fireEvent.change(after[1], { target: { value: 'u1' } });
    fireEvent.change(after[2], { target: { value: 'b1' } });
    fireEvent.change(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'granting branch access for support' } });
    fireEvent.click(getByText('Assign'));
    await waitFor(() => expect(superAdminApi.assignUserBranch as any).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1', userId: 'u1', branchId: 'b1', accessLevel: 'manager' })));
    expect(await screen.findByText(/Branch access granted/i)).toBeInTheDocument();
  });

  it('opens the Permission Matrix showing the live RBAC role→permission catalog (read-only, custom roles not connected)', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    fireEvent.click(screen.getByText('Permission Matrix'));
    const dialog = await screen.findByRole('dialog', { name: /permission matrix/i });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText(/Custom-role creation/i)).toBeInTheDocument();
  });

  it('"Create Super Admin" invites the person with a platform role — no account with a password is minted (C3)', async () => {
    renderScreen();
    await screen.findByText(/Emily Johnson/);
    fireEvent.click(screen.getByText('Create Super Admin'));               // opener
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@aipowersalon.com' } });
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Admin' } });
    const submit = screen.getByRole('button', { name: 'Invite Super Admin' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Platform role'), { target: { value: 'PLATFORM_AUDITOR' } });
    fireEvent.click(submit);
    await waitFor(() => expect(superAdminApi.createInvitation).toHaveBeenCalledWith({ email: 'new@aipowersalon.com', fullName: 'New Admin', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_AUDITOR', tenantId: null }));
    expect(await screen.findByText(/Secure invite created for new@aipowersalon\.com/)).toBeInTheDocument();
  });
});
