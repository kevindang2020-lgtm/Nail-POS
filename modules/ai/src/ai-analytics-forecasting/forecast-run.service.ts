// forecast-run.service.ts — records forecasts (once per day per domain/branch) and evaluates DURABLE realized accuracy by
// comparing matured predictions against AUTHORITATIVE actuals supplied by the caller (the same ReportsService/inventory
// sources the forecasts are built from). Recording is best-effort — it must never break a forecast response. Accuracy is
// only ever reported from realized outcomes here; nothing is asserted.
import { AiForecastError, AiForecastErrorCode, type AiForecastContext } from './ai-analytics-forecasting.dto';
import type { ForecastRunRepositoryPort, ForecastRunInput, AccuracyAgg } from './forecast-run.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export type Domain = 'appointments' | 'revenue' | 'product_demand';

/** A generic forecast shape (matches the domain services' `horizon` + metadata) used for persistence. */
export interface RecordableForecast {
  method: string;
  intervalLevel?: number;
  confidence?: string;
  dataQuality?: string;
  accuracy?: { wape: number } | null;
  horizon: { step: number; date: string; point?: number; pointCents?: number; lower?: number; lowerCents?: number; upper?: number; upperCents?: number; demand?: number }[];
}

const val = (h: any, k: 'point' | 'lower' | 'upper') =>
  (k === 'point' ? (h.point ?? h.pointCents ?? h.demand) : k === 'lower' ? (h.lower ?? h.lowerCents) : (h.upper ?? h.upperCents)) ?? 0;

export class ForecastRunService {
  constructor(private readonly repo: ForecastRunRepositoryPort, private readonly modelVersion = 'forecast-v1') {}

  /** Persist a forecast for accuracy tracking — at most once per day per (domain, branch, entity). Best-effort. */
  async recordForecast(ctx: AiForecastContext, domain: Domain, f: RecordableForecast, entityId?: string | null): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (await this.repo.hasRunOn(ctx.tenantId, ctx.branchId, domain, today, entityId ?? null)) return;
      const input: ForecastRunInput = {
        domain, entityId: entityId ?? null, model: f.method, modelVersion: this.modelVersion,
        intervalLevel: f.intervalLevel ?? 0.8, confidence: f.confidence ?? null, dataQuality: f.dataQuality ?? null,
        backtestWape: f.accuracy?.wape ?? null,
        points: f.horizon.map((h) => ({ horizonStep: h.step, targetDate: h.date, point: val(h, 'point'), lower: val(h, 'lower'), upper: val(h, 'upper') })),
      };
      await this.repo.recordRun(ctx.tenantId, ctx.branchId, input);
    } catch { /* recording must never break the forecast response */ }
  }

  /** Match matured predictions to actuals, persist realized values, and return the realized accuracy aggregate. */
  async evaluateAccuracy(ctx: AiForecastContext, domain: Domain, actualByDate: Map<string, number>, entityId?: string | null): Promise<AccuracyAgg & { modelVersion: string }> {
    if (!ctx.permissions.includes('reports.view') && !ctx.permissions.includes('inventory.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view/inventory.view', 403), 'PERMISSION_DENIED');
    }
    const today = new Date().toISOString().slice(0, 10);
    const matured = await this.repo.listUnrealizedMatured(ctx.tenantId, ctx.branchId, domain, today, entityId ?? null);
    for (const m of matured) {
      const actual = actualByDate.get(m.targetDate);
      if (actual == null) continue; // no authoritative actual yet — leave unrealized
      const absError = Math.abs(actual - m.point);
      const within = actual >= m.lower && actual <= m.upper;
      await this.repo.setRealized(ctx.tenantId, m.id, actual, absError, within);
    }
    const agg = await this.repo.accuracy(ctx.tenantId, ctx.branchId, domain, entityId ?? null);
    return { ...agg, modelVersion: this.modelVersion };
  }
}
