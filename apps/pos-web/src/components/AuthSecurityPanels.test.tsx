// AuthSecurityPanels.test.tsx — Constitution 3 Step 8: the Security screen's recovery codes, devices and sign-in activity.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = { recoveryCodesRemaining: vi.fn(), generateRecoveryCodes: vi.fn(), devices: vi.fn(), deviceAction: vi.fn(), activity: vi.fn() };
vi.mock('../api/posSecurityApi', () => ({ posSecurityApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => (api as any)[k](...a) }) }));
import { RecoveryCodesCard, DevicesCard, SignInActivityCard } from './AuthSecurityPanels';
beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('Recovery codes', () => {
  it('without two-factor it explains instead of offering codes', () => {
    render(<RecoveryCodesCard mfaConfirmed={false} />);
    expect(screen.getByText(/Turn on two-factor authentication first/)).toBeInTheDocument();
    expect(api.recoveryCodesRemaining).not.toHaveBeenCalled();
  });
  it('shows how many are left; creating new ones needs the authenticator code and shows them once', async () => {
    api.recoveryCodesRemaining.mockResolvedValue({ remaining: 2 });
    api.generateRecoveryCodes.mockResolvedValue({ ok: true, codes: ['ABCD-EFGH', 'JKLM-NPQR'] });
    render(<RecoveryCodesCard mfaConfirmed />);
    expect(await screen.findByText('2 left')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Create new codes' }); expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Authenticator code for recovery codes'), { target: { value: '12a3456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create new codes' }));
    await waitFor(() => expect(api.generateRecoveryCodes).toHaveBeenCalledWith('123456'));
    expect(await screen.findByTestId('recovery-codes')).toHaveTextContent('ABCD-EFGH');
    fireEvent.click(screen.getByText('I have saved them'));
    expect(screen.queryByTestId('recovery-codes')).toBeNull();
  });
  it('a wrong code shows the server reason', async () => {
    api.recoveryCodesRemaining.mockResolvedValue({ remaining: 0 });
    api.generateRecoveryCodes.mockRejectedValue(new Error('Enter the current 6-digit code from your authenticator.'));
    render(<RecoveryCodesCard mfaConfirmed />);
    fireEvent.change(await screen.findByLabelText('Authenticator code for recovery codes'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create recovery codes' }));
    expect(await screen.findByText(/current 6-digit code/)).toBeInTheDocument();
  });
});

describe('Devices', () => {
  const dev = (o: any) => ({ id: 'd', name: 'Chrome on Mac', platform: 'web', trustState: 'recognized', trustedUntil: null, lastSeenAt: '2026-10-03T20:00:00Z', signInCount: 2, current: false, ...o });
  it('this device cannot be signed out or blocked from here; another can; Trust appears only when the session may trust', async () => {
    api.devices.mockResolvedValue({ devices: [dev({ id: 'me', name: 'Edge on Windows', current: true }), dev({ id: 'mac' })], canTrust: false });
    render(<DevicesCard />);
    expect(await screen.findByText('Edge on Windows · this device')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Trust' })).toBeNull();
    expect(screen.getByText(/needs a sign-in that used your authenticator/)).toBeInTheDocument();
  });
  it('blocking calls the server, reports the sessions ended, and reloads; a blocked device offers Unblock', async () => {
    api.devices.mockResolvedValueOnce({ devices: [dev({ id: 'mac' })], canTrust: true }).mockResolvedValueOnce({ devices: [dev({ id: 'mac', trustState: 'blocked' })], canTrust: true });
    api.deviceAction.mockResolvedValue({ ok: true, sessionsEnded: 2 });
    render(<DevicesCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
    await waitFor(() => expect(api.deviceAction).toHaveBeenCalledWith('mac', 'block'));
    expect(await screen.findByText('2 sessions on that device signed out.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
  });
});

describe('Sign-in activity', () => {
  it('readable labels; failures marked', async () => {
    api.activity.mockResolvedValue({ events: [{ type: 'LOGIN_FAILED', outcome: 'failure', occurredAt: '2026-10-03T20:00:00Z', ip: '10.0.0.1', reason: 'invalid_credentials' }, { type: 'STEP_UP_SUCCEEDED', outcome: 'success', occurredAt: '2026-10-03T20:05:00Z', ip: null, reason: null }] });
    render(<SignInActivityCard />);
    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument();
    expect(screen.getByText('Confirmed password')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

describe('Sign-in policy (owners)', () => {
  it('shows the four enforced switches; toggling saves the whole policy and confirms', async () => {
    const pol = { mfaForOwner: false, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, auditRetention: '90d' };
    (api as any).signInPolicy = vi.fn().mockResolvedValue(pol);
    (api as any).saveSignInPolicy = vi.fn().mockResolvedValue({ ...pol, mfaForOwner: true });
    const { SignInPolicyCard } = await import('./AuthSecurityPanels');
    render(<SignInPolicyCard />);
    const box = await screen.findByLabelText('Require two-factor for owners and managers');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect((api as any).saveSignInPolicy).toHaveBeenCalledWith({ ...pol, mfaForOwner: true }));
    expect(await screen.findByText(/Saved\. It applies to new sign-ins/)).toBeInTheDocument();
    expect(screen.getByLabelText('Require two-factor for owners and managers')).toBeChecked();
  });
});

// Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8 hours
// locked." The owner's control for the salon's value lives with the other enforced sign-in switches.
describe('Sign-in policy — POS auto-lock (owners)', () => {
  it('shows on / 60 for a salon that never chose; the owner picks another time or switches it off; each saves the policy', async () => {
    const pol = { mfaForOwner: false, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, auditRetention: '90d' };   // saved before Oct 12
    (api as any).signInPolicy = vi.fn().mockResolvedValue(pol);
    (api as any).saveSignInPolicy = vi.fn(async (p: any) => p);
    const { SignInPolicyCard } = await import('./AuthSecurityPanels');
    render(<SignInPolicyCard />);
    const on = await screen.findByLabelText('Lock POS devices automatically');
    expect(on).toBeChecked();
    const sel = screen.getByLabelText('Lock POS devices after') as HTMLSelectElement;
    expect(sel.value).toBe('60');
    expect([...sel.options].map((o) => Number(o.value))).toEqual([5, 10, 15, 30, 60, 120]);
    fireEvent.change(sel, { target: { value: '30' } });
    await waitFor(() => expect((api as any).saveSignInPolicy).toHaveBeenCalledWith(expect.objectContaining({ autoLockEnabled: true, autoLockMinutes: 30 })));
    fireEvent.click(screen.getByLabelText('Lock POS devices automatically'));
    await waitFor(() => expect((api as any).saveSignInPolicy).toHaveBeenLastCalledWith(expect.objectContaining({ autoLockEnabled: false, autoLockMinutes: 30 })));
    expect(screen.getByText(/after 8 hours locked/)).toBeInTheDocument();
  });
});
