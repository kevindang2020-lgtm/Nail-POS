// seasonal-trend.service.ts — Seasonal Trend Detection domain. Reuses the authoritative appointment history (via the
// existing AppointmentSeriesSource) and detects day-of-week / monthly seasonality from the tenant's OWN data. Read-only,
// gated on reports.view. Patterns are evidence-based (sample sizes shown) and never presented as guarantees.
import { detectSeasonality } from './seasonal-trend.core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type AppointmentSeriesSource } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const LOOKBACK_DAYS = 400; // enough to speak to monthly seasonality when the history exists

export class SeasonalTrendService {
  constructor(private readonly source: AppointmentSeriesSource) {}

  async getSeasonalTrends(ctx: AiForecastContext) {
    if (!ctx.permissions.includes('reports.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    }
    const series = await this.source.getDailyAppointments(ctx, LOOKBACK_DAYS);
    const result = detectSeasonality(series);
    return {
      domain: 'seasonal_trends' as const,
      branchId: ctx.branchId,
      ...result,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Patterns are derived from this branch\u2019s own history, not generic industry assumptions, and describe past behavior — not a guarantee of future demand.',
    };
  }
}
