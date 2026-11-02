// ai-business.service.ts — read-only backbone service for the AI Business Assistant.
//
// Slice 1 scope: expose the CENTRALIZED metric registry (definitions + freshness) with permission-aware filtering, so
// the frontend and the (later) authorized data tools both resolve KPIs from one source. This service holds NO tenant
// data and issues NO queries — it returns definitional metadata only. Tenant-scoped VALUES arrive in later slices via
// authorized tools that inject DATABASE_READ and reuse the existing report services (never a second KPI calculation).
//
// Permission model: the registry declares each metric's granular requiredPermission (e.g. pos.reports.view). We bridge
// it to the coarse capability the session token actually carries using requiredCapability() from security-core — the
// exact mapping the guards use — so an OWNER (who holds every coarse cap) sees all metrics, while a user without, say,
// reports access simply doesn't see revenue metrics. This is honest permission-aware filtering, not a hidden bypass.
import { AI_BUSINESS_METRICS, getMetric, type MetricDefinition, type MetricCategory } from './ai-business-metrics';
import {
  AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError,
  type AiBusinessContext, type MetricListResponse, type MetricFreshness,
} from './ai-business.dto';
import { requiredCapability } from '@aipowersalon/permissions';

export class AiBusinessService {
  /** True if the caller holds the coarse capability the metric's granular permission maps to. */
  private canSee(ctx: AiBusinessContext, m: MetricDefinition): boolean {
    const need = requiredCapability(m.requiredPermission);
    return Array.isArray(ctx.permissions) && ctx.permissions.includes(need);
  }

  private assertAuthed(ctx: AiBusinessContext): void {
    if (!ctx?.tenantId || !ctx?.userId) {
      throw new AiBusinessForbiddenError('Not authenticated');
    }
  }

  /** List metric DEFINITIONS this user is permitted to see. Optional category filter. Tenant-agnostic metadata. */
  listMetrics(ctx: AiBusinessContext, category?: string): MetricListResponse {
    this.assertAuthed(ctx);
    let pool: readonly MetricDefinition[] = AI_BUSINESS_METRICS;
    if (category) {
      const cats: MetricCategory[] = ['revenue', 'appointments', 'customers', 'technicians', 'operations', 'ai'];
      if (!cats.includes(category as MetricCategory)) {
        throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unknown metric category');
      }
      pool = pool.filter((m) => m.category === category);
    }
    const metrics = pool.filter((m) => this.canSee(ctx, m));
    return { metrics, total: metrics.length };
  }

  /** Get a single metric definition, enforcing existence and this user's permission to see it. */
  getMetricDefinition(ctx: AiBusinessContext, metricId: string): MetricDefinition {
    this.assertAuthed(ctx);
    const m = getMetric(metricId);
    if (!m) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unknown metric');
    if (!this.canSee(ctx, m)) throw new AiBusinessForbiddenError('You do not have access to this metric');
    return m;
  }

  /** Report freshness for a metric. Slice 1 returns the registry's intended class and flags a partial current day;
   *  later slices refine `observed`/`note` from actual replica lag + aggregation state (spec §24). */
  getDataFreshness(ctx: AiBusinessContext, metricId: string, opts?: { includesCurrentDay?: boolean }): MetricFreshness {
    const m = this.getMetricDefinition(ctx, metricId);
    const partial = opts?.includesCurrentDay === true;
    return {
      metricId: m.id,
      class: m.freshness,
      observed: m.freshness,
      asOf: new Date().toISOString(),
      partialCurrentDay: partial,
      note: partial ? 'Includes an incomplete current day; today\u2019s figures are partial.' : null,
    };
  }
}
