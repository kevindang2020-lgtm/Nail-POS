// Kysely (Postgres) delivery repo. Aggregates rollups for the KPIs and groups failures by category. Only safe
// masked destinations + provider status are ever selected.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DeliveryRepo, FailureRow } from './campaign-delivery.repository';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapFailure = (r: any): FailureRow => ({
  id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, tenantId: r.tenant_id, channel: r.channel, provider: r.provider,
  failureCategory: r.failure_category, maskedDestination: r.masked_destination, providerResponse: r.provider_response,
  attemptCount: Number(r.attempt_count || 0), retryable: !!r.retryable, resolutionStatus: r.resolution_status,
  firstFailureAt: iso(r.first_failure_at) as string, lastAttemptAt: iso(r.last_attempt_at) as string,
});

export class KyselyDeliveryRepo implements DeliveryRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async deliveryTotals(tenantId: string): Promise<{ attempted: number; delivered: number; optedOut: number }> {
    if (!tenantId) return { attempted: 0, delivered: 0, optedOut: 0 };
    try {
      // 🔴 was: no WHERE at all — every salon's delivery totals summed together and shown to whichever salon asked.
      const r = await sql<any>`
        SELECT COALESCE(sum(attempted),0)::int AS attempted, COALESCE(sum(delivered),0)::int AS delivered,
               COALESCE(sum(opted_out),0)::int AS opted_out
        FROM campaign_delivery_rollups WHERE tenant_id = ${tenantId}`.execute(this.db);
      const row = r.rows[0] || {};
      return { attempted: Number(row.attempted || 0), delivered: Number(row.delivered || 0), optedOut: Number(row.opted_out || 0) };
    } catch { return { attempted: 0, delivered: 0, optedOut: 0 }; }
  }
  async failureCounts(tenantId: string): Promise<{ failureCategory: string; count: number }[]> {
    if (!tenantId) return [];
    try {
      // 🔴 was: grouped across EVERY tenant.
      const r = await sql<any>`
        SELECT failure_category, count(*)::int AS n FROM campaign_delivery_failures
        WHERE tenant_id = ${tenantId} GROUP BY failure_category`.execute(this.db);
      return r.rows.map((x) => ({ failureCategory: x.failure_category, count: Number(x.n || 0) }));
    } catch { return []; }
  }
  /** 🔴 CROSS-TENANT LEAK, FIXED — was `WHERE 1=1` with no tenant filter, on a TenantAuthGuard route. */
  async listFailures(scope: { tenantId: string; category?: string; cap?: number }): Promise<FailureRow[]> {
    if (!scope.tenantId) return [];
    const cat = scope.category ? sql`AND failure_category = ${scope.category}` : sql``;
    try {
      const r = await sql<any>`
        SELECT * FROM campaign_delivery_failures
        WHERE tenant_id = ${scope.tenantId} ${cat}
        ORDER BY last_attempt_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db);
      return r.rows.map(mapFailure);
    } catch { return []; }
  }
  async metricSnapshots(days: number): Promise<{ snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }[]> {
    try {
      const r = await sql<any>`SELECT snapshot_date, attempted, delivered, opened, clicked FROM campaign_metric_snapshots ORDER BY snapshot_date DESC LIMIT ${Math.max(1, Math.min(90, days))}`.execute(this.db);
      return r.rows.map((x) => ({ snapshotDate: iso(x.snapshot_date) as string, attempted: Number(x.attempted || 0), delivered: Number(x.delivered || 0), opened: Number(x.opened || 0), clicked: Number(x.clicked || 0) }));
    } catch { return []; }
  }
}
