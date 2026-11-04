// AIQueueCenter.test — A6 AI Queue guide (Nov 4 2026): Check AI Queue System, history search + numbered pages, the guest overlay.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
const { api } = vi.hoisted(() => ({ api: { history: vi.fn(), entryDetail: vi.fn(), panel: vi.fn(), lastHealth: vi.fn(), runHealth: vi.fn() } }));
vi.mock('../../api/posAIQueueAssignmentApi', async (orig) => ({ ...(await orig<typeof import('../../api/posAIQueueAssignmentApi')>()), posAIQueueAssignmentApi: api }));
import { AIQueueHealthDialog, AIQueueHistoryCard, AIQueueEntryOverlay } from './AIQueueCenter';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-11-04' };
const item = (n: number) => ({ decisionId: 'd' + n, queueEntryId: 'q' + n, recommendationId: null, decision: 'accepted', applied: true, reason: null, feedbackCode: null, decidedBy: 'u', createdAt: '2026-11-04T15:00:00Z',
  customerName: 'Guest ' + n, maskedPhone: '••• 1234', customerId: null, ticketId: null, appointmentId: null, entryStatus: 'in_service', technicianId: 't1', technicianName: 'Mia', previousTechnicianId: null, previousTechnicianName: null });
const page = (p: number, size = 20, total = 45) => ({ period, page: p, pageSize: size, totalItems: total, totalPages: Math.ceil(total / size), order: 'newest', items: Array.from({ length: Math.min(size, total - (p - 1) * size) }, (_, i) => item((p - 1) * size + i)) });
const check = (key: string, status: string, facts: Record<string, number | string> = {}) => ({ key, label: key, status, evidence: 'EN evidence', failure: null, fix: null, facts, checkedAt: '2026-11-04T15:00:00Z' });

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); window.history.replaceState(null, '', '/tenant/ai/queue'); });
afterEach(async () => { await setLanguage('en'); });

describe('Check AI Queue System', () => {
  it('shows the last run, runs again on request, words each part with its numbers; says it changes nothing', async () => {
    api.lastHealth.mockResolvedValue({ run: null });
    api.runHealth.mockResolvedValue({ runId: 'h1', overall: 'ATTENTION_REQUIRED', checkedAt: '2026-11-04T15:00:00Z', note: '', checks: [check('queue_sync', 'READY', { seen: 3, active: 3, inService: 1 }), check('schedules', 'ATTENTION_REQUIRED', { shifts: 0 })] });
    render(<AIQueueHealthDialog onClose={() => {}} />);
    expect(await screen.findByText(/No check has run/)).toBeTruthy();
    expect(screen.getByText(/assigns no one/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('aqh-run'));
    expect(await screen.findByText('The AI sees 3 active guest(s); the queue holds 3 active and 1 in service (last 24 hours).')).toBeTruthy();
    expect(screen.getByText(/No shifts today/)).toBeTruthy();
    expect(screen.getAllByTestId('aqh-status-ATTENTION_REQUIRED').length).toBe(2);   // the part + the overall
  });
  it('in Vietnamese', async () => {
    await setLanguage('vi');
    api.lastHealth.mockResolvedValue({ run: { runId: 'h1', overall: 'READY', checkedAt: '2026-11-04T15:00:00Z', note: '', checks: [check('technicians', 'READY', { total: 4, free: 2 })] } });
    render(<AIQueueHealthDialog onClose={() => {}} />);
    expect(await screen.findByText('4 thợ ở chi nhánh này; 2 thợ đang rảnh.')).toBeTruthy();
    expect(screen.getAllByText('Sẵn sàng').length).toBeGreaterThan(0);
  });
});

describe('Assignment history', () => {
  it('numbered pages and rows-per-page go to the server; newest first; filters land in the URL', async () => {
    api.history.mockImplementation(async (f: any) => page(f.page ?? 1, f.pageSize ?? 20));
    render(<AIQueueHistoryCard tick={0} roster={[{ technicianId: 't1', name: 'Mia' }]} onOpen={() => {}} />);
    expect((await screen.findAllByTestId('aqh-row')).length).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: /^Page 3$|^3$/ }));
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, pageSize: 20 })));
    fireEvent.change(screen.getByTestId('aqh-size'), { target: { value: '50' } });
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 50 })));
    fireEvent.click(screen.getByTestId('aqh-preset-yesterday'));
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'yesterday' })));
    expect(window.location.search).toContain('aqp=yesterday');
  });
  it('one search box goes to the server (not a filter of this page)', async () => {
    api.history.mockImplementation(async () => page(1));
    render(<AIQueueHistoryCard tick={0} roster={[]} onOpen={() => {}} />);
    await screen.findAllByTestId('aqh-row');
    fireEvent.change(screen.getByTestId('aqh-search'), { target: { value: '856 555 1234' } });
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith(expect.objectContaining({ q: '856 555 1234', page: 1 })), { timeout: 2000 });
  });
  it('a row opens the guest', async () => {
    api.history.mockResolvedValue(page(1, 20, 1));
    const onOpen = vi.fn();
    render(<AIQueueHistoryCard tick={0} roster={[]} onOpen={onOpen} />);
    fireEvent.click(await screen.findByTestId('aqh-row'));
    expect(onOpen).toHaveBeenCalledWith('q0');
  });
});

describe('Guest overlay', () => {
  const detail = { queueEntryId: 'q1', status: 'waiting', source: 'walk_in', priority: 'normal', isVip: false, checkedInAt: '2026-11-04T14:30:00Z', calledAt: null, startedAt: null, waitMinutes: 30,
    ticketId: null, appointmentId: 'a1', assignedTechnicianId: null, requestedServices: [{ serviceId: 's1', name: 'Gel Manicure' }], notes: null,
    customer: { customerId: 'c1aaaaaa-0000', name: 'Thảo Nguyễn', maskedPhone: '••• 1234', preferredTechnicianId: 't1', customerSince: null, paidVisits: 7, lastVisitAt: null },
    appointments: [{ appointmentId: 'a1', date: '2026-11-04', startAt: '2026-11-04T15:00:00Z', endAt: null, status: 'confirmed', source: 'online', technicianId: 't1', technicianName: 'Mia' }],
    events: [{ eventType: 'queue.item.updated', deliveryStatus: 'published', attempts: 1, occurredAt: '2026-11-04T14:31:00Z', publishedAt: null }] };
  it('tabs show verified facts apart from the AI suggestion (no confidence percentage); Assign hands the guest over; View Booking opens that day', async () => {
    api.entryDetail.mockResolvedValue(detail);
    api.panel.mockResolvedValue({ entry: {}, candidates: [{ technicianId: 't1', name: 'Mia', eligible: true, reasons: [] }], recommendation: { queueEntryId: 'q1', recommended: { technicianId: 't1', name: 'Mia', eligible: true, matchScore: 0.9, reasons: ['free_now'], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 45 }, alternates: [], confidence: 0.82, conflicts: [], warnings: [], requiredAction: 'assignable', ruleVersion: 'r', recoVersion: 'v', generatedAt: '2026-11-04T15:00:00Z' }, decisions: [], lock: null });
    const onAssign = vi.fn(), onViewBooking = vi.fn();
    render(<AIQueueEntryOverlay queueEntryId="q1" techName={(id) => (id === 't1' ? 'Mia' : '—')} onClose={() => {}} onAssign={onAssign} onViewBooking={onViewBooking} />);
    expect(await screen.findByText('Gel Manicure')).toBeTruthy();
    fireEvent.click(screen.getByTestId('aqo-tab-customer'));
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText(/customer record and paid tickets/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('aqo-tab-ai'));
    expect(screen.getByText(/A suggestion only/)).toBeTruthy();
    expect(screen.queryByText(/82%/)).toBeNull();
    fireEvent.click(screen.getByTestId('aqo-tab-audit'));
    expect(screen.getByTestId('aqo-panel-audit').textContent).toContain('Delivered');
    fireEvent.click(screen.getByTestId('aqo-booking'));
    expect(onViewBooking).toHaveBeenCalledWith('a1', '2026-11-04');
    fireEvent.click(screen.getByTestId('aqo-assign'));
    expect(onAssign).toHaveBeenCalledWith('q1');
  });
  it('a guest who has left the queue offers no Assign', async () => {
    api.entryDetail.mockResolvedValue({ ...detail, status: 'in_service' });
    api.panel.mockRejectedValue(new Error('gone'));
    render(<AIQueueEntryOverlay queueEntryId="q1" techName={() => 'Mia'} onClose={() => {}} onAssign={() => {}} />);
    await screen.findByText('Gel Manicure');
    expect(screen.queryByTestId('aqo-assign')).toBeNull();
  });
});
