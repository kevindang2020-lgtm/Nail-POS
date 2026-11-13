// appointment-forecast.vitest.spec.ts — appointment domain over a fake authoritative source.
import { describe, it, expect } from 'vitest';
import { AppointmentForecastService } from './appointment-forecast.service';
import { AiForecastError, InMemoryAppointmentSource, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const series = (values: number[]): SeriesPoint[] => {
  const d0 = new Date('2026-01-01').getTime();
  return values.map((value, i) => ({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), value }));
};
const weekly = (n: number) => Array.from({ length: n }, (_, i) => [10, 12, 14, 16, 30, 40, 8][i % 7]);

const ctx = (o: Partial<AiForecastContext> = {}): AiForecastContext => ({
  tenantId: 'T1', branchId: 'B1', userId: 'U1', role: 'OWNER', permissions: ['reports.view'], ...o,
});

function svc(rows: SeriesPoint[], tenant = 'T1', branch = 'B1') {
  const src = new InMemoryAppointmentSource();
  src.seed(tenant, branch, rows);
  src.seed('T2', 'B1', series(weekly(60)).map((p) => ({ ...p, value: p.value + 999 })));
  return { svc: new AppointmentForecastService(src), src };
}

describe('permission gate', () => {
  it('requires reports.view', async () => {
    await expect(svc(series(weekly(60))).svc.getAppointmentForecast(ctx({ permissions: [] }))).rejects.toBeInstanceOf(AiForecastError);
  });
});

describe('insufficient history', () => {
  it('refuses to guess with < 14 days', async () => {
    await expect(svc(series(weekly(10))).svc.getAppointmentForecast(ctx(), 7)).rejects.toMatchObject({ code: 'INSUFFICIENT_HISTORY' });
  });
});

describe('forecast output', () => {
  it('returns dated horizon with intervals, backtested accuracy, and a disclaimer', async () => {
    const { svc: s } = svc(series(weekly(60)));
    const f = await s.getAppointmentForecast(ctx(), 7);
    expect(f.horizon).toHaveLength(7);
    expect(f.horizon[0].date).toBe('2026-03-02'); // day after last of 60 (2026-01-01 + 59 = 2026-02-29; +1)
    for (const h of f.horizon) { expect(h.upper).toBeGreaterThanOrEqual(h.point); expect(h.lower).toBeGreaterThanOrEqual(0); }
    expect(f.accuracy).not.toBeNull();
    expect(f.accuracy!.folds).toBeGreaterThan(0);
    // extras AI Analytics Forecasting 05 (round 10): the seasonal-naive baseline on the same folds rides along (or null = not evaluated)
    expect(f.baseline).toMatchObject({ method: 'seasonal_naive', selectedWape: f.accuracy!.wape, skill: null });   // the baseline IS the selected model on weekly data (WAPE 0 → no ratio)
    expect(f.method).toBe('seasonal_naive'); // weekly data
    expect(f.disclaimer).toMatch(/not a guaranteed outcome/i);
  });

  it('rejects an out-of-range horizon', async () => {
    await expect(svc(series(weekly(60))).svc.getAppointmentForecast(ctx(), 400)).rejects.toMatchObject({ code: 'INVALID_HORIZON' });
  });
});

describe('tenant isolation', () => {
  it('reads only the ctx tenant/branch history', async () => {
    const { svc: s, src } = svc(series(weekly(60)));
    await s.getAppointmentForecast(ctx({ tenantId: 'T1' }), 7);
    expect(src.lastCtx!.tenantId).toBe('T1');
    // T2's inflated series must never influence T1's forecast points
    const f = await s.getAppointmentForecast(ctx({ tenantId: 'T1' }), 3);
    expect(f.horizon.every((h) => h.point < 500)).toBe(true);
  });
});

// extras (AI Analytics Forecasting 07): the what-if sandbox over the capacity gap
import { capacityGap, capacityScenario, parseCapacityScenario, CAPACITY_SCENARIO_VERSION } from './appointment-forecast.service';
import { AiAnalyticsForecastingController } from './ai-analytics-forecasting.controller';
describe('Non-mutating Scenario (what-if sandbox)', () => {
  const horizon = [{ date: '2026-03-02', point: 10, lower: 8, upper: 12 }, { date: '2026-03-03', point: 10, lower: 8, upper: 12 }, { date: '2026-03-04', point: 4, lower: 2, upper: 6 }];
  const cap = { days: [{ date: '2026-03-02', scheduledMinutes: 600, technicians: 2 }, { date: '2026-03-03', scheduledMinutes: 480, technicians: 1 }, { date: '2026-03-04', scheduledMinutes: 0, technicians: 0 }],
    avgAppointmentMinutes: 50, durationSample: 40, durationWindowDays: 90 };
  it('parses only whole numbers in range; nothing given = no scenario; out of range is refused, never clamped', () => {
    expect(parseCapacityScenario(undefined, '')).toBeNull();
    expect(parseCapacityScenario('20', undefined)).toEqual({ demandChangePct: 20, extraMinutesPerDay: 0 });
    expect(parseCapacityScenario('-50', '960')).toEqual({ demandChangePct: -50, extraMinutesPerDay: 960 });
    for (const [d, e] of [['101', '0'], ['-51', '0'], ['10', '961'], ['10', '-5'], ['2.5', '0'], ['abc', '0']]) expect(() => parseCapacityScenario(d, e)).toThrow(AiForecastError);
  });
  it('scales the workload and adds scheduled minutes with the same state rule; the real gap is untouched; labelled sandbox, versioned, not stored', () => {
    const gap = capacityGap(horizon, cap);
    const before = JSON.stringify(gap);
    expect(gap.days.map((d) => d.state)).toEqual(['ok', 'short', 'no_schedule']);   // 500/600 (upper 600) · 500 > 480 · nobody scheduled
    const s = capacityScenario(gap, { demandChangePct: 20, extraMinutesPerDay: 120 });
    expect(JSON.stringify(gap)).toBe(before);
    expect(s).toMatchObject({ version: CAPACITY_SCENARIO_VERSION, sandbox: true, stored: false, assumptions: { demandChangePct: 20, extraMinutesPerDay: 120 } });
    // day 1: 500×1.2 = 600 workload, upper 600×1.2 = 720 vs 720 scheduled → ok; day 2: 600 vs 600 → upper 720 > 600 → tight; day 3: 240 vs 120 → short
    expect(s.days.map((d) => [d.expectedMinutes, d.scheduledMinutes, d.gapMinutes, d.state, d.baselineState])).toEqual([
      [600, 720, 120, 'ok', 'ok'], [600, 600, 0, 'tight', 'short'], [240, 120, -120, 'short', 'no_schedule']]);
    expect(s.counts).toEqual({ short: 1, tight: 1, noSchedule: 0, changed: 2 });
    expect(s.note).toMatch(/Nothing is saved/);
  });
  it('a day without duration history stays unknown in the sandbox', () => {
    const s = capacityScenario(capacityGap(horizon, { ...cap, avgAppointmentMinutes: null }), { demandChangePct: 50, extraMinutesPerDay: 0 });
    expect(s.days.every((d) => d.state === 'unknown' && d.expectedMinutes == null)).toBe(true);
  });
  it('the endpoint records ONLY the real forecast; the scenario rides beside it; a bad scenario is refused before any read or record', async () => {
    const src = new InMemoryAppointmentSource(); src.seed('T1', 'B1', series(weekly(60)));
    const reader = { getCapacity: async (_c: AiForecastContext, dates: string[]) => ({ days: dates.map((date) => ({ date, scheduledMinutes: 480, technicians: 1 })), avgAppointmentMinutes: 30, durationSample: 10, durationWindowDays: 90 }) };
    const recorded: any[] = [];
    const runs = { recordForecast: async (_c: unknown, _d: string, f: unknown) => { recorded.push(f); } };
    const ctl = new (AiAnalyticsForecastingController as any)(new AppointmentForecastService(src, reader), null, null, null, runs, null, null, null, null);
    const req = { ctx: ctx() };
    const out: any = await ctl.appointmentForecast(req, '7', '25', '60');
    expect(out.scenario).toMatchObject({ sandbox: true, stored: false, assumptions: { demandChangePct: 25, extraMinutesPerDay: 60 } });
    expect(out.capacity.days[0].scheduledMinutes).toBe(480);                      // the real gap is unchanged
    expect(out.scenario.days[0].scheduledMinutes).toBe(540);
    expect(recorded).toHaveLength(1); expect(recorded[0]).not.toHaveProperty('scenario');
    const plain: any = await ctl.appointmentForecast(req, '7');
    expect(plain).not.toHaveProperty('scenario');
    await expect(ctl.appointmentForecast(req, '7', '500')).rejects.toMatchObject({ status: 400 });
    expect(recorded).toHaveLength(2);                                              // the refused call recorded nothing
  });
});
