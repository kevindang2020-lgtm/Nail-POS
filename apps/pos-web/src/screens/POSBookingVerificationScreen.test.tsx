// POSBookingVerificationScreen.test — BUILD_PLAN Phase 4: the manager sees who is waiting for a code and can approve ONE
// booking (with a reason and how the customer was confirmed); the activity panel shows what verification is doing; the
// in-salon switches that nothing ever read are gone.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
import { api } from '../api/client';
import { POSBookingVerificationScreen } from './POSBookingVerificationScreen';

const settings = (over: any = {}) => ({
  enabled: true, channels: { online: true, customerApp: true, aiReceptionist: true }, verifyEveryBooking: false, reverifyAfterSeconds: 86400,
  reverifyOnGroupBooking: true, reverifyOnDeposit: true, reverifyOnHighValue: true, holdSeconds: 600, version: 3,
  provider: { connected: true, validated: true, blockedReason: null },
  platform: { requiredByPlatform: false, blockedByPlatform: false, emergencyDisabled: false, moduleDisabled: false, ...(over.platform ?? {}) }, ...over,
});
const pendingRow = { id: '7a1b2c3d-0000-4000-8000-00000000abcd', channel: 'online', maskedPhone: '••••0142', status: 'sent', attempts: 1, createdAt: '2026-10-07T14:00:00Z', expiresAt: '2026-10-07T14:10:00Z', slotStartsAt: '2026-10-08T15:00:00Z', technicianId: null };
const usage = { days: 30, totals: { requested: 12, codesSent: 14, delivered: 13, verified: 9, overridden: 1, failed: 1, locked: 1, expired: 1, bookingsCompleted: 10 }, verifyRate: 0.75,
  byChannel: [{ channel: 'online', requested: 8, verified: 6 }], recentFailures: [{ at: '2026-10-07T13:00:00Z', channel: 'online', status: 'locked', reason: 'too_many_attempts', maskedPhone: '••••7777' }] };

function routes(over: { pending?: any; settings?: any } = {}) {
  vi.mocked(api.get).mockImplementation(async (p: string) => {
    if (p === '/pos/settings/booking-phone-verification') return (over.settings ?? settings()) as never;
    if (p.startsWith('/pos/settings/booking-phone-verification/usage')) return usage as never;
    if (p === '/pos/booking/verification-override/pending') { if (over.pending instanceof Error) throw over.pending; return { items: over.pending ?? [pendingRow] } as never; }
    throw new Error('unexpected ' + p);
  });
}
beforeEach(() => { for (const f of Object.values(api)) vi.mocked(f as any).mockReset(); routes(); });

describe('who is waiting, and the manager override', () => {
  it('lists the waiting booking with a MASKED number, and approves it with the reason and how the customer was confirmed', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true } as never);
    render(<POSBookingVerificationScreen />);
    const row = await screen.findByTestId('pending-row');
    expect(row).toHaveTextContent('••••0142');
    expect(row).toHaveTextContent('Online booking page');
    fireEvent.change(screen.getByLabelText('How you confirmed the customer'), { target: { value: 'staff_called_back' } });
    fireEvent.click(screen.getByText('Approve without code'));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Called her back on the number on file' } });
    fireEvent.click(screen.getByText('Approve booking'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pos/booking/verification-override', { verificationId: pendingRow.id, reason: 'Called her back on the number on file', contactMethod: 'staff_called_back' }));
    expect(await screen.findByTestId('pending-msg')).toHaveTextContent('tap Book again');
  });
  it('a short reason is refused in place — nothing is sent', async () => {
    render(<POSBookingVerificationScreen />);
    fireEvent.click(await screen.findByText('Approve without code'));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByText('Approve booking'));
    expect(await screen.findByText(/at least 12 characters/)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('a receptionist (403 on the list) does not see the panel at all', async () => {
    routes({ pending: Object.assign(new Error('Forbidden'), { status: 403 }) });
    render(<POSBookingVerificationScreen />);
    await screen.findByText('Booking Phone Verification');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/pos/booking/verification-override/pending'));
    expect(screen.queryByTestId('pending-verifications')).toBeNull();
  });
});

describe('the activity panel and the switches', () => {
  it('shows the counts, the verify rate and recent problems (masked)', async () => {
    render(<POSBookingVerificationScreen />);
    const p = await screen.findByTestId('verification-usage');
    expect(p).toHaveTextContent('Asked for a code');
    expect(p).toHaveTextContent('75% of customers asked for a code entered it');
    expect(p).toHaveTextContent('••••7777');
    expect(p).toHaveTextContent('too many wrong codes');
  });
  it('the in-salon switches are gone (front desk, walk-in, kiosk) — the remote ones stay', async () => {
    render(<POSBookingVerificationScreen />);
    await screen.findByText('Online booking page');
    expect(screen.getByText('Customer App')).toBeTruthy();
    expect(screen.queryByText(/Front desk \(staff-created\)/)).toBeNull();
    expect(screen.queryByText('Walk-in check-in')).toBeNull();
    expect(screen.queryByText('Kiosk')).toBeNull();
    // the risk switches no booking path can feed are not offered (decided)
    expect(screen.queryByText(/re-verify group bookings/)).toBeNull();
    expect(screen.queryByText(/high-value services/)).toBeNull();
  });
  it('module switched off by the platform: said plainly, and the switch is locked', async () => {
    routes({ settings: settings({ enabled: false, platform: { moduleDisabled: true } }) });
    render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('module-disabled')).toHaveTextContent('not available');
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
