// busy-period.service.ts — Busy & Slow Period domain. Reads the branch's hour-of-week booked-demand map and classifies
// each hour relative to the branch average, surfacing the busiest and slowest windows for staffing/walk-in planning.
// Read-only, gated on reports.view. Describes historical intensity — not a guarantee — and triggers no schedule change.
import { classifyBusyPeriods } from './busy-period.core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext, type HourlyDemandSource } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const LOOKBACK_DAYS = 120;

export class BusyPeriodService {
  constructor(private readonly source: HourlyDemandSource) {}

  async getBusyPeriods(ctx: AiForecastContext) {
    if (!ctx.permissions.includes('reports.view')) {
      throw withCode(new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403), 'PERMISSION_DENIED');
    }
    const cells = await this.source.getHourOfWeekDemand(ctx, LOOKBACK_DAYS);
    const result = classifyBusyPeriods(cells);
    return {
      domain: 'busy_periods' as const,
      branchId: ctx.branchId,
      ...result,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Busy/slow classification reflects this branch\u2019s historical booked demand by hour, not a guarantee of future volume. Review alongside confirmed bookings and staffing before adjusting coverage.',
    };
  }
}
