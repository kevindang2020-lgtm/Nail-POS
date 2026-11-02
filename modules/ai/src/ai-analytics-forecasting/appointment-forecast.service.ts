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
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export class AppointmentForecastService {
  constructor(private readonly source: AppointmentSeriesSource) {}

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
    };
  }
}
