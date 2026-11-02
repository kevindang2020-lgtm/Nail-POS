// tech-offline.test.tsx — BUILD_PLAN Phase 13 (Constitution 6 §18, §21–23): the migrated Technician screens under the
// app's query layer. A cached Queue / Today / Ticket renders offline with "last updated"; Start Service tapped offline is
// journaled as PENDING (never sent), then replays ONCE with the same Idempotency-Key when the network returns.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MobileQueryProvider, MemoryKvStore, createAppQueryClient, persistNow, scopedKey, resetNetworkState, type JournalSender, type QueryScope } from '@aipowersalon/mobile-sdk';

vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back: vi.fn(), openTicket: vi.fn(), openQueue: vi.fn(), push: vi.fn(), setTab: vi.fn() }) }));
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', () => ({ techApi: { queue: vi.fn(), ticket: vi.fn(), ticketMembership: vi.fn(), startService: vi.fn(), dashboard: vi.fn(), startBreak: vi.fn(), endBreak: vi.fn(), earningsCanonical: vi.fn(), cashPending: vi.fn() } }));

import { techApi } from '../api/techApi';
import { QueueScreen } from './QueueScreen';
import { TicketDetailScreen } from './TicketDetailScreen';
import { TechDashboardScreen } from './TechDashboardScreen';
import { TechEarningsScreen } from './TechEarningsScreen';

const S: QueryScope = { realm: 'tenant', tenantId: 't-1', branchId: 'b-1', userId: 'u-1' };
const offlineErr = () => Object.assign(new TypeError('Failed to fetch'), { status: 0, code: 'NETWORK_ERROR' });
function setOnline(v: boolean) { Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); }
const queue = { turnPosition: 2, onBreak: false, myQueue: [{ ticketId: 'k1', ticketNumber: 'T-1', name: 'Jane Doe', serviceSummary: 'Gel', status: 'waiting', mine: true }], branchQueue: [] };
const ticket = { ticketId: 'T1', technicianId: 'u-1', status: 'accepted', ticketNumber: 'T-1', customerName: 'Jane Doe', services: [], version: 3 };

let store: MemoryKvStore;
beforeEach(() => { vi.clearAllMocks(); store = new MemoryKvStore(); setOnline(true); resetNetworkState(); (techApi.ticketMembership as any).mockResolvedValue({ hasMembership: false, membership: null, benefits: [] }); });
afterEach(() => { cleanup(); setOnline(true); });

async function seed(key: unknown[], data: unknown) {
  const c = createAppQueryClient(); c.setQueryDefaults(scopedKey(S, ...key), { meta: { persist: true } }); c.setQueryData(scopedKey(S, ...key), data);
  await persistNow(c, { app: 'tech', store }, S);
}

describe('Queue (migrated)', () => {
  it('online: renders the server queue (unchanged) and no offline banner', async () => {
    (techApi.queue as any).mockResolvedValue(queue);
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><QueueScreen /></MobileQueryProvider>);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });
  it('online: the queue is written to the offline read cache (secret-free) for next time', async () => {
    (techApi.queue as any).mockResolvedValue({ ...queue, streamToken: 'never-on-device' });
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><QueueScreen /></MobileQueryProvider>);
    await screen.findByText('Jane Doe');
    await waitFor(async () => { const raw = (await Promise.all((await store.keys()).map((k) => store.get(k)))).join(''); expect(raw).toContain('Jane Doe'); expect(raw).not.toContain('never-on-device'); }, { timeout: 2000 });
  });
  it('offline with a cached queue: shows it with "last updated"', async () => {
    await seed(['tech', 'queue'], queue);
    setOnline(false); (techApi.queue as any).mockRejectedValue(offlineErr());
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><QueueScreen /></MobileQueryProvider>);
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/You’re offline — showing saved data\. Last updated/)).toBeInTheDocument();
  });
  it('offline with nothing cached: the existing error state', async () => {
    setOnline(false); (techApi.queue as any).mockRejectedValue(Object.assign(offlineErr(), { message: 'No connection' }));
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><QueueScreen /></MobileQueryProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection');
  });
});

describe('Start Service offline', () => {
  it('is journaled as pending, not sent; replays once with the same key on reconnect', async () => {
    await seed(['tech', 'ticket', 'T1'], ticket);
    (techApi.ticket as any).mockRejectedValue(offlineErr());
    const sent: { path: string; key: string }[] = [];
    const send: JournalSender = async (r) => { sent.push({ path: r.path, key: r.idempotencyKey }); return { ...ticket, status: 'serving' }; };
    setOnline(false);
    render(<MobileQueryProvider app="tech" scope={S} send={send} store={store}><TicketDetailScreen ticketId="T1" /></MobileQueryProvider>);
    fireEvent.click(await screen.findByText('Start Service'));
    expect(await screen.findByText(/Start service · T-1 is pending/)).toBeInTheDocument();
    expect(screen.getByText(/Pending — will send when you’re back online/)).toBeInTheDocument();
    expect(techApi.startService).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    (techApi.ticket as any).mockResolvedValue({ ...ticket, status: 'serving' });
    act(() => setOnline(true));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].path).toBe('/tech/tickets/T1/start-service');
    await waitFor(() => expect(screen.queryByText(/Pending — will send/)).toBeNull());
    act(() => { window.dispatchEvent(new Event('online')); });
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toHaveLength(1);
  });
});

describe('Today + Earnings (migrated) offline', () => {
  it('Today: the cached overview renders offline with "last updated"', async () => {
    const d = { technician: { fullName: 'Mai Tran', initials: 'MT' }, overview: { appointmentsToday: 4 }, earnings: {}, currentService: null, availableActions: { canAcceptTicket: false }, assignedTicketId: null };
    await seed(['tech', 'today'], { d, offer: null });
    setOnline(false); (techApi.dashboard as any).mockRejectedValue(offlineErr());
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><TechDashboardScreen /></MobileQueryProvider>);
    expect(await screen.findByText(/You’re offline — showing saved data/)).toBeInTheDocument();
    expect(screen.queryByText('Loading today’s overview…')).toBeNull();
    expect(screen.getByText(/Mai/)).toBeInTheDocument();
  });
  it('Earnings: online renders; the cash-pending list is never persisted', async () => {
    (techApi.earningsCanonical as any).mockResolvedValue({ serviceCommissionCents: 1000, cardTipCents: 0, cashTipCents: 0, tipsCents: 0, retailCommissionCents: 0, bonusCents: null, guaranteeTopUpCents: null, adjustmentsCents: null, estimatedEarningsCents: 12345, status: 'estimated', tickets: 3, dateFrom: '', dateTo: '', lines: [] });   // lines ride with the canonical read (merge Oct 12)
    (techApi.cashPending as any).mockResolvedValue({ items: [{ confirmationId: 'c', ticketId: 't', paymentIntentId: 'pi_9', amountCents: 500, customerName: 'Cash Customer', ticketNumber: 'T-9', services: [] }] });
    render(<MobileQueryProvider app="tech" scope={S} send={async () => ({})} store={store}><TechEarningsScreen /></MobileQueryProvider>);
    await waitFor(async () => expect((await store.keys()).length).toBeGreaterThan(0), { timeout: 2000 });
    await waitFor(async () => { const raw = (await Promise.all((await store.keys()).map((k) => store.get(k)))).join(''); expect(raw).toContain('12345'); expect(raw).not.toContain('Cash Customer'); expect(raw).not.toContain('pi_9'); }, { timeout: 2000 });
  });
});
