// revenue-forecast.service.ts — Revenue Forecasting domain. Reads AUTHORITATIVE daily net-revenue history (via
// RevenueSeriesSource → ReportsService.getRevenueOverview in prod, which enforces pos.reports.financial_view), selects a
// validated model by BACKTEST, and returns a point forecast with prediction intervals in CENTS. Revenue is money, so the
// financial gate is strict and the output is explicitly labeled a forecast range — NOT guaranteed income. Accuracy is only
// reported from a backtest. Values are cents (money-as-integer-cents invariant preserved end to end).
import { forecast, backtest, selectModel, classifyDataQuality, classifyConfidence, type BacktestMetrics, type SeriesPoint } from './forecast-core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type RevenueSeriesSource } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const MIN_HISTORY = 14;
const LOOKBACK_DAYS = 180;
const MIN_TRAIN = 14;

export interface RevenueForecast {
  domain: 'revenue';
  branchId: string;
  currencyUnit: 'cents';
  horizonDays: number;
  method: string;
  selectionReason: string;
  historyLength: number;
  dataQuality: string;
  confidence: string;
  intervalLevel: number;
  accuracy: (BacktestMetrics & { note: string }) | null;
  forecastTotalCents: number;               // sum of point forecasts over the horizon (forecasted additional revenue)
  horizon: { step: number; date: string; pointCents: number; lowerCents: number; upperCents: number }[];
  generatedAt: string;
  disclaimer: string;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isForbidden = (e: any) => e && (e.name === 'ForbiddenError' || e instanceof Error && /forbidden|financial_view/i.test(e.message || ''));

export class RevenueForecastService {
  constructor(private readonly source: RevenueSeriesSource) {}

  /** Authoritative historical revenue actuals (cents) by date. Financial gate enforced by the source. */
  async getActualsByDate(ctx: AiForecastContext, lookbackDays = 120): Promise<Map<string, number>> {
    if (!ctx.permissions.includes('reports.view')) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    try {
      const series = await this.source.getDailyRevenue(ctx, lookbackDays);
      return new Map(series.map((p) => [p.date, p.value]));
    } catch (e) {
      if (isForbidden(e)) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing pos.reports.financial_view', 403), 'PERMISSION_DENIED');
      throw e;
    }
  }

  async getRevenueForecast(ctx: AiForecastContext, horizonDays = 7): Promise<RevenueForecast> {
    if (!ctx.permissions.includes('reports.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    }
    if (horizonDays < 1 || horizonDays > 90) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INVALID_HORIZON, 'Horizon must be 1–90 days', 400), 'FORECAST_HORIZON_INVALID');
    }

    let series: SeriesPoint[];
    try {
      series = await this.source.getDailyRevenue(ctx, LOOKBACK_DAYS);
    } catch (e) {
      // The financial gate lives in ReportsService (requireFinancial → ForbiddenError). Map it to a clean 403.
      if (isForbidden(e)) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing pos.reports.financial_view', 403), 'PERMISSION_DENIED');
      throw e;
    }

    if (series.length < MIN_HISTORY) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_HISTORY, `Need at least ${MIN_HISTORY} days of revenue history to forecast (have ${series.length}).`, 422), 'FORECAST_HISTORY_TOO_SHORT');
    }

    const selection = selectModel(series, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const metrics = backtest(series, selection.selected, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const out = forecast(series, selection.selected, horizonDays, { intervalLevel: 0.8, period: 7, wape: metrics?.wape ?? null });

    const lastDate = series[series.length - 1].date;
    const horizon = out.horizon.map((h) => ({
      step: h.step, date: addDays(lastDate, h.step),
      pointCents: Math.round(h.point), lowerCents: Math.round(h.lower), upperCents: Math.round(h.upper),
    }));

    return {
      domain: 'revenue', branchId: ctx.branchId, currencyUnit: 'cents', horizonDays,
      method: selection.selected, selectionReason: selection.reason, historyLength: series.length,
      dataQuality: classifyDataQuality(series),
      confidence: classifyConfidence(series.length, horizonDays, metrics?.wape ?? null, classifyDataQuality(series)),
      intervalLevel: out.intervalLevel,
      accuracy: metrics ? { ...metrics, note: `Backtested over ${metrics.folds} rolling folds (WAPE ${(metrics.wape * 100).toFixed(1)}%).` } : null,
      forecastTotalCents: horizon.reduce((a, h) => a + h.pointCents, 0),
      horizon,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Forecasted revenue is decision-support, NOT guaranteed income. Ranges are 80% prediction intervals; actual results will vary.',
    };
  }
}
