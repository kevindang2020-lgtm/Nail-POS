// media-lifecycle-telemetry — BUILD_PLAN Phase 14 B (Constitution 11 §152 "Lifecycle Errors"): every media.lifecycle run
// is counted per store — ok with the partial uploads it removed, error when the sweep threw — so the storage dashboard
// can show lifecycle failures instead of a log line nobody reads.
import { describe, it, expect } from 'vitest';
import { storageLifecycle, storageLifecycleRemoved } from '@aipowersalon/observability';
import { MediaLifecycleService } from './media-lifecycle';

const v = (m: any, labels: Record<string, string>) => (m.snapshot().find((s: any) => Object.entries(labels).every(([k, x]) => s.labels[k] === x))?.value ?? 0) as number;
const policy = { object_days: 30, lookback_days: 7, temp_upload_hours: 24, tables: {} };
const store = (sweep: () => Promise<number>) => ({ put: async () => ({ url: '' }), remove: async () => undefined, resolvePath: () => null, sweepAbandoned: sweep });

describe('media.lifecycle runs are counted per store', () => {
  it('ok + removed for a store whose sweep worked; error for one whose sweep threw', async () => {
    const ok0 = v(storageLifecycle, { store: 'lc_good', outcome: 'ok' }), rm0 = v(storageLifecycleRemoved, { store: 'lc_good' });
    const svc = new MediaLifecycleService(null, { lc_good: store(async () => 3), lc_bad: store(async () => { throw new Error('s3 down'); }) }, { policy, now: () => Date.parse('2026-10-01T00:00:00Z') });
    const r = await svc.run();
    expect(r.abandoned).toBe(3);
    expect(v(storageLifecycle, { store: 'lc_good', outcome: 'ok' })).toBe(ok0 + 1);
    expect(v(storageLifecycleRemoved, { store: 'lc_good' })).toBe(rm0 + 3);
    expect(v(storageLifecycle, { store: 'lc_bad', outcome: 'error' })).toBe(1);
    expect(v(storageLifecycle, { store: 'lc_bad', outcome: 'ok' })).toBe(0);
  });
});
