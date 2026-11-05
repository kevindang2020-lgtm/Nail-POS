// TapToPayAdminScreen — Super Admin → Tap to Pay: safe onboarding status (no credential values), record progress,
// the salon's payment phones with approve / revoke (revoke confirms inline first).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { state: vi.fn() } }));
vi.mock('../api/tapToPayAdminApi', async (orig) => ({
  ...(await orig<any>()),
  tapToPayAdminApi: { onboarding: vi.fn(), setOnboarding: vi.fn(), devices: vi.fn(), approve: vi.fn(), revoke: vi.fn() },
}));
import { superAdminApi } from '../api/superAdminApi';
import { tapToPayAdminApi } from '../api/tapToPayAdminApi';
import { TapToPayAdminScreen } from './TapToPayAdminScreen';

const OB = { tenantId: 't1', appleEntitlementStatus: 'requested', pspEnrollmentStatus: 'onboarding', onboarded: false, credentialsPresent: false, notes: null, updatedAt: null };
const renderAt = (q = '?tenantId=t1') => render(<MemoryRouter initialEntries={[`/tap-to-pay${q}`]}><TapToPayAdminScreen /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.state as any).mockResolvedValue({ tenants: [{ id: 't1', name: 'Luxe Nails' }] });
  (tapToPayAdminApi.onboarding as any).mockResolvedValue(OB);
  (tapToPayAdminApi.devices as any).mockResolvedValue([
    { deviceId: 'dev-1', label: "Kevin's iPhone", platform: 'ios', tapToPayCapable: true, status: 'pending', appVersion: '1.2.0' },
    { deviceId: 'dev-2', label: 'Old iPhone', platform: 'ios', tapToPayCapable: true, status: 'active', lastErrorCode: 'PAYMENT_STATUS_UNKNOWN', lastErrorAt: '2026-10-12T15:00:00Z' },
  ]);
});

describe('TapToPayAdminScreen', () => {
  it('asks for a tenant first and points to the kill-switch centre', async () => {
    renderAt('');
    expect(await screen.findByText(/Pick a tenant/)).toBeInTheDocument();
    expect(screen.getByText(/Kill-Switch Centre/)).toBeInTheDocument();
  });

  it('shows the safe onboarding status — credentials as Present / Missing only — and the not-live explanation', async () => {
    renderAt();
    expect(await screen.findByText(/Tap to Pay not live/)).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getAllByText('Requested').length).toBeGreaterThan(0);
    expect(screen.getByText(/takes no card/)).toBeInTheDocument();
    expect(screen.getByText(/PAYMENT_STATUS_UNKNOWN/)).toBeInTheDocument();
  });

  it('records onboarding progress', async () => {
    (tapToPayAdminApi.setOnboarding as any).mockResolvedValue({ ...OB, appleEntitlementStatus: 'approved' });
    renderAt();
    await screen.findByText(/Tap to Pay not live/);
    fireEvent.change(screen.getByLabelText('Apple entitlement status'), { target: { value: 'approved' } });
    fireEvent.click(screen.getByText('Record status'));
    await waitFor(() => expect(tapToPayAdminApi.setOnboarding).toHaveBeenCalledWith('t1', { appleEntitlementStatus: 'approved', pspEnrollmentStatus: 'onboarding', notes: undefined }));
  });

  it('approves a pending phone; revoke confirms first', async () => {
    (tapToPayAdminApi.approve as any).mockResolvedValue({});
    (tapToPayAdminApi.revoke as any).mockResolvedValue({});
    renderAt();
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(tapToPayAdminApi.approve).toHaveBeenCalledWith('t1', 'dev-1'));
    fireEvent.click(screen.getAllByText('Revoke')[1]);
    expect(tapToPayAdminApi.revoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /^(Confirm|Yes)/ }));
    await waitFor(() => expect(tapToPayAdminApi.revoke).toHaveBeenCalledWith('t1', 'dev-2'));
  });
});
