// react.test.tsx — the provider's lifecycle (Constitution 6 §18, §22, §35, §46–48): restore the scope's cache on launch,
// wipe it on logout and on a tenant / branch switch, replay the journal once on reconnect, show "offline · last updated"
// and the pending list.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { MobileQueryProvider, useScopedQuery, OfflineStatus, PendingMutations, useJournalRun, useStreamInvalidation, useServerStateReset } from './react';
import { MemoryKvStore } from './storage';
import { createAppQueryClient } from './client';
import { scopedKey, type QueryScope } from './scope';
import { persistNow, cacheStorageKey, CACHE_PREFIX } from './persist';
import { JOURNAL_PREFIX, type JournalSender } from './journal';
import { resetNetworkState } from '../network/network-state';

const A: QueryScope = { realm: 'tenant', tenantId: 't-a', branchId: 'b-1', userId: 'u-1' };
const B: QueryScope = { realm: 'tenant', tenantId: 't-b', branchId: 'b-1', userId: 'u-1' };

function setOnline(v: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });
  window.dispatchEvent(new Event(v ? 'online' : 'offline'));
}

function Queue({ fn }: { fn: () => Promise<{ who: string }> }) {
  const q = useScopedQuery({ key: ['tech', 'queue'], fn, persist: true });
  return <div><OfflineStatus updatedAt={q.dataUpdatedAt || undefined} failed={q.isError} /><span data-testid="who">{q.data?.who ?? (q.isError ? 'error' : 'loading')}</span></div>;
}

let store: MemoryKvStore;
beforeEach(() => { store = new MemoryKvStore(); setOnline(true); resetNetworkState(); });
afterEach(() => { cleanup(); setOnline(true); });

describe('restore + wipe', () => {
  it('a cached read renders offline with "last updated", without a network', async () => {
    const seed = createAppQueryClient();
    seed.setQueryDefaults(scopedKey(A, 'tech', 'queue'), { meta: { persist: true } });
    seed.setQueryData(scopedKey(A, 'tech', 'queue'), { who: 'Ann' });
    await persistNow(seed, { app: 'tech', store }, A);
    setOnline(false);
    const fn = async () => { throw Object.assign(new TypeError('Failed to fetch'), { status: 0, code: 'NETWORK_ERROR' }); };
    render(<MobileQueryProvider app="tech" scope={A} send={async () => ({})} store={store}><Queue fn={fn} /></MobileQueryProvider>);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Ann'));
    expect(screen.getByRole('status').textContent).toMatch(/You’re offline — showing saved data\. Last updated/);
  });

  it('logout (scope → null) clears memory, every persisted scope and the journal', async () => {
    // an entry of ANOTHER scope: the launch replay leaves it alone, so only the logout wipe can remove it
    await store.set(`${JOURNAL_PREFIX}:tech:x`, JSON.stringify({ id: 'x', scope: 'tenant:t-b:b-1:u-1', status: 'pending' }));
    let setScope!: (s: QueryScope | null) => void;
    function Harness() { const [s, set] = useState<QueryScope | null>(A); setScope = set; return <MobileQueryProvider app="tech" scope={s} send={async () => ({})} store={store}>{s ? <Queue fn={async () => ({ who: 'Ann' })} /> : <span>login</span>}</MobileQueryProvider>; }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Ann'));
    await waitFor(async () => expect(await store.get(cacheStorageKey('tech', A))).toContain('Ann'), { timeout: 2000 });
    act(() => setScope(null));
    await waitFor(async () => expect((await store.keys()).filter((k) => k.startsWith(CACHE_PREFIX) || k.startsWith(JOURNAL_PREFIX))).toEqual([]));
    expect(screen.getByText('login')).toBeTruthy();
  });

  it('a tenant switch never shows the previous salon’s rows and wipes its persisted cache', async () => {
    let setScope!: (s: QueryScope | null) => void;
    const fnFor = (s: QueryScope) => async () => ({ who: s.tenantId === 't-a' ? 'salon-A' : 'salon-B' });
    function Harness() { const [s, set] = useState<QueryScope | null>(A); setScope = set; return <MobileQueryProvider app="tech" scope={s} send={async () => ({})} store={store}><Queue key={s?.tenantId} fn={fnFor(s!)} /></MobileQueryProvider>; }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('salon-A'));
    await waitFor(async () => expect(await store.get(cacheStorageKey('tech', A))).toBeTruthy(), { timeout: 2000 });
    act(() => setScope(B));
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('salon-B'));
    expect(await store.get(cacheStorageKey('tech', A))).toBeNull();
  });
});

describe('explicit reset (owner salon switch)', () => {
  it('drops memory + every persisted scope of the app', async () => {
    let reset!: () => Promise<void>;
    function R() { reset = useServerStateReset(); return <Queue fn={async () => ({ who: 'Ann' })} />; }
    render(<MobileQueryProvider app="owner" scope={A} send={async () => ({})} store={store}><R /></MobileQueryProvider>);
    await waitFor(async () => expect(await store.get(cacheStorageKey('owner', A))).toContain('Ann'), { timeout: 2000 });
    await act(async () => { await reset(); });
    expect((await store.keys()).filter((k) => k.startsWith(`${CACHE_PREFIX}:owner:`))).toEqual([]);
  });
});

describe('journal through the provider', () => {
  it('an action tapped offline shows pending, then replays ONCE on reconnect with the same key', async () => {
    const calls: string[] = [];
    const send: JournalSender = async (r) => { calls.push(r.idempotencyKey); return { ok: true }; };
    let tap!: () => Promise<unknown>; const execKeys: string[] = [];
    function Btn() {
      const run = useJournalRun();
      tap = () => run({ resourceType: 'ticket', resourceId: 't1', operation: 'tech.start_service', method: 'POST', path: '/tech/tickets/t1/start-service', body: {}, offline: 'queue', ttlMs: 60_000, label: 'Start service' },
        async (k) => { execKeys.push(k); return {}; }, [['tech', 'queue']]);
      return <PendingMutations />;
    }
    render(<MobileQueryProvider app="tech" scope={A} send={send} store={store}><Btn /></MobileQueryProvider>);
    await waitFor(() => expect(tap).toBeTypeOf('function'));
    act(() => setOnline(false));
    await act(async () => { await tap(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Start service · Pending/));
    expect(execKeys).toEqual([]);
    act(() => setOnline(true));
    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    act(() => { window.dispatchEvent(new Event('online')); });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
  });
});

describe('realtime → invalidate', () => {
  it('a stream event refetches the screen’s keys', async () => {
    let n = 0; let fire!: (e: string) => void;
    function S() { const q = useScopedQuery({ key: ['tech', 'queue'], fn: async () => ({ who: `v${++n}` }) }); fire = useStreamInvalidation([['tech', 'queue']]); return <span data-testid="who">{q.data?.who}</span>; }
    render(<MobileQueryProvider app="tech" scope={A} send={async () => ({})} store={store}><S /></MobileQueryProvider>);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('v1'));
    act(() => fire('ticket.updated'));
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('v2'));
    act(() => fire('reconcile'));
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('v3'));
  });
  it('with an event filter, other events are ignored but reconcile always refetches', async () => {
    let n = 0; let fire!: (e: string) => void;
    function S() { const q = useScopedQuery({ key: ['x'], fn: async () => ({ who: `v${++n}` }) }); fire = useStreamInvalidation([['x']], ['queue.changed']); return <span data-testid="who">{q.data?.who}</span>; }
    render(<MobileQueryProvider app="tech" scope={A} send={async () => ({})} store={store}><S /></MobileQueryProvider>);
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('v1'));
    act(() => fire('chat.message'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('who').textContent).toBe('v1');
    act(() => fire('queue.changed'));
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('v2'));
  });
});

describe('OfflineStatus', () => {
  it('online and fresh: nothing; failed refresh while online: "Couldn’t refresh"', async () => {
    const { rerender } = render(<MobileQueryProvider app="tech" scope={A} send={async () => ({})} store={store}><OfflineStatus updatedAt={Date.now()} /></MobileQueryProvider>);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<MobileQueryProvider app="tech" scope={A} send={async () => ({})} store={store}><OfflineStatus updatedAt={Date.now()} failed /></MobileQueryProvider>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Couldn’t refresh — showing saved data/));
  });
});
