// persist.ts — the persisted READ cache (Constitution 6 §17–18). Only queries that opt in with `meta: { persist: true }`
// are written; only the current scope's; secret-named fields are stripped first; the blob expires after `maxAgeMs`.
// Logout and a tenant / branch switch call wipePersistedQueryCache (react.tsx does it).
import { dehydrate, hydrate, type QueryClient, type DehydratedState } from '@tanstack/react-query';
import { keyInScope, scopeKey, type QueryScope } from './scope';
import type { KvStore } from './storage';
import { stripSecrets } from './sanitize';

export const CACHE_PREFIX = 'aps.qcache.v1';
export const CACHE_MAX_AGE_MS = 24 * 3600_000;
export interface PersistOptions { app: string; store: KvStore; maxAgeMs?: number; throttleMs?: number }
interface Blob { savedAt: number; scope: string; state: DehydratedState }

export const cacheStorageKey = (app: string, scope: QueryScope) => `${CACHE_PREFIX}:${app}:${scopeKey(scope)}`;

export function snapshot(client: QueryClient, scope: QueryScope): DehydratedState {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (q) => q.state.status === 'success' && (q.meta as any)?.persist === true && keyInScope(q.queryKey, scope),
    shouldDehydrateMutation: () => false,
  });
  return { ...state, queries: state.queries.map((q) => ({ ...q, state: { ...q.state, data: stripSecrets(q.state.data) } })) };
}

export async function persistNow(client: QueryClient, o: PersistOptions, scope: QueryScope): Promise<void> {
  const state = snapshot(client, scope);
  const key = cacheStorageKey(o.app, scope);
  if (!state.queries.length) { await o.store.remove(key); return; }
  const blob: Blob = { savedAt: Date.now(), scope: scopeKey(scope), state };
  await o.store.set(key, JSON.stringify(blob));
}

/** Hydrate the scope's cache. false = nothing (or an expired / foreign blob, which is deleted). */
export async function restoreQueryCache(client: QueryClient, o: PersistOptions, scope: QueryScope, now = Date.now()): Promise<boolean> {
  const key = cacheStorageKey(o.app, scope);
  let raw: string | null = null;
  try { raw = await o.store.get(key); } catch { return false; }
  if (!raw) return false;
  let blob: Blob | null = null;
  try { blob = JSON.parse(raw); } catch { /* corrupt */ }
  if (!blob || blob.scope !== scopeKey(scope) || now - blob.savedAt > (o.maxAgeMs ?? CACHE_MAX_AGE_MS)) {
    await o.store.remove(key).catch(() => undefined);
    return false;
  }
  hydrate(client, blob.state);
  return true;
}

/** Remove EVERY persisted scope of this app — logout, tenant switch, branch switch. */
export async function wipePersistedQueryCache(store: KvStore, app: string): Promise<void> {
  const keys = await store.keys().catch(() => [] as string[]);
  await Promise.all(keys.filter((k) => k.startsWith(`${CACHE_PREFIX}:${app}:`)).map((k) => store.remove(k).catch(() => undefined)));
}

/** Write the cache (throttled) whenever a query changes. Returns stop(). */
export function startQueryCachePersistence(client: QueryClient, o: PersistOptions, scope: QueryScope): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null; let stopped = false;
  const flush = () => { timer = null; if (!stopped) void persistNow(client, o, scope).catch(() => undefined); };
  const unsub = client.getQueryCache().subscribe((e) => {
    if (stopped || !keyInScope(e.query.queryKey, scope)) return;
    if (e.type !== 'updated' && e.type !== 'removed') return;
    if (!timer) timer = setTimeout(flush, o.throttleMs ?? 500);
  });
  return () => { stopped = true; unsub(); if (timer) clearTimeout(timer); };
}
