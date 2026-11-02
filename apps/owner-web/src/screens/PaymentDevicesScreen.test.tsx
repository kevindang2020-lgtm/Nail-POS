import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PaymentDevicesScreen } from './PaymentDevicesScreen';

vi.mock('../api/ownerPaymentDevicesApi', () => ({ ownerPaymentDevicesApi: { list: vi.fn(), act: vi.fn() } }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
import { ownerPaymentDevicesApi } from '../api/ownerPaymentDevicesApi';

const dev = (over: Partial<any>) => ({ deviceId: 'dev-1', label: "Kevin's iPhone", platform: 'ios', tapToPayCapable: true, status: 'active', boundUserName: 'Kevin', online: true, appVersion: '1.2.0', lastPaymentAt: null, lastSeenAt: null, lastErrorCode: null, ...over });

describe('Owner PaymentDevicesScreen (TTP §12–§17, §137–§145)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows each phone with trust state, bound person, online and last error', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([
      dev({}),
      dev({ deviceId: 'dev-2', label: 'Back iPhone', status: 'pending', boundUserName: 'Mia', online: false, lastErrorCode: 'DEVICE_NOT_AUTHORIZED', lastErrorAt: '2026-10-12T15:00:00Z' }),
    ]);
    render(<PaymentDevicesScreen />);
    expect(await screen.findByText("Kevin's iPhone")).toBeInTheDocument();
    expect(screen.getByText(/Kevin · Online · v1.2.0 · Tap to Pay capable/)).toBeInTheDocument();
    expect(screen.getByText(/Mia · Offline/)).toBeInTheDocument();
    expect(screen.getByText(/DEVICE_NOT_AUTHORIZED/)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('approve runs at once; revoke asks for a reason first and sends it', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([dev({ status: 'pending' })]);
    (ownerPaymentDevicesApi.act as any).mockResolvedValue({ deviceId: 'dev-1', status: 'active' });
    render(<PaymentDevicesScreen />);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(ownerPaymentDevicesApi.act).toHaveBeenCalledWith('dev-1', 'approve', undefined));
    fireEvent.click(screen.getByText('Revoke'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'staff left' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(ownerPaymentDevicesApi.act).toHaveBeenCalledWith('dev-1', 'revoke', 'staff left'));
  });

  it('a revoked / compromised phone offers no re-activation in place', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([dev({ status: 'compromised', revokeReason: 'stolen', revokedAt: '2026-10-12T15:00:00Z' })]);
    render(<PaymentDevicesScreen />);
    expect(await screen.findByText(/stolen/)).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument();
  });

  it('honest empty and no-access states', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([]);
    const { unmount } = render(<PaymentDevicesScreen />);
    expect(await screen.findByText('No payment phones yet')).toBeInTheDocument();
    unmount();
    (ownerPaymentDevicesApi.list as any).mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    render(<PaymentDevicesScreen />);
    expect(await screen.findByText('You do not have access to payment devices.')).toBeInTheDocument();
  });
});

// Secure Tap to Pay §51 (Oct 27 2026): the owner's payment-phone security card
describe('Owner PaymentDevicesScreen — §51 security card', () => {
  const S = { scope: 'tenant', windowDays: 30, generatedAt: '2026-10-27T12:00:00Z', devices: { active: 2 }, registrations: { last24h: 5, window: 6 }, revocations: 1, suspensions: 0, claimConflicts: 3,
    signals: { revoked_device_attempt: 1, key_mismatch: 2, request_replayed: 0, app_version_refused: 0, attestation_failed: 0, unusual_registration: 1 }, appVersions: [{ version: '1.4.0', devices: 2 }] };
  it('shows new phones, revocations, claim conflicts, the alerts that fired and the app versions', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([dev({})]);
    (ownerPaymentDevicesApi as any).securitySummary = vi.fn().mockResolvedValue(S);
    render(<PaymentDevicesScreen />);
    const card = await screen.findByTestId('device-security-card');
    expect(card).toHaveTextContent('New phones (24 h)5');
    expect(card).toHaveTextContent('Revoked1');
    expect(card).toHaveTextContent('Claim conflicts3');
    expect(screen.getByTestId('device-alert-unusual_registration')).toHaveTextContent('Unusual new-phone registrations: 1');
    expect(screen.getByTestId('device-alert-key_mismatch')).toHaveTextContent('Failed device signatures: 2');
    expect(screen.queryByTestId('device-alert-request_replayed')).toBeNull();
    expect(card).toHaveTextContent('v1.4.0 (2)');
  });
  it('a refused summary (not the owner) hides the card; the device list still works', async () => {
    (ownerPaymentDevicesApi.list as any).mockResolvedValue([dev({})]);
    (ownerPaymentDevicesApi as any).securitySummary = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    render(<PaymentDevicesScreen />);
    expect(await screen.findByText("Kevin's iPhone")).toBeInTheDocument();
    expect(screen.queryByTestId('device-security-card')).toBeNull();
  });
});
