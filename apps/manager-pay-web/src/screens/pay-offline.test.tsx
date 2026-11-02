// pay-offline.test.tsx — BUILD_PLAN Phase 13 (Constitution 6 §19): Manager Tap to Pay on the query layer. The checkout queue
// is server state (scoped key, stream-invalidated) but NEVER written to the device store, and the app's journal sender
// refuses — a payment can never be queued or replayed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MobileQueryProvider, MemoryKvStore, createMutationJournal, JournalRefusedError, type QueryScope } from '@aipowersalon/mobile-sdk';

vi.mock('../shell/nav', () => ({ usePayNav: () => ({ go: vi.fn(), open: vi.fn(), openTicket: vi.fn() }) }));
vi.mock('../lib/useCheckoutStream', () => ({ useCheckoutStream: () => {}, useSentToThisPhone: () => {} }));
vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { queue: vi.fn(), readiness: vi.fn().mockResolvedValue(null) } }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';
import { CheckoutQueueScreen } from './CheckoutQueueScreen';
import { refuseJournal } from '../lib/queryLayer';

const S: QueryScope = { realm: 'tenant', tenantId: 't1', branchId: 'b1', userId: 'm1' };
let store: MemoryKvStore;
beforeEach(() => { vi.clearAllMocks(); store = new MemoryKvStore(); });
afterEach(() => cleanup());

describe('manager-pay', () => {
  it('the checkout queue renders and nothing reaches the device store', async () => {
    (mobileCheckoutApi.queue as any).mockResolvedValue({ items: [{ ticketId: 'k1', ticketNumber: 'T-77', customerName: 'Jane Doe', totalCents: 9900, status: 'ready', services: [] }] });
    render(<MobileQueryProvider app="manager-pay" scope={S} send={refuseJournal} store={store}><CheckoutQueueScreen /></MobileQueryProvider>);
    expect((await screen.findAllByText(/Jane Doe/)).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 700));
    expect(await store.keys()).toEqual([]);
  });
  it('a charge can never be journaled, and the sender refuses any replay', async () => {
    const j = createMutationJournal({ app: 'manager-pay', store, send: refuseJournal, isOnline: () => false });
    j.setScope(S);
    await expect(j.run({ resourceType: 'ticket', resourceId: 'k1', operation: 'pay.charge', method: 'POST', path: '/mobile-checkout/tickets/k1/charge', body: { amountCents: 100 }, offline: 'queue', ttlMs: 1000 })).rejects.toBeInstanceOf(JournalRefusedError);
    await expect(refuseJournal({ method: 'POST', path: '/x', idempotencyKey: 'k-12345678' })).rejects.toMatchObject({ code: 'JOURNAL_REFUSED' });
    await waitFor(async () => expect(await store.keys()).toEqual([]));
  });
});
