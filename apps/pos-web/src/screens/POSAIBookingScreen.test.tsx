// POSAIBookingScreen — A7 AI Booking Assistant guide (Nov 4 2026): the honest add-on header (Cancelled stays Cancelled) and the
// operations center below it: counts, recovery (Prepare Message is a draft — never sent; Dismiss needs a reason), the request
// activity (server search, numbered pages, statuses that keep "booked" and "confirmed" apart), the overlay tabs and the
// read-only system check. EN + VI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
const { bk, pkg } = vi.hoisted(() => ({ bk: { overview: vi.fn(), activity: vi.fn(), detail: vi.fn(), recovery: vi.fn(), dismiss: vi.fn(), lastHealth: vi.fn(), runHealth: vi.fn(), alternatives: vi.fn(), requestApproval: vi.fn(), recordSupportReport: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posAiBookingCenterApi', () => ({ posAiBookingCenterApi: bk }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
import { POSAIBookingScreen } from './POSAIBookingScreen';

const CARD = { package: { code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: 'Customer messages → booking.', category: 'front_desk', posArea: 'Booking', state: 'cancelled', storedStatus: 'cancelled',
  disabledReason: null, price: { cents: 4900, period: 'monthly', source: 'catalog_list' }, usage: { used: 1, limit: 1000, unit: 'messages', percent: 0, level: 'ok', periodStart: null, periodEnd: null, remaining: 999 },
  trial: { days: 14, endsAt: null, daysLeft: null, eligible: false }, actions: [] } };
const period = { preset: 'month', from: '2026-11-01', to: '2026-11-30', tz: 'America/New_York', today: '2026-11-04' };
const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ requestId: id, status, source: 'AI_PHONE_RECEPTIONIST', createdAt: '2026-11-03T15:00:00Z', updatedAt: '2026-11-03T15:02:00Z', customerName: 'Thảo Nguyễn', maskedPhone: '••• 1234', customerId: 'c1',
  appointmentId: null, appointmentDate: null, appointmentTime: null, appointmentStatus: null, services: [], technicianId: null, technicianName: null, failureReason: null, attempts: 0, events: 3, ...extra });
const page = (items: any[], p = 1, total = items.length) => ({ period: { ...period, preset: 'all', from: null, to: null }, basis: 'requested', page: p, pageSize: 20, totalItems: total, totalPages: Math.max(1, Math.ceil(total / 20)), order: 'newest', items });

beforeEach(() => {
  Object.values(bk).forEach((f) => f.mockReset());
  pkg.detail.mockResolvedValue(CARD);
  bk.overview.mockResolvedValue({ period, requests: 4, prepared: 3, pendingVerification: 1, pendingConfirmation: 1, confirmed: 1, failed: 1, liveHolds: 0, expiredHolds: 2, definitions: {} });
  bk.activity.mockResolvedValue(page([row('r2', 'pending_confirmation', { appointmentId: 'a2', appointmentDate: '2026-11-06', appointmentTime: '11:00', services: ['Pedicure'] }), row('r1', 'confirmed', { appointmentId: 'a1', appointmentDate: '2026-11-05' })]));
  bk.recovery.mockResolvedValue({ cases: [{ key: 'failed:r3', type: 'repeated_attempts', urgency: 'high', requestId: 'r3', at: '2026-11-03T15:08:00Z', customerName: 'Ava Kim', maskedPhone: '••• 9876', appointmentId: null, date: null, reason: 'APPOINTMENT_CONFLICT', source: 'AI_PHONE_RECEPTIONIST', attempts: 2 }], dismissedCount: 0, note: '' });
  bk.lastHealth.mockResolvedValue({ run: null });
});
afterEach(async () => { await setLanguage('en'); });
const renderIt = () => render(<MemoryRouter><POSAIBookingScreen /></MemoryRouter>);

describe('A7 AI Booking Assistant', () => {
  it('keeps the honest add-on header and shows the counts with "booked" and "confirmed" apart', async () => {
    renderIt();
    expect(await screen.findByTestId('pkg-state')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('bk-ops').textContent).toContain('Booked, not confirmed'));
    expect(screen.getByTestId('bk-ops').textContent).toContain('Confirmed');
    const rows = await screen.findAllByTestId('bk-row');
    expect(rows[0].textContent).toContain('Booked, not confirmed');
    expect(rows[1].textContent).toContain('Confirmed');
  });
  it('the search, filters and pages go to the server', async () => {
    renderIt();
    await screen.findAllByTestId('bk-row');
    fireEvent.change(screen.getByTestId('bk-search'), { target: { value: 'thao@example.com' } });
    await waitFor(() => expect(bk.activity).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'thao@example.com', page: 1 })), { timeout: 2000 });
    fireEvent.change(screen.getByTestId('bk-status'), { target: { value: 'failed' } });
    await waitFor(() => expect(bk.activity).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' })));
    fireEvent.change(screen.getByTestId('bk-basis'), { target: { value: 'appointment' } });
    await waitFor(() => expect(bk.activity).toHaveBeenLastCalledWith(expect.objectContaining({ basis: 'appointment' })));
    fireEvent.change(screen.getByTestId('bk-size'), { target: { value: '50' } });
    await waitFor(() => expect(bk.activity).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));
  });
  it('recovery: Prepare Message is a draft only; Dismiss needs a reason and goes to the server', async () => {
    bk.dismiss.mockResolvedValue({ dismissed: true, key: 'failed:r3' });
    renderIt();
    expect((await screen.findByTestId('bk-rec-case')).textContent).toContain('The time was already taken');
    fireEvent.click(screen.getByTestId('bk-rec-draft'));
    expect((screen.getByTestId('bk-rec-draft-text') as HTMLTextAreaElement).value).toContain('Ava');
    expect(screen.getByText(/it is not sent/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('bk-rec-dismiss'));
    expect((screen.getByTestId('bk-rec-dismiss-go') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('bk-rec-dismiss-why'), { target: { value: 'Booked by phone' } });
    fireEvent.click(screen.getByTestId('bk-rec-dismiss-go'));
    await waitFor(() => expect(bk.dismiss).toHaveBeenCalledWith('failed:r3', 'Booked by phone'));
  });
  it('a row opens the overlay with its tabs; the verification tab never shows a code', async () => {
    bk.detail.mockResolvedValue({ ...row('r1', 'confirmed', { appointmentId: 'a1', appointmentDate: '2026-11-05', appointmentTime: '10:00', appointmentStatus: 'confirmed', services: ['Gel Manicure'] }), branchId: 'b1',
      customer: { customerId: 'c1', name: 'Thảo Nguyễn', maskedPhone: '••• 1234', verified: true, appointments: [] }, serviceLines: [{ name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }],
      timeline: [{ stage: 'BOOKING_INTENT_DETECTED', outcome: null, failureReason: null, appointmentId: null, latencyMs: null, at: '2026-11-03T15:00:00Z' }, { stage: 'OPTIONS_PRESENTED', outcome: null, failureReason: null, appointmentId: null, latencyMs: null, at: '2026-11-03T15:01:00Z' }],
      verification: [{ status: 'verified', channel: 'ai_receptionist', maskedPhone: '***-1234', attempts: 1, resends: 0, expiresAt: '2026-11-03T15:10:00Z', verifiedAt: '2026-11-03T15:02:00Z', failureReason: null, at: '2026-11-03T15:01:00Z' }],
      communications: [], holds: [], tools: [] });
    renderIt();
    fireEvent.click((await screen.findAllByTestId('bk-row'))[1]);
    expect(await screen.findByTestId('bk-overlay')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('bko-tab-services'));
    expect(screen.getByTestId('bko-panel-services').textContent).toContain('$45.00');
    fireEvent.click(screen.getByTestId('bko-tab-ai'));
    expect(screen.getByTestId('bko-panel-ai').textContent).toContain('Offered times');
    fireEvent.click(screen.getByTestId('bko-tab-verification'));
    expect(screen.getByTestId('bko-panel-verification').textContent).toContain('never shown');
    expect(screen.getByTestId('bko-panel-verification').textContent).toContain('Verified');
    expect(screen.getByTestId('bko-report')).toHaveTextContent('Support report');            // extras 14: the redacted report, from this detail
    // round 10 (AI Booking 14): the download is recorded on the server FIRST; a refused record means no file
    const made: Blob[] = [];
    const U = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    const prev = { c: U.createObjectURL, r: U.revokeObjectURL };
    U.createObjectURL = (b: Blob) => { made.push(b); return 'blob:x'; }; U.revokeObjectURL = () => {};
    bk.recordSupportReport.mockRejectedValueOnce(new Error('The support report cannot be recorded right now — try again.'));
    fireEvent.click(screen.getByTestId('bko-report'));
    expect(await screen.findByTestId('bko-report-err')).toHaveTextContent('cannot be recorded');
    expect(made).toHaveLength(0);
    bk.recordSupportReport.mockResolvedValueOnce({ recorded: true, requestId: 'r1', at: '2026-11-13T12:00:00.000Z' });
    fireEvent.click(screen.getByTestId('bko-report'));
    await waitFor(() => expect(made).toHaveLength(1));
    expect(bk.recordSupportReport).toHaveBeenLastCalledWith('r1');
    expect(await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(made[0]); })).toContain('2026-11-13T12:00:00.000Z');   // the report is stamped with the server's recorded time
    U.createObjectURL = prev.c; U.revokeObjectURL = prev.r;
  });
  it('Extras · AI Booking Assistant 10: services tab separates manual prices from catalog prices, marks add-ons and totals the booking', async () => {
    bk.detail.mockResolvedValue({ ...row('r9', 'pending_confirmation', { appointmentId: 'a9', appointmentDate: '2026-11-07', appointmentTime: '10:00', appointmentStatus: 'booked', services: ['Gel Manicure', 'Nail Art'] }), branchId: 'b1',
      customer: { customerId: 'c1', name: 'Thảo Nguyễn', maskedPhone: '••• 1234', verified: false, appointments: [] },
      serviceLines: [
        { name: 'Gel Manicure', priceCents: 4000, durationMinutes: 45, serviceId: 's1', isAddon: false, manualOverride: true, overrideReason: 'Loyal guest', catalogPriceCents: 5000, catalogDurationMinutes: 45, inCatalog: true },
        { name: 'Nail Art', priceCents: 1500, durationMinutes: 15, serviceId: 's2', isAddon: true, parentServiceId: 's1', manualOverride: false, overrideReason: null, catalogPriceCents: 1500, catalogDurationMinutes: 15, inCatalog: true },
        { name: 'Old Service', priceCents: 900, durationMinutes: 10, serviceId: 's3', isAddon: false, manualOverride: false, overrideReason: null, catalogPriceCents: null, catalogDurationMinutes: null, inCatalog: false }],
      serviceSummary: { lines: 3, addOns: 1, totalPriceCents: 6400, totalDurationMinutes: 70, catalogTotalCents: null, overrides: 1, notInCatalog: 1 },
      timeline: [], verification: [], communications: [], holds: [], tools: [] });
    renderIt();
    fireEvent.click((await screen.findAllByTestId('bk-row'))[1]);
    fireEvent.click(await screen.findByTestId('bko-tab-services'));
    const lines = await screen.findAllByTestId('bko-svc-line');
    expect(lines).toHaveLength(3);
    expect(within(lines[0]).getByTestId('bko-svc-manual').textContent).toBe('Manual price');
    expect(within(lines[0]).queryByTestId('bko-svc-catalog')).toBeNull();
    expect(within(lines[0]).getByTestId('bko-svc-catalog-now').textContent).toContain('$50.00');
    expect(lines[0].textContent).toContain('Reason: Loyal guest');
    expect(within(lines[1]).getByTestId('bko-svc-addon')).toBeTruthy();
    expect(within(lines[1]).getByTestId('bko-svc-catalog').textContent).toBe('Catalog price');
    expect(within(lines[1]).queryByTestId('bko-svc-manual')).toBeNull();
    expect(within(lines[2]).getByTestId('bko-svc-gone')).toBeTruthy();
    expect(screen.getByTestId('bko-svc-total').textContent).toBe('Total $64.00 · 70 min');
    expect(screen.queryByTestId('bko-svc-catalog-total')).toBeNull();          // one line has no catalog price — no invented total
    expect(screen.getByTestId('bko-svc-overrides').textContent).toContain('1 manual price');
  });
  it('services tab from an older server (name / price / duration only) claims no catalog price', async () => {
    bk.detail.mockResolvedValue({ ...row('r1', 'confirmed', { appointmentId: 'a1', services: ['Gel Manicure'] }), branchId: 'b1', customer: { customerId: null, name: null, maskedPhone: null, verified: false, appointments: [] },
      serviceLines: [{ name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }], timeline: [], verification: [], communications: [], holds: [], tools: [] });
    renderIt();
    fireEvent.click((await screen.findAllByTestId('bk-row'))[1]);
    fireEvent.click(await screen.findByTestId('bko-tab-services'));
    const line = await screen.findByTestId('bko-svc-line');
    expect(line.textContent).toContain('$45.00');
    expect(screen.queryByTestId('bko-svc-catalog')).toBeNull(); expect(screen.queryByTestId('bko-svc-manual')).toBeNull(); expect(screen.queryByTestId('bko-svc-gone')).toBeNull();
    expect(screen.queryByTestId('bko-svc-summary')).toBeNull();
  });
  it('Check AI Booking System words each part (EN / VI) and says it changes nothing', async () => {
    await setLanguage('vi');
    bk.runHealth.mockResolvedValue({ runId: 'h1', overall: 'DISABLED', checkedAt: '2026-11-04T15:00:00Z', note: '', checks: [
      { key: 'entitlement', status: 'DISABLED', evidence: 'x', failure: 'x', fix: 'x', owner: 'Owner', facts: { status: 'cancelled' }, checkedAt: '2026-11-04T15:00:00Z' },
      { key: 'technicians', status: 'READY', evidence: 'x', failure: null, fix: null, owner: 'Manager', facts: { total: 4 }, checkedAt: '2026-11-04T15:00:00Z' }] });
    renderIt();
    fireEvent.click(await screen.findByTestId('bk-check'));
    expect(await screen.findByText(/không gửi tin nhắn/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('bkh-run'));
    expect(await screen.findByText('4 thợ đang làm việc.')).toBeTruthy();
    expect(screen.getByTestId('bkh-entitlement').textContent).toContain('chủ tiệm');
  });
  it('recovery: Review alternatives shows POS Booking\'s real open times (suggestions only); Request manager approval needs what to approve and shows its state', async () => {
    bk.alternatives.mockResolvedValue({ key: 'failed:r3', date: '2026-11-04', serviceIds: [], preferredTechnicianId: null, totalOpen: 2, note: 'default', safety: 's',
      alternatives: [{ technicianId: 't1', technicianName: 'Lan', start: '10:30', preferred: false }, { technicianId: 't2', technicianName: 'Mai', start: '15:00', preferred: false }] });
    bk.requestApproval.mockResolvedValue({ key: 'failed:r3', approval: { created: true } });
    render(<MemoryRouter><POSAIBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('bk-rec-alternatives'));
    const slots = await screen.findAllByTestId('bk-rec-alt-slot');
    expect(slots.map((x) => x.textContent)).toEqual(['10:30 · Lan', '15:00 · Mai']);
    expect(screen.getByTestId('bk-rec-alt')).toHaveTextContent('nothing is held, booked or sent');
    expect(bk.alternatives).toHaveBeenCalledWith('failed:r3');
    fireEvent.click(screen.getByTestId('bk-rec-approval'));
    expect(screen.getByTestId('bk-rec-approval-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('bk-rec-approval-why'), { target: { value: 'Courtesy discount for the failed booking' } });
    bk.recovery.mockResolvedValue({ cases: [{ key: 'failed:r3', type: 'repeated_attempts', urgency: 'high', requestId: 'r3', at: '2026-11-03T15:08:00Z', customerName: 'Ava Kim', maskedPhone: '••• 9876', appointmentId: null, date: null, reason: null, source: 'AI_PHONE_RECEPTIONIST', attempts: 2, approval: { id: 'ap1', status: 'pending', at: '2026-11-04T15:00:00Z' } }], dismissedCount: 0, note: '' });
    fireEvent.click(screen.getByTestId('bk-rec-approval-go'));
    await waitFor(() => expect(bk.requestApproval).toHaveBeenCalledWith('failed:r3', 'Courtesy discount for the failed booking'));
    expect(await screen.findByTestId('bk-rec-approval-state')).toHaveTextContent('Manager approval: waiting');
    expect(screen.queryByTestId('bk-rec-approval')).toBeNull();   // a live request is not asked again
  });
});
