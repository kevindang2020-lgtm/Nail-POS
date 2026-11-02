// cache.test.ts — Constitution 6 §18, §24–27: the server-state layer. Every query key starts with realm + tenant + branch;
// the persisted read cache holds only opt-in, secret-free reads of ONE scope, and it is wiped on logout and on a
// tenant / branch switch.
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { scopedKey, scopeKey, sameScope, scopeFromPrincipal, type QueryScope } from './scope';
import { MemoryKvStore } from './storage';
import { stripSecrets, findSecretPaths } from './sanitize';
import { createAppQueryClient } from './client';
import { CACHE_PREFIX, cacheStorageKey, persistNow, restoreQueryCache, wipePersistedQueryCache, startQueryCachePersistence } from './persist';

const A: QueryScope = { realm: 'tenant', tenantId: 't-a', branchId: 'b-1', userId: 'u-1' };
const B: QueryScope = { realm: 'tenant', tenantId: 't-b', branchId: 'b-9', userId: 'u-1' };

describe('query keys are scoped by realm + tenant + branch', () => {
  it('prefixes every key', () => {
    expect(scopedKey(A, 'tech', 'queue')).toEqual(['tenant', 't-a', 'b-1', 'tech', 'queue']);
    expect(scopedKey({ realm: 'customer', tenantId: null, branchId: null, userId: 'c' }, 'home')).toEqual(['customer', '-', '-', 'home']);
  });
  it('two salons never share a key', () => {
    expect(scopedKey(A, 'tech', 'queue')).not.toEqual(scopedKey(B, 'tech', 'queue'));
    expect(scopeKey(A)).not.toBe(scopeKey(B));
    expect(sameScope(A, { ...A })).toBe(true);
    expect(sameScope(A, { ...A, branchId: 'b-2' })).toBe(false);
    expect(sameScope(A, { ...A, userId: 'u-2' })).toBe(false);
  });
});

describe('the persisted cache never holds a secret, token or payment detail', () => {
  it('strips secret-named fields at any depth, keeps the rest', () => {
    const out = stripSecrets({ name: 'Ann', accessToken: 'x', nested: { refresh_token: 'y', cardNumber: '4111', last4: '1111', cvv: '123', pin: '1234', password: 'p', ok: 1 },
      list: [{ otp: '000000', apiKey: 'k', footprint: 'keep', pinned: true, shipping: 'keep', paymentIntentId: 'pi_1', paymentMethodId: 'pm_1' }] });
    expect(out).toEqual({ name: 'Ann', nested: { ok: 1 }, list: [{ footprint: 'keep', pinned: true, shipping: 'keep' }] });
    expect(findSecretPaths(out)).toEqual([]);
  });
  it('scopeFromPrincipal: signed out → null', () => {
    expect(scopeFromPrincipal('tenant', null)).toBeNull();
    expect(scopeFromPrincipal('tenant', { userId: 'u', tenantId: 't', branchId: null })).toEqual({ realm: 'tenant', tenantId: 't', branchId: null, userId: 'u' });
  });
  it('finds what it would strip', () => {
    expect(findSecretPaths({ a: { sessionToken: 'z' }, b: [{ Authorization: 'Bearer q' }] })).toEqual(['a.sessionToken', 'b.0.Authorization']);
  });
});

async function seeded(scope: QueryScope, client = createAppQueryClient()) {
  client.setQueryDefaults(scopedKey(scope, 'tech', 'queue'), { meta: { persist: true } });
  client.setQueryData(scopedKey(scope, 'tech', 'queue'), { myQueue: [{ name: 'Ann' }], streamToken: 'secret-1' });
  client.setQueryData(scopedKey(scope, 'tech', 'private'), { notPersisted: true });    // no meta.persist → never written
  return client;
}

describe('persist + restore', () => {
  let store: MemoryKvStore;
  beforeEach(() => { store = new MemoryKvStore(); });

  it('writes only opt-in reads of the current scope, secret-free', async () => {
    const client = await seeded(A);
    client.setQueryDefaults(scopedKey(B, 'tech', 'queue'), { meta: { persist: true } });
    client.setQueryData(scopedKey(B, 'tech', 'queue'), { other: 'salon' });
    await persistNow(client, { app: 'tech', store }, A);
    const raw = await store.get(cacheStorageKey('tech', A));
    expect(raw).toBeTruthy();
    expect(raw).toContain('Ann');
    expect(raw).not.toContain('secret-1');
    expect(raw).not.toContain('notPersisted');
    expect(raw).not.toContain('salon');                       // another tenant's rows never land in this scope's blob
    expect(findSecretPaths(JSON.parse(raw!))).toEqual([]);
  });

  it('restores into a fresh client for the SAME scope, with its updated-at', async () => {
    const c1 = await seeded(A);
    const at = c1.getQueryState(scopedKey(A, 'tech', 'queue'))!.dataUpdatedAt;
    await persistNow(c1, { app: 'tech', store }, A);
    const c2 = createAppQueryClient();
    expect(await restoreQueryCache(c2, { app: 'tech', store }, A)).toBe(true);
    expect(c2.getQueryData(scopedKey(A, 'tech', 'queue'))).toEqual({ myQueue: [{ name: 'Ann' }] });
    expect(c2.getQueryState(scopedKey(A, 'tech', 'queue'))!.dataUpdatedAt).toBe(at);
  });

  it('never restores another scope’s cache', async () => {
    await persistNow(await seeded(A), { app: 'tech', store }, A);
    const c2 = createAppQueryClient();
    expect(await restoreQueryCache(c2, { app: 'tech', store }, B)).toBe(false);
    expect(await restoreQueryCache(c2, { app: 'tech', store }, { ...A, userId: 'someone-else' })).toBe(false);
    expect(c2.getQueryCache().getAll()).toHaveLength(0);
  });

  it('drops a cache older than maxAge', async () => {
    await persistNow(await seeded(A), { app: 'tech', store }, A);
    const c2 = createAppQueryClient();
    expect(await restoreQueryCache(c2, { app: 'tech', store, maxAgeMs: 1000 }, A, Date.now() + 5000)).toBe(false);
    expect(await store.get(cacheStorageKey('tech', A))).toBeNull();
  });

  it('wipe removes every scope of the app (logout / switch) and leaves other apps alone', async () => {
    await persistNow(await seeded(A), { app: 'tech', store }, A);
    await persistNow(await seeded(B), { app: 'tech', store }, B);
    await store.set(`${CACHE_PREFIX}:owner:x`, '{}');
    await wipePersistedQueryCache(store, 'tech');
    expect((await store.keys()).filter((k) => k.startsWith(`${CACHE_PREFIX}:tech:`))).toEqual([]);
    expect(await store.get(`${CACHE_PREFIX}:owner:x`)).toBe('{}');
  });

  it('the running persister writes on change (throttled) and stops cleanly', async () => {
    const client = createAppQueryClient();
    const stop = startQueryCachePersistence(client, { app: 'tech', store, throttleMs: 5 }, A);
    client.setQueryDefaults(scopedKey(A, 'tech', 'today'), { meta: { persist: true } });
    client.setQueryData(scopedKey(A, 'tech', 'today'), { n: 1 });
    client.setQueryData(scopedKey(A, 'tech', 'today'), { n: 2 });
    await new Promise((r) => setTimeout(r, 30));
    expect(await store.get(cacheStorageKey('tech', A))).toContain('"n":2');
    stop();
  });
});

describe('the client defaults', () => {
  it('reads are offline-first and the transport owns retries', () => {
    const c: QueryClient = createAppQueryClient();
    const d = c.getDefaultOptions();
    expect(d.queries?.networkMode).toBe('offlineFirst');
    expect(d.queries?.retry).toBe(false);
    expect(d.mutations?.retry).toBe(false);
    expect(Number(d.queries?.gcTime)).toBeGreaterThanOrEqual(24 * 3600_000);
  });
});
