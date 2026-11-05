// react.tsx — the React face of the server-state layer (Constitution 6 §24–27): ONE provider per app, mounted inside the
// auth provider, owns the QueryClient, the persisted read cache and the pending-mutation journal for the signed-in
// scope.
//   • scope null (signed out) → the in-memory cache, every persisted scope and the journal are wiped (logout);
//   • scope A → scope B (tenant / branch / user switch) → the cache and every persisted scope are wiped before B renders;
//   • on launch and whenever the network comes back → the journal replays (exactly once, same keys) and reads refetch.
// Screens use useScopedQuery / useStreamInvalidation / useJournal; outside a provider (unit tests that render one screen)
// each screen gets its own private client and journal, so a screen behaves exactly as it did before the migration.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClientProvider, useQuery, keepPreviousData, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createAppQueryClient } from './client';
import { scopedKey, scopeKey, type QueryScope } from './scope';
import { deviceKvStore, MemoryKvStore, type KvStore } from './storage';
import { restoreQueryCache, startQueryCachePersistence, wipePersistedQueryCache, cacheStorageKey, CACHE_PREFIX } from './persist';
import { createMutationJournal, type JournalEntry, type JournalSender, type MutationJournal, type MutationSpec, type RunResult } from './journal';
import { networkState } from '../network/network-state';
import { useNetworkState } from '../network/react';

interface Ctx { client: QueryClient; scope: QueryScope; journal: MutationJournal; reset: () => Promise<void> }
const QueryLayerCtx = createContext<Ctx | null>(null);
const NO_SCOPE: QueryScope = { realm: '-', tenantId: null, branchId: null, userId: null };
const noSend: JournalSender = async () => { throw Object.assign(new Error('offline replay is not available here'), { status: 0, code: 'NETWORK_ERROR' }); };

export interface MobileQueryProviderProps {
  app: string;
  /** From the auth provider's principal; null while signed out. */
  scope: QueryScope | null;
  /** Replays a journaled mutation: the app's transport, with `Idempotency-Key`. */
  send: JournalSender;
  store?: KvStore;
  client?: QueryClient;
  children: ReactNode;
}

export function MobileQueryProvider({ app, scope, send, store: storeIn, client: clientIn, children }: MobileQueryProviderProps) {
  const store = useMemo(() => storeIn ?? deviceKvStore(), [storeIn]);
  const [client] = useState(() => clientIn ?? createAppQueryClient());
  const sendRef = useRef(send); sendRef.current = send;
  const [journal] = useState(() => createMutationJournal({ app, store, send: (r) => sendRef.current(r), isOnline: () => networkState.isOnline() }));
  const id = scope ? scopeKey(scope) : null;
  const prev = useRef<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);   // the scope id whose persisted cache has been restored

  useEffect(() => {
    let alive = true; let stop = () => {};
    const was = prev.current; prev.current = id;
    journal.setScope(scope);
    (async () => {
      if (was && was !== id) {                                 // logout or switch: nothing of the old scope survives
        client.clear();
        await wipePersistedQueryCache(store, app);
      }
      if (!scope) { await journal.clear(); if (alive) setReady(null); return; }
      // stray blobs of other scopes (a switch the app was killed during) go too
      const keys = await store.keys().catch(() => [] as string[]);
      await Promise.all(keys.filter((k) => k.startsWith(`${CACHE_PREFIX}:${app}:`) && k !== cacheStorageKey(app, scope)).map((k) => store.remove(k).catch(() => undefined)));
      await restoreQueryCache(client, { app, store }, scope).catch(() => false);
      if (!alive) return;
      stop = startQueryCachePersistence(client, { app, store }, scope);
      setReady(id);
      void journal.replay().then((out) => { if (out.some((e) => e.status !== 'pending')) void client.invalidateQueries(); });   // launch: crash recovery
    })();
    return () => { alive = false; stop(); };
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // reconnect: replay the journal, then refetch what is on screen
  useEffect(() => {
    let last = networkState.get().status;
    return networkState.subscribe(() => {
      const now = networkState.get().status;
      if (now !== 'offline' && last === 'offline') void journal.replay().finally(() => { void client.invalidateQueries(); });
      last = now;
    });
  }, [client, journal]);

  const reset = useMemo(() => async () => { client.clear(); await wipePersistedQueryCache(store, app); }, [client, store, app]);
  const value = useMemo<Ctx>(() => ({ client, scope: scope ?? NO_SCOPE, journal, reset }), [client, id, journal, reset]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Signed out: render at once (login screen). Signed in: wait for the restore so a cached screen never flashes empty.
  const gate = !scope || ready === id;
  return <QueryClientProvider client={client}><QueryLayerCtx.Provider value={value}>{gate ? children : null}</QueryLayerCtx.Provider></QueryClientProvider>;
}

/** Outside a provider (a unit test that renders one screen): ONE shared fallback layer with nothing kept — no stale
 *  time, no cache once a query has no observer, memory-only journal — so every mount fetches fresh exactly as the screen's
 *  old useState/useEffect did, and the hooks of one component share a client. Apps always mount MobileQueryProvider. */
let fallback: Ctx | null = null;
function fallbackLayer(): Ctx {
  if (!fallback) {
    const client = createAppQueryClient();
    client.setDefaultOptions({ ...client.getDefaultOptions(), queries: { ...client.getDefaultOptions().queries, staleTime: 0, gcTime: 0 } });
    const journal = createMutationJournal({ app: 'local', store: new MemoryKvStore(), send: noSend, isOnline: () => networkState.isOnline() });
    journal.setScope({ ...NO_SCOPE, userId: 'local' });
    fallback = { client, scope: NO_SCOPE, journal, reset: async () => { client.clear(); } };
  }
  return fallback;
}
let fallbackUsers = 0;
function useLayer(): Ctx {
  const ctx = useContext(QueryLayerCtx);
  const layer = ctx ?? fallbackLayer();
  // the fallback forgets everything the moment the last component using it unmounts (each test starts clean)
  useEffect(() => {
    if (ctx) return;
    fallbackUsers++;
    return () => { if (--fallbackUsers === 0) { layer.client.clear(); void layer.journal.clear(); } };
  }, [ctx, layer]);
  return layer;
}

export function useQueryScope(): QueryScope { return useLayer().scope; }
export function useMobileQueryClient(): QueryClient { return useLayer().client; }
export function useMutationJournal(): MutationJournal { return useLayer().journal; }
/** A salon / branch switch the principal does not show (the Owner App's context switch): drop every cached read —
 *  memory and device — before the new salon's screens render. */
export function useServerStateReset(): () => Promise<void> { return useLayer().reset; }

export interface ScopedQueryOptions<T> {
  /** Key parts after the scope: ['tech', 'queue']. */
  key: unknown[];
  fn: () => Promise<T>;
  /** true: kept in the device read cache for offline (only for reads without secrets / payment details). */
  persist?: boolean;
  enabled?: boolean;
  staleTime?: number;
  /** Keep showing the previous key's data while a new key (a filter change) loads — as the screens did before. */
  keepPrevious?: boolean;
}
/** A server read keyed by [realm, tenant, branch, ...key]. */
export function useScopedQuery<T>(o: ScopedQueryOptions<T>): UseQueryResult<T, Error & { status?: number; code?: string }> {
  const { client, scope } = useLayer();
  return useQuery({ queryKey: scopedKey(scope, ...o.key), queryFn: () => o.fn(), meta: { persist: !!o.persist }, enabled: o.enabled, staleTime: o.staleTime,
    placeholderData: o.keepPrevious ? keepPreviousData : undefined }, client) as any;
}

/** Write a scoped read locally (an action's returned row) — the next fetch / stream event still has the last word. */
export function useScopedSetter(): <T>(key: unknown[], update: (prev: T | undefined) => T | undefined) => void {
  const { client, scope } = useLayer();
  return useMemo(() => <T,>(key: unknown[], update: (prev: T | undefined) => T | undefined) => { client.setQueryData<T>(scopedKey(scope, ...key), update); }, [client, scope]);
}

/** The realtime → query bridge: hand the result to the app's stream hook (`useTechStream(useStreamInvalidation(...))`).
 *  Any event — and 'reconcile' (resync / safety sync) — invalidates the given keys, so the screen refetches. */
export function useStreamInvalidation(keys: unknown[][], events?: readonly string[]): (event: string) => void {
  const { client, scope } = useLayer();
  const k = useRef(keys); k.current = keys;
  return useMemo(() => (event: string) => {
    if (events && event !== 'reconcile' && !events.includes(event)) return;
    for (const key of k.current) void client.invalidateQueries({ queryKey: scopedKey(scope, ...key) });
  }, [client, scope, events && events.join('|')]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** Run a mutation through the journal. `exec` is the first, live attempt (the app's typed API call with the key);
 *  replays after a reconnect / relaunch go through the provider's `send` with the same key. */
export function useJournalRun(): (spec: MutationSpec, exec: (idempotencyKey: string) => Promise<unknown>, invalidate?: unknown[][]) => Promise<RunResult> {
  const { journal, client, scope } = useLayer();
  return useMemo(() => async (spec, exec, invalidate = []) => {
    const r = await journal.run(spec, exec);
    if (r.status === 'applied') for (const key of invalidate) void client.invalidateQueries({ queryKey: scopedKey(scope, ...key) });
    return r;
  }, [journal, client, scope]);
}

/** This scope's journal entries (pending + settled outcomes), live. */
export function usePendingMutations(filter?: (e: JournalEntry) => boolean): JournalEntry[] {
  const journal = useMutationJournal();
  const [list, setList] = useState<JournalEntry[]>([]);
  const f = useRef(filter); f.current = filter;
  useEffect(() => {
    let alive = true;
    const load = () => { void journal.list().then((l) => { if (alive) setList(f.current ? l.filter(f.current) : l); }); };
    load();
    const off = journal.subscribe(load);
    return () => { alive = false; off(); };
  }, [journal]);
  return list;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** §16 / §18: "You're offline — Last updated 10:42 AM". Renders nothing while online and the data is fresh. */
export function OfflineStatus({ updatedAt, failed, className }: { updatedAt?: number; failed?: boolean; className?: string }) {
  const net = useNetworkState();
  const offline = net.status === 'offline';
  if (!offline && net.status !== 'degraded' && !failed) return null;
  const head = offline ? 'You’re offline' : net.status === 'degraded' ? 'Connection is unstable' : 'Couldn’t refresh';
  const tail = updatedAt ? ` — showing saved data. Last updated ${clock(updatedAt)}` : '';
  return (
    <div role="status" aria-live="polite" data-network={net.status} className={className ?? 'aps-offline-status'}
      style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: offline ? '#FEF3C7' : '#F1F5F9', color: offline ? '#92400E' : '#334155' }}>
      {head}{tail}
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  pending: 'Pending — will send when you’re back online', expired: 'Not sent — it expired', conflict: 'Not applied — it changed on the salon side',
  stale: 'Not applied — it was out of date', permission_revoked: 'Not applied — you no longer have permission', resource_changed: 'Not applied — it no longer exists',
  rejected: 'Not applied',
};
/** §23: the pending list + what happened to each queued action. The user dismisses settled outcomes. */
export function PendingMutations({ filter, className }: { filter?: (e: JournalEntry) => boolean; className?: string }) {
  const journal = useMutationJournal();
  const list = usePendingMutations(filter);
  if (!list.length) return null;
  return (
    <div role="status" aria-live="polite" className={className ?? 'aps-pending-mutations'} style={{ margin: '0 0 12px', display: 'grid', gap: 6 }}>
      {list.map((e) => (
        <div key={e.id} data-status={e.status} style={{ padding: '8px 12px', borderRadius: 10, fontSize: 13, background: e.status === 'pending' ? '#EFF6FF' : '#FEF2F2', color: e.status === 'pending' ? '#1E40AF' : '#991B1B', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}><strong>{e.label ?? e.operation}</strong> · {OUTCOME_TEXT[e.status] ?? e.status}{e.status !== 'pending' && e.message ? ` (${e.message})` : ''}</span>
          {e.status !== 'pending' ? <button type="button" onClick={() => void journal.dismiss(e.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 700 }} aria-label="Dismiss">OK</button> : null}
        </div>
      ))}
    </div>
  );
}

