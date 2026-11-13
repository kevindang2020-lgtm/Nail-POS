// appointment-forecast.service.ts — Appointment Forecasting domain. Reads the AUTHORITATIVE daily appointment history
// (via AppointmentSeriesSource → ReportsService in prod), selects a validated model by BACKTEST, and returns a point
// forecast with prediction intervals, a backtest-derived confidence, and a data-quality status. It never fabricates data
// and never claims accuracy that wasn't backtested; with too little history it returns INSUFFICIENT_HISTORY rather than a
// confident guess. This is decision-support — the output is explicitly a forecast range, not a guaranteed outcome.
import { forecast, backtest, selectModel, classifyDataQuality, classifyConfidence, type BacktestMetrics, type SeriesPoint } from './forecast-core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type AppointmentSeriesSource } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const MIN_HISTORY = 14;       // below this we won't produce a numeric forecast
const LOOKBACK_DAYS = 180;    // how much history to pull
const MIN_TRAIN = 14;

export interface AppointmentForecast {
  domain: 'appointments';
  branchId: string;
  horizonDays: number;
  method: string;
  selectionReason: string;
  historyLength: number;
  dataQuality: string;
  confidence: string;
  intervalLevel: number;
  accuracy: (BacktestMetrics & { note: string }) | null; // null when not backtestable — accuracy is NEVER asserted
  horizon: { step: number; date: string; point: number; lower: number; upper: number }[];
  generatedAt: string;
  disclaimer: string;
  /** Extras (AI Analytics Forecasting 03): forecast workload vs scheduled technician hours — advisory only, never a shift */
  capacity?: ForecastCapacityGap;
}

/** the capacity reader the gap needs (ScheduleCapacitySource in prod) */
export interface ForecastCapacityReader {
  getCapacity(ctx: AiForecastContext, dates: string[]): Promise<{ days: { date: string; scheduledMinutes: number; technicians: number }[]; avgAppointmentMinutes: number | null; durationSample: number; durationWindowDays: number }>;
}
export type CapacityState = 'short' | 'tight' | 'ok' | 'no_schedule' | 'unknown';
export interface ForecastCapacityGap {
  avgAppointmentMinutes: number | null; durationSample: number; durationWindowDays: number;
  days: { date: string; expectedMinutes: number | null; lowerMinutes: number | null; upperMinutes: number | null; scheduledMinutes: number; technicians: number; gapMinutes: number | null; state: CapacityState }[];
  basis: string;
}
/** PURE: workload = forecast appointments × the average booked minutes; gap = scheduled − expected (negative = short).
 *  short: the expected workload is above the scheduled hours; tight: only the upper 80% bound is; no_schedule: work expected,
 *  nobody scheduled; unknown: no duration history to convert appointments into minutes. */
export function capacityGap(horizon: { date: string; point: number; lower: number; upper: number }[], cap: Awaited<ReturnType<ForecastCapacityReader['getCapacity']>>): ForecastCapacityGap {
  const by = new Map(cap.days.map((d) => [d.date, d]));
  const avg = cap.avgAppointmentMinutes;
  const days = horizon.map((h) => {
    const c = by.get(h.date) ?? { scheduledMinutes: 0, technicians: 0 };
    if (avg == null) return { date: h.date, expectedMinutes: null, lowerMinutes: null, upperMinutes: null, scheduledMinutes: c.scheduledMinutes, technicians: c.technicians, gapMinutes: null, state: 'unknown' as CapacityState };
    const exp = Math.round(Math.max(0, h.point) * avg), lo = Math.round(Math.max(0, h.lower) * avg), hi = Math.round(Math.max(0, h.upper) * avg);
    const state = capacityState(exp, hi, c.scheduledMinutes);
    return { date: h.date, expectedMinutes: exp, lowerMinutes: lo, upperMinutes: hi, scheduledMinutes: c.scheduledMinutes, technicians: c.technicians, gapMinutes: c.scheduledMinutes - exp, state };
  });
  return { avgAppointmentMinutes: avg, durationSample: cap.durationSample, durationWindowDays: cap.durationWindowDays, days,
    basis: 'Workload = forecast appointments x average booked minutes. Scheduled = weekly schedule with date overrides, breaks removed; time off is not subtracted. Advisory only: no shift is created or changed.' };
}

/** the one state rule (used by the real gap and by the what-if sandbox) */
function capacityState(expectedMinutes: number, upperMinutes: number, scheduledMinutes: number): CapacityState {
  return scheduledMinutes === 0 ? (expectedMinutes > 0 ? 'no_schedule' : 'ok') : expectedMinutes > scheduledMinutes ? 'short' : upperMinutes > scheduledMinutes ? 'tight' : 'ok';
}

// ── Extras (AI Analytics Forecasting 07): Non-mutating Scenario ───────────────────────────────────────────────────────────
// A what-if illustration over the capacity gap: "if demand were X % different and Y extra technician minutes were scheduled
// each day". It is a SANDBOX: versioned (CAPACITY_SCENARIO_VERSION), returned only when asked, labelled with its assumptions,
// computed AFTER the real forecast run is recorded and never stored — not as a forecast run, not as an appointment, not as
// revenue, not as a shift. The real forecast and the real gap in the same answer stay unchanged beside it.
export const CAPACITY_SCENARIO_VERSION = 'capacity-scenario-v1';
export interface CapacityScenarioAssumptions { demandChangePct: number; extraMinutesPerDay: number }
export interface ForecastCapacityScenario {
  version: string; sandbox: true; stored: false; assumptions: CapacityScenarioAssumptions;
  days: { date: string; expectedMinutes: number | null; upperMinutes: number | null; scheduledMinutes: number; gapMinutes: number | null; state: CapacityState; baselineState: CapacityState }[];
  counts: { short: number; tight: number; noSchedule: number; changed: number };
  note: string;
}
/** PURE: the two query values → assumptions (null when neither is given). Whole numbers only: demand −50…+100 %, extra
 *  scheduled minutes 0…960 per day. Anything else is refused, never clamped into a different question. */
export function parseCapacityScenario(demandPct?: string, extraMinutes?: string): CapacityScenarioAssumptions | null {
  const given = (v?: string) => v != null && String(v).trim() !== '';
  if (!given(demandPct) && !given(extraMinutes)) return null;
  const int = (v: string | undefined, lo: number, hi: number) => { if (!given(v)) return 0; const t = String(v).trim(); if (!/^-?\d+$/.test(t)) return null; const n = Number(t); return n >= lo && n <= hi ? n : null; };
  const d = int(demandPct, -50, 100), e = int(extraMinutes, 0, 960);
  if (d == null || e == null) throw withCode(new AiForecastError(AiForecastErrorCode.INVALID_SCENARIO, 'What-if: demand change must be a whole number from -50 to 100 (%), extra minutes from 0 to 960 per day.', 400), 'VALIDATION_FAILED');
  return { demandChangePct: d, extraMinutesPerDay: e };
}
/** PURE: the sandbox over a real capacity gap. Workload scales by (100 + demand %) / 100; scheduled minutes gain the extra
 *  minutes (added to the salon's total per day); the state uses the same rule as the real gap. A day with no duration
 *  history stays unknown. */
export function capacityScenario(gap: ForecastCapacityGap, a: CapacityScenarioAssumptions): ForecastCapacityScenario {
  const f = (m: number) => Math.round((m * (100 + a.demandChangePct)) / 100);
  const days = gap.days.map((d) => {
    const sched = d.scheduledMinutes + a.extraMinutesPerDay;
    if (d.expectedMinutes == null || d.upperMinutes == null) return { date: d.date, expectedMinutes: null, upperMinutes: null, scheduledMinutes: sched, gapMinutes: null, state: 'unknown' as CapacityState, baselineState: d.state };
    const exp = f(d.expectedMinutes), hi = f(d.upperMinutes);
    return { date: d.date, expectedMinutes: exp, upperMinutes: hi, scheduledMinutes: sched, gapMinutes: sched - exp, state: capacityState(exp, hi, sched), baselineState: d.state };
  });
  return {
    version: CAPACITY_SCENARIO_VERSION, sandbox: true, stored: false, assumptions: a, days,
    counts: { short: days.filter((d) => d.state === 'short').length, tight: days.filter((d) => d.state === 'tight').length, noSchedule: days.filter((d) => d.state === 'no_schedule').length,
      changed: days.filter((d) => d.state !== d.baselineState).length },
    note: 'What-if illustration only: the assumptions above are yours, not a forecast. Nothing is saved, booked, scheduled or counted as revenue.',
  };
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export class AppointmentForecastService {
  constructor(private readonly source: AppointmentSeriesSource, private readonly capacityReader: ForecastCapacityReader | null = null) {}

  /** AI Analytics & Forecasting guide (Nov 2026): how much history the model has — the SAME series the forecast uses, so the
   *  "have N of 14 days" the screen shows is the number the forecast was refused on. Read-only. */
  async readiness(ctx: AiForecastContext) {
    if (!ctx.permissions.includes('reports.view')) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    const series = await this.source.getDailyAppointments(ctx, LOOKBACK_DAYS);
    const zeroDays = series.filter((p) => !p.value).length;
    return { domain: 'appointments' as const, historyDays: series.length, minimum: MIN_HISTORY, ready: series.length >= MIN_HISTORY, firstDay: series[0]?.date ?? null,
      lastDay: series[series.length - 1]?.date ?? null, zeroDays, daysShort: Math.max(0, MIN_HISTORY - series.length) };
  }

  /** Authoritative historical actuals by date (for realized-accuracy evaluation). */
  async getActualsByDate(ctx: AiForecastContext, lookbackDays = 120): Promise<Map<string, number>> {
    if (!ctx.permissions.includes('reports.view')) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    const series = await this.source.getDailyAppointments(ctx, lookbackDays);
    return new Map(series.map((p) => [p.date, p.value]));
  }

  async getAppointmentForecast(ctx: AiForecastContext, horizonDays = 7): Promise<AppointmentForecast> {
    // Appointment history is authoritative reporting data → requires the reports.view permission.
    if (!ctx.permissions.includes('reports.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    }
    if (horizonDays < 1 || horizonDays > 90) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INVALID_HORIZON, 'Horizon must be 1–90 days', 400), 'FORECAST_HORIZON_INVALID');
    }

    const series: SeriesPoint[] = await this.source.getDailyAppointments(ctx, LOOKBACK_DAYS);
    if (series.length < MIN_HISTORY) {
      throw withCode(new AiForecastError(
        AiForecastErrorCode.INSUFFICIENT_HISTORY,
        `Need at least ${MIN_HISTORY} days of appointment history to forecast (have ${series.length}).`,
        422,
      ), 'FORECAST_HISTORY_TOO_SHORT');
    }

    const selection = selectModel(series, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const metrics = backtest(series, selection.selected, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const out = forecast(series, selection.selected, horizonDays, { intervalLevel: 0.8, period: 7, wape: metrics?.wape ?? null });

    const lastDate = series[series.length - 1].date;
    const horizon = out.horizon.map((h) => ({
      step: h.step, date: addDays(lastDate, h.step), point: h.point, lower: h.lower, upper: h.upper,
    }));

    return {
      domain: 'appointments',
      branchId: ctx.branchId,
      horizonDays,
      method: selection.selected,
      selectionReason: selection.reason,
      historyLength: series.length,
      dataQuality: classifyDataQuality(series),
      confidence: classifyConfidence(series.length, horizonDays, metrics?.wape ?? null, classifyDataQuality(series)),
      intervalLevel: out.intervalLevel,
      accuracy: metrics ? { ...metrics, note: `Backtested over ${metrics.folds} rolling folds (WAPE ${(metrics.wape * 100).toFixed(1)}%).` } : null,
      horizon,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Forecast is decision-support, not a guaranteed outcome. Ranges are 80% prediction intervals.',
      ...(this.capacityReader ? { capacity: capacityGap(horizon, await this.capacityReader.getCapacity(ctx, horizon.map((h) => h.date))) } : {}),
    };
  }
}
