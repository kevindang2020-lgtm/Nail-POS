// audit-partitions.vitest.spec.ts — pure partition naming/bounds/month-math + the service's safe no-op when the table
// isn't partitioned. The full conversion + row routing is proven on real Postgres (smoke).
import { describe, it, expect, vi } from 'vitest';
import { partitionName, partitionBounds, upcomingMonths, ensurePartitionSql } from './audit-partitions-core';
import { AuditPartitionService } from './audit-partition.service';

describe('audit partition helpers', () => {
  it('names + bounds a month as a half-open range', () => {
    expect(partitionName({ year: 2026, month: 7 })).toBe('audit_events_2026_07');
    expect(partitionBounds({ year: 2026, month: 7 })).toEqual({ from: '2026-07-01', to: '2026-08-01' });
  });
  it('rolls December into the next January', () => {
    expect(partitionBounds({ year: 2026, month: 12 })).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
  it('lists current + N upcoming months across a year boundary', () => {
    const months = upcomingMonths(new Date(Date.UTC(2026, 10, 15)), 2);   // Nov 2026 + 2
    expect(months).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }]);
  });
  it('generates idempotent CREATE TABLE ... PARTITION OF DDL', () => {
    expect(ensurePartitionSql({ year: 2026, month: 7 })).toBe(
      "CREATE TABLE IF NOT EXISTS audit_events_2026_07 PARTITION OF audit_events FOR VALUES FROM ('2026-07-01') TO ('2026-08-01')",
    );
  });
});

describe('AuditPartitionService safety', () => {
  it('is a no-op when there is no database', async () => {
    const svc = new AuditPartitionService(null as any);
    expect(await svc.ensureUpcoming(2)).toEqual({ created: [], skipped: true });
  });
  it('is a no-op when audit_events is not partitioned', async () => {
    const svc = new AuditPartitionService({} as any);
    vi.spyOn(svc, 'isPartitioned').mockResolvedValue(false);
    expect(await svc.ensureUpcoming(2)).toEqual({ created: [], skipped: true });
  });
});
