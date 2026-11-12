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
    const state: CapacityState = c.scheduledMinutes === 0 ? (exp > 0 ? 'no_schedule' : 'ok') : exp > c.scheduledMinutes ? 'short' : hi > c.scheduledMinutes ? 'tight' : 'ok';
    return { date: h.date, expectedMinutes: exp, lowerMinutes: lo, upperMinutes: hi, scheduledMinutes: c.scheduledMinutes, technicians: c.technicians, gapMinutes: c.scheduledMinutes - exp, state };
  });
  return { avgAppointmentMinutes: avg, durationSample: cap.durationSample, durationWindowDays: cap.durationWindowDays, days,
    basis: 'Workload = forecast appointments x average booked minutes. Scheduled = weekly schedule with date overrides, breaks removed; time off is not subtracted. Advisory only: no shift is created or changed.' };
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
