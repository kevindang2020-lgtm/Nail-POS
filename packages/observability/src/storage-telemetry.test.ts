// storage-telemetry.test — Constitution 11 §49 storage metrics: every media / private store call counted by STORE, op and
// outcome, bytes written / read, latency; errors re-thrown unchanged (the caller keeps its own policy).
import { describe, it, expect } from 'vitest';
import { instrumentStore, storageOps, storageBytes, storageDuration, storageLifecycle, recordStorageLifecycle, isInstrumentedStore } from './storage-telemetry';

const val = (labels: Record<string, string>, m: { snapshot: () => Array<{ labels: Record<string, string>; value: unknown }> } = storageOps) =>
  (m.snapshot().find((s) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0) as number;

function fakeStore(fail = false) {
  return {
    kind: 'local' as const,
    root: '/tmp/x',
    async put(_k: string, body: Buffer) { if (fail) throw new Error('disk full'); return { url: '/media/' + _k, bytes: body.length }; },
    async get(_k: string) { return fail ? null : Buffer.from('hello'); },
    async remove(_k: string) { if (fail) throw new Error('nope'); },
    resolvePath(k: string) { return '/tmp/x/' + k; },
  };
}

describe('instrumentStore', () => {
  it('counts ops, bytes written / read and latency by store; non-store members pass through', async () => {
    const s = instrumentStore(fakeStore(), 'unit_media');
    const before = val({ store: 'unit_media', op: 'put', outcome: 'ok' });
    await s.put('a.png', Buffer.alloc(1000));
    await s.get('a.png');
    await s.remove('a.png');
    expect(val({ store: 'unit_media', op: 'put', outcome: 'ok' })).toBe(before + 1);
    expect(val({ store: 'unit_media', op: 'get', outcome: 'ok' })).toBeGreaterThanOrEqual(1);
    expect(val({ store: 'unit_media', op: 'remove', outcome: 'ok' })).toBeGreaterThanOrEqual(1);
    expect(val({ store: 'unit_media', direction: 'written' }, storageBytes)).toBeGreaterThanOrEqual(1000);
    expect(val({ store: 'unit_media', direction: 'read' }, storageBytes)).toBeGreaterThanOrEqual(5);
    const h = storageDuration.snapshot().find((x) => x.labels.store === 'unit_media' && x.labels.op === 'put')?.value as any;
    expect(h.count).toBeGreaterThanOrEqual(1);
    expect(s.resolvePath('k')).toBe('/tmp/x/k');
    expect((s as any).kind).toBe('local');
    expect((s as any).root).toBe('/tmp/x');
  });

  it('an error is counted as an error and re-thrown unchanged', async () => {
    const s = instrumentStore(fakeStore(true), 'unit_failing');
    await expect(s.put('a', Buffer.alloc(3))).rejects.toThrow('disk full');
    expect(val({ store: 'unit_failing', op: 'put', outcome: 'error' })).toBe(1);
    expect(val({ store: 'unit_failing', direction: 'written' }, storageBytes)).toBe(0);
    // a get that answers null (object gone) is a miss, not an error
    expect(await s.get('a')).toBeNull();
    expect(val({ store: 'unit_failing', op: 'get', outcome: 'miss' })).toBe(1);
  });

  it('wrapping twice does not double count', async () => {
    const once = instrumentStore(fakeStore(), 'unit_twice');
    const twice = instrumentStore(once, 'unit_twice');
    expect(isInstrumentedStore(twice)).toBe(true);
    await twice.put('a', Buffer.alloc(1));
    expect(val({ store: 'unit_twice', op: 'put', outcome: 'ok' })).toBe(1);
  });

  it('lifecycle runs are counted by store and outcome with removed objects', () => {
    recordStorageLifecycle('unit_life', 'ok', 4);
    recordStorageLifecycle('unit_life', 'error', 0);
    expect(val({ store: 'unit_life', outcome: 'ok' }, storageLifecycle)).toBe(1);
    expect(val({ store: 'unit_life', outcome: 'error' }, storageLifecycle)).toBe(1);
  });
});
