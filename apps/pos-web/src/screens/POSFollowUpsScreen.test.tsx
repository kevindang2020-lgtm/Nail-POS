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
  it('extras row 11 contact cooldown timeline: the task details list what actually went out to this customer in the last 14 days (unsent drafts, older items and this task excluded); a role without access sees "not available", never "nothing sent"', async () => {
    window.history.replaceState(null, '', '/follow-ups');
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const detail = { id: 't1', status: 'pending', businessDate: '2026-10-30', customerId: 'c-t1', customerName: 'Olivia Brown', customerPhone: null, customerHasApp: true, technicianId: 'te1', technicianName: 'Linh Tran',
      serviceName: 'Gel Manicure', ticketId: 'k1', ticketNumber: '1001', appointmentId: null, completedAt: null, createdAt: null, submittedAt: null, sentAt: null, expiredAt: null, rejectedAt: null, templateKey: null, draft: 'Thanks for visiting!', sentMessage: null, delivery: null };
    const timeline = { customer: { id: 'c-t1', name: 'Olivia Brown' }, channel: 'all', capped: false, links: { profile: '', booking: '' }, page: 1, pageSize: 50, totalItems: 5, totalPages: 1, items: [
      { kind: 'notification', id: 'n1', channel: 'sms', direction: 'outbound', at: ago(2), type: 'reminder', status: 'delivered', summary: null },
      { kind: 'receipt', id: 'r1', channel: 'email', direction: 'outbound', at: ago(5), type: 'receipt', status: 'sent', summary: 'Receipt 1001' },
      { kind: 'follow_up', id: 't1', channel: 'follow_up', direction: 'outbound', at: ago(0), type: 'followup', status: 'pending', summary: 'Gel Manicure' },
      { kind: 'follow_up', id: 'f0', channel: 'follow_up', direction: 'outbound', at: ago(1), type: 'followup', status: 'skipped', summary: 'Pedicure' },
      { kind: 'inbound_message', id: 'i1', channel: 'sms', direction: 'inbound', at: ago(1), type: 'conversation', status: 'received', summary: null },
      { kind: 'notification', id: 'n0', channel: 'sms', direction: 'outbound', at: ago(30), type: 'marketing', status: 'delivered', summary: null },
    ] };
    let timelineStatus = 200;
    const base = mockFetch();
    const f = vi.fn(async (u: any, _init?: any) => {
      const url = String(u);
      const r = url.includes('/eod-follow-ups/tasks/t1') ? { status: 200, body: detail }
        : url.includes('/contact-check') ? { status: 200, body: { taskId: 't1', category: 'eligible', categories: ['eligible'], channel: 'customer_app', cooldownHours: 72, lastFollowUp: null, otherChannel: null, optOuts: [], marketing: { sms: true, email: true }, upcomingBooking: null, priority: 'normal', priorityReasons: [], priorityVersion: 'v1' } }
        : url.includes('/follow-up-queue/customers/') ? { status: 200, body: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 } }
        : url.includes('/customer-notifications/customers/c-t1/timeline') ? (timelineStatus === 200 ? { status: 200, body: timeline } : { status: 403, body: { code: 'PERMISSION_DENIED', message: 'no' } })
        : null;
      if (!r) return base(u);
      return { ok: r.status < 400, status: r.status, json: async () => r.body, headers: { get: () => null } } as any;
    });
    globalThis.fetch = f as any;
    view();
    fireEvent.click((await screen.findAllByTestId('fuq-row-details'))[0]);
    const rows = await screen.findAllByTestId('fuq-d-recent-row');
    expect(rows).toHaveLength(2);                                   // the reminder text 2 days ago + the emailed receipt 5 days ago
    expect(rows[0]).toHaveTextContent('Message'); expect(rows[0]).toHaveTextContent('SMS');
    expect(rows[1]).toHaveTextContent('Receipt 1001');
    expect(screen.getByText('Messages sent to this customer — last 14 days')).toBeInTheDocument();
    expect(f.mock.calls.some((c: any[]) => String(c[0]).includes('/customer-notifications/customers/c-t1/timeline') && String(c[0]).includes('pageSize=50'))).toBe(true);
    // read only: nothing was posted by opening the details
    expect(f.mock.calls.some((c: any[]) => (c[1]?.method ?? 'GET') !== 'GET')).toBe(false);
    // a role that may not read the customer timeline
    fireEvent.click(screen.getByTestId('fuq-d-close'));
    timelineStatus = 403;
    fireEvent.click((await screen.findAllByTestId('fuq-row-details'))[0]);
    expect(await screen.findByTestId('fuq-d-recent-na')).toHaveTextContent('Recent messages are not available for your role.');
    expect(screen.queryByTestId('fuq-d-recent-none')).toBeNull();
  });
  it('extras FOLLOW-UP QUEUE 05: a task whose visit was voided or had its service removed shows "Visit cancelled" in the contact check (server category), as a blocking chip', async () => {
    window.history.replaceState(null, '', '/follow-ups');
    const detail = { id: 't1', status: 'pending', businessDate: '2026-10-30', customerId: 'c-t1', customerName: 'Olivia Brown', customerPhone: null, customerHasApp: true, technicianId: 'te1', technicianName: 'Linh Tran',
      serviceName: 'Gel Manicure', ticketId: 'k1', ticketNumber: '1001', appointmentId: null, completedAt: null, createdAt: null, submittedAt: null, sentAt: null, expiredAt: null, rejectedAt: null, templateKey: null, draft: 'Thanks for visiting!', sentMessage: null, delivery: null };
    const base = mockFetch();
    const f = vi.fn(async (u: any, _init?: any) => {
      const url = String(u);
      const r = url.includes('/eod-follow-ups/tasks/t1') ? { status: 200, body: detail }
        : url.includes('/contact-check') ? { status: 200, body: { taskId: 't1', category: 'source_cancelled', categories: ['source_cancelled'], channel: 'customer_app', cooldownHours: 72, lastFollowUp: null, otherChannel: null, optOuts: [], marketing: { sms: true, email: true }, upcomingBooking: null, priority: 'normal', priorityReasons: [], priorityVersion: 'v1' } }
        : url.includes('/follow-up-queue/customers/') ? { status: 200, body: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 } }
        : null;
      if (!r) return base(u);
      return { ok: r.status < 400, status: r.status, json: async () => r.body, headers: { get: () => null } } as any;
    });
    globalThis.fetch = f as any;
    view();
    fireEvent.click((await screen.findAllByTestId('fuq-row-details'))[0]);
    const chip = await screen.findByTestId('fuq-d-category');
    expect(chip).toHaveTextContent('Visit cancelled (ticket voided, reopened or service removed) — cannot be sent');
    expect(chip.className).toContain('bad');
    expect(f.mock.calls.some((c: any[]) => (c[1]?.method ?? 'GET') !== 'GET')).toBe(false);   // read only
  });
  it('extras END-OF-DAY FOLLOW-UPS 07 / 11: a customer who texted STOP shows Opted Out (server category), the STOP line says it is enforced, and Send is disabled', async () => {
    window.history.replaceState(null, '', '/follow-ups');
    const detail = { id: 't1', status: 'pending', businessDate: '2026-10-30', customerId: 'c-t1', customerName: 'Olivia Brown', customerPhone: null, customerHasApp: true, technicianId: 'te1', technicianName: 'Linh Tran',
      serviceName: 'Gel Manicure', ticketId: 'k1', ticketNumber: '1001', appointmentId: null, completedAt: null, createdAt: null, submittedAt: null, sentAt: null, expiredAt: null, rejectedAt: null, templateKey: null, draft: 'Thanks for visiting!', sentMessage: null, delivery: null };
    const base = mockFetch();
    const f = vi.fn(async (u: any, _init?: any) => {
      const url = String(u);
      const r = url.includes('/eod-follow-ups/tasks/t1') ? { status: 200, body: detail }
        : url.includes('/contact-check') ? { status: 200, body: { taskId: 't1', category: 'opted_out', categories: ['opted_out'], channel: 'customer_app', cooldownHours: 72, lastFollowUp: null, otherChannel: null,
          optOuts: [{ channel: 'sms', at: '2026-10-29T15:00:00Z', enforced: true }], marketing: { sms: false, email: true }, upcomingBooking: null, priority: 'normal', priorityReasons: [], priorityVersion: 'v1' } }
        : url.includes('/follow-up-queue/customers/') ? { status: 200, body: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 } }
        : null;
      if (!r) return base(u);
      return { ok: r.status < 400, status: r.status, json: async () => r.body, headers: { get: () => null } } as any;
    });
    globalThis.fetch = f as any;
    view();
    fireEvent.click((await screen.findAllByTestId('fuq-row-details'))[0]);
    const chip = await screen.findByTestId('fuq-d-category');
    expect(chip).toHaveTextContent('Opted Out'); expect(chip.className).toContain('bad');
    expect(screen.getByTestId('fuq-d-optout-sms')).toHaveTextContent(/Texted STOP on .* no follow-up is sent to this customer on any channel, and it cannot be overridden/);
    expect(screen.getByTestId('fuq-d-send')).toBeDisabled();
    expect(f.mock.calls.some((c: any[]) => (c[1]?.method ?? 'GET') !== 'GET')).toBe(false);
  });
});
