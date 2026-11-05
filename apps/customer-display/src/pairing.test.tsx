// pairing.test.tsx — 23-inch dual-screen spec §8–§12: the display pairs itself. It shows a code, polls with its secret,
// takes the credential once the owner claims the code, replaces an expired code, and says plainly when the server cannot
// be reached or too many codes were asked for — it never asks for a salon login.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ startPairing: vi.fn(), pollPairing: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), startPairing: api.startPairing, pollPairing: api.pollPairing }));
import { DisplayApiError } from './api';
import { Pairing } from './DeviceScreens';
import { PAIRING_POLL_MS } from './usePairing';

const start = (code: string, id = 'p1') => ({ pairingId: id, code, pollSecret: 'secret-' + id, expiresAt: new Date(Date.now() + 600_000).toISOString() });
const step = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers(); api.startPairing.mockReset(); api.pollPairing.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('the pairing screen', () => {
  it('shows the code (formatted), polls with its secret, and hands the credential over once the owner claims it', async () => {
    api.startPairing.mockResolvedValue(start('48291374'));
    api.pollPairing.mockResolvedValueOnce({ status: 'waiting', expiresAt: '' }).mockResolvedValueOnce({ status: 'paired', deviceToken: 'TOKEN-1', deviceName: 'Front Display #1', salonName: 'Luxury Nails', branchName: 'Cherry Hill' });
    const onPaired = vi.fn();
    render(<Pairing onPaired={onPaired} />);
    await step(10);
    expect(screen.getByTestId('pairing-code').textContent).toBe('4829 1374');
    expect(screen.getByText(/Devices → Customer Displays/)).toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();   // nothing to type on the display — no login, no salon picker
    expect(api.startPairing).toHaveBeenCalledWith('web');
    await step(PAIRING_POLL_MS);
    expect(api.pollPairing).toHaveBeenLastCalledWith(expect.objectContaining({ pairingId: 'p1', pollSecret: 'secret-p1' }));
    await step(PAIRING_POLL_MS);
    expect(onPaired).toHaveBeenCalledWith('TOKEN-1');
    expect(screen.getByText('Paired with Luxury Nails')).toBeInTheDocument();
    expect(screen.getByText(/Cherry Hill · Front Display #1/)).toBeInTheDocument();
  });

  it('an expired code is replaced by a fresh one', async () => {
    api.startPairing.mockResolvedValueOnce(start('11112222', 'a')).mockResolvedValueOnce(start('33334444', 'b'));
    api.pollPairing.mockResolvedValueOnce({ status: 'expired' }).mockResolvedValue({ status: 'waiting', expiresAt: '' });
    render(<Pairing onPaired={vi.fn()} />);
    await step(10);
    expect(screen.getByTestId('pairing-code').textContent).toBe('1111 2222');
    await step(PAIRING_POLL_MS + 10);
    expect(screen.getByTestId('pairing-code').textContent).toBe('3333 4444');
  });

  it('too many codes from this network: says so, and asks again a minute later', async () => {
    api.startPairing.mockRejectedValueOnce(new DisplayApiError(429, 'Too many')).mockResolvedValue(start('55556666'));
    api.pollPairing.mockResolvedValue({ status: 'waiting', expiresAt: '' });
    render(<Pairing onPaired={vi.fn()} />);
    await step(10);
    expect(screen.getByRole('alert').textContent).toMatch(/Too many codes/);
    await step(30_000);
    expect(api.startPairing).toHaveBeenCalledTimes(1);
    await step(30_100);
    expect(screen.getByTestId('pairing-code').textContent).toBe('5555 6666');
  });

  it('the server cannot be reached: says so and retries', async () => {
    api.startPairing.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(start('77778888'));
    render(<Pairing onPaired={vi.fn()} />);
    await step(10);
    expect(screen.getByRole('alert').textContent).toMatch(/Can’t reach the salon’s server/);
    await step(5_100);
    expect(screen.getByTestId('pairing-code').textContent).toBe('7777 8888');
  });
});
