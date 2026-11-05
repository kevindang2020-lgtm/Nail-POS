// anomaly-detect.service.ts — Business Anomaly Detection domain. Reuses the authoritative appointment history (via the
// existing AppointmentSeriesSource) and flags recent points outside their expected seasonal range. Read-only, gated on
// reports.view. Neutral by design: findings describe deviations + possible operational causes, never accusations, and
// nothing here triggers an action — a human verifies before acting.
import { detectAnomalies } from './anomaly-detect.core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type AppointmentSeriesSource } from './ai-analytics-forecasting.dto';

const LOOKBACK_DAYS = 120;
export const ANOMALY_MODEL_VERSION = 'anomaly-seasonal-z-v1';

export class AnomalyDetectService {
  constructor(private readonly source: AppointmentSeriesSource) {}

  async getAnomalies(ctx: AiForecastContext, windowDays = 14) {
    if (!ctx.permissions.includes('reports.view')) {
      throw new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403);
    }
    const w = Math.max(1, Math.min(60, windowDays));
    const series = await this.source.getDailyAppointments(ctx, LOOKBACK_DAYS);
    const result = detectAnomalies(series, w);
    return {
      domain: 'business_anomalies' as const,
      branchId: ctx.branchId,
      metric: 'appointments',
      modelVersion: ANOMALY_MODEL_VERSION,
      ...result,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Anomalies are statistical deviations from the expected range, not verified problems. Possible causes are neutral suggestions to investigate — review before taking any action.',
    };
  }
}
