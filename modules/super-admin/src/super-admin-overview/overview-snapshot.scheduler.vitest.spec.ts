// Overview snapshot scheduler — env gate, month key, and the pure tick body.
import { describe, it, expect, vi } from 'vitest';
import { overviewSnapshotCronEnabled, currentSnapshotMonth, snapshotTick } from './overview-snapshot.scheduler';

describe('overview-snapshot scheduler', () => {
  it('is off unless explicitly enabled', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) expect(overviewSnapshotCronEnabled({ OVERVIEW_SNAPSHOT_CRON_ENABLED: v } as any)).toBe(true);
    for (const v of ['', '0', 'false', 'off', undefined as any]) expect(overviewSnapshotCronEnabled({ OVERVIEW_SNAPSHOT_CRON_ENABLED: v } as any)).toBe(false);
    expect(overviewSnapshotCronEnabled({} as any)).toBe(false);
  });

  it('formats the current month key as YYYY-MM (UTC)', () => {
    expect(currentSnapshotMonth(new Date('2026-03-09T12:00:00Z'))).toBe('2026-03');
    expect(currentSnapshotMonth(new Date('2026-12-31T23:59:00Z'))).toBe('2026-12');
  });

  it('tick captures and reports the result', async () => {
    const svc = { captureSnapshot: vi.fn().mockResolvedValue({ ok: true as const, captured: true }) };
    expect(await snapshotTick(svc)).toBe(true);
    expect(svc.captureSnapshot).toHaveBeenCalledOnce();
  });

  it('tick swallows + logs errors (never throws)', async () => {
    const svc = { captureSnapshot: vi.fn().mockRejectedValue(new Error('db down')) };
    const errors: string[] = [];
    expect(await snapshotTick(svc, { log: () => {}, error: (m) => errors.push(m) })).toBe(false);
    expect(errors[0]).toMatch(/db down/);
  });
});
