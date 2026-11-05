// QA for Users & Roles (directory row identity; create Super Admin with the ONE-TIME temp-password banner;
// disable/enable via the row ⋯ menu) and the Audit Logs reader (typed filters land in the exact request; clear resets).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  users: vi.fn(), usersDashboard: vi.fn(), roles: vi.fn(), createSuperAdmin: vi.fn(), inviteUser: vi.fn(), resetUserPassword: vi.fn(), setUserRole: vi.fn(), setUserMfa: vi.fn(), resendInvite: vi.fn(), cancelInvite: vi.fn(), userSessions: vi.fn(), revokeSession: vi.fn(), revokeAllUserSessions: vi.fn(), enableUser: vi.fn(), disableUser: vi.fn(), supportSessions: vi.fn(), tenantUsersAndBranches: vi.fn(), assignUserBranch: vi.fn(), revokeUserBranch: vi.fn(),
  auditLogs: vi.fn(), approveAccessRequest: vi.fn().mockResolvedValue({}), cancelInvitationToken: vi.fn().mockResolvedValue({}), createInvitation: vi.fn().mockResolvedValue({}), createScheduledReport: vi.fn().mockResolvedValue({}), deleteScheduledReport: vi.fn().mockResolvedValue({}), exportUsers: vi.fn().mockResolvedValue({}), listAccessRequests: vi.fn().mockResolvedValue({}), listInvitations: vi.fn().mockResolvedValue({}), listScheduledReports: vi.fn().mockResolvedValue({}), rejectAccessRequest: vi.fn().mockResolvedValue({}), resendInvitationToken: vi.fn().mockResolvedValue({}), runScheduledReportNow: vi.fn().mockResolvedValue({}), state: vi.fn().mockResolvedValue({ tenants: [] }), toggleScheduledReport: vi.fn().mockResolvedValue({})   // Sep 2026 redesign's new calls
} }));
vi.mock('../api/superAdminHardwarePackagesApi', () => ({ hwApi: { listTenants: vi.fn().mockResolvedValue([]) } }));
import { superAdminApi } from '../api/superAdminApi';
import { UsersRolesScreen } from './UsersRolesScreen';
import { AuditLogsScreen } from './AuditLogsScreen';

const user = (over: any = {}) => ({ id: 'u1', fullName: 'Kevin Root', email: 'root@aipowersalon.test', role: 'SUPER_ADMIN', status: 'active', mfaEnabled: true, tenantName: null, lastLoginAt: '2026-06-11T09:00:00Z', ...over });
const openRowMenu = async (name: string) => { fireEvent.click(screen.getByLabelText(`Actions for ${name}`)); await screen.findByRole('menu'); };

describe('UsersRolesScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); (superAdminApi.roles as any).mockResolvedValue([]); (superAdminApi.usersDashboard as any).mockResolvedValue(null); });

  it('renders a directory row with the role badge, MFA indicator and email', async () => {
    (superAdminApi.users as any).mockResolvedValue({ rows: [user()], total: 1 });
    render(<MemoryRouter><UsersRolesScreen /></MemoryRouter>);
    expect(await screen.findByText('Kevin Root')).toBeInTheDocument();
    const row = screen.getByText('Kevin Root').closest('tr') as HTMLElement;
    expect(within(row).getByText('Super Admin')).toBeInTheDocument();      // role badge (scoped — avoids the All Roles option)
    expect(within(row).getByText('MFA')).toBeInTheDocument();              // MFA indicator
    expect(screen.getByText(/root@aipowersalon\.test/)).toBeInTheDocument();
  });

  it('creates a Super Admin and shows the temporary password EXACTLY ONCE in the banner', async () => {
    (superAdminApi.users as any).mockResolvedValue({ rows: [], total: 0 });
    (superAdminApi.createSuperAdmin as any).mockResolvedValue({ ok: true, email: 'new@aipowersalon.test', temporaryPassword: 'Tmp-9f3k2m1q' });
    render(<MemoryRouter><UsersRolesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Super Admin' }));   // opener → "Close"
    const createBtn = screen.getByRole('button', { name: 'Create Super Admin' });          // submit
    expect(createBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@aipowersalon.test' } });
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Admin' } });
    expect(createBtn).toBeEnabled();
    fireEvent.click(createBtn);
    await waitFor(() => expect(superAdminApi.createSuperAdmin).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@aipowersalon.test', fullName: 'New Admin' })));
    expect(await screen.findByText(/temporary password: Tmp-9f3k2m1q \(shown once/)).toBeInTheDocument();
  });

  it('disables an active user and enables a suspended one (via the row actions menu)', async () => {
    (superAdminApi.users as any)
      .mockResolvedValueOnce({ rows: [user()], total: 1 })
      .mockResolvedValue({ rows: [user({ status: 'suspended' })], total: 1 });
    (superAdminApi.disableUser as any).mockResolvedValue({ ok: true });
    (superAdminApi.enableUser as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><UsersRolesScreen /></MemoryRouter>);
    await screen.findByText('Kevin Root');
    await openRowMenu('Kevin Root');
    fireEvent.click(screen.getByText('Disable'));
    await waitFor(() => expect(superAdminApi.disableUser).toHaveBeenCalledWith('u1'));
    await openRowMenu('Kevin Root');
    fireEvent.click(await screen.findByText('Enable'));
    await waitFor(() => expect(superAdminApi.enableUser).toHaveBeenCalledWith('u1'));
  });
});

describe('AuditLogsScreen (reader + filters)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends typed filters in the exact request on Apply Filters, and Clear resets them', async () => {
    (superAdminApi.auditLogs as any).mockResolvedValue({ rows: [], total: 0 });
    render(<MemoryRouter><AuditLogsScreen /></MemoryRouter>);
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith({ page: 1, pageSize: 50 }));
    fireEvent.change(screen.getByPlaceholderText('Action contains… (e.g. support_access)'), { target: { value: 'support_access' } });
    fireEvent.change(screen.getByPlaceholderText('Tenant id'), { target: { value: 't-glow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenCalledWith({ action: 'support_access', tenantId: 't-glow', page: 1, pageSize: 50 }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(superAdminApi.auditLogs).toHaveBeenLastCalledWith({ page: 1, pageSize: 50 }));
  });
});
