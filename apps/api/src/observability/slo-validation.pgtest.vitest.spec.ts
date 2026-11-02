// slo-validation.pgtest — BUILD_PLAN Phase 14 C (Constitution 11 §80): a PROPOSED SLO becomes validated / breached only
// from persisted request data. Fixed clock; rows are inserted relative to it.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { evaluateSlo, validateAll, readSloValidations, dailyRows, thresholds } from './slo-validation';
import { SLOS } from './slo-core';
import { SystemOperationsService } from './system-operations';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM platform_request_metrics_minute; DELETE FROM slo_validations;`); });

const NOW = new Date('2026-05-31T12:00:00Z');
const ENV = { SLO_VALIDATION_MIN_DAYS: '28', SLO_VALIDATION_MIN_REQUESTS: '1000' };
const CARD = SLOS.find((s) => s.id === 'checkout_payment')!;

/** `days` consecutive days ending yesterday, one bucket per day per status class. */
async function traffic(days: number, perDay: { ok: number; fail5xx?: number; slow?: number }, route = 'POST /pos/checkout/tickets/:ticketId/pay/card') {
  const [method, path] = route.split(' ');
  for (let d = 1; d <= days; d++) {
    const minute = new Date(NOW.getTime() - d * 86_400_000);
    // le_100 = fast; le_5000 = slower than the 2.5 s latency threshold
    await pg.query(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count, le_100, le_5000) VALUES ($1, $2, $3, 2, $4, $5, $6)`,
      [minute, method, path, perDay.ok, perDay.ok - (perDay.slow ?? 0), perDay.slow ?? 0]);
    if (perDay.fail5xx) await pg.query(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count, le_100) VALUES ($1, $2, $3, 5, $4, $4)`, [minute, method, path, perDay.fail5xx]);
  }
}

describe('the verdict (pure)', () => {
  const t = { minDays: 28, minRequests: 1000 };
  it('no data → proposed with 0 days — never validated by default', () => {
    expect(evaluateSlo(CARD, [], t)).toMatchObject({ verdict: 'proposed', daysWithData: 0, sli: null });
  });
  it('27 good days → still proposed; 28 → validated', () => {
    const day = (i: number) => ({ day: `2026-05-${String(i).padStart(2, '0')}`, total: 100, bad: 0 });
    expect(evaluateSlo(CARD, Array.from({ length: 27 }, (_, i) => day(i + 1)), t).verdict).toBe('proposed');
    expect(evaluateSlo(CARD, Array.from({ length: 28 }, (_, i) => day(i + 1)), t).verdict).toBe('validated');
  });
  it('enough days but too few requests → proposed (a quiet month proves nothing)', () => {
    expect(evaluateSlo(CARD, Array.from({ length: 30 }, (_, i) => ({ day: String(i), total: 10, bad: 0 })), t).verdict).toBe('proposed');
  });
  it('days with zero traffic do not count', () => {
    expect(evaluateSlo(CARD, Array.from({ length: 30 }, (_, i) => ({ day: String(i), total: i % 2 ? 100 : 0, bad: 0 })), t)).toMatchObject({ daysWithData: 15, verdict: 'proposed' });
  });
  it('below target → breached; exactly on target → validated', () => {
    const days = (bad: number) => Array.from({ length: 28 }, (_, i) => ({ day: String(i), total: 1000, bad: i === 0 ? bad : 0 }));
    expect(evaluateSlo({ target: 0.995, windowDays: 30 }, days(141), t).verdict).toBe('breached');     // 141 / 28000 > 0.5 %
    expect(evaluateSlo({ target: 0.995, windowDays: 30 }, days(140), t).verdict).toBe('validated');    // exactly 0.5 %
  });
  it('thresholds come from the environment, with sane floors', () => {
    expect(thresholds({ SLO_VALIDATION_MIN_DAYS: '7', SLO_VALIDATION_MIN_REQUESTS: '50' })).toEqual({ minDays: 7, minRequests: 50 });
    expect(thresholds({ SLO_VALIDATION_MIN_DAYS: '-3' })).toEqual({ minDays: 1, minRequests: 1000 });
    expect(thresholds({})).toEqual({ minDays: 28, minRequests: 1000 });
  });
});

describe('from the persisted per-minute table', () => {
  it('an empty table: every SLO is proposed with 0 days, and the rows say so', async () => {
    const r = await validateAll(db, NOW, ENV);
    expect(r.map((x) => x.verdict)).toEqual(SLOS.map(() => 'proposed'));
    const rows = (await pg.query(`SELECT slo_id, status, days_with_data FROM slo_validations ORDER BY slo_id`)).rows;
    expect(rows).toHaveLength(SLOS.length);
    expect(rows.every((x: any) => x.status === 'proposed' && x.days_with_data === 0)).toBe(true);
  });
  it('30 good days of card payments → checkout_payment validated (and only the SLOs whose routes had traffic)', async () => {
    await traffic(30, { ok: 100 });
    const r = Object.fromEntries((await validateAll(db, NOW, ENV)).map((x) => [x.id, x]));
    expect(r.checkout_payment).toMatchObject({ verdict: 'validated', daysWithData: 30, total: 3000, bad: 0 });
    expect(r.api_availability.verdict).toBe('validated');        // '*' — every route
    expect(r.booking_completion.verdict).toBe('proposed');       // no booking traffic at all
  });
  it('5xx above the budget → breached; a later good month flips it back but keeps when each verdict was FIRST reached', async () => {
    await traffic(30, { ok: 100, fail5xx: 5 });                   // ~4.8 % failures vs a 0.5 % budget
    await validateAll(db, NOW, ENV);
    const first = (await pg.query(`SELECT status, breached_at, validated_at FROM slo_validations WHERE slo_id = 'checkout_payment'`)).rows[0];
    expect(first.status).toBe('breached');
    expect(new Date(first.breached_at).toISOString()).toBe(NOW.toISOString());
    await pg.exec(`DELETE FROM platform_request_metrics_minute`);
    await traffic(30, { ok: 100 });
    const later = new Date(NOW.getTime() + 3_600_000);
    await validateAll(db, later, ENV);
    const second = (await pg.query(`SELECT status, breached_at, validated_at FROM slo_validations WHERE slo_id = 'checkout_payment'`)).rows[0];
    expect(second.status).toBe('validated');
    expect(new Date(second.breached_at).toISOString()).toBe(NOW.toISOString());     // kept
    expect(new Date(second.validated_at).toISOString()).toBe(later.toISOString());
  });
  it('a validated SLO that stays validated keeps the time it was FIRST validated', async () => {
    await traffic(30, { ok: 100 });
    await validateAll(db, NOW, ENV);
    await validateAll(db, new Date(NOW.getTime() + 3_600_000), ENV);
    const row = (await pg.query(`SELECT status, validated_at, evaluated_at FROM slo_validations WHERE slo_id = 'checkout_payment'`)).rows[0];
    expect(row.status).toBe('validated');
    expect(new Date(row.validated_at).toISOString()).toBe(NOW.toISOString());
    expect(new Date(row.evaluated_at).toISOString()).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
  });
  it('the latency SLO counts requests slower than 2.5 s as bad', async () => {
    await traffic(30, { ok: 100, slow: 10 });                     // 10 % slow vs a 95 % target
    const r = Object.fromEntries((await validateAll(db, NOW, ENV)).map((x) => [x.id, x]));
    expect(r.checkout_latency).toMatchObject({ verdict: 'breached', bad: 300 });
    expect(r.checkout_payment.verdict).toBe('validated');         // slow is not unavailable
  });
  it('traffic older than the window is not evidence', async () => {
    await pg.query(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count) VALUES ($1, 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 2, 100000)`, [new Date(NOW.getTime() - 31 * 86_400_000)]);
    expect(await dailyRows(db, CARD, NOW)).toEqual([]);
  });
  it('System Operations carries the verdicts; never-evaluated SLOs read as proposed with 0 days', async () => {
    expect((await readSloValidations(db)).map((v) => [v.id, v.status, v.daysWithData])).toEqual(SLOS.map((s) => [s.id, 'proposed', 0]));
    await traffic(30, { ok: 100 }); await validateAll(db, NOW, ENV);
    const o = await new SystemOperationsService(db).overview(NOW);
    expect(o.sloValidations.find((v) => v.id === 'checkout_payment')).toMatchObject({ status: 'validated', daysWithData: 30, requiredDays: 28 });
  });
});
