// slo-alerts.pgtest — §106 burn-rate alerts through the shared reconcile, and §104 against component alerts.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { HealthAggregator, sloAlerts } from './health-aggregator';
import { SLOS, type SloReport } from './slo-core';
import { COMPONENTS } from './health-core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM alerts WHERE related_module = 'system_health'`); });

const rep = (id: string, alert: 'page' | 'ticket' | null): SloReport =>
  ({ id, name: SLOS.find((s) => s.id === id)!.name, status: 'proposed', target: 0.995, windowDays: 30, sli: 0.9, total: 1000, bad: 100,
     budgetAllowed: 5, budgetRemaining: -19, burnRateFast: 20, burnRateSlow: 8, alert });

describe('sloAlerts', () => {
  it('a page-rate burn is P2 (high), a ticket-rate burn P3 (medium)', () => {
    expect(sloAlerts([rep('booking_completion', 'page'), rep('checkout_latency', 'ticket')], new Set()).map((a) => [a.component, a.severity]))
      .toEqual([['slo:booking_completion', 'high'], ['slo:checkout_latency', 'medium']]);
  });
  it('§104: no SLO alert while its component is already alerting — "checkout down" and "checkout burning" are one incident', () => {
    expect(sloAlerts([rep('checkout_payment', 'page')], new Set(['checkout']))).toEqual([]);
  });
  it('§177: carries its component\'s owner and runbook, not a placeholder', () => {
    const [a] = sloAlerts([rep('phone_verification', 'page')], new Set());
    const comp = COMPONENTS.find((c) => c.key === 'communications')!;
    expect(a.owner).toBe(comp.owner); expect(a.runbook).toBe(comp.runbook);
    expect(a.message).toMatch(new RegExp(`Runbook: ${comp.runbook.replace(/[.#]/g, '\\$&')}`));
  });
  it('§80: the message says the target is PROPOSED — a burn alert must not imply a promise we never measured', () => {
    expect(sloAlerts([rep('api_availability', 'page')], new Set())[0].message).toMatch(/PROPOSED, not yet validated/);
  });
  it('an SLO that is not burning raises nothing', () => expect(sloAlerts([rep('api_availability', null)], new Set())).toEqual([]));
});

describe('SLO alerts through the real alerts table', () => {
  const reconcile = (agg: HealthAggregator, desired: any[], now: number) => (agg as any).reconcileAlerts(desired, now, SLOS.map((s) => `slo:${s.id}`));
  it('raises under slo:<id>, and resolves when the burn stops', async () => {
    const agg = new HealthAggregator(db);
    await reconcile(agg, sloAlerts([rep('booking_completion', 'page')], new Set()), 1_000_000);
    await reconcile(agg, [], 1_300_000);
    const rows = (await pg.query(`SELECT related_record_id, status FROM alerts WHERE related_module = 'system_health'`)).rows;
    expect(rows).toEqual([{ related_record_id: 'slo:booking_completion', status: 'resolved' }]);
  });
  it('reconciling SLO keys never touches COMPONENT alerts — each key set is managed separately', async () => {
    const agg = new HealthAggregator(db);
    await (agg as any).reconcileAlerts([{ component: 'database', severity: 'critical', title: 'db down', message: 'm', owner: 'o', runbook: 'r', causes: [] }], 1_000_000, COMPONENTS.map((c) => c.key));
    await reconcile(agg, [], 1_030_000);                             // an empty SLO reconcile must not resolve the database alert
    expect((await pg.query(`SELECT status FROM alerts WHERE related_record_id = 'database'`)).rows[0].status).toBe('unread');
  });
});

describe('through a real tick: the SLO pass must not resolve component alerts', () => {
  // The test above calls reconcileAlerts with explicit SLO keys, so it could not see the call inside tick(). Dropping
  // the key list there SURVIVED it — and the consequence is severe: the SLO pass would default to COMPONENT keys,
  // want none of them, and RESOLVE every open component alert every five minutes, while the outage continues.
  it('an API outage alert raised in a tick is still open after that same tick\'s SLO pass', async () => {
    const { httpRequests } = await import('./http-metrics');
    for (let i = 0; i < 100; i++) httpRequests.inc({ method: 'GET', route: '/zz-slo-tick', status_class: '5' });
    const agg = new HealthAggregator(db);
    await agg.tick(5_000_000);                       // first tick: api OUTAGE accepted as-is, and the SLO pass runs (tick 0)
    const api = (await pg.query(`SELECT status FROM alerts WHERE tenant_id IS NULL AND related_record_id = 'api'`)).rows;
    expect(api).toHaveLength(1);
    expect(api[0].status).toBe('unread');
  });
});
