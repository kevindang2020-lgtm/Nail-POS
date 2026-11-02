// slo-reader.pgtest — SLO windows computed from the real per-minute table.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readSlo, fastColumns } from './slo-reader';
import { SLOS } from './slo-core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM platform_request_metrics_minute`); });
const NOW = new Date('2026-09-21T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const slo = (id: string) => SLOS.find((s) => s.id === id)!;
async function put(mins: number, method: string, route: string, cls: number, count: number, extra = '') {
  await pg.exec(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count${extra ? ', ' + extra.split('=')[0] : ''})
                 VALUES ('${minsAgo(mins)}', '${method}', '${route}', ${cls}, ${count}${extra ? ', ' + extra.split('=')[1] : ''})`);
}

describe('availability SLO from real rows', () => {
  it('checkout: 5xx are bad, 4xx (declines) are not, and other routes are out of scope', async () => {
    await put(10, 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 2, 990);
    await put(10, 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 4, 50);     // declines — not failures
    await put(10, 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 5, 10);
    await put(10, 'GET', '/pos/unrelated', 5, 999);                               // out of scope
    const r = await readSlo(db, slo('checkout_payment'), NOW);
    expect(r.total).toBe(1050); expect(r.bad).toBe(10);
    expect(r.sli).toBeCloseTo(1040 / 1050);
  });

  it('the METHOD is part of scope — GET on a POST route is not the workflow', async () => {
    await put(10, 'GET', '/pos/booking/appointments', 5, 100);
    expect((await readSlo(db, slo('booking_completion'), NOW)).total).toBe(0);
  });

  it('api_availability ("*") covers every route', async () => {
    await put(10, 'GET', '/a', 2, 100); await put(10, 'GET', '/b', 5, 1);
    expect((await readSlo(db, slo('api_availability'), NOW))).toMatchObject({ total: 101, bad: 1 });
  });

  it('windows are separate: an old failure counts in 30 days but not in the last hour', async () => {
    await put(3 * 60, 'GET', '/a', 5, 10);                    // three hours ago
    await put(10, 'GET', '/a', 2, 100);
    const r = await readSlo(db, slo('api_availability'), NOW);
    expect(r.bad).toBe(10);                                    // in the 30-day window
    expect(r.burnRateFast).toBe(0);                           // the last hour is clean
    expect(r.burnRateSlow).toBeGreaterThan(0);                // the six-hour window saw it
  });

  it('rows older than the window are ignored', async () => {
    await put(31 * 24 * 60, 'GET', '/a', 5, 1000);
    expect((await readSlo(db, slo('api_availability'), NOW)).total).toBe(0);
  });

  it('a live burn PAGES from real rows', async () => {
    for (const m of [2, 20, 40]) { await put(m, 'GET', '/a', 2, 900); await put(m, 'GET', '/a', 5, 100); }   // 10% errors
    expect((await readSlo(db, slo('api_availability'), NOW)).alert).toBe('page');
  });
});

describe('latency SLO from the histogram columns', () => {
  it('requests above 2.5 s are bad: total minus the buckets at or under it', async () => {
    // 100 requests: 90 in le_100, 5 in le_2500, 5 in le_5000 (slow)
    await pg.exec(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count, le_100, le_2500, le_5000)
                   VALUES ('${minsAgo(10)}', 'POST', '/pos/checkout/tickets/:ticketId/pay/cash', 2, 100, 90, 5, 5)`);
    const r = await readSlo(db, slo('checkout_latency'), NOW);
    expect(r).toMatchObject({ total: 100, bad: 5 });
  });
  it('a threshold that is not a bucket boundary is refused, not interpolated', () => {
    expect(() => fastColumns(2000)).toThrow(/not a bucket boundary/);
    expect(fastColumns(2500)).toContain('le_2500');
    expect(fastColumns(2500)).not.toContain('le_5000');
  });
});
