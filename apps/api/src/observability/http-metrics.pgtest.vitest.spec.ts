// http-metrics.pgtest — Constitution 11 §36–37, §246: API telemetry as per-minute aggregates, end to end on the
// real schema: aggregator → upsert → the analytics reader's p50/p95.
import { describe, it, expect, beforeAll } from 'vitest';
import { MinuteAggregator, HttpMetricsInterceptor, statusClassOf, bucketIndex, minuteOf } from './http-metrics';
import { KyselyAnalyticsGapRepo } from '@aipowersalon/super-admin';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });

describe('the aggregator', () => {
  it('status classes and buckets', () => {
    expect([statusClassOf(200), statusClassOf(304), statusClassOf(404), statusClassOf(503), statusClassOf(0)]).toEqual([2, 3, 4, 5, 0]);
    expect([bucketIndex(3), bucketIndex(5), bucketIndex(6), bucketIndex(99_999)]).toEqual([0, 0, 1, 11]);
  });
  it('folds requests into (minute, method, route, class) keys', () => {
    const a = new MinuteAggregator();
    const t = Date.UTC(2026, 8, 21, 12, 0, 10);
    a.record('GET', '/x', 200, 40, t); a.record('GET', '/x', 200, 60, t + 5_000); a.record('GET', '/x', 500, 900, t);
    const rows = a.drain();
    expect(rows).toHaveLength(2);
    const ok = rows.find((r) => r.statusClass === 2)!;
    expect(ok.count).toBe(2); expect(ok.sumMs).toBe(100); expect(ok.maxMs).toBe(60); expect(ok.minute.getTime()).toBe(minuteOf(t).getTime());
    expect(a.size()).toBe(0);   // drained
  });
  it('§37 cardinality: past MAX_KEYS distinct keys, new routes fold into "other" instead of growing the buffer', () => {
    const a = new MinuteAggregator(10);
    for (let i = 0; i < 50; i++) a.record('GET', `/customers/${i}`, 200, 1);
    const rows = a.drain();
    expect(rows.length).toBe(11);
    expect(rows.find((r) => r.route === 'other')!.count).toBe(40);
  });
});

describe('the flush is ADDITIVE, so two API instances can share one table', () => {
  const at = Date.UTC(2020, 0, 1, 0, 0, 0);   // a fixed minute nobody else writes
  it('two flushes into the same minute sum their counts and keep the max', async () => {
    const i1 = new HttpMetricsInterceptor(db), i2 = new HttpMetricsInterceptor(db);
    i1.agg.record('POST', '/appointments', 201, 120, at); i1.agg.record('POST', '/appointments', 201, 80, at);
    i2.agg.record('POST', '/appointments', 201, 700, at);
    // The instance with the LARGER max flushes FIRST. A mutation replacing GREATEST with EXCLUDED.max_ms survived
    // while the larger value happened to arrive last — order is what makes the max observable.
    await i2.flush(); await i1.flush();
    const r = await pg.query(`SELECT count, sum_ms, max_ms, le_100, le_250, le_1000 FROM platform_request_metrics_minute WHERE route = '/appointments' AND bucket_minute = to_timestamp(${at / 1000})`);
    expect(r.rows[0]).toMatchObject({ count: 3, sum_ms: 900, max_ms: 700, le_100: 1, le_250: 1, le_1000: 1 });
  });
  it('a failed flush drops the batch and does not throw into the caller (§285)', async () => {
    const broken = new HttpMetricsInterceptor({ executeQuery: async () => { throw new Error('db down'); } });
    broken.agg.record('GET', '/x', 200, 1, at);
    await expect(broken.flush()).resolves.toBeUndefined();
    expect(broken.agg.size()).toBe(0);
  });
});

describe('the analytics reader computes p50/p95 from bucket counts', () => {
  it('a window with 90 fast and 10 slow requests reports a p95 in the slow bucket', async () => {
    const i = new HttpMetricsInterceptor(db);
    const now = Date.now();
    for (let k = 0; k < 90; k++) i.agg.record('GET', '/fast', 200, 20, now);
    for (let k = 0; k < 10; k++) i.agg.record('GET', '/fast', 200, 2000, now);
    await i.flush();
    const h = await new KyselyAnalyticsGapRepo(db).requestHealth(5);
    expect(h).not.toBeNull();
    expect(h!.total).toBeGreaterThanOrEqual(100);
    expect(h!.p50LatencyMs).toBeLessThanOrEqual(50);
    expect(h!.p95LatencyMs).toBeGreaterThan(1000);
  });
  it('4xx responses are NOT successes and NOT server errors — a validation storm must not read as an outage or as health', async () => {
    const i = new HttpMetricsInterceptor(db);
    const now = Date.now();
    for (let k = 0; k < 40; k++) i.agg.record('POST', '/only4xx', 422, 10, now);
    for (let k = 0; k < 10; k++) i.agg.record('POST', '/only4xx', 200, 10, now);
    await i.flush();
    const h = await new KyselyAnalyticsGapRepo(db).requestHealth(5);
    // Success is <400 only: the 4xx rows above pull the percentage DOWN. (The exact value depends on other rows
    // in the window, so assert the direction against a window that would otherwise be ~100% green.)
    expect(h!.apiSuccessPct).toBeLessThan(100);
    expect(h!.serverErrors).toBe(0);
  });

  it('an empty window is NULL, never a fake zero (§332)', async () => {
    expect(await new KyselyAnalyticsGapRepo(db).requestHealth(0)).toBeNull();
  });
});
