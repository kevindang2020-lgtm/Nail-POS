// ai-business-admin.kysely.repository.ts — platform aggregate reads over the read replica. COUNT/GROUP BY only; no
// tenant rows are returned. Runs on DATABASE_READ (analytics path).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiBusinessAdminRepositoryPort, AiBusinessAdminOverview } from './ai-business-admin.repository';

export class KyselyAiBusinessAdminRepository implements AiBusinessAdminRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async overview(): Promise<AiBusinessAdminOverview> {
    try {
      const sq = await sql<any>`SELECT count(*)::int AS total, count(DISTINCT tenant_id)::int AS tenants FROM ai_business_saved_questions`.execute(this.db);
      const sqi = await sql<any>`SELECT intent, count(*)::int AS count FROM ai_business_saved_questions GROUP BY intent ORDER BY count DESC`.execute(this.db);
      const al = await sql<any>`SELECT count(*)::int AS total, count(*) FILTER (WHERE active)::int AS active, count(DISTINCT tenant_id)::int AS tenants FROM ai_business_alerts`.execute(this.db);
      const alm = await sql<any>`SELECT metric_id, count(*)::int AS count FROM ai_business_alerts GROUP BY metric_id ORDER BY count DESC`.execute(this.db);
      const sqRow = sq.rows[0] || {}; const alRow = al.rows[0] || {};
      return {
        savedQuestions: {
          total: Number(sqRow.total || 0), tenants: Number(sqRow.tenants || 0),
          byIntent: sqi.rows.map((r: any) => ({ intent: String(r.intent), count: Number(r.count || 0) })),
        },
        alerts: {
          total: Number(alRow.total || 0), active: Number(alRow.active || 0), tenants: Number(alRow.tenants || 0),
          byMetric: alm.rows.map((r: any) => ({ metricId: String(r.metric_id), count: Number(r.count || 0) })),
        },
      };
    } catch {
      // Fail closed to zeros rather than surfacing a partial/incorrect platform number.
      return { savedQuestions: { total: 0, tenants: 0, byIntent: [] }, alerts: { total: 0, active: 0, tenants: 0, byMetric: [] } };
    }
  }
}
