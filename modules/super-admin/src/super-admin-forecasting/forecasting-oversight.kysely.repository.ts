// forecasting-oversight.kysely.repository.ts — production oversight reads. Cross-tenant BY DESIGN (Super Admin only, behind
// SuperAdminGuard); every query returns aggregates/counts, never predicted values. Reads on the primary handle.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ForecastingOversightRepositoryPort, PlatformTotals, DomainRow, AccuracyBucket, TenantHealthRow } from './forecasting-oversight.repository';

export class KyselyForecastingOversightRepository implements ForecastingOversightRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async platformTotals(): Promise<PlatformTotals> {
    const r = await sql<any>`
      SELECT count(DISTINCT tenant_id)::int AS tenants,
             count(DISTINCT run_id)::int AS runs,
             count(*)::int AS points,
             count(realized_value)::int AS evaluated,
             CASE WHEN SUM(ABS(realized_value)) > 0 THEN (SUM(abs_error) / SUM(ABS(realized_value)))::float END AS realized_wape,
             AVG(CASE WHEN realized_value IS NOT NULL THEN (CASE WHEN within_interval THEN 1.0 ELSE 0.0 END) END)::float AS coverage
      FROM forecast_points`.execute(this.db);
    const x = r.rows[0] || {};
    return {
      tenants: Number(x.tenants ?? 0), runs: Number(x.runs ?? 0), points: Number(x.points ?? 0), evaluated: Number(x.evaluated ?? 0),
      realizedWape: x.realized_wape == null ? null : Math.round(Number(x.realized_wape) * 1000) / 1000,
      coverage: x.coverage == null ? null : Math.round(Number(x.coverage) * 1000) / 1000,
    };
  }

  async byDomain(): Promise<DomainRow[]> {
    const r = await sql<any>`
      SELECT domain, count(DISTINCT run_id)::int AS runs, count(realized_value)::int AS evaluated,
             CASE WHEN SUM(ABS(realized_value)) > 0 THEN (SUM(abs_error) / SUM(ABS(realized_value)))::float END AS realized_wape
      FROM forecast_points GROUP BY domain ORDER BY domain`.execute(this.db);
    return r.rows.map((x): DomainRow => ({ domain: x.domain, runs: Number(x.runs), evaluated: Number(x.evaluated), realizedWape: x.realized_wape == null ? null : Math.round(Number(x.realized_wape) * 1000) / 1000 }));
  }

  async accuracyDistribution(): Promise<AccuracyBucket[]> {
    const r = await sql<any>`
      WITH per_tenant AS (
        SELECT tenant_id,
               CASE WHEN SUM(ABS(realized_value)) > 0 THEN (SUM(abs_error) / SUM(ABS(realized_value))) END AS w,
               count(realized_value) AS ev
        FROM forecast_points GROUP BY tenant_id
      )
      SELECT CASE
               WHEN ev = 0 OR w IS NULL THEN 'not_evaluated'
               WHEN w <= 0.1 THEN 'excellent'
               WHEN w <= 0.2 THEN 'good'
               WHEN w <= 0.4 THEN 'fair'
               ELSE 'poor' END AS bucket,
             count(*)::int AS tenants
      FROM per_tenant GROUP BY 1`.execute(this.db);
    const order = ['excellent', 'good', 'fair', 'poor', 'not_evaluated'];
    const map = new Map<string, number>(r.rows.map((x: any) => [x.bucket, Number(x.tenants)]));
    return order.map((bucket) => ({ bucket, tenants: map.get(bucket) ?? 0 }));
  }

  async tenantHealth(limit: number, offset: number): Promise<{ rows: TenantHealthRow[]; total: number }> {
    const totalR = await sql<{ n: number }>`SELECT count(DISTINCT tenant_id)::int AS n FROM forecast_points`.execute(this.db);
    const r = await sql<any>`
      SELECT tenant_id,
             count(DISTINCT domain)::int AS domains,
             count(DISTINCT run_id)::int AS runs,
             count(*)::int AS points,
             count(realized_value)::int AS evaluated,
             CASE WHEN SUM(ABS(realized_value)) > 0 THEN (SUM(abs_error) / SUM(ABS(realized_value)))::float END AS realized_wape,
             AVG(CASE WHEN realized_value IS NOT NULL THEN (CASE WHEN within_interval THEN 1.0 ELSE 0.0 END) END)::float AS coverage,
             MAX(generated_at) AS last_generated_at,
             bool_or(confidence = 'insufficient_data' OR data_quality = 'insufficient_data') AS low_confidence
      FROM forecast_points GROUP BY tenant_id
      ORDER BY runs DESC, tenant_id
      LIMIT ${limit} OFFSET ${offset}`.execute(this.db);
    const rows = r.rows.map((x): TenantHealthRow => ({
      tenantId: x.tenant_id, domains: Number(x.domains), runs: Number(x.runs), points: Number(x.points), evaluated: Number(x.evaluated),
      realizedWape: x.realized_wape == null ? null : Math.round(Number(x.realized_wape) * 1000) / 1000,
      coverage: x.coverage == null ? null : Math.round(Number(x.coverage) * 1000) / 1000,
      lastGeneratedAt: x.last_generated_at ? new Date(x.last_generated_at).toISOString() : null,
      lowConfidence: !!x.low_confidence,
    }));
    return { rows, total: Number(totalR.rows[0]?.n ?? 0) };
  }
}
