// DeviceScreens.test — Secure Tap to Pay M6-4: the removed-phone lock, the waiting-for-owner banner (never on the customer's
// screen), and pairing by a pasted POS code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../device/enroll', () => ({ enrollDevice: vi.fn() }));
vi.mock('../device/deviceKeys', () => ({ wipeDeviceIdentity: vi.fn(async () => undefined) }));
import { enrollDevice } from '../device/enroll';
import { wipeDeviceIdentity } from '../device/deviceKeys';
import { DeviceRemovedScreen, DeviceStandingBanner, PairDeviceCard } from './DeviceScreens';
import { setDeviceStanding, clearRemoved, getDeviceStanding } from '../device/deviceState';
import { PayNavProvider, usePayNav } from '../shell/nav';

function Handoff({ children }: { children: React.ReactNode }) {
  const nav = usePayNav();
  return <>{children}<button onClick={() => nav.openHandoff({ ticketId: 't', version: 'v', subtotalCents: 1, balanceCents: 1, tipCents: 0 })}>hand</button></>;
}

describe('device screens', () => {
  beforeEach(() => { vi.clearAllMocks(); clearRemoved(); });

  it('the removed screen says so plainly; leaving it is a staff action that sets the phone up again', () => {
    const again = vi.fn();
    act(() => setDeviceStanding('removed'));
    render(<DeviceRemovedScreen onSetUpAgain={again} />);
    expect(screen.getByTestId('device-removed')).toHaveTextContent('This phone was removed from the salon');
    fireEvent.click(screen.getByText('Set up this phone again'));
    expect(again).toHaveBeenCalled();
    expect(getDeviceStanding()).toBe('unknown');
  });

  it('waiting for the owner is shown to staff, and hidden while the customer holds the phone', () => {
    act(() => setDeviceStanding('pending'));
    render(<PayNavProvider><Handoff><DeviceStandingBanner /></Handoff></PayNavProvider>);
    expect(screen.getByTestId('device-pending')).toHaveTextContent('waiting for the salon owner');
    fireEvent.click(screen.getByText('hand'));
    expect(screen.queryByTestId('device-pending')).toBeNull();
  });

  it('a pasted POS link pairs this phone as a NEW device (fresh identity, then register with the code)', async () => {
    (enrollDevice as any).mockResolvedValue({ deviceId: 'd', status: 'active' });
    render(<PayNavProvider><PairDeviceCard /></PayNavProvider>);
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'aipowersalon-pay://pair?code=Zq3x_9-abcdefghijklmnop' } });
    fireEvent.click(screen.getByText('Pair this phone'));
    await waitFor(() => expect(enrollDevice).toHaveBeenCalledWith({ pairingCode: 'Zq3x_9-abcdefghijklmnop' }));
    expect(wipeDeviceIdentity).toHaveBeenCalled();
    expect(await screen.findByText('This phone is paired with the salon.')).toBeInTheDocument();
  });

  it('a refused code reads in plain English', async () => {
    (enrollDevice as any).mockRejectedValue(Object.assign(new Error('This pairing code is wrong, expired or already used. Ask the front desk for a new QR code.'), { code: 'PAIRING_CODE_INVALID' }));
    render(<PayNavProvider><PairDeviceCard /></PayNavProvider>);
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'Zq3x_9-abcdefghijklmnop' } });
    fireEvent.click(screen.getByText('Pair this phone'));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or already used');
  });
});
