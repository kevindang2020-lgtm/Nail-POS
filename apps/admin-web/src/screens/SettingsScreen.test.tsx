// QA for the Super Admin Settings (Security) screen: account card, the full MFA enrollment flow (enroll → secret
// shown once → confirm with a live code → active), and the change-password form including the MFA-code requirement
// once a factor is confirmed. All against a mocked authApi — shapes mirror the real /auth endpoints.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/authApi', () => ({ authApi: { mfaStatus: vi.fn(), mfaEnroll: vi.fn(), mfaConfirm: vi.fn(), changePassword: vi.fn() } }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemHealth: vi.fn().mockResolvedValue({ ok: true, database: { ok: true, latencyMs: 9, counts: { tenants: 1, users: 4, activeSubscriptions: 1 } }, process: { uptimeSeconds: 7200, node: 'v20.0.0', env: 'production' } }) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'Kevin Root', role: 'SUPER_ADMIN' }, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));
import { authApi } from '../api/authApi';
import { SettingsScreen } from './SettingsScreen';

describe('SettingsScreen (Security Settings, spec §22)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the account card and a Not enrolled MFA state', async () => {
    (authApi.mfaStatus as any).mockResolvedValue({ enrolled: false, confirmed: false });
    render(<SettingsScreen />);
    expect(await screen.findByText('Kevin Root')).toBeInTheDocument();
    expect(screen.getByText('SUPER_ADMIN')).toBeInTheDocument();
    expect(await screen.findByText('Not enrolled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enroll MFA' })).toBeEnabled();
    expect(await screen.findByText('Operational', { exact: false })).toBeInTheDocument();
  });

  it('runs the full enrollment flow: secret shown once, confirm activates, status reloads', async () => {
    (authApi.mfaStatus as any)
      .mockResolvedValueOnce({ enrolled: false, confirmed: false })
      .mockResolvedValueOnce({ enrolled: true, confirmed: true });
    (authApi.mfaEnroll as any).mockResolvedValue({ ok: true, secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/AIPowerSalon:kevin?secret=JBSWY3DPEHPK3PXP' });
    (authApi.mfaConfirm as any).mockResolvedValue({ ok: true, confirmed: true });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enroll MFA' }));
    const secretBox = await screen.findByLabelText('TOTP secret');
    expect((secretBox as HTMLInputElement).value).toBe('JBSWY3DPEHPK3PXP');
    const confirmBtn = screen.getByRole('button', { name: 'Confirm & Activate' });
    expect(confirmBtn).toBeDisabled(); // needs a 6-digit code first
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(authApi.mfaConfirm).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText(/MFA is active on this account/)).toBeInTheDocument();
    expect(authApi.mfaStatus).toHaveBeenCalledTimes(2); // status reloaded after confirm
  });

  it('changes the password without MFA: button gates on all three fields, body carries no mfaCode', async () => {
    (authApi.mfaStatus as any).mockResolvedValue({ enrolled: false, confirmed: false });
    (authApi.changePassword as any).mockResolvedValue({ ok: true });
    render(<SettingsScreen />);
    const btn = await screen.findByRole('button', { name: 'Change Password' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'Old-Pass-123' } });
    fireEvent.change(screen.getByPlaceholderText('New password (min 10, letters + numbers)'), { target: { value: 'Brand-New-Pass-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-Pass-9' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'Old-Pass-123', newPassword: 'Brand-New-Pass-9', confirmPassword: 'Brand-New-Pass-9', mfaCode: undefined,
    }));
    expect(await screen.findByText(/Password changed\./)).toBeInTheDocument();
  });

  it('requires the MFA code in the password form once a factor is confirmed', async () => {
    (authApi.mfaStatus as any).mockResolvedValue({ enrolled: true, confirmed: true });
    render(<SettingsScreen />);
    expect(await screen.findByText(/MFA is active on this account/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Change Password' });
    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'Old-Pass-123' } });
    fireEvent.change(screen.getByPlaceholderText('New password (min 10, letters + numbers)'), { target: { value: 'Brand-New-Pass-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-Pass-9' } });
    expect(btn).toBeDisabled(); // MFA code still missing
    fireEvent.change(screen.getByPlaceholderText('MFA code'), { target: { value: '654321' } });
    expect(btn).toBeEnabled();
  });

  it('surfaces a backend rejection (e.g. wrong current password) instead of claiming success', async () => {
    (authApi.mfaStatus as any).mockResolvedValue({ enrolled: false, confirmed: false });
    (authApi.changePassword as any).mockRejectedValue(new Error('Current password is incorrect.'));
    render(<SettingsScreen />);
    fireEvent.change(await screen.findByPlaceholderText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByPlaceholderText('New password (min 10, letters + numbers)'), { target: { value: 'Brand-New-Pass-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-Pass-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(await screen.findByText(/Current password is incorrect\./)).toBeInTheDocument();
  });
});
