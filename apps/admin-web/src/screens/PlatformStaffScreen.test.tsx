import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { platformStaff: vi.fn(), changePlatformRole: vi.fn(), setPlatformUserStatus: vi.fn(), platformUserSessions: vi.fn(), revokePlatformUserSessions: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { PlatformStaffScreen } from './PlatformStaffScreen';

const rows = [
  { userId: 'u1', email: 'kevin@platform.test', fullName: 'Kevin', platformRole: 'PLATFORM_SUPER_ADMIN', status: 'active', lastLoginAt: null },
  { userId: 'u2', email: 'amy@platform.test', fullName: 'Amy', platformRole: 'PLATFORM_SUPPORT', status: 'active', lastLoginAt: null },
  { userId: 'u3', email: 'x@platform.test', fullName: null, platformRole: null, status: 'active', lastLoginAt: null },
];

describe('Platform Staff (Constitution 7 §24–§26)', () => {
  beforeEach(() => { vi.clearAllMocks(); (superAdminApi.platformStaff as any).mockResolvedValue({ rows }); });

  it('lists platform accounts with their roles; a missing role reads as read-only, not as a role', async () => {
    render(<PlatformStaffScreen />);
    const panel = await screen.findByTestId('platform-staff');
    await waitFor(() => expect(within(panel).getByText('Amy')).toBeInTheDocument());
    expect(within(panel).getByText('Support')).toBeInTheDocument();
    expect(within(panel).getByText('Not set (read-only)')).toBeInTheDocument();
  });

  it('changing a role needs a reason, sends it, and says the sessions were signed out', async () => {
    (superAdminApi.changePlatformRole as any).mockResolvedValue({ ok: true, userId: 'u2', from: 'PLATFORM_SUPPORT', to: 'PLATFORM_FINANCE', sessionsRevoked: true });
    render(<PlatformStaffScreen />);
    await screen.findByText('Amy');
    fireEvent.click(screen.getAllByText('Change role')[1]);
    const editor = screen.getByTestId('role-editor');
    fireEvent.change(within(editor).getByLabelText('New role'), { target: { value: 'PLATFORM_FINANCE' } });
    const save = within(editor).getByRole('button', { name: 'Change role' });
    expect(save).toBeDisabled();                                                   // no reason yet
    fireEvent.change(within(editor).getByLabelText('Reason'), { target: { value: 'moved to the finance team' } });
    fireEvent.click(save);
    await waitFor(() => expect(superAdminApi.changePlatformRole).toHaveBeenCalledWith('u2', 'PLATFORM_FINANCE', 'moved to the finance team'));
    expect(await screen.findByText(/signed out so it applies on next sign-in/)).toBeInTheDocument();
  });

  it("shows the server's refusal verbatim (e.g. the last Platform Super Admin)", async () => {
    (superAdminApi.changePlatformRole as any).mockRejectedValue(new Error('This is the last active Platform Super Admin. Make another account Platform Super Admin first.'));
    render(<PlatformStaffScreen />);
    await screen.findByText('Kevin');
    fireEvent.click(screen.getAllByText('Change role')[0]);
    const editor = screen.getByTestId('role-editor');
    fireEvent.change(within(editor).getByLabelText('New role'), { target: { value: 'PLATFORM_ADMIN' } });
    fireEvent.change(within(editor).getByLabelText('Reason'), { target: { value: 'handing over full control' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Change role' }));
    expect(await screen.findByText(/last active Platform Super Admin/)).toBeInTheDocument();
  });
  it('§24: suspending needs a reason and sends it; Sessions lists them and "Sign out all sessions" revokes with a reason', async () => {
    (superAdminApi.setPlatformUserStatus as any).mockResolvedValue({ ok: true, from: 'active', to: 'suspended' });
    (superAdminApi.platformUserSessions as any).mockResolvedValue({ rows: [{ id: 's1', status: 'active', createdAt: '2026-09-28T09:00:00Z', expiresAt: null, revokedAt: null, lastSeenAt: null, ip: '10.0.0.1', userAgent: 'Safari', device: null }] });
    (superAdminApi.revokePlatformUserSessions as any).mockResolvedValue({ ok: true, revoked: 1 });
    render(<PlatformStaffScreen />);
    await screen.findByText('Amy');
    fireEvent.click(screen.getAllByText('Suspend')[1]);
    const act = screen.getByTestId('staff-action');
    expect((within(act).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(act).getByLabelText('Action reason'), { target: { value: 'left the company today' } });
    fireEvent.click(within(act).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(superAdminApi.setPlatformUserStatus).toHaveBeenCalledWith('u2', 'suspended', 'left the company today'));
    fireEvent.click(screen.getAllByText('Sessions')[1]);
    const panel = await screen.findByTestId('staff-sessions');
    expect(within(panel).getByText('10.0.0.1')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Sign out all sessions' }));
    fireEvent.change(within(screen.getByTestId('staff-action')).getByLabelText('Action reason'), { target: { value: 'suspicious sign-in from abroad' } });
    fireEvent.click(within(screen.getByTestId('staff-action')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(superAdminApi.revokePlatformUserSessions).toHaveBeenCalledWith('u2', 'suspicious sign-in from abroad'));
  });
});
