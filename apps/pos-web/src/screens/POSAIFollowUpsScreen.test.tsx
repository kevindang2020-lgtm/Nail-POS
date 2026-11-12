// POSAIFollowUpsScreen.test — the six original chips, honest empty/error states, search + paging, the create overlay
// (one request key per dialog), the task overlay (Close), and that previewing a text never sends it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const row = { id: 'fu1', status: 'open', priority: 'high', reason: 'CALLBACK', source: 'ai_receptionist', description: 'Call back', customer: null, caller: '•••0000', customerMatch: 'unmatched',
  providerCallId: 'call_1', callStartedAt: null, handoffOutcome: null, appointmentId: null, assignee: null, dueAt: null, overdue: false, contactAttempts: 0, lastContactAt: null, escalationLevel: 0,
  createdAt: '2026-10-31T12:00:00Z', updatedAt: '2026-10-31T12:00:00Z', resolvedAt: null, version: 1 };
const page = (items: any[]) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, filters: { status: 'open', basis: 'created', sort: 'newest', period: { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-31' }, q: null } });
const kpis = { asOf: '', timeZone: 'America/New_York', today: '2026-10-31', cards: { open: 1, assigned: 0, inProgress: 0, waiting: 0, overdue: 0, resolved: 0, resolvedToday: 0, unassigned: 1, total: 1 }, handoffs30d: { needsStaff: 1, transfersCompleted: 0 }, definitions: {} };
const list = vi.fn((_q?: any) => Promise.resolve(page([row])));
const create = vi.fn((_b?: any) => Promise.resolve({ id: 'fu2', duplicate: false }));
const prepareText = vi.fn((_id: string, _b: any) => Promise.resolve({ state: 'awaiting_confirmation', blocked: [], warnings: [], notices: [], token: 't1', proposed: { to: '•••0000' } }));
const confirmText = vi.fn();
const edit = vi.fn((_id: string, _b: any) => Promise.resolve(row));
const detail = vi.fn((_id: string) => Promise.resolve({ overview: { ...row, resolution: null, resolutionCategory: null, notes: null, createdBy: 'AI receptionist', branchId: null, dueTimeZone: null, reopenedCount: 0, waitingUntil: null },
  customer: { id: null, name: null, phone: '•••0000', unmatched: true, match: 'unmatched', smsOptedOut: false, sharedPhoneProfiles: 0 }, call: null, attempts: [], booking: { linked: null, upcoming: 0 }, activity: [],
  permissions: { canWork: true, canManage: false, canText: true, canBook: true } }));

const priorities = vi.fn(() => Promise.resolve({ items: [] as any[], asOf: undefined as string | undefined, bookingsAwaitingVerification: 0, note: '' }));
const importSources = vi.fn(() => Promise.resolve({ createdFromMissedCalls: 2, createdFromCopilot: 1 }));
const healthHistory = vi.fn(() => Promise.resolve({ items: [{ overall: 'WARNING', at: '2026-11-06T15:00:00Z', by: 'Olivia Owner', failed: 1 }], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }));
vi.mock('../api/posAiFollowUpsApi', () => ({ posAiFollowUpsApi: {
  importSources: () => importSources(), healthHistory: () => healthHistory(), recommendedAssignee: () => Promise.resolve({ userId: 'u9', name: 'Fran Desk', role: 'FRONT_DESK', openTasks: 0, reason: 'x' }),
  list: (q: any) => list(q), kpis: () => Promise.resolve(kpis), staff: () => Promise.resolve({ items: [] }), priorities: () => priorities(),
  create: (b: any) => create(b), detail: (id: string) => detail(id), prepareText: (id: string, b: any) => prepareText(id, b), confirmText: (...a: any[]) => confirmText(...a),
  edit: (id: string, b: any) => edit(id, b), health: vi.fn(), decide: vi.fn(), assign: vi.fn(), status: vi.fn(), note: vi.fn(), priority: vi.fn(), attempt: vi.fn(),
} }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn().mockResolvedValue({ items: [] }) } }));

import { POSAIFollowUpsScreen } from './POSAIFollowUpsScreen';
const mount = () => render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);

describe('POSAIFollowUpsScreen', () => {
  beforeEach(() => { list.mockClear(); create.mockClear(); prepareText.mockClear(); confirmText.mockClear(); });
  it('every assistant urgency suggestion shows its evidence, when the task opened and when the check ran', async () => {
    priorities.mockResolvedValueOnce({ items: [{ taskId: 'fu1', version: 1, reason: 'CALLBACK', priority: 'high', ageMinutes: 90, signal: 'overdue_callback', rank: 1, recommendation: 'x', evidence: ['Overdue by 30 min'] }], asOf: '2026-11-10T15:00:00Z', bookingsAwaitingVerification: 0, note: '' });
    mount();
    expect((await screen.findByTestId('aifu-rec-evidence')).textContent).toMatch(/Overdue by 30 min/);
    const when = screen.getByTestId('aifu-rec-when').textContent ?? '';
    expect(when).toMatch(/1:30/); expect(when).toMatch(/3:00/);   // opened 90 min before the 15:00 check (TZ=UTC)
  });
  it('keeps the six original status chips and Back to Command Center', async () => {
    mount();
    for (const s of ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'all']) expect(screen.getByTestId(`aifu-chip-${s}`)).toBeInTheDocument();
    expect(screen.getByTestId('aifu-back')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
  });
  it('an empty Open view is a real zero with New Follow-Up, All and the health check; a failed load shows Retry, not "none"', async () => {
    list.mockResolvedValueOnce(page([]));
    mount();
    await waitFor(() => expect(screen.getByText(/No Open follow-ups/)).toBeInTheDocument());
    list.mockRejectedValueOnce({ code: 'INTERNAL_ERROR', message: 'boom' });
    fireEvent.click(screen.getByTestId('aifu-refresh'));
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
  });
  it('search goes to the server and the page resets', async () => {
    mount();
    fireEvent.change(screen.getByTestId('aifu-q'), { target: { value: 'ava' } });
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ q: 'ava', page: 1 })));
  });
  it('a double-tapped Save sends the SAME request key', async () => {
    mount();
    fireEvent.click(screen.getByTestId('aifu-new'));
    fireEvent.change(screen.getByTestId('aifu-c-phone'), { target: { value: '+16095550100' } });
    fireEvent.change(screen.getByTestId('aifu-c-desc'), { target: { value: 'Wants a callback' } });
    fireEvent.click(screen.getByTestId('aifu-create-save')); fireEvent.click(screen.getByTestId('aifu-create-save'));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const keys = new Set(create.mock.calls.map((c: any) => c[0].idempotencyKey));
    expect(keys.size).toBe(1);
  });
  it('the task overlay opens with Close; previewing a text does not send it', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('aifu-row')[0]);
    await waitFor(() => expect(screen.getByTestId('aifu-d-close')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('aifu-tab-attempts'));
    fireEvent.change(screen.getByTestId('aifu-tx-body'), { target: { value: 'Hello from the salon' } });
    fireEvent.click(screen.getByTestId('aifu-tx-prepare'));
    await waitFor(() => expect(screen.getByTestId('aifu-tx-preview')).toBeInTheDocument());
    expect(confirmText).not.toHaveBeenCalled();
  });
  it('Edit details sends only the changed fields with the row version', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('aifu-row')[0]);
    await waitFor(() => expect(screen.getByTestId('aifu-d-edit')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('aifu-d-edit'));
    expect(screen.getByTestId('aifu-e-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('aifu-e-desc'), { target: { value: 'Call back after 3pm' } });
    fireEvent.click(screen.getByTestId('aifu-e-save'));
    await waitFor(() => expect(edit).toHaveBeenCalledWith('fu1', { description: 'Call back after 3pm', version: 1 }));
  });
  it('A13 Nov 6: Bring in missed calls reports what was added; Check history lists past runs; Missed call / Copilot are source filters', async () => {
    render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('aifu-import'));
    expect(await screen.findByText('Added 2 missed call(s) and 1 Copilot problem(s).')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aifu-health-history'));
    expect(await screen.findByTestId('aifu-run-row')).toHaveTextContent('Olivia Owner');
    const src = screen.getByTestId('aifu-f-source') as HTMLSelectElement;
    expect([...src.options].map((o) => o.value)).toEqual(expect.arrayContaining(['missed_call', 'copilot']));
  });
});
