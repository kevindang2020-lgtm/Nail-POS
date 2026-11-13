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
const healthRun = vi.fn((): Promise<any> => Promise.resolve({ overall: 'READY', checks: [], ranAt: '2026-11-06T15:00:00Z', cached: false }));
const edit = vi.fn((_id: string, _b: any) => Promise.resolve(row));
const detail = vi.fn((_id: string) => Promise.resolve({ overview: { ...row, resolution: null, resolutionCategory: null, notes: null, createdBy: 'AI receptionist', branchId: null, dueTimeZone: null, reopenedCount: 0, waitingUntil: null },
  customer: { id: null, name: null, phone: '•••0000', unmatched: true, match: 'unmatched', smsOptedOut: false, sharedPhoneProfiles: 0 }, call: null, attempts: [], booking: { linked: null, upcoming: 0 }, activity: [],
  permissions: { canWork: true, canManage: false, canText: true, canBook: true } }));

const priorities = vi.fn(() => Promise.resolve({ items: [] as any[], asOf: undefined as string | undefined, bookingsAwaitingVerification: 0, note: '' }));
const importSources = vi.fn(() => Promise.resolve({ createdFromMissedCalls: 2, createdFromCopilot: 1 }));
const healthHistory = vi.fn(() => Promise.resolve({ items: [{ overall: 'WARNING', at: '2026-11-06T15:00:00Z', by: 'Olivia Owner', failed: 1 }], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }));
const handover = vi.fn((_b: any) => Promise.resolve({ moved: 2, toUserId: 'u9', followUpIds: ['a', 'b'] }));
const alertSettings = vi.fn(() => Promise.resolve({ enabled: true, graceMinutes: 0, scope: 'default', updatedAt: null }));
const saveAlertSettings = vi.fn((b: any) => Promise.resolve({ ...b, scope: 'branch', updatedAt: '2026-11-13T12:00:00Z' }));
vi.mock('../api/posAiFollowUpsApi', () => ({ posAiFollowUpsApi: {
  handover: (b: any) => handover(b), alertSettings: () => alertSettings(), saveAlertSettings: (b: any) => saveAlertSettings(b),
  importSources: () => importSources(), healthHistory: () => healthHistory(), recommendedAssignee: () => Promise.resolve({ userId: 'u9', name: 'Fran Desk', role: 'FRONT_DESK', openTasks: 0, reason: 'x' }),
  list: (q: any) => list(q), kpis: () => Promise.resolve(kpis), staff: () => Promise.resolve({ items: [{ id: 'u9', name: 'Fran Desk', role: 'FRONT_DESK' }] }), priorities: () => priorities(),
  create: (b: any) => create(b), detail: (id: string) => detail(id), prepareText: (id: string, b: any) => prepareText(id, b), confirmText: (...a: any[]) => confirmText(...a),
  edit: (id: string, b: any) => edit(id, b), health: () => healthRun(), decide: vi.fn(), assign: vi.fn(), status: vi.fn(), note: vi.fn(), priority: vi.fn(), attempt: vi.fn(),
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
  it('round 10 (AI Follow Ups 04/09): Last-Contact Truth keeps reached / delivered apart; the Timeline tab lists everything in order', async () => {
    detail.mockImplementationOnce(() => Promise.resolve({ overview: { ...row, resolution: null, resolutionCategory: null, notes: null, createdBy: 'AI receptionist', branchId: null, dueTimeZone: null, reopenedCount: 0, waitingUntil: null },
      customer: { id: null, name: null, phone: '•••0000', unmatched: true, match: 'unmatched', smsOptedOut: false, sharedPhoneProfiles: 0 }, call: null, attempts: [], booking: { linked: null, upcoming: 0 }, activity: [],
      permissions: { canWork: true, canManage: false, canText: true, canBook: true },
      lastContact: { attempted: 3, reached: 0, lastAttempt: { at: '2026-11-12T15:00:00Z', channel: 'sms', outcome: 'submitted', attestation: false }, lastReached: null,
        texts: { total: 2, submitted: 1, providerAccepted: 0, delivered: 1, failed: 0, unknown: 0 }, lastVerified: { at: '2026-11-12T14:00:00Z', channel: 'sms', outcome: 'delivered' } },
      timeline: [{ at: '2026-11-12T13:00:00Z', kind: 'call', type: 'call_started', detail: null, actor: null }, { at: '2026-11-12T13:02:00Z', kind: 'handoff', type: 'transfer_failed', detail: null, actor: null },
        { at: '2026-11-12T13:03:00Z', kind: 'task', type: 'created', detail: null, actor: 'AI receptionist' }, { at: '2026-11-12T14:00:00Z', kind: 'attempt', type: 'sms', detail: 'delivered', actor: 'Fiona Desk' }] } as any));
    mount();
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('aifu-row')[0]);
    await waitFor(() => expect(screen.getByTestId('aifu-d-close')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('aifu-tab-attempts'));
    expect(screen.getByTestId('aifu-lc-counts')).toHaveTextContent('3 attempts · 0 actually reached');
    expect(screen.getByTestId('aifu-lc-texts')).toHaveTextContent('1 submitted (not confirmed) · 0 accepted by the provider · 1 delivered');
    expect(screen.getByTestId('aifu-lc-verified')).toHaveTextContent('Delivered');
    fireEvent.click(screen.getByTestId('aifu-tab-timeline'));
    const rows = screen.getAllByTestId('aifu-tl-row');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Call started'), expect.stringContaining('Transfer failed'), expect.stringContaining('Created'), expect.stringContaining('Delivered')]);
  });
  it('round 10 (AI Follow Ups 06 / 02): shift handover needs a colleague and a note; the overdue alert setting saves on/off + grace', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('aifu-handover'));
    expect(screen.getByTestId('aifu-ho-go')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('aifu-ho-to').querySelectorAll('option').length).toBe(2));
    fireEvent.change(screen.getByTestId('aifu-ho-to'), { target: { value: 'u9' } });
    expect(screen.getByTestId('aifu-ho-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('aifu-ho-note'), { target: { value: 'Going home' } });
    fireEvent.click(screen.getByTestId('aifu-ho-go'));
    await waitFor(() => expect(handover).toHaveBeenCalledWith({ toUserId: 'u9', note: 'Going home' }));
    expect(await screen.findByText('2 follow-up(s) handed over.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('aifu-alerts'));
    expect(await screen.findByTestId('aifu-al-scope')).toHaveTextContent('Using the default');
    fireEvent.change(screen.getByTestId('aifu-al-grace'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('aifu-al-save'));
    await waitFor(() => expect(saveAlertSettings).toHaveBeenCalledWith({ enabled: true, graceMinutes: 30 }));
    expect(await screen.findByTestId('aifu-al-scope')).toHaveTextContent('Set for this location.');
    fireEvent.click(screen.getByTestId('aifu-al-on'));
    expect(screen.getByTestId('aifu-al-grace')).toBeDisabled();
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
  it('AI Follow Ups 05: a customer reached recently by another task or an end-of-day follow-up shows a warning (none → no warning)', async () => {
    const base = await detail('x');
    detail.mockResolvedValueOnce({ ...base, recentContacts: [{ source: 'ai_follow_up', at: '2026-11-10T15:00:00Z', channel: 'phone_call', outcome: 'reached', by: 'Fiona Desk', ref: 't2' },
      { source: 'end_of_day', at: '2026-11-09T23:00:00Z', channel: 'customer_app', outcome: 'sent', by: 'Lan Tran', ref: 'e1' }] } as any);
    mount();
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('aifu-row')[0]);
    const w = await screen.findByTestId('aifu-d-recent');
    expect(w).toHaveTextContent('2 other contact(s) in the last 7 days');
    const rows = screen.getAllByTestId('aifu-d-recent-row');
    expect(rows[0]).toHaveTextContent('Another follow-up task'); expect(rows[0]).toHaveTextContent('Fiona Desk'); expect(rows[0]).toHaveTextContent('Reached');
    expect(rows[1]).toHaveTextContent('End-of-day technician follow-up'); expect(rows[1]).toHaveTextContent('Lan Tran'); expect(rows[1]).not.toHaveTextContent('sent');
    expect(w.querySelectorAll('button')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('aifu-d-close'));
    fireEvent.click(screen.getAllByTestId('aifu-row')[0]);
    await waitFor(() => expect(screen.getByTestId('aifu-d-close')).toBeInTheDocument());
    expect(screen.queryByTestId('aifu-d-recent')).toBeNull();
  });
});

describe('AI Follow-Ups — data-quality signals (extras #14)', () => {
  it('a row with server signals says "Check data" with each issue in words; a clean row shows nothing', async () => {
    list.mockImplementationOnce(() => Promise.resolve(page([{ ...row, dataQuality: ['missing_branch', 'unlinked_call', 'no_due'] }, { ...row, id: 'fu9', dataQuality: [] }])));
    render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(2));
    const dq = screen.getAllByTestId('aifu-dq');
    expect(dq).toHaveLength(1);
    expect(dq[0]).toHaveTextContent('Check data: no branch · call not found · no due time');
    expect(dq[0].textContent).not.toMatch(/missing_branch|unlinked_call/);
  });
});

describe('AI Follow-Ups — stale event reconciler (extras #07)', () => {
  it('Check lists each handoff with no follow-up; Create follow-up opens the form for that call and sends its call id — nothing is created until Save', async () => {
    healthRun.mockResolvedValueOnce({ overall: 'FAILED', ranAt: '2026-11-06T15:00:00Z', cached: false, checks: [{ domain: 'handoff_detection', status: 'FAILED', detail: '1 handoff', evidence: 'x', nextAction: 'Review', responsibleRole: 'Owner / manager', checkedAt: '',
      items: [{ eventId: 'e1', providerCallId: 'call_orphan_123456789', kind: 'callback_requested', reason: 'asked for a person', at: '2026-11-06T14:00:00Z' }] }] });
    render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('aifu-row')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('aifu-health'));
    const o = await screen.findByTestId('aifu-orphan');
    expect(o).toHaveTextContent('Callback requested'); expect(o).toHaveTextContent('asked for a person');
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('aifu-orphan-create'));
    expect(await screen.findByTestId('aifu-c-call')).toHaveTextContent('For call call_orphan_1234');
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('aifu-c-phone'), { target: { value: '+16095550199' } });
    fireEvent.change(screen.getByTestId('aifu-c-desc'), { target: { value: 'Call the guest back' } });
    fireEvent.click(screen.getByTestId('aifu-create-save'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ reason: 'CALLBACK', providerCallId: 'call_orphan_123456789', callerPhone: '+16095550199' });
  });
});
