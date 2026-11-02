// product-demand-forecast.service.ts — Product Demand Forecasting. Closes the loop between the two AI modules: it forecasts
// per-product daily DEMAND from the ai_inventory movements ledger (retail_sale + service_usage) using the validated engine,
// then fuses that with the LIVE inventory position (sellable on-hand + confirmed inbound, from the ai_inventory position
// service) to project a stockout date, days-of-cover, and a forecast-driven suggested order. READ-ONLY: it recommends, it
// never orders. Reuses both existing modules — no second inventory ledger, no second forecasting engine.
import { forecast, backtest, selectModel, classifyDataQuality, classifyConfidence, type BacktestMetrics, type SeriesPoint } from './forecast-core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type ProductDemandSource, type ProductPositionProvider } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const MIN_HISTORY = 14;
const LOOKBACK_DAYS = 120;
const MIN_TRAIN = 14;

export interface ProductDemandForecast {
  domain: 'product_demand';
  branchId: string;
  productId: string;
  productName: string | null;
  horizonDays: number;
  method: string;
  selectionReason: string;
  historyLength: number;
  dataQuality: string;
  confidence: string;
  accuracy: (BacktestMetrics & { note: string }) | null;
  position: { sellableOnHand: number; confirmedInbound: number; projectedAvailable: number };
  forecastDemandOverHorizon: number;
  projectedStockoutDate: string | null; // null when not projected to run out within the horizon
  daysOfCover: number | null;
  suggestedOrderUnits: number;           // forecast-driven cover for the horizon, net of position + inbound
  horizon: { step: number; date: string; demand: number; lower: number; upper: number }[];
  generatedAt: string;
  disclaimer: string;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00.000Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export class ProductDemandForecastService {
  constructor(private readonly demand: ProductDemandSource, private readonly position: ProductPositionProvider) {}

  async getProductForecast(ctx: AiForecastContext, productId: string, horizonDays = 14): Promise<ProductDemandForecast> {
    if (!ctx.permissions.includes('inventory.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing inventory.view', 403), 'PERMISSION_DENIED');
    }
    if (!productId) throw new AiForecastError(AiForecastErrorCode.INTERNAL_ERROR, 'productId required', 400);
    if (horizonDays < 1 || horizonDays > 90) throw withCode(new AiForecastError(AiForecastErrorCode.INVALID_HORIZON, 'Horizon must be 1–90 days', 400), 'FORECAST_HORIZON_INVALID');

    const series: SeriesPoint[] = await this.demand.getDailyDemand(ctx, productId, LOOKBACK_DAYS);
    if (series.length < MIN_HISTORY) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_HISTORY, `Need at least ${MIN_HISTORY} days of demand history to forecast (have ${series.length}).`, 422), 'FORECAST_HISTORY_TOO_SHORT');
    }

    const selection = selectModel(series, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const metrics = backtest(series, selection.selected, { minTrain: MIN_TRAIN, step: 1, period: 7 });
    const out = forecast(series, selection.selected, horizonDays, { intervalLevel: 0.8, period: 7, wape: metrics?.wape ?? null });

    const pos = await this.position.getProductPosition(ctx, productId);
    if (!pos) throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_HISTORY, 'No stock record for this product at this branch', 404), 'NO_STOCK_RECORD');
    const projectedAvailable = Math.max(0, pos.sellableOnHand + pos.confirmedInbound);

    const lastDate = series[series.length - 1].date;
    let cumulative = 0;
    let stockoutDate: string | null = null;
    const horizon = out.horizon.map((h) => {
      const date = addDays(lastDate, h.step);
      cumulative += h.point;
      if (stockoutDate === null && cumulative > projectedAvailable) stockoutDate = date;
      return { step: h.step, date, demand: h.point, lower: h.lower, upper: h.upper };
    });

    const forecastDemandOverHorizon = Math.round(cumulative * 100) / 100;
    const avgDaily = horizonDays > 0 ? cumulative / horizonDays : 0;
    const daysOfCover = avgDaily > 0 ? Math.round((projectedAvailable / avgDaily) * 10) / 10 : null;
    const suggestedOrderUnits = Math.max(0, Math.ceil(forecastDemandOverHorizon - projectedAvailable));

    return {
      domain: 'product_demand', branchId: ctx.branchId, productId, productName: pos.name,
      horizonDays, method: selection.selected, selectionReason: selection.reason, historyLength: series.length,
      dataQuality: classifyDataQuality(series),
      confidence: classifyConfidence(series.length, horizonDays, metrics?.wape ?? null, classifyDataQuality(series)),
      accuracy: metrics ? { ...metrics, note: `Backtested over ${metrics.folds} rolling folds (WAPE ${(metrics.wape * 100).toFixed(1)}%).` } : null,
      position: { sellableOnHand: pos.sellableOnHand, confirmedInbound: pos.confirmedInbound, projectedAvailable },
      forecastDemandOverHorizon, projectedStockoutDate: stockoutDate, daysOfCover, suggestedOrderUnits,
      horizon,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Demand forecast is decision-support, not a guaranteed outcome. Suggested order covers forecast demand over the horizon net of on-hand + confirmed inbound; apply vendor minimums and lead time before ordering.',
    };
  }
}
