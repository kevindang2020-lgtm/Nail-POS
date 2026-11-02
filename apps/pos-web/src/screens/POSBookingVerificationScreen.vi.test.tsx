// POSBookingVerificationScreen.vi.test — English + Vietnamese POS mandate (WP-C1): Booking Verification reads in Vietnamese
// — channels (a getter table read at render), the activity counts, the manager-override prompt and its result (kept as a
// key) — with no English left. Masked phone numbers stay as sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
import { api } from '../api/client';
import { POSBookingVerificationScreen } from './POSBookingVerificationScreen';

const settings = { enabled: true, channels: { online: true, customerApp: true, aiReceptionist: true }, verifyEveryBooking: false, reverifyAfterSeconds: 86400, reverifyOnGroupBooking: true, reverifyOnDeposit: true, reverifyOnHighValue: true, holdSeconds: 600, version: 3,
  provider: { connected: true, validated: true, blockedReason: null }, platform: { requiredByPlatform: false, blockedByPlatform: false, emergencyDisabled: false, moduleDisabled: false } };
const pendingRow = { id: 'v1', channel: 'online', maskedPhone: '••••0142', status: 'sent', attempts: 1, createdAt: '2026-10-07T14:00:00Z', expiresAt: '2026-10-07T14:10:00Z', slotStartsAt: '2026-10-08T15:00:00Z', technicianId: null };
const usage = { days: 30, totals: { requested: 12, codesSent: 14, delivered: 13, verified: 9, overridden: 1, failed: 1, locked: 1, expired: 1, bookingsCompleted: 10 }, verifyRate: 0.75,
  byChannel: [{ channel: 'online', requested: 8, verified: 6 }], recentFailures: [{ at: '2026-10-07T13:00:00Z', channel: 'kiosk', status: 'locked', reason: 'too_many_attempts', maskedPhone: '••••7777' }] };
beforeEach(() => {
  vi.mocked(api.get).mockImplementation(async (p: string) => {
    if (p === '/pos/settings/booking-phone-verification') return settings as never;
    if (p.startsWith('/pos/settings/booking-phone-verification/usage')) return usage as never;
    if (p === '/pos/booking/verification-override/pending') return { items: [pendingRow] } as never;
    if (p === '/pos/booking-verification-center/summary') return { generatedAt: '2026-10-31T12:00:00Z', timezone: 'America/New_York', lastActivityAt: null, cards: { pending: { value: 0, definition: '' }, verifiedToday: { value: 0, definition: '' }, failedToday: { value: 0, definition: '' }, activeHolds: { value: 0, expiringSoon: 0, definition: '' }, smsHealth: { state: 'ready', providerErrors24h: 0, codesSent24h: 0, definition: '' }, successRate: { value: null, numerator: 0, denominator: 0, definition: '' } } } as never;
    if (p === '/pos/booking-verification-center/live' || p === '/pos/booking-verification-center/history') return { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } as never;
    throw new Error('unexpected ' + p);
  });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Booking Verification in Vietnamese (WP-C1)', () => {
  it('channels, activity counts and the waiting list are Vietnamese; no English left', async () => {
    await setLanguage('vi');
    const { container } = render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('pending-row')).toHaveTextContent('Trang đặt lịch trực tuyến');
    expect(screen.getByText('Quản lý đã duyệt')).toBeInTheDocument();
    for (const en of ['Online booking page', 'Approved by a manager', 'Locked (wrong codes)', 'Codes sent']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container).join(' | ')).toBe('');
  });
});
