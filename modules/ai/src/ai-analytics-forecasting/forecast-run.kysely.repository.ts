// forecast-run.kysely.repository.ts — production persistence on the PRIMARY db. All statements tenant-scoped; recording is
// transactional (all points of a run together). Read-only accuracy aggregate computes realized MAE/WAPE/coverage in SQL.
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ForecastRunRepositoryPort, ForecastRunInput, MaturedPoint, AccuracyAgg } from './forecast-run.repository';

const SENTINEL = '00000000-0000-0000-0000-000000000000';

export class KyselyForecastRunRepository implements ForecastRunRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async hasRunOn(tenantId: string, branchId: string, domain: string, generatedDate: string, entityId?: string | null): Promise<boolean> {
    const r = await sql<{ one: number }>`
      SELECT 1 AS one FROM forecast_points
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND domain = ${domain}
        AND COALESCE(entity_id, ${SENTINEL}::uuid) = COALESCE(${entityId ?? null}, ${SENTINEL}::uuid)
        AND generated_at::date = ${generatedDate}::date
      LIMIT 1`.execute(this.db);
    return r.rows.length > 0;
  }

  async recordRun(tenantId: string, branchId: string, input: ForecastRunInput): Promise<{ runId: string; count: number }> {
    const runId = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      for (const p of input.points) {
        await sql`
          INSERT INTO forecast_points
            (tenant_id, branch_id, run_id, domain, entity_id, model, model_version, horizon_step, target_date,
             point_value, lower_value, upper_value, interval_level, confidence, data_quality, backtest_wape)
          VALUES (${tenantId}, ${branchId}, ${runId}, ${input.domain}, ${input.entityId ?? null}, ${input.model},
             ${input.modelVersion}, ${p.horizonStep}, ${p.targetDate}::date, ${p.point}, ${p.lower}, ${p.upper},
             ${input.intervalLevel}, ${input.confidence}, ${input.dataQuality}, ${input.backtestWape})
          ON CONFLICT DO NOTHING`.execute(trx);
      }
    });
    return { runId, count: input.points.length };
  }

  async listUnrealizedMatured(tenantId: string, branchId: string, domain: string, onOrBefore: string, entityId?: string | null): Promise<MaturedPoint[]> {
    const r = await sql<any>`
      SELECT id, target_date, point_value, lower_value, upper_value FROM forecast_points
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND domain = ${domain}
        AND COALESCE(entity_id, ${SENTINEL}::uuid) = COALESCE(${entityId ?? null}, ${SENTINEL}::uuid)
        AND realized_value IS NULL AND target_date <= ${onOrBefore}::date
      ORDER BY target_date LIMIT 1000`.execute(this.db);
    return r.rows.map((x): MaturedPoint => ({
      id: x.id, targetDate: new Date(x.target_date).toISOString().slice(0, 10),
      point: Number(x.point_value), lower: Number(x.lower_value), upper: Number(x.upper_value),
    }));
  }

  async setRealized(tenantId: string, pointId: string, realized: number, absError: number, withinInterval: boolean): Promise<void> {
    await sql`UPDATE forecast_points SET realized_value = ${realized}, abs_error = ${absError},
      within_interval = ${withinInterval}, realized_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${pointId}`.execute(this.db);
  }

  async accuracy(tenantId: string, branchId: string, domain: string, entityId?: string | null): Promise<AccuracyAgg> {
    const r = await sql<any>`
      SELECT count(*)::int AS evaluated,
             COALESCE(AVG(abs_error), 0)::float AS mae,
             CASE WHEN SUM(ABS(realized_value)) > 0 THEN (SUM(abs_error) / SUM(ABS(realized_value)))::float ELSE 0 END AS wape,
             COALESCE(AVG(CASE WHEN within_interval THEN 1.0 ELSE 0.0 END), 0)::float AS coverage
      FROM forecast_points
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND domain = ${domain}
        AND COALESCE(entity_id, ${SENTINEL}::uuid) = COALESCE(${entityId ?? null}, ${SENTINEL}::uuid)
        AND realized_value IS NOT NULL`.execute(this.db);
    const row = r.rows[0];
    const evaluated = Number(row?.evaluated ?? 0);
    if (evaluated === 0) return { evaluated: 0, mae: null, wape: null, coverage: null };
    return {
      evaluated,
      mae: Math.round(Number(row.mae) * 100) / 100,
      wape: Math.round(Number(row.wape) * 1000) / 1000,
      coverage: Math.round(Number(row.coverage) * 1000) / 1000,
    };
  }
}
