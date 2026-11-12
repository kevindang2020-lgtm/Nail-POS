// POSBookingVerificationScreen.test — BUILD_PLAN Phase 4: the manager sees who is waiting for a code and can approve ONE
// booking (with a reason and how the customer was confirmed); the activity panel shows what verification is doing; all six
// booking sources and the three re-verify rules are shown (Booking Phone Verification guide, Oct 31 2026).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn().mockResolvedValue({ branches: [{ id: 'b1', name: 'Main', isActive: true }, { id: 'b2', name: 'Haddon', isActive: true }] }) } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
import { api } from '../api/client';
import { POSBookingVerificationScreen, ConfigComparison } from './POSBookingVerificationScreen';

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
    if (p === '/pos/booking-verification-center/summary') return { generatedAt: '2026-10-31T12:00:00Z', timezone: 'America/New_York', lastActivityAt: null, cards: { pending: { value: 0, definition: '' }, verifiedToday: { value: 0, definition: '' }, failedToday: { value: 0, definition: '' }, activeHolds: { value: 0, expiringSoon: 0, definition: '' }, smsHealth: { state: 'ready', providerErrors24h: 0, codesSent24h: 0, definition: '' }, successRate: { value: null, numerator: 0, denominator: 0, definition: '' } } } as never;
    if (p === '/pos/booking-verification-center/live' || p === '/pos/booking-verification-center/history') return { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } as never;
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
  it('all six sources are shown (guide §2) — the in-salon three fixed OFF with the reason; the three re-verify rules are back (guide §9)', async () => {
    render(<POSBookingVerificationScreen />);
    await screen.findAllByText('Online booking page');   // also a channel name in the live list
    expect(screen.getAllByText('Customer App').length).toBeGreaterThan(0);
    for (const label of ['Kiosk', 'Front desk (staff-created)', 'Walk-in check-in']) {
      const box = screen.getAllByText(label).map((el) => el.closest('label')).find(Boolean)!.querySelector('input') as HTMLInputElement;   // the label inside the switches (the name also appears in the live list)
      expect(box.checked).toBe(false); expect(box.disabled).toBe(true);   // never asked in the salon; the server refuses turning them on
    }
    expect(screen.getAllByText(/staff confirm the customer in person/)).toHaveLength(3);
    for (const label of ['Group bookings', 'Bookings that need a deposit', 'High-value bookings'])
      expect((screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Not set — this rule never triggers/)).toBeTruthy();   // no high-value amount saved yet
  });
  it('saving a high-value amount sends cents; clearing sends null', async () => {
    vi.mocked(api.patch).mockResolvedValue(settings({ highValueThresholdCents: 15000 }) as never);
    render(<POSBookingVerificationScreen />);
    const input = await screen.findByLabelText('High-value amount ($)');
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('bv-high-save'));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pos/settings/booking-phone-verification', { highValueThresholdCents: 15000 }));
    fireEvent.click(await screen.findByText('Clear'));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/pos/settings/booking-phone-verification', { highValueThresholdCents: null }));
  });
  it('module switched off by the platform: said plainly, and the switch is locked', async () => {
    routes({ settings: settings({ enabled: false, platform: { moduleDisabled: true } }) });
    render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('module-disabled')).toHaveTextContent('not available');
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
  });
  it('Extras BPV-09: the verification funnel shows each evidence step, conversion of the previous step ("—" when unknown) and overrides apart', async () => {
    const base = await (api.get as any)('/pos/booking-verification-center/summary');
    const funnel = { windowDays: 30, overrides: 1, overridesDefinition: 'apart', steps: [
      { key: 'requested', count: 6, definition: 'd', conversionPercent: null }, { key: 'sent', count: 4, definition: 'd', conversionPercent: 66.7 },
      { key: 'verified', count: 3, definition: 'd', conversionPercent: 75 }, { key: 'holdConverted', count: 0, definition: 'd', conversionPercent: 0 },
      { key: 'confirmed', count: 0, definition: 'd', conversionPercent: null }] };
    const prev = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (p: string, ...rest: any[]) => (p === '/pos/booking-verification-center/summary' ? { ...base, funnel } as never : prev(p, ...rest)));
    render(<POSBookingVerificationScreen />);
    const f = await screen.findByTestId('bv-funnel');
    expect(f).toHaveTextContent('Verification funnel · last 30 days');
    expect(screen.getByTestId('bv-funnel-requested')).toHaveTextContent('Requested6');
    expect(screen.getByTestId('bv-funnel-sent')).toHaveTextContent('66.7% of previous step');
    expect(screen.getByTestId('bv-funnel-confirmed')).toHaveTextContent('— of previous step');
    expect(screen.getByTestId('bv-funnel-overrides')).toHaveTextContent('Staff overrides (not counted as verified): 1');
  });
  it('Extras BPV-07: SMS delivery evidence keeps sender readiness, sends, delivery reports and correct checks apart ("—" when unknown)', async () => {
    const base = await (api.get as any)('/pos/booking-verification-center/summary');
    const prev = vi.mocked(api.get).getMockImplementation()!;
    const deliveryEvidence = { windowDays: 30, sender: { state: 'ready', definition: 'd' }, sends: { sessions: 4, attempts: 6, definition: 'd' },
      delivery: { delivered: 2, providerFailed: 1, noReport: 1, lastDeliveredAt: null, deliveredPercent: 50, definition: 'd' }, checks: { verified: 0, percentOfSent: null, definition: 'd' } };
    vi.mocked(api.get).mockImplementation(async (p: string, ...rest: any[]) => (p === '/pos/booking-verification-center/summary' ? { ...base, deliveryEvidence } as never : prev(p, ...rest)));
    render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('bv-delivery')).toHaveTextContent('SMS delivery evidence · last 30 days');
    expect(screen.getByTestId('bv-dev-sender')).toHaveTextContent('Ready');
    expect(screen.getByTestId('bv-dev-sender')).toHaveTextContent('not proof a text arrived');
    expect(screen.getByTestId('bv-dev-sends')).toHaveTextContent('6 send attempts incl. resends');
    expect(screen.getByTestId('bv-dev-delivery')).toHaveTextContent('50% of codes sent');
    expect(screen.getByTestId('bv-dev-delivery')).toHaveTextContent('Provider failed: 1 · No report: 1');
    expect(screen.getByTestId('bv-dev-checks')).toHaveTextContent('— of codes sent');
  });
  it('Extras BPV-12: provider failures are grouped by what to fix, with the provider codes; none says so', async () => {
    const base = await (api.get as any)('/pos/booking-verification-center/summary');
    const prev = vi.mocked(api.get).getMockImplementation()!;
    const providerFailures = { windowDays: 7, total: 3, groups: [{ category: 'permission', count: 2, lastAt: null, codes: ['20003'] }, { category: 'wrong_phone', count: 1, lastAt: null, codes: ['21211'] }] };
    vi.mocked(api.get).mockImplementation(async (p: string, ...rest: any[]) => (p === '/pos/booking-verification-center/summary' ? { ...base, providerFailures } as never : prev(p, ...rest)));
    const { unmount } = render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('bv-triage')).toHaveTextContent('Provider failures · last 7 days');
    expect(screen.getByTestId('bv-triage-permission')).toHaveTextContent('Permission / account2');
    expect(screen.getByTestId('bv-triage-permission')).toHaveTextContent('codes 20003');
    expect(screen.getByTestId('bv-triage-wrong_phone')).toHaveTextContent('confirm it with the customer');
    unmount();
    vi.mocked(api.get).mockImplementation(async (p: string, ...rest: any[]) => (p === '/pos/booking-verification-center/summary' ? { ...base, providerFailures: { windowDays: 7, total: 0, groups: [] } } as never : prev(p, ...rest)));
    render(<POSBookingVerificationScreen />);
    expect(await screen.findByTestId('bv-triage-none')).toHaveTextContent('No provider failures in the last 7 days.');
  });
  it('extras Booking Phone Verification 11: choosing a location shows the server comparison — salon, location (or inherits), in effect, source', async () => {
    vi.mocked(api.get).mockImplementation(async (p: string) => (p === '/pos/settings/booking-phone-verification?branchId=b2' ? { comparison: { branchHasOwnSettings: true, salonHasSettings: true, rows: [
      { field: 'enabled', salon: true, branch: null, effective: true, source: 'salon' },
      { field: 'channel.online', salon: true, branch: false, effective: false, source: 'branch' },
      { field: 'reverifyAfterSeconds', salon: 86400, branch: null, effective: 86400, source: 'salon' }] } } : {}) as never);
    render(<ConfigComparison />);
    fireEvent.change(await screen.findByTestId('bv-cmp-branch'), { target: { value: 'b2' } });
    expect((await screen.findByTestId('bv-cmp-enabled')).textContent).toBe('Phone verificationOnInheritsOnSalon setting');
    expect(screen.getByTestId('bv-cmp-channel.online').textContent).toBe('Online bookingOnOffOffThis location');
    expect(screen.getByTestId('bv-cmp-reverifyAfterSeconds').textContent).toContain('24 h');
    expect(screen.getByTestId('bv-cmp-state').textContent).toMatch(/its own settings/);
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('extras TEXT MESSAGING SETUP 12 — Booking Code Health Test', () => {
  it('before a check the code-rules item is listed as not checked; after a check the server result and its rules are shown', async () => {
    render(<POSBookingVerificationScreen />);
    const pending = await screen.findByTestId('bv-pending-code_rules');
    expect(pending).toHaveTextContent('Booking code rules');
    expect(pending).toHaveTextContent('no code is sent');
    vi.mocked(api.get).mockImplementation(async (p: string) => {
      if (p === '/pos/booking-verification-center/health') return { checkedAt: '2026-11-12T12:00:00Z', overall: 'ready', items: [{ key: 'code_rules', state: 'ready', message: 'The code rules passed a safe self-test (8 checks; no code was sent).', evidence: '6 digits · expires after 10 min · 5 tries', nextAction: null, checkedAt: '2026-11-12T12:00:00Z' }] } as never;
      return { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } as never;
    });
    fireEvent.click(screen.getByTestId('bv-check-inline'));
    const item = await screen.findByTestId('bv-check-code_rules');
    expect(item).toHaveTextContent('Booking code rules');
    expect(item).toHaveTextContent('6 digits · expires after 10 min · 5 tries');
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
