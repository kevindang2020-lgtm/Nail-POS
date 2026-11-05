// db-telemetry.vitest.spec — Constitution 11 §40–43, §195, §367.
import { describe, it, expect, beforeEach } from 'vitest';
import { attachDbTelemetry, fingerprint, classify, record, recentSlowQueries, resetSlowQueries, dbQueries, dbQueryErrors, dbSlowQueries, dbPoolTotal, dbPoolUtilisation, SLOW_QUERY_MS } from './db-telemetry';
import { registry } from './metrics';
import { runWithContext, getContext, newRequestId, newTraceId } from './request-context';

describe('§42 fingerprint — same shape, same fingerprint; values never present', () => {
  it('collapses an IN list of any length to one shape', () => {
    expect(fingerprint('select * from t where id in ($1, $2, $3)')).toBe(fingerprint('select * from t where id in ($1, $2)'));
  });
  it('collapses a batched INSERT of any row count to one shape', () => {
    expect(fingerprint('insert into t (a, b) values ($1, $2), ($3, $4), ($5, $6)')).toBe(fingerprint('insert into t (a, b) values ($1, $2)'));
  });
  it('normalises whitespace', () => {
    expect(fingerprint('select  *\n  from   t')).toBe(fingerprint('select * from t'));
  });
  it('a literal limit does not create a new shape per page size', () => {
    expect(fingerprint('select * from t limit 500')).toBe(fingerprint('select * from t limit 25'));
  });
  it('is bounded — a 5 KB query cannot become a 5 KB label or record', () => {
    expect(fingerprint('select ' + 'x, '.repeat(3000) + 'y from t').length).toBeLessThanOrEqual(500);
  });
  it('a DIFFERENT shape is a different fingerprint — otherwise every query is one bucket', () => {
    expect(fingerprint('select * from tickets where tenant_id = $1')).not.toBe(fingerprint('select * from customers where tenant_id = $1'));
  });
});

describe('classify — the two low-cardinality labels', () => {
  it('reads operation and first table', () => {
    expect(classify('SELECT "id" FROM "tickets" WHERE "tenant_id" = $1')).toEqual({ operation: 'select', table: 'tickets' });
    expect(classify('insert into "audit_logs" (a) values ($1)')).toEqual({ operation: 'insert', table: 'audit_logs' });
    expect(classify('update customers set x = $1')).toEqual({ operation: 'update', table: 'customers' });
  });
  it('a CTE is a select', () => expect(classify('with x as (select 1) select * from x').operation).toBe('select'));
  it('unknown SQL degrades to other/unknown — never throws', () => expect(classify('vacuum')).toEqual({ operation: 'other', table: 'unknown' }));
});

describe('record — metrics, slow log, and the request query counter', () => {
  beforeEach(() => resetSlowQueries());

  it('counts a query by operation and table', () => {
    const before = dbQueries.snapshot().find((s) => s.labels.table === 'zz_count')?.value as number | undefined;
    record({ sql: 'select * from zz_count', durationMs: 1, rows: 3 });
    const after = dbQueries.snapshot().find((s) => s.labels.table === 'zz_count')?.value as number;
    expect(after).toBe((before ?? 0) + 1);
  });

  it('a failed query is counted as an ERROR, not as a query — and never throws', () => {
    record({ sql: 'select * from zz_err', durationMs: 1, rows: 0, error: true });
    expect(dbQueryErrors.snapshot().find((s) => s.labels.table === 'zz_err')?.value).toBe(1);
    expect(dbQueries.snapshot().find((s) => s.labels.table === 'zz_err')).toBeUndefined();
  });

  it('a slow query lands in the slow log with its FINGERPRINT — never its parameters', () => {
    record({ sql: 'select * from zz_slow where phone = $1', durationMs: SLOW_QUERY_MS + 1, rows: 1 });
    const slow = recentSlowQueries();
    expect(slow.length).toBe(1);
    expect(slow[0].fingerprint).toBe('select * from zz_slow where phone = $?');
    expect(slow[0].table).toBe('zz_slow');
    expect(dbSlowQueries.snapshot().find((s) => s.labels.table === 'zz_slow')?.value).toBe(1);
  });

  it('a fast query does NOT enter the slow log', () => {
    record({ sql: 'select * from zz_fast', durationMs: SLOW_QUERY_MS - 1, rows: 1 });
    expect(recentSlowQueries()).toHaveLength(0);
  });

  it('the slow log is bounded — 500 slow queries keep 200', () => {
    for (let i = 0; i < 500; i++) record({ sql: `select * from zz_bound${i % 7}`, durationMs: SLOW_QUERY_MS + i, rows: 0 });
    expect(recentSlowQueries().length).toBe(200);
  });

  it('§43: queries issued inside a request context are counted ON that context', () => {
    const ctx = { requestId: newRequestId(), correlationId: 'c', traceId: newTraceId(), service: 'api' as const };
    runWithContext(ctx, () => {
      record({ sql: 'select 1 from zz_ctx', durationMs: 1, rows: 1 });
      record({ sql: 'select 1 from zz_ctx', durationMs: 1, rows: 1 });
      expect(getContext()?.dbQueries).toBe(2);
    });
  });

  it('the slow log carries the request and tenant ids for correlation (§41 "tenant context where safe")', () => {
    const ctx = { requestId: 'req_zz', correlationId: 'c', traceId: newTraceId(), service: 'api' as const, tenantId: 'tn-1' };
    runWithContext(ctx, () => record({ sql: 'select * from zz_link', durationMs: SLOW_QUERY_MS + 5, rows: 0 }));
    const s = recentSlowQueries()[0];
    expect(s.requestId).toBe('req_zz');
    expect(s.tenantId).toBe('tn-1');
  });
});

describe('attachDbTelemetry — the pool wrapper', () => {
  function fakePool(queryImpl: (sql: string) => Promise<any>) {
    const client = { query: async (cfg: any) => queryImpl(typeof cfg === 'string' ? cfg : cfg.text) };
    return { totalCount: 4, idleCount: 1, waitingCount: 2, connect: async () => client, client };
  }

  it('times every query that passes through a connected client', async () => {
    const pool = attachDbTelemetry(fakePool(async () => ({ rows: [1, 2] })), 10);
    const c = await pool.connect();
    await c.query('select * from zz_pool');
    expect(dbQueries.snapshot().find((s) => s.labels.table === 'zz_pool')?.value).toBe(1);
  });

  it('a query that throws is counted as an error AND still throws to the caller', async () => {
    const pool = attachDbTelemetry(fakePool(async () => { throw new Error('boom'); }), 10);
    const c = await pool.connect();
    await expect(c.query('select * from zz_poolerr')).rejects.toThrow('boom');
    expect(dbQueryErrors.snapshot().find((s) => s.labels.table === 'zz_poolerr')?.value).toBe(1);
  });

  it('wraps a client ONCE — a pooled client returned twice is not double-instrumented (double-counting)', async () => {
    const pool = attachDbTelemetry(fakePool(async () => ({ rows: [] })), 10);
    const a = await pool.connect(); const b = await pool.connect();
    expect(a).toBe(b);
    await a.query('select * from zz_once');
    expect(dbQueries.snapshot().find((s) => s.labels.table === 'zz_once')?.value).toBe(1);
  });

  it('§40: pool gauges are refreshed on collect — active = total − idle, utilisation over pool max', () => {
    attachDbTelemetry(fakePool(async () => ({ rows: [] })), 10);
    registry.snapshot();
    const state = (s: string) => dbPoolTotal.snapshot().find((x) => x.labels.state === s)?.value;
    expect(state('total')).toBe(4); expect(state('idle')).toBe(1); expect(state('active')).toBe(3); expect(state('waiting')).toBe(2);
    expect(dbPoolUtilisation.snapshot()[0].value).toBeCloseTo(0.3);
  });
});
