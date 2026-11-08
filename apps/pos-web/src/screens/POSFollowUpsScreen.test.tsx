import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSFollowUpsScreen } from './POSFollowUpsScreen';

// Follow-Up Queue guide §05/§06/§17: the five counters with their basis, the server queue (overdue first), priority,
// Generate Now's result summary, the Missed Call type, and an honest "Unknown" when the counters fail to load.
const kpis = { date: '2026-10-31', timezone: 'America/New_York', basis: 'due_date', pending: 2, awaitingApproval: 1, sent: 3, skipped: 1, expired: 0, rebooked: 1, total: 6,
  overdueEarlier: 1, missedCalls: 2, updatedAt: '2026-10-31T20:00:00Z', generation: null };
const row = (id: string, name: string, due: string, overdue: boolean, priority: string) => ({ id, type: 'after_service', dueDate: due, overdue, status: 'pending', customerId: `c-${id}`,
  customerName: name, customerPhoneLast4: '0142', customerHasApp: true, serviceName: 'Gel Manicure', technicianId: 'te1', technicianName: 'Linh Tran', completedAt: null, createdAt: null,
  sentAt: null, reason: null, ticketId: 'k1', ticketNumber: '1001', appointmentId: null, priority, priorityReasons: overdue ? [{ code: 'overdue', at: null, detail: due }] : [] });
const tasks = { items: [row('t1', 'Olivia Brown', '2026-10-30', true, 'high'), row('t2', 'Mia Chen', '2026-10-31', false, 'normal')], total: 2, page: 1, pageSize: 20, totalPages: 1, view: 'queue', basis: 'due', status: 'unsent' };
const missed = { items: [{ id: 'm1', type: 'missed_call', customerId: null, customerName: null, callerLast4: '9999', at: '2026-10-31T15:00:00Z', aiHandled: false, state: 'awaiting_callback', recoveredAppointmentId: null }], total: 1, page: 1, pageSize: 20, totalPages: 1 };
const gen = { result: { businessDate: '2026-10-31', created: 0, skipped: 0, alreadyRan: false }, summary: { businessDate: '2026-10-31', status: 'completed', eligible: 4, created: 0, createdToday: 4, alreadyExisted: 4, skippedByReason: {}, failed: 0, error: null } };

function route(url: string, kpiFail = false) {
  if (url.includes('/follow-up-queue/kpis')) return kpiFail ? { status: 500, body: { message: 'boom' } } : { status: 200, body: kpis };
  if (url.includes('/follow-up-queue/missed-calls')) return { status: 200, body: missed };
  if (url.includes('/follow-up-queue/tasks')) return { status: 200, body: tasks };
  if (url.includes('/follow-up-queue/results')) return { status: 200, body: { from: '2026-10-01', to: '2026-10-31', timezone: 'America/New_York', windowDays: 30, funnel: { eligible: 6, generated: 6, sent: 3, deliveredToApp: 3, viewed: 1, bookedAfter: 1, returnVisits: 1 }, closed: { skipped: 1, expired: 0, unsent: 2 }, associatedRevenueCents: 7500, skipReasons: [], byTechnician: [], queueAge: { under1Day: 1, oneToThreeDays: 1, overThreeDays: 0 } } };
  if (url.includes('/follow-up-queue/generate')) return { status: 200, body: gen };
  if (url.includes('/eod-follow-ups/health')) return { status: 200, body: { overall: 'ready', rows: [] } };
  if (url.includes('/pos/follow-ups')) return { status: 200, body: { tasks: [], stats: {} } };
  return { status: 200, body: {} };
}
const mockFetch = (kpiFail = false) => vi.fn(async (u: any) => { const r = route(String(u), kpiFail); return { ok: r.status < 400, status: r.status, json: async () => r.body, headers: { get: () => null } } as any; });
const view = () => render(<MemoryRouter><POSFollowUpsScreen /></MemoryRouter>);

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSFollowUpsScreen — Follow-Up Queue', () => {
  it('shows the five counters with their written basis, the overdue task first with High priority, and the Generate Now result', async () => {
    globalThis.fetch = mockFetch() as any;
    view();
    expect(await screen.findByText('Follow-Up Queue')).toBeInTheDocument();
    for (const l of ['Pending', 'Sent', 'Skipped', 'Rebooked', 'Total Today']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(await screen.findByText(/All five counters count tasks whose due date is 2026-10-31/)).toBeInTheDocument();
    const rows = await screen.findAllByTestId('fuq-row');
    expect(rows[0]).toHaveTextContent('Olivia Brown'); expect(rows[0]).toHaveTextContent('Overdue'); expect(rows[0]).toHaveTextContent('High');
    fireEvent.click(screen.getByTestId('fuq-generate'));
    expect(await screen.findByTestId('fuq-gen-line')).toHaveTextContent('4 eligible · 0 created now · 4 already existed');
  });
  it('the Missed Call type is its own list with its callback state', async () => {
    globalThis.fetch = mockFetch() as any;
    view();
    fireEvent.click(await screen.findByTestId('fuq-type-missed_call'));
    expect(await screen.findByTestId('fuq-mc-row')).toHaveTextContent('Awaiting callback');
  });
  it('a failed counter load shows Unknown, never a fabricated zero', async () => {
    globalThis.fetch = mockFetch(true) as any;
    view();
    await waitFor(() => expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0));
    expect(screen.getByText(/They are not zero/)).toBeInTheDocument();
  });
  it('the original status tabs All / Pending / Sent / Skipped stay as tabs and filter the server list (SUNMI addendum §03, Nov 7 2026)', async () => {
    window.history.replaceState(null, '', '/follow-ups');   // an earlier test leaves ?type=missed_call (the screen reads its filters from the address)
    const f = mockFetch(); globalThis.fetch = f as any;
    view();
    const tabs = await screen.findByTestId('fuq-status-tabs');
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('fuq-tab-sent'));
    await waitFor(() => expect(f.mock.calls.map((c: any[]) => String(c[0])).some((u) => u.includes('/follow-up-queue/tasks') && u.includes('status=sent') && u.includes('view=history'))).toBe(true));
    expect(screen.getByTestId('fuq-tab-sent').getAttribute('aria-selected')).toBe('true');
  });
});
