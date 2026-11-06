// forecast-center.pgtest — AI Analytics & Forecasting guide (Nov 2 2026; migration 776) on the REAL migrated schema.
// SU = counters · LI = the forecast history (who sees which type, search, status, dates, pages, scope) · RN = one run, forecast
// vs actual · HL = Check AI Analytics & Forecasting System (data quality, storage, evaluation, isolation; read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ForecastCenter, ForecastCenterError, type FcProbes } from './forecast-center';
import { permissionsFor } from '@aipowersalon/permissions';

const id = (n: number) => `77760000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), TECH = id(30);
const R1 = id(101), R2 = id(102), R3 = id(103), R4 = id(104), R5 = id(105);
const VIEW = ['pos.ai_analytics.view', 'reports.view'];
const FIN = [...VIEW, 'pos.reports.financial_view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: VIEW, ...o });
let pg: any; let db: any; let fc: ForecastCenter;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ForecastCenterError ? e.code : (e as Error).message; } }
/** a run of `days` targets starting `startOffset` days from today, generated `genDaysAgo` days ago; `realized` of them evaluated */
async function run(rid: string, o: { t?: string; b?: string; domain?: string; model?: string; genDaysAgo: number; startOffset: number; days: number; realized?: number; backtest?: number | null; badRange?: boolean }) {
  for (let i = 0; i < o.days; i++) {
    const ev = i < (o.realized ?? 0);
    const actual = 10 + i;           // forecast is always 10; inside the range [8, 12] for the first 3 days only
    await q(`insert into forecast_points (tenant_id, branch_id, run_id, domain, model, model_version, horizon_step, target_date, point_value, lower_value, upper_value,
        backtest_wape, realized_value, abs_error, within_interval, realized_at, generated_at)
      values ($1,$2,$3,$4,$5,'forecast-v1',$6, current_date + $7::int, 10, $8, 12, $9, $10, $11, $12, $13, now() - ($14 || ' days')::interval)`,
    [o.t ?? T, o.b ?? B, rid, o.domain ?? 'appointments', o.model ?? 'holt_linear', i + 1, o.startOffset + i, o.badRange && i === 0 ? 11 : 8, o.backtest === undefined ? 0.2 : o.backtest,
      ev ? actual : null, ev ? Math.abs(actual - 10) : null, ev ? actual <= 12 : null, ev ? new Date() : null, String(o.genDaysAgo)]);
  }
}
const appt = (o: { b?: string; daysAgo: number; status?: string; cust?: string | null; start?: string; end?: string; dur?: number; createdDaysAgo?: number }) =>
  q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, customer_phone, appt_date, start_time, end_time, duration_minutes, status, created_at, updated_at)
    values ($1,$2,$3,'Guest',$4, current_date - $5::int, $6, $7, $8, $9, now() - ($10 || ' days')::interval, now())`,
  [T, o.b ?? B, TECH, o.cust === undefined ? '+18565550142' : o.cust, o.daysAgo, o.start ?? '10:00', o.end ?? '11:00', o.dur ?? 60, o.status ?? 'completed', String(o.createdDaysAgo ?? o.daysAgo)]);
const probes = (o: Partial<{ appt: number; rev: number | 'restricted' }> = {}): FcProbes => ({
  appointments: async () => ({ historyDays: o.appt ?? 30, minimum: 14, ready: (o.appt ?? 30) >= 14, zeroDays: 2, lastDay: null }),
  revenue: async () => (o.rev === 'restricted' ? { restricted: true as const } : { historyDays: o.rev ?? 30, minimum: 14, ready: (o.rev ?? 30) >= 14, zeroDays: 0 }),
});

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  fc = new ForecastCenter(db);
  await q(`set timezone = 'UTC'`);   // current_date in the fixtures = the branches' (UTC) salon day
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','fc-776','FC776','active'), ($2,'X','Other','fc-776x','FC776X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$2,'North','active','UTC'), ($4,$5,'Other','active','UTC')`, [B, T, B2, BX, X]);
}, 180_000);

describe('Forecast center — who may see it', () => {
  it('SU-01 no forecasts yet → zero counters, an empty history (never an error)', async () => {
    const s: any = await fc.summary(ctx());
    expect(s.counters).toEqual({ runs: 0, runs30d: 0, awaitingActual: 0, evaluatedDays: 0 });
    expect(s.domains).toEqual(['appointments', 'product_demand']);
    const l: any = await fc.list(ctx(), {});
    expect(l).toMatchObject({ items: [], total: 0, page: 1, totalPages: 1 });
  });
  it('Nov 6 2026 route sweep: an OWNER / MANAGER session (the catalog grants, alias-granted keys) is let in — it was refused', async () => {
    for (const role of ['OWNER', 'MANAGER'] as const) {
      const l: any = await fc.list(ctx({ role, permissions: [...permissionsFor(role)] }), {});
      expect(l).toMatchObject({ page: 1 });
    }
    expect(await code(fc.list(ctx({ role: 'FRONT_DESK', permissions: [...permissionsFor('FRONT_DESK')] }), {}))).toBe('PERMISSION_DENIED');
  });
  it('SU-02 without the AI analytics permission, or without any forecast type, → PERMISSION_DENIED', async () => {
    expect(await code(fc.list(ctx({ permissions: ['reports.view'] }), {}))).toBe('PERMISSION_DENIED');
    expect(await code(fc.summary(ctx({ permissions: ['pos.ai_analytics.view'] })))).toBe('PERMISSION_DENIED');
    expect(await code(fc.check(ctx({ permissions: ['pos.ai_analytics.view'] }), probes()))).toBe('PERMISSION_DENIED');
  });
});

describe('Forecast history', () => {
  beforeAll(async () => {
    await run(R1, { genDaysAgo: 40, startOffset: -39, days: 7, realized: 7, model: 'seasonal_naive' });   // evaluated
    await run(R2, { genDaysAgo: 2, startOffset: -2, days: 7 });                                            // 2 matured, none evaluated
    await run(R3, { genDaysAgo: 1, startOffset: 1, days: 7, domain: 'revenue' });                          // pending
    await run(R4, { genDaysAgo: 3, startOffset: 1, days: 7, b: B2 });                                      // another branch
    await run(R5, { genDaysAgo: 3, startOffset: 1, days: 7, t: X, b: BX });                                // another salon
  });
  it('LI-01 newest first; revenue only with the financial permission; another branch and salon never shown', async () => {
    const l: any = await fc.list(ctx(), {});
    expect(l.items.map((r: any) => r.runId)).toEqual([R2, R1]);
    expect((await fc.list(ctx({ permissions: FIN }), {}) as any).items.map((r: any) => r.runId)).toEqual([R3, R2, R1]);
    expect((await fc.list(ctx({ permissions: FIN }), { sort: 'oldest' }) as any).items.map((r: any) => r.runId)).toEqual([R1, R2, R3]);
  });
  it('LI-02 a salon-wide user sees every branch of the salon, still never another salon', async () => {
    const l: any = await fc.list(ctx({ branchId: null }), {});
    expect(l.items.map((r: any) => r.runId)).toEqual([R2, R4, R1]);
    expect(l.items.find((r: any) => r.runId === R4).branch).toBe('North');
  });
  it('LI-03 status, evaluation numbers: evaluated → WAPE and coverage from the actual days; awaiting → none (never a fabricated 0)', async () => {
    const l: any = await fc.list(ctx({ permissions: FIN }), {});
    const r1 = l.items.find((r: any) => r.runId === R1), r2 = l.items.find((r: any) => r.runId === R2), r3 = l.items.find((r: any) => r.runId === R3);
    expect(r1).toMatchObject({ status: 'evaluated', realized: 7, matured: 7, model: 'seasonal_naive', branch: 'Main', days: 7 });
    expect(r1.wape).toBeCloseTo(21 / 91, 6);      // |10..16 − 10| = 0+1+…+6 = 21 over actuals 10+…+16 = 91
    expect(r1.coverage).toBeCloseTo(3 / 7, 6);    // 10, 11, 12 inside [8, 12]
    expect(r2).toMatchObject({ status: 'awaiting', matured: 2, realized: 0, wape: null, coverage: null });
    expect(r3).toMatchObject({ status: 'pending', domain: 'revenue' });
    expect((await fc.list(ctx({ permissions: FIN }), { status: 'awaiting' }) as any).items.map((r: any) => r.runId)).toEqual([R2]);
    expect((await fc.list(ctx({ permissions: FIN }), { domain: 'revenue' }) as any).total).toBe(1);
  });
  it('LI-04 search: run id prefix, model; nothing for another salon\'s run id', async () => {
    expect((await fc.list(ctx(), { q: R1 }) as any).items.map((r: any) => r.runId)).toEqual([R1]);
    expect((await fc.list(ctx(), { q: 'seasonal' }) as any).items.map((r: any) => r.runId)).toEqual([R1]);
    expect((await fc.list(ctx(), { q: R5 }) as any).total).toBe(0);
  });
  it('LI-05 dates on the generated day: presets and From/To; From after To is refused', async () => {
    expect((await fc.list(ctx(), { preset: 'last_7' }) as any).items.map((r: any) => r.runId)).toEqual([R2]);
    const today = (await fc.summary(ctx()) as any).period.today as string;
    const d = (k: number) => { const x = new Date(today + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
    expect((await fc.list(ctx(), { preset: 'custom', from: d(-45), to: d(-30) }) as any).items.map((r: any) => r.runId)).toEqual([R1]);
    expect(await code(fc.list(ctx(), { preset: 'custom', from: d(0), to: d(-1) }))).toBe('FC_INVALID_PERIOD');
    expect(await code(fc.list(ctx(), { preset: 'custom', from: 'x' }))).toBe('FC_INVALID_PERIOD');
  });
  it('LI-06 numbered pages and page sizes (an unknown size falls back to 25)', async () => {
    const p1: any = await fc.list(ctx({ permissions: FIN }), { pageSize: 10, page: 1 });
    expect(p1).toMatchObject({ total: 3, totalPages: 1, pageSize: 10 });
    expect((await fc.list(ctx({ permissions: FIN }), { pageSize: 10, page: 2 }) as any).items).toEqual([]);
    expect((await fc.list(ctx(), { pageSize: 7 }) as any).pageSize).toBe(25);
  });
  it('SU-03 counters', async () => {
    const s: any = await fc.summary(ctx({ permissions: FIN }));
    expect(s.counters).toEqual({ runs: 3, runs30d: 2, awaitingActual: 2, evaluatedDays: 7 });
    expect(s.lastRun.revenue).not.toBeNull();
  });
});

describe('One run — forecast vs actual', () => {
  it('RN-01 each day: forecast, range, actual, error, inside or not; future days pending, matured without an actual awaiting', async () => {
    const r: any = await fc.run(ctx(), R1);
    expect(r.run.runId).toBe(R1);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toMatchObject({ step: 1, forecast: 10, lower: 8, upper: 12, actual: 10, error: 0, inside: true, state: 'evaluated' });
    expect(r.days[6]).toMatchObject({ actual: 16, error: 6, inside: false });
    const r2: any = await fc.run(ctx(), R2);
    expect(r2.days.map((d: any) => d.state)).toEqual(['awaiting', 'awaiting', 'pending', 'pending', 'pending', 'pending', 'pending']);
  });
  it('RN-02 another salon\'s run, a revenue run without the financial permission, a bad id → not found', async () => {
    expect(await code(fc.run(ctx(), R5))).toBe('FC_RUN_NOT_FOUND');
    expect(await code(fc.run(ctx(), R3))).toBe('FC_RUN_NOT_FOUND');
    expect(await code(fc.run(ctx(), 'nope'))).toBe('FC_RUN_NOT_FOUND');
    expect(await code(fc.run(ctx(), R4))).toBe('FC_RUN_NOT_FOUND');      // another branch for a branch user
  });
});

describe('Check AI Analytics & Forecasting System', () => {
  const byKey = (h: any) => Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
  it('HL-01 finds the data-quality problems, the awaiting evaluation; read-only; failures first', async () => {
    await q(`set session_replication_role = replica`);
    for (let i = 1; i <= 10; i++) await appt({ daysAgo: i, cust: '+1856555' + String(1000 + i), createdDaysAgo: 0 });
    await appt({ daysAgo: 3, cust: '+18565551003' });                       // same tech, day, time, customer → a duplicate
    await appt({ daysAgo: 4, cust: null, dur: 900 });                        // 15 hours
    await appt({ daysAgo: 5, cust: null, status: 'booked' });               // past, no outcome recorded
    await appt({ daysAgo: 6, cust: null, status: 'no_show' });
    await q(`set session_replication_role = origin`);
    const before = (await q(`select count(*)::int as n from forecast_points`))[0].n;
    const h: any = await fc.check(ctx(), probes());
    const k = byKey(h);
    expect(k.duplicate_appointments).toMatchObject({ state: 'WARNING', count: 1, component: 'data_quality' });
    expect(k.invalid_durations).toMatchObject({ state: 'WARNING', count: 1 });
    expect(k.missing_outcomes).toMatchObject({ state: 'WARNING', count: 1 });
    expect(k.noshow_labels).toMatchObject({ state: 'PASSED', detail: { noShows: 1 } });
    expect(k.appointment_history.state).toBe('PASSED');
    expect(k.booking_connection.state).toBe('PASSED');
    expect(k.evaluation).toMatchObject({ state: 'PASSED', count: 0 });       // R2's matured days are not 3 days overdue yet
    expect(k.forecast_storage.state).toBe('PASSED');
    expect(k.forecast_ranges.state).toBe('PASSED');
    expect(k.interval_coverage).toMatchObject({ state: 'INSUFFICIENT_DATA', count: 7 });   // under 10 evaluated days: no verdict
    expect(k.backtest.state).toBe('PASSED');
    expect(k.revenue_history).toBeUndefined();                                // no financial permission → not checked
    expect(k.tenant_isolation.state).toBe('PASSED');
    expect(k.no_side_effects.state).toBe('PASSED');
    expect(h.overall).toBe('WARNING');
    expect(h.checks[0].state).toBe('WARNING');
    expect(h.checks.find((c: any) => c.state === 'PASSED').lastPassedAt).toBe(h.checkedAt);
    expect(k.interval_coverage.lastPassedAt).toBeNull();
    expect((await q(`select count(*)::int as n from forecast_points`))[0].n).toBe(before);
    expect((await q(`select overall from forecasting_health_runs where tenant_id = $1`, [T])).map((r) => r.overall)).toEqual(['WARNING']);
  });
  it('HL-02 a second check within 30 seconds reuses the run (no second row)', async () => {
    const h: any = await fc.check(ctx(), probes());
    expect(h.reused).toBe(true);
    expect((await q(`select count(*)::int as n from forecasting_health_runs where tenant_id = $1`, [T]))[0].n).toBe(1);
  });
  it('HL-03 a broken range, a missing backtest, a forecast pointing at another salon\'s branch, a short history → flagged; last success kept', async () => {
    await q(`update forecasting_health_runs set created_at = now() - interval '1 hour' where tenant_id = $1`, [T]);
    await run(id(106), { genDaysAgo: 0, startOffset: 1, days: 3, badRange: true, backtest: null });
    await run(id(107), { genDaysAgo: 5, startOffset: 1, days: 2, b: BX });
    await run(id(108), { genDaysAgo: 30, startOffset: -29, days: 6, realized: 6 });   // 13 evaluated days, 6 inside
    await q(`update forecast_points set realized_value = null, abs_error = null, within_interval = null where run_id = $1 and horizon_step = 1`, [R2]);
    await q(`update forecast_points set target_date = current_date - 5 where run_id = $1 and horizon_step = 1`, [R2]);
    const h: any = await fc.check(ctx({ permissions: FIN }), probes({ appt: 5, rev: 'restricted' }));
    const k = byKey(h);
    expect(k.forecast_ranges).toMatchObject({ state: 'FAILED', count: 1 });
    expect(k.tenant_isolation).toMatchObject({ state: 'FAILED', count: 2 });
    expect(k.backtest).toMatchObject({ state: 'WARNING', detail: { notAvailable: ['appointments'] } });
    expect(k.appointment_history).toMatchObject({ state: 'WARNING', count: 5 });
    expect(k.interval_coverage).toMatchObject({ state: 'WARNING', count: 13 });
    expect(k.interval_coverage.detail.coverage).toBeCloseTo(6 / 13, 6);
    expect(k.evaluation).toMatchObject({ state: 'WARNING', count: 1 });   // a day 5 days past with no actual
    expect(k.revenue_history).toMatchObject({ state: 'INSUFFICIENT_DATA', detail: { restricted: true } });
    expect(h.overall).toBe('FAILED');
    expect(h.checks[0].state).toBe('FAILED');
    expect(k.appointment_history.lastPassedAt).not.toBeNull();       // it passed in HL-01
    expect(k.appointment_history.lastPassedAt).not.toBe(h.checkedAt);
  });
});
