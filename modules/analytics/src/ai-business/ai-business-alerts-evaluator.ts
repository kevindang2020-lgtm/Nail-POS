// ai-business-alerts-evaluator.ts — the pure evaluation core for a business alert (§34, §17).
// Given an alert, it resolves the metric's CURRENT value from the same authorized tools the assistant uses, applies
// the minimum-sample-size guard (so a tiny sample can never trip an alert), and reports whether the condition holds.
// This is the function the scheduled worker will call; keeping it isolated makes it deterministic and testable.
import type { AiBusinessContext } from './ai-business.dto';
import type { BusinessAlert, AlertMetric } from './ai-business-alerts.repository';

/** Minimal facade over the three tool services the supported alert metrics need. The real services satisfy it. */
export interface AlertMetricSource {
  getRevenueSummary(ctx: AiBusinessContext, preset?: string): Promise<{ netSalesCents: number; averageTicketCents: number; ticketsCount: number }>;
  getAppointmentMetrics(ctx: AiBusinessContext, preset?: string): Promise<{ funnel: { completed: number; cancelledPercent: number; noShowPercent: number; totalBookings: number } }>;
  getCustomerGrowth(ctx: AiBusinessContext, preset?: string): Promise<{ retentionRatePercent: number; activeCustomers: number }>;
}

export type MetricUnit = 'currency_cents' | 'count' | 'percent';

export interface AlertEvaluation {
  metricId: AlertMetric;
  unit: MetricUnit;
  value: number;
  threshold: number;
  operator: 'lt' | 'gt';
  preset: string;
  sampleSize: number;
  sampleOk: boolean;         // sampleSize >= minSampleSize
  triggered: boolean;        // sampleOk AND the operator/threshold condition holds
  reason: string;
}

const UNIT: Record<AlertMetric, MetricUnit> = {
  net_sales: 'currency_cents', average_ticket: 'currency_cents', completed_appointments: 'count',
  cancellation_rate: 'percent', no_show_rate: 'percent', customer_retention: 'percent',
};

export class AiBusinessAlertEvaluator {
  constructor(private readonly src: AlertMetricSource) {}

  /** Resolve (value, sampleSize) for a metric at a preset, pulling from the appropriate authorized tool. */
  private async resolve(ctx: AiBusinessContext, metricId: AlertMetric, preset: string): Promise<{ value: number; sampleSize: number }> {
    switch (metricId) {
      case 'net_sales': { const r = await this.src.getRevenueSummary(ctx, preset); return { value: r.netSalesCents, sampleSize: r.ticketsCount }; }
      case 'average_ticket': { const r = await this.src.getRevenueSummary(ctx, preset); return { value: r.averageTicketCents, sampleSize: r.ticketsCount }; }
      case 'completed_appointments': { const r = await this.src.getAppointmentMetrics(ctx, preset); return { value: r.funnel.completed, sampleSize: r.funnel.totalBookings }; }
      case 'cancellation_rate': { const r = await this.src.getAppointmentMetrics(ctx, preset); return { value: r.funnel.cancelledPercent, sampleSize: r.funnel.totalBookings }; }
      case 'no_show_rate': { const r = await this.src.getAppointmentMetrics(ctx, preset); return { value: r.funnel.noShowPercent, sampleSize: r.funnel.totalBookings }; }
      case 'customer_retention': { const r = await this.src.getCustomerGrowth(ctx, preset); return { value: r.retentionRatePercent, sampleSize: r.activeCustomers }; }
    }
  }

  async evaluate(ctx: AiBusinessContext, alert: Pick<BusinessAlert, 'metricId' | 'operator' | 'threshold' | 'preset' | 'minSampleSize'>): Promise<AlertEvaluation> {
    const { value, sampleSize } = await this.resolve(ctx, alert.metricId, alert.preset);
    const sampleOk = sampleSize >= alert.minSampleSize;
    const conditionHolds = alert.operator === 'lt' ? value < alert.threshold : value > alert.threshold;
    const triggered = sampleOk && conditionHolds;
    const reason = !sampleOk
      ? `Sample size ${sampleSize} is below the minimum ${alert.minSampleSize}; not evaluated.`
      : conditionHolds
        ? `${alert.metricId} (${value}) is ${alert.operator === 'lt' ? 'below' : 'above'} ${alert.threshold}.`
        : `${alert.metricId} (${value}) is within the threshold.`;
    return { metricId: alert.metricId, unit: UNIT[alert.metricId], value, threshold: alert.threshold, operator: alert.operator, preset: alert.preset, sampleSize, sampleOk, triggered, reason };
  }
}
