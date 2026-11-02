import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountScreen } from './AccountScreen';

vi.mock('../api/authApi', () => ({ authApi: { me: vi.fn(), logout: vi.fn() } }));
vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { readiness: vi.fn(), capability: vi.fn(), disableDevice: vi.fn(), myDevices: vi.fn(), approveDevice: vi.fn(), revokeDevice: vi.fn() } }));
import { authApi } from '../api/authApi';
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const principal = { userId: 'u_owner', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: [], fullName: 'Dana Owner' };

describe('AccountScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authApi.logout as any).mockResolvedValue({ ok: true });
    (mobileCheckoutApi.myDevices as any).mockResolvedValue([]);
    (mobileCheckoutApi.capability as any).mockResolvedValue({ provider: 'fiserv', state: 'setup_required', reason: 'Fiserv Tap to Pay merchant enrollment is not complete.', environment: 'sandbox', capabilities: {} });
  });

  it('shows the signed-in principal, role, and honest payment readiness', async () => {
    (authApi.me as any).mockResolvedValue(principal);
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'tap_to_pay_setup_required', canTakePayment: false, checks: [], processor: 'cardpointe', tapToPayConfigured: false });
    render(<AccountScreen />);
    expect(await screen.findByText('Dana Owner')).toBeInTheDocument();
    expect(screen.getByText('OWNER')).toBeInTheDocument();
    expect(await screen.findByText('Tap to Pay · Setup Required')).toBeInTheDocument(); // §28 capability honestly not ready
    expect(screen.getByText('Fiserv Tap to Pay merchant enrollment is not complete.')).toBeInTheDocument();
    expect(screen.getByText('SANDBOX — test payments only')).toBeInTheDocument(); // §125 sandbox banner
    expect(screen.getByText('Support')).toBeInTheDocument(); // §119 More screen
  });

  it('signs out and shows the signed-out state', async () => {
    (authApi.me as any).mockResolvedValue(principal);
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    render(<AccountScreen />);
    fireEvent.click(await screen.findByText('Sign out'));
    await waitFor(() => expect(authApi.logout).toHaveBeenCalled());
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });

  it('shows a not-signed-in state when there is no principal', async () => {
    (authApi.me as any).mockResolvedValue(null);
    (mobileCheckoutApi.readiness as any).mockResolvedValue(null);
    render(<AccountScreen />);
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });

  it('lets an owner approve a pending payment device', async () => {
    (authApi.me as any).mockResolvedValue(principal); // role OWNER
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'not_ready', canTakePayment: false, checks: [] });
    (mobileCheckoutApi.myDevices as any).mockResolvedValue([{ deviceId: 'devABCDEF12', status: 'pending', platform: 'ios', tapToPayCapable: true }]);
    (mobileCheckoutApi.approveDevice as any).mockResolvedValue({ deviceId: 'devABCDEF12', status: 'active' });
    render(<AccountScreen />);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(mobileCheckoutApi.approveDevice).toHaveBeenCalledWith('devABCDEF12'));
  });

  it('§138: revoking a phone asks for a reason inline and sends it', async () => {
    (authApi.me as any).mockResolvedValue(principal);
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.myDevices as any).mockResolvedValue([{ deviceId: 'devLOST0001', status: 'active', platform: 'ios', tapToPayCapable: true, online: false }]);
    (mobileCheckoutApi.revokeDevice as any).mockResolvedValue({ deviceId: 'devLOST0001', status: 'revoked' });
    render(<AccountScreen />);
    fireEvent.click(await screen.findByText('Revoke'));
    expect(mobileCheckoutApi.revokeDevice).not.toHaveBeenCalled();
    const input = await screen.findByLabelText('Your answer');
    fireEvent.change(input, { target: { value: 'lost phone' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mobileCheckoutApi.revokeDevice).toHaveBeenCalledWith('devLOST0001', 'lost phone'));
  });
});
