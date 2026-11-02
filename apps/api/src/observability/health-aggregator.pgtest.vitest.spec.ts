// health-aggregator.pgtest — the aggregator against the real schema (migration 444), and its window arithmetic.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { HealthAggregator, evaluateAll, counterDelta, EXPIRES_AFTER_MS } from './health-aggregator';

import { effectiveStatus } from './health-core';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM system_health_snapshots; DELETE FROM status_components;`); });

describe('migration 444 — the status page can finally say "unknown"', () => {
  // DROP CONSTRAINT IF EXISTS relies on Postgres's auto-generated name for 147's inline CHECK. If that name were
  // different, the drop would silently do nothing, the old check would survive beside the new one, and 'unknown'
  // would still be refused — while the migration reported success. This stores it for real.
  it('"unknown" is accepted', async () => {
    await pg.exec(`INSERT INTO status_components (key, name, status) VALUES ('probe', 'Probe', 'unknown')`);
    expect((await pg.query(`SELECT status FROM status_components WHERE key = 'probe'`)).rows[0].status).toBe('unknown');
  });
  it('the check still refuses nonsense — it was replaced, not removed', async () => {
    await expect(pg.exec(`INSERT INTO status_components (key, name, status) VALUES ('bad', 'Bad', 'green')`)).rejects.toThrow();
  });
  it('exactly one status check exists afterwards — no leftover from 147', async () => {
    const r = await pg.query(`SELECT count(*)::int AS c FROM pg_constraint WHERE conrelid = 'status_components'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%operational%'`);
    expect(r.rows[0].c).toBe(1);
  });
});

describe('a tick writes computed health where the status page reads it', () => {
  it('every registered component is upserted with metadata and an expiry', async () => {
    const agg = new HealthAggregator(db);
    await agg.tick(1_000_000);
    const rows = (await pg.query(`SELECT key, status_source, criticality, runbook, expires_at FROM status_components ORDER BY key`)).rows;
    expect(rows.map((r: any) => r.key)).toContain('database');
    for (const r of rows) {
      expect(r.status_source, r.key).toBe('computed');
      expect(r.runbook, r.key).toBeTruthy();
      expect(new Date(r.expires_at).getTime(), r.key).toBe(1_000_000 + EXPIRES_AFTER_MS);
    }
  });

  it('the database probe runs for real: PGlite answers, so the database is HEALTHY', async () => {
    const agg = new HealthAggregator(db);
    await agg.tick(1_000_000);
    expect(agg.current()!.components.database.effective).toBe('HEALTHY');
    expect((await pg.query(`SELECT status FROM status_components WHERE key = 'database'`)).rows[0].status).toBe('operational');
  });

  it('a component with no signal is written as "unknown" — never "operational" (§332)', async () => {
    const agg = new HealthAggregator(db);
    await agg.tick(1_000_000);
    // No provider has been called in this process, so payments has no signal.
    expect((await pg.query(`SELECT status FROM status_components WHERE key = 'payments'`)).rows[0].status).toBe('unknown');
  });

  it('a human\'s MAINTENANCE is never overridden — but the computed verdict is still recorded', async () => {
    await pg.exec(`INSERT INTO status_components (key, name, status, status_source) VALUES ('database', 'Database', 'maintenance', 'manual')`);
    const agg = new HealthAggregator(db);
    await agg.tick(1_000_000);
    const r = (await pg.query(`SELECT status, status_source, reason_code FROM status_components WHERE key = 'database'`)).rows[0];
    expect(r.status).toBe('maintenance');
    expect(r.status_source).toBe('manual');
    expect(r.reason_code).toBe('ok');
  });

  it('§390 history: one row per CHANGE, not per tick — ten healthy ticks are one row', async () => {
    const agg = new HealthAggregator(db);
    for (let i = 0; i < 10; i++) await agg.tick(1_000_000 + i * 30_000);
    const r = await pg.query(`SELECT count(*)::int AS c FROM system_health_snapshots WHERE component_key = 'database'`);
    expect(r.rows[0].c).toBe(1);
  });

  it('a broken database makes the probe fail → OUTAGE after hysteresis, recorded in history', async () => {
    const agg = new HealthAggregator(db);
    await agg.tick(1_000_000);                                   // healthy baseline
    (agg as any).db = { ...db, executeQuery: async () => { throw new Error('down'); } };
    const probeFails = new HealthAggregator({ executeQuery: async () => { throw new Error('down'); } } as never);
    // two failed observations are required to flip (hysteresis toWorse = 2)
    (probeFails as any).state = (agg as any).state;
    await probeFails.tick(1_030_000);
    expect(probeFails.current()!.components.database.effective).toBe('HEALTHY');
    await probeFails.tick(1_060_000);
    expect(probeFails.current()!.components.database.effective).toBe('OUTAGE');
  });
});

describe('§333 staleness at read time', () => {
  it('a row read after expires_at is UNKNOWN whatever its stored status says', () => {
    expect(effectiveStatus({ status: 'HEALTHY', expiresAt: 1_000 }, 2_000)).toBe('UNKNOWN');
  });
});

describe('window arithmetic', () => {
  it('counter deltas are across the window, never negative', () => {
    const snap = (v: number) => ({ c: [{ labels: { status_class: '5' }, value: v }] }) as never;
    expect(counterDelta(snap(12), snap(10), 'c')).toBe(2);
    expect(counterDelta(snap(5), snap(10), 'c')).toBe(0);      // a counter reset (restart) is not negative traffic
    expect(counterDelta(snap(12), undefined, 'c')).toBe(12);    // no older snapshot: the whole counter is the window
  });

  it('an API failing 30% in the window is an OUTAGE even if it was clean since start', () => {
    const cur = { aipowersalon_api_requests_total: [{ labels: { status_class: '2' }, value: 1070 }, { labels: { status_class: '5' }, value: 30 }] } as never;
    const old = { aipowersalon_api_requests_total: [{ labels: { status_class: '2' }, value: 1000 }, { labels: { status_class: '5' }, value: 0 }] } as never;
    const e = evaluateAll({ cur, old, now: 0, dbProbeOk: true, outbox: null, aiProviders: [], providers: [], jobs: [], realtimeBackbone: 'in-process' });
    expect(e.api.status).toBe('OUTAGE');                         // 30 of 100 in the window, not 30 of 1100 all-time
  });
});

describe('tick() judges the WINDOW, not the process lifetime', () => {
  // The evaluateAll test above passes cur/old explicitly, so it cannot see whether tick() actually picks an older
  // snapshot. A mutation that made tick() use no old snapshot at all (cumulative counters) survived it. This drives
  // real ticks against the real registry instead.
  it('30 failures in the last 100 requests is an OUTAGE even after 1,000 clean ones', async () => {
    const { httpRequests } = await import('./http-metrics');
    const agg = new HealthAggregator(db);
    for (let i = 0; i < 1000; i++) httpRequests.inc({ method: 'GET', route: '/w', status_class: '2' });
    await agg.tick(2_000_000);                                            // oldest snapshot in the window
    for (let i = 0; i < 70; i++) httpRequests.inc({ method: 'GET', route: '/w', status_class: '2' });
    for (let i = 0; i < 30; i++) httpRequests.inc({ method: 'GET', route: '/w', status_class: '5' });
    await agg.tick(2_030_000);
    // Window: 30 of 100 = 30% → OUTAGE. Cumulative would be 30 of 1100 ≈ 2.7% → HEALTHY.
    const api = agg.current()!.components.api;
    expect(api.summary.requests).toBe(100);
    expect(api.status).toBe('OUTAGE');
  });
});
