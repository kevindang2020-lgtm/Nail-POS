// database-core.vitest.spec — BUILD_PLAN Phase 10 (E): the pure rules behind the Super Admin Database page.
import { describe, it, expect } from 'vitest';
import {
  actionReason, MIN_DB_ACTION_REASON, isSafeTableName, migrationLedger, queryShape, bloatEstimateBytes, duplicateIndexGroups,
  retrySqlAllowed, aggregateSlowSamples, growthFromSnapshots, indexKey,
} from './database-core';

describe('actionReason', () => {
  it('needs at least 10 visible characters and trims', () => {
    expect(MIN_DB_ACTION_REASON).toBe(10);
    expect(actionReason('  short ')).toBeNull();
    expect(actionReason(undefined)).toBeNull();
    expect(actionReason(42)).toBeNull();
    expect(actionReason('  table bloat after import  ')).toBe('table bloat after import');
    expect(actionReason('x'.repeat(900))!.length).toBe(500);
  });
});

describe('isSafeTableName', () => {
  it('only a plain lower-case identifier', () => {
    expect(isSafeTableName('payments')).toBe(true);
    expect(isSafeTableName('tenant_daily_sales_summary')).toBe(true);
    for (const bad of ['Payments', 'payments; drop table x', 'public.payments', '"payments"', '', 'a'.repeat(64), '1abc', 'pay ments', null, undefined]) expect(isSafeTableName(bad as any), String(bad)).toBe(false);
  });
});

describe('migrationLedger', () => {
  it('latest = highest applied file, pending = files not in the ledger, a ledger row with no file breaks integrity', () => {
    const r = migrationLedger(['001_a.sql', '002_b.sql', '003_c.sql'], ['001_a.sql', '002_b.sql']);
    expect(r).toEqual({ latest: '002_b.sql', applied: 2, files: 3, pending: ['003_c.sql'], ledgerIntegrity: 'ok', unknownLedgerRows: [] });
    const broken = migrationLedger(['001_a.sql'], ['001_a.sql', '999_gone.sql']);
    expect(broken.ledgerIntegrity).toBe('broken');
    expect(broken.unknownLedgerRows).toEqual(['999_gone.sql']);
    expect(broken.latest).toBe('999_gone.sql');
  });
  it('no migrations directory (files unknown) never reports every ledger row as broken', () => {
    const r = migrationLedger(null, ['001_a.sql']);
    expect(r.ledgerIntegrity).toBe('ok'); expect(r.files).toBe(0); expect(r.pending).toEqual([]);
  });
});

describe('queryShape', () => {
  it('replaces every literal value — strings, numbers, dollar quotes, parameters — and truncates', () => {
    const s = queryShape(`select * from customers where phone = '+1 555 0100' and id = 42 and note = E'it''s' and x = $1 and y = $$secret$$`);
    expect(s).not.toContain('555'); expect(s).not.toContain('42'); expect(s).not.toContain('secret'); expect(s).not.toContain("it''s");
    expect(s).toContain('phone = ?'); expect(s).toContain('x = $?');
    expect(queryShape('select ' + 'a,'.repeat(300)).length).toBeLessThanOrEqual(200);
    expect(queryShape(null as any)).toBe('');
  });
  it('keeps identifiers with digits intact (table names like tenant_daily_2026 are not values)', () => {
    expect(queryShape('select * from tbl_2026 where c = 7')).toBe('select * from tbl_2026 where c = N');
  });
});

describe('bloatEstimateBytes', () => {
  it('table bytes × dead / (live + dead); 0 when there is nothing', () => {
    expect(bloatEstimateBytes(1000, 75, 25)).toBe(250);
    expect(bloatEstimateBytes(1000, 0, 0)).toBe(0);
    expect(bloatEstimateBytes(1000, -1, 0)).toBe(0);
  });
});

describe('duplicate indexes', () => {
  it('two indexes with the same table, columns and predicate are one group; a different predicate is not', () => {
    const rows = [
      { table: 't', index: 'a', definition: 'CREATE INDEX a ON public.t USING btree (tenant_id, created_at)' },
      { table: 't', index: 'b', definition: 'CREATE INDEX b ON public.t USING btree (tenant_id, created_at)' },
      { table: 't', index: 'c', definition: 'CREATE INDEX c ON public.t USING btree (tenant_id, created_at) WHERE (x IS NULL)' },
      { table: 'u', index: 'd', definition: 'CREATE INDEX d ON public.u USING btree (tenant_id, created_at)' },
    ];
    expect(duplicateIndexGroups(rows)).toEqual([{ table: 't', definition: 'ON public.t USING btree (tenant_id, created_at)', indexes: ['a', 'b'] }]);
    expect(indexKey('CREATE UNIQUE INDEX uq ON public.t USING btree (a)')).toBe('UNIQUE ON public.t USING btree (a)');
  });
});

describe('retrySqlAllowed', () => {
  it('only the statement shapes a pre-flight records', () => {
    for (const ok of [
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_x ON users (tenant_id, lower(email)) WHERE email IS NOT NULL',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_y ON t (a)',
      'ALTER TABLE payments VALIDATE CONSTRAINT fk_payments_ticket',
      'ALTER TABLE booking_holds ADD CONSTRAINT ck_x CHECK (ends_at > starts_at) NOT VALID',
      'ALTER TABLE t ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid;',
    ]) expect(retrySqlAllowed(ok), ok).toBe(true);
    for (const bad of [
      'DROP TABLE users', 'ALTER TABLE t VALIDATE CONSTRAINT a; DROP TABLE users', 'DELETE FROM users', 'UPDATE users SET role = 1',
      'CREATE INDEX x ON t (a); select pg_sleep(1)', 'ALTER TABLE t DROP COLUMN a', 'ALTER ROLE postgres SUPERUSER', '', null,
      'CREATE INDEX x ON t ((pg_terminate_backend(1)))', 'ALTER TABLE t VALIDATE CONSTRAINT a -- ; drop',
      'ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0) -- hidden tail', 'ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0) /* x */',
    ]) expect(retrySqlAllowed(bad as any), String(bad)).toBe(false);
  });
});

describe('aggregateSlowSamples', () => {
  it('one row per shape: calls, mean, max, total, rows, last seen — slowest total first', () => {
    const rows = aggregateSlowSamples([
      { hash: 'aa', fingerprint: 'select a', table: 'x', durationMs: 300, rows: 1, at: '2026-10-08T10:00:00Z' },
      { hash: 'aa', fingerprint: 'select a', table: 'x', durationMs: 500, rows: 3, at: '2026-10-08T11:00:00Z' },
      { hash: 'bb', fingerprint: 'select b', table: 'y', durationMs: 900, rows: 0, at: '2026-10-08T09:00:00Z' },
    ]);
    expect(rows).toEqual([
      { hash: 'aa', shape: 'select a', calls: 2, meanMs: 400, maxMs: 500, totalMs: 800, rows: 4, lastSeenAt: '2026-10-08T11:00:00.000Z', table: 'x' },
      { hash: 'bb', shape: 'select b', calls: 1, meanMs: 900, maxMs: 900, totalMs: 900, rows: 0, lastSeenAt: '2026-10-08T09:00:00.000Z', table: 'y' },
    ].sort((a, b) => b.totalMs - a.totalMs));
  });
});

describe('growthFromSnapshots', () => {
  it('per-day totals, per-table series ordered by day, change = latest − first, biggest growers first', () => {
    const g = growthFromSnapshots([
      { day: '2026-10-07', table: 'a', totalBytes: 100, rowEstimate: 1 },
      { day: '2026-10-08', table: 'a', totalBytes: 400, rowEstimate: 4 },
      { day: '2026-10-07', table: 'b', totalBytes: 1000, rowEstimate: 10 },
      { day: '2026-10-08', table: 'b', totalBytes: 1100, rowEstimate: 11 },
    ], 20);
    expect(g.totals).toEqual([{ day: '2026-10-07', totalBytes: 1100 }, { day: '2026-10-08', totalBytes: 1500 }]);
    expect(g.tables.map((t) => [t.table, t.changeBytes, t.latestBytes])).toEqual([['a', 300, 400], ['b', 100, 1100]]);
    expect(g.tables[0].series.map((s) => s.day)).toEqual(['2026-10-07', '2026-10-08']);
    expect(growthFromSnapshots([], 20)).toEqual({ totals: [], tables: [] });
  });
});
