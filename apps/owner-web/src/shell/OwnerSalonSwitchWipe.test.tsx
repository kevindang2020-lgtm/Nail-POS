// OwnerSalonSwitchWipe.test.tsx — BUILD_PLAN Phase 13 (Constitution 6 §46–48): an Owner salon switch (a server-side context
// switch that leaves the principal unchanged) wipes the server-state cache — memory and device — before the new salon's
// screens render; a REFUSED switch keeps everything where it was.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, cleanup } from '@testing-library/react';
import { MobileQueryProvider, MemoryKvStore, createAppQueryClient, persistNow, scopedKey, cacheStorageKey, type QueryScope } from '@aipowersalon/mobile-sdk';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ api: http }));
import { OwnerSalonProvider, useOwnerSalon } from './OwnerSalonContext';

const S: QueryScope = { realm: 'tenant', tenantId: 't-1', branchId: null, userId: 'o-1' };
let store: MemoryKvStore;
beforeEach(async () => {
  vi.clearAllMocks(); store = new MemoryKvStore();
  http.get.mockImplementation(async (p: string) => (p === '/owner/portfolio' ? { salons: [] } : { activeSalonId: 't-1' }));
  const c = createAppQueryClient(); c.setQueryDefaults(scopedKey(S, 'owner', 'dashboard', 'all'), { meta: { persist: true } });
  c.setQueryData(scopedKey(S, 'owner', 'dashboard', 'all'), { revenue: 1 });
  await persistNow(c, { app: 'owner', store }, S);
});
afterEach(() => cleanup());

function mount() {
  let ctx!: ReturnType<typeof useOwnerSalon>;
  function Probe() { ctx = useOwnerSalon(); return null; }
  render(<MobileQueryProvider app="owner" scope={S} send={async () => ({})} store={store}><OwnerSalonProvider><Probe /></OwnerSalonProvider></MobileQueryProvider>);
  return () => ctx;
}

describe('owner salon switch', () => {
  it('a successful switch wipes the persisted cache', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeTruthy());
    expect(await store.get(cacheStorageKey('owner', S))).toBeTruthy();
    http.post.mockResolvedValue({ activeSalonId: 't-2', salonName: 'Two' });
    await act(async () => { await get().switchSalon('t-2'); });
    expect((await store.keys()).filter((k) => k.startsWith('aps.qcache'))).toEqual([]);
  });
  it('a refused switch keeps it', async () => {
    const get = mount();
    await waitFor(() => expect(get()).toBeTruthy());
    http.post.mockRejectedValue({ status: 403, message: 'no' });
    await act(async () => { await get().switchSalon('t-9').catch(() => undefined); });
    expect(await store.get(cacheStorageKey('owner', S))).toBeTruthy();
  });
});
