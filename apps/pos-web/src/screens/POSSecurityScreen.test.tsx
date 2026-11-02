import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSSecurityScreen } from './POSSecurityScreen';
import { posSessionsApi } from '../api/posSessionsApi';
import { posSecurityApi } from '../api/posSecurityApi';

vi.mock('../api/posSecurityApi', () => ({ posSecurityApi: {
  mfaStatus: vi.fn().mockResolvedValue({ enrolled: true, confirmed: true }),
  mfaEnroll: vi.fn(), mfaConfirm: vi.fn(),
  changePassword: vi.fn().mockResolvedValue({ ok: true }),
  // Constitution 3 Step 8 cards (tested in AuthSecurityPanels.test.tsx)
  recoveryCodesRemaining: vi.fn().mockResolvedValue({ remaining: 10 }), generateRecoveryCodes: vi.fn(),
  devices: vi.fn().mockResolvedValue({ devices: [], canTrust: false }), deviceAction: vi.fn(), activity: vi.fn().mockResolvedValue({ events: [] }),
  signInPolicy: vi.fn().mockResolvedValue({ mfaForOwner: false, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, auditRetention: '90d' }), saveSignInPolicy: vi.fn(), connectedApps: vi.fn().mockResolvedValue({ apps: [] }), disconnectApp: vi.fn(),
} }));
vi.mock('../api/posSessionsApi', () => ({ posSessionsApi: {
  list: vi.fn().mockResolvedValue({ sessions: [{ id: 's1', device: 'Chrome on macOS', ip: '10.0.0.5', signedInAt: '2026-05-06T14:21:00Z', status: 'active', active: true }] }),
  revoke: vi.fn().mockResolvedValue({ ok: true, revoked: true }),
  revokeAll: vi.fn().mockResolvedValue({ ok: true, count: 1 }),
} }));
vi.mock('../api/posAuditApi', () => ({ posAuditApi: {
  events: vi.fn().mockResolvedValue({ items: [{ id: 'a1', occurredAt: '2026-05-06T14:21:00Z', actorUserId: 'u1', actorRole: 'OWNER', actorName: 'Sophia Nguyen', module: 'security', action: 'password.updated', resourceType: 'user', summary: 'Account password was changed', status: 'success', severity: 'medium', ip: null, device: null }], pagination: { page: 1, pageSize: 14, totalItems: 1, totalPages: 1 } }),
} }));
vi.mock('../api/client', () => ({ api: { get: vi.fn().mockResolvedValue({ passwordChangedAt: '2026-04-18T00:00:00Z', lastLoginAt: '2026-05-06T14:21:00Z' }), post: vi.fn() } }));

describe('POSSecurityScreen', () => {
  it('renders real 2FA status, a session, password form, and security activity', async () => {
    render(<MemoryRouter><POSSecurityScreen /></MemoryRouter>);
    expect(screen.getByText('Security & Access')).toBeInTheDocument();
    // 2FA enabled (status pill) — there are KPI + card; at least one "Enabled"
    expect(await screen.findAllByText('Enabled')).not.toHaveLength(0);
    // real session row + revoke control
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Revoke')).toBeInTheDocument();
    // password section + security activity (from audit feed)
    expect(screen.getByText('Update Password')).toBeInTheDocument();
    expect(screen.getByText('Password Updated')).toBeInTheDocument();
  });

  it('revokes a session via the real endpoint', async () => {
    render(<MemoryRouter><POSSecurityScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Revoke'));
    await waitFor(() => expect((posSessionsApi.revoke as any)).toHaveBeenCalledWith('s1'));
  });
  // Security Deep Scan C1: replacing a confirmed authenticator sends its CURRENT code (POST /auth/mfa/enroll {currentCode})
  it('Replace authenticator asks for the current code first and sends it with the enroll', async () => {
    (posSecurityApi.mfaEnroll as any).mockReset().mockResolvedValue({ ok: true, secret: 'NEWSECRET', otpauthUri: 'otpauth://x' });
    render(<MemoryRouter><POSSecurityScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Replace authenticator'));
    const box = await screen.findByLabelText('Current code from your existing authenticator');
    expect(screen.getByText('Continue')).toBeDisabled();
    expect(posSecurityApi.mfaEnroll).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(posSecurityApi.mfaEnroll).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('NEWSECRET')).toBeInTheDocument();
  });

  it('a set-up that the server refuses with CURRENT_MFA_REQUIRED opens the current-code step instead of an error', async () => {
    (posSecurityApi.mfaStatus as any).mockResolvedValueOnce({ enrolled: true, confirmed: false });
    (posSecurityApi.mfaEnroll as any).mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('Enter the current 6-digit code from your existing authenticator to replace it.'), { status: 403, code: 'CURRENT_MFA_REQUIRED' }))
      .mockResolvedValue({ ok: true, secret: 'NEWSECRET', otpauthUri: 'otpauth://x' });
    render(<MemoryRouter><POSSecurityScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Enable 2FA'));
    const box = await screen.findByLabelText('Current code from your existing authenticator');
    expect(screen.queryByText(/Could not start 2FA setup/)).toBeNull();
    fireEvent.change(box, { target: { value: '654321' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(posSecurityApi.mfaEnroll).toHaveBeenLastCalledWith('654321'));
    expect(await screen.findByText('NEWSECRET')).toBeInTheDocument();
  });
});
