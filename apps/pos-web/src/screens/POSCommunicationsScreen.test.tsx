import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { POSCommunicationsScreen } from './POSCommunicationsScreen';
import { posCommunicationsApi } from '../api/posCommunicationsApi';

vi.mock('../api/posCommunicationsApi', () => {
  // the screen reads the Communications Inbox API (inbox.list / summary / detail …) — the old getState / getThread shape is retired
  const thread = { id: 'c0330000-0000-4000-8000-000000000001', branchId: null, branchName: null, customerId: 'c1', displayName: 'Olivia Brown', identity: 'linked', contactMasked: '(•••) •••-4567', channel: 'sms', status: 'open',
    assignedTo: null, assignedToName: null, unreadCount: 1, lastActivityAt: '2026-06-06T14:00:00Z', lastMessagePreview: "Hi! I'd like to book a gel mani", lastDirection: 'inbound',
    awaitingSince: '2026-06-06T14:00:00Z', followUpDueAt: null, version: 1, createdAt: '2026-06-06T14:00:00Z' };
  const page = { items: [thread], total: 1, page: 1, pageSize: 20, pageCount: 1, sort: 'recent', period: { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-06-06' }, branch: null };
  const summary = { scope: { branch: null, tz: 'America/New_York' }, conversations: { total: 1, open: 1, unreadThreads: 1, unreadMessages: 1, replied: 0, missed: 0, awaiting: 1, oldestAwaitingSince: null },
    channelMix: [{ channel: 'sms', count: 1 }], sentToday: { total: 12, submitted: 12, delivered: 10, failed: 0, simulated: 0 }, definitions: {}, generatedAt: '2026-06-06T14:00:00Z' };
  const detail = { thread: { ...thread, contact: '(555) 123-4567', customerMatch: 'linked', closedAt: null, lastInboundAt: '2026-06-06T14:00:00Z' },
    customer: { id: 'c1', name: 'Olivia Brown', phone: '(555) 123-4567', email: null, marketingSmsOptIn: true, archived: false }, consent: { smsOptedOut: false, marketingSmsOptIn: true },
    nextAppointment: null, ambiguousCandidates: 0, olderCursor: null, permissions: { canSend: true, canManage: true },
    composer: { enabled: true, reasonCode: null, readiness: null },
    messages: [{ id: 'm1', threadId: 'c0330000-0000-4000-8000-000000000001', direction: 'inbound', channel: 'sms', body: 'Hi! I would like to book a gel mani this weekend.', authorKind: 'customer', authorName: null, createdAt: '2026-06-06T14:00:00Z',
      delivery: 'received', reasonCode: null, providerErrorCode: null, deliveredAt: null, mediaCount: 0 }] };
  const ok = (v: unknown) => vi.fn().mockResolvedValue(v);
  return {
    posCommunicationsApi: {
      inbox: { list: ok(page), summary: ok(summary), sourceCampaigns: ok({ items: [{ value: 'rsms:11111111-1111-4111-8111-111111111111', name: 'October win-back', kind: 'rsms', sentAt: null }], windowDays: 14 }), detail: ok(detail), read: ok({}), unread: ok({}), readAll: ok({ cutoff: '2026-06-06T14:05:00.000Z', branch: null, marked: 1, skippedNewer: 2 }), reply: vi.fn(), status: vi.fn(), assign: vi.fn(), followUp: vi.fn(), linkCustomer: vi.fn(),
        customers: ok({ items: [] }), staff: ok({ items: [] }), templates: ok({ items: [] }), renderTemplate: vi.fn(), older: ok({ messages: [], olderCursor: null }), start: vi.fn(), timeline: ok({ items: [] }) },
      getActivity: vi.fn().mockResolvedValue({
        windowDays: 30,
        messagesSentToday: { value: 12, available: true },
        campaignDeliveryRatePct: { value: 93, available: true },
        aiCallsHandled: { value: 4, available: true },
        reviewRequestsSent: { value: 7, available: true },
        avgResponseMinutes: { value: 15, available: true },
        rebookingConversionPct: { value: null, available: false, reason: 'Rebooking conversion needs campaign→booking attribution, which nothing records yet' },
      }),
    },
  };
});

describe('POSCommunicationsScreen', () => {
  it('renders the inbox + KPIs + hub modules, and opens a conversation on click', async () => {
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);

    // inbox list + KPIs
    expect(await screen.findByText('Olivia Brown')).toBeInTheDocument();
    expect(screen.getByText('Open Conversations')).toBeInTheDocument();
    expect(screen.getByText('Total Conversations')).toBeInTheDocument();
    // T14 hub modules
    expect(screen.getByText('Channel Mix')).toBeInTheDocument();
    expect(screen.getByText('AI Receptionist & Missed Calls')).toBeInTheDocument();
    expect(screen.getByText('Campaign Center')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // empty conversation pane prompt
    expect(screen.getByText('Select a conversation')).toBeInTheDocument();

    // open the thread → conversation messages render
    fireEvent.click(screen.getByText('Olivia Brown'));
    expect(await screen.findByText('Hi! I would like to book a gel mani this weekend.')).toBeInTheDocument();
  });

  it('Open AI Receptionist and Open Templates navigate to their REAL screens (both exist now)', async () => {
    // History: these buttons once navigated to unregistered routes (dead-end), then honestly said "isn't connected
    // yet" while the screens didn't exist. Both screens have since been BUILT and routed (/tenant/ai/receptionist,
    // /tenant/communications/templates) — so the honest-disclosure message itself became the lie. They navigate now.
    render(
      <MemoryRouter initialEntries={["/tenant/communications"]}>
        <Routes>
          <Route path="/tenant/communications" element={<POSCommunicationsScreen />} />
          <Route path="/tenant/communications/ai-receptionist" element={<div>AI-RECEPTIONIST-SCREEN</div>} />
          <Route path="/tenant/communications/templates" element={<div>TEMPLATES-SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Olivia Brown');
    fireEvent.click(screen.getByText('Open AI Receptionist'));
    expect(await screen.findByText('AI-RECEPTIONIST-SCREEN')).toBeInTheDocument();
  });

  it('renders the activity metrics from their real sources, and shows an unavailable one as — not 0', async () => {
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Messages Sent Today')).toBeInTheDocument();
    expect((await screen.findAllByText('12')).length).toBeGreaterThan(0);
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('15 m')).toBeInTheDocument();
    // rebooking conversion has no source — it must read as not-tracked, never as 0%
    expect(screen.getByText('Rebooking Conv.')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText(/not tracked yet/i).length).toBeGreaterThanOrEqual(1);
  });

  it('C2 gap: the source-campaign filter sends the campaign and goes back to page 1', async () => {
    const { posCommunicationsApi } = await import('../api/posCommunicationsApi');
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    const sel = await screen.findByTestId('ci-campaign');
    fireEvent.change(sel, { target: { value: 'rsms:11111111-1111-4111-8111-111111111111' } });
    await waitFor(() => expect((posCommunicationsApi.inbox.list as any)).toHaveBeenLastCalledWith(expect.objectContaining({ campaign: 'rsms:11111111-1111-4111-8111-111111111111', page: '1' })));
  });
  it('Extras SMS-14: performance shows the source timestamps ("—" when none) and unknown / partial warnings', async () => {
    const base = { scope: { branch: null, tz: 'America/New_York' }, conversations: { total: 1, open: 1, unreadThreads: 1, unreadMessages: 1, replied: 0, missed: 0, awaiting: 1, oldestAwaitingSince: null },
      channelMix: [{ channel: 'sms', count: 1 }], sentToday: { total: 2, submitted: 1, delivered: 0, failed: 0, simulated: 1 }, definitions: {}, generatedAt: '2026-06-06T14:00:00Z' };
    const summary = posCommunicationsApi.inbox.summary as unknown as ReturnType<typeof vi.fn>;
    summary.mockResolvedValue({ ...base, freshness: { conversationsAt: '2026-06-06T13:00:00Z', messagesAt: '2026-06-06T13:00:00Z', callsAt: null, deliveryCallbacksAt: null,
      warnings: [{ metric: 'missed', kind: 'unknown', reason: 'no_call_records', count: null }, { metric: 'sentToday', kind: 'partial', reason: 'simulated_sends', count: 1 }] } });
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    const f = await screen.findByTestId('ci-freshness');
    expect(f.textContent).toMatch(/calls: — · delivery callbacks: —/);
    expect(f.textContent).not.toMatch(/messages: —/);
    expect(screen.getByTestId('ci-fr-missed').textContent).toBe('Missed calls unknown: no call has ever been recorded here, so 0 may not be real');
    expect(screen.getByTestId('ci-fr-sentToday').textContent).toMatch(/Sent today partial: 1 test send\(s\) without a provider/);
    summary.mockResolvedValue(base);
  });
  it('Extras SMS-12: a stale status-callback webhook is warned about from timestamps — waiting texts are not counted as failed', async () => {
    const base = { scope: { branch: null, tz: 'America/New_York' }, conversations: { total: 1, open: 1, unreadThreads: 1, unreadMessages: 1, replied: 0, missed: 0, awaiting: 1, oldestAwaitingSince: null },
      channelMix: [{ channel: 'sms', count: 1 }], sentToday: { total: 12, submitted: 12, delivered: 10, failed: 0, simulated: 0 }, definitions: {}, generatedAt: '2026-06-06T14:00:00Z' };
    const summary = posCommunicationsApi.inbox.summary as unknown as ReturnType<typeof vi.fn>;
    summary.mockResolvedValue({ ...base, callbacks: { state: 'stale', awaiting: 3, oldestAwaitingAt: '2026-06-06T10:00:00Z', lastCallbackAt: null, waitMinutes: 30, lookbackDays: 7 } });
    const { unmount } = render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    const w = await screen.findByTestId('callback-warning');
    expect(w.textContent).toMatch(/3 sent texts have had no delivery update for over 30 min/);
    expect(w.textContent).toMatch(/last callback: none received/);
    expect(w.textContent).toMatch(/not counted as failed/);
    expect(screen.getByTestId('callback-fix')).toBeInTheDocument();
    unmount();
    summary.mockResolvedValue({ ...base, callbacks: { state: 'ok', awaiting: 0, oldestAwaitingAt: null, lastCallbackAt: '2026-06-06T13:00:00Z', waitMinutes: 30, lookbackDays: 7 } });
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    await screen.findByText('Olivia Brown');
    expect(screen.queryByTestId('callback-warning')).toBeNull();
    summary.mockResolvedValue(base);
  });

  it('Extras Customer Notifications 03: Mark all as read asks first, sends the list-loaded cutoff, and says how many newer stayed unread', async () => {
    const readAll = posCommunicationsApi.inbox.readAll as unknown as ReturnType<typeof vi.fn>;
    readAll.mockClear();
    const before = Date.now();
    render(<MemoryRouter><POSCommunicationsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('ci-read-all'));
    expect(readAll).not.toHaveBeenCalled();                     // explicit: nothing happens until confirmed
    expect(screen.getByTestId('ci-read-all-confirm')).toHaveTextContent(/Newer texts stay unread/);
    fireEvent.click(screen.getByTestId('ci-read-all-no'));
    expect(screen.queryByTestId('ci-read-all-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('ci-read-all'));
    fireEvent.click(screen.getByTestId('ci-read-all-yes'));
    await waitFor(() => expect(readAll).toHaveBeenCalledTimes(1));
    const [cutoff, branch] = readAll.mock.calls[0];
    expect(new Date(cutoff).getTime()).toBeGreaterThanOrEqual(before - 1000);   // the moment the list was shown, not a later click
    expect(new Date(cutoff).getTime()).toBeLessThanOrEqual(Date.now());
    expect(branch).toBeNull();
    expect(await screen.findByTestId('ci-note')).toHaveTextContent('1 conversation(s) marked as read. 2 with newer texts stayed unread.');
  });
});
