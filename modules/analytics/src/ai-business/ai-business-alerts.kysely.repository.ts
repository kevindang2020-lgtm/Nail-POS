// ai-business-alerts.kysely.repository.ts — Postgres adapter. Tenant scoping server-derived from ctx.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  BusinessAlert, AlertContext, CreateAlertInput, UpdateAlertInput, AlertsRepositoryPort,
  AlertMetric, AlertOperator, AlertChannel, AlertFrequency,
} from './ai-business-alerts.repository';

function toDomain(r: any): BusinessAlert {
  return {
    id: String(r.id), title: String(r.title), metricId: String(r.metric_id) as AlertMetric,
    operator: String(r.operator) as AlertOperator, threshold: Number(r.threshold), preset: String(r.preset),
    minSampleSize: Number(r.min_sample_size ?? 5), frequency: String(r.frequency) as AlertFrequency,
    channel: String(r.channel) as AlertChannel, active: !!r.active,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
    lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
  };
}
const COLS = ['id', 'title', 'metric_id', 'operator', 'threshold', 'preset', 'min_sample_size', 'frequency', 'channel', 'active', 'created_at', 'last_checked_at', 'last_triggered_at'] as const;

export class KyselyAlertsRepository implements AlertsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async list(ctx: AlertContext): Promise<BusinessAlert[]> {
    const rows = await this.db.selectFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId)
      .select(COLS as any).orderBy('created_at', 'desc').limit(500).execute().catch(() => [] as any[]);
    return (rows as any[]).map(toDomain);
  }
  async get(ctx: AlertContext, id: string): Promise<BusinessAlert | null> {
    const r = await this.db.selectFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .select(COLS as any).executeTakeFirst().catch(() => null);
    return r ? toDomain(r) : null;
  }
  async create(ctx: AlertContext, input: CreateAlertInput & { metricId: AlertMetric; operator: AlertOperator }): Promise<BusinessAlert> {
    const row = await this.db.insertInto('ai_business_alerts').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, created_by_user_id: ctx.userId,
      title: input.title, metric_id: input.metricId, operator: input.operator, threshold: input.threshold,
      preset: input.preset ?? 'today', min_sample_size: input.minSampleSize ?? 5,
      frequency: input.frequency ?? 'daily', channel: input.channel ?? 'in_app', active: true,
    } as any).returning(COLS as any).executeTakeFirstOrThrow();
    return toDomain(row);
  }
  async update(ctx: AlertContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert | null> {
    const set: any = {};
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.threshold !== undefined) set.threshold = patch.threshold;
    if (patch.title !== undefined) set.title = patch.title;
    if (Object.keys(set).length === 0) return this.get(ctx, id);
    const row = await this.db.updateTable('ai_business_alerts').set(set)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .returning(COLS as any).executeTakeFirst().catch(() => null);
    return row ? toDomain(row) : null;
  }
  async remove(ctx: AlertContext, id: string): Promise<boolean> {
    const res = await this.db.deleteFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any)
      .executeTakeFirst().catch(() => null);
    return !!res && Number((res as any).numDeletedRows ?? 0) > 0;
  }
  async markChecked(ctx: AlertContext, id: string, triggered: boolean): Promise<void> {
    const set: any = { last_checked_at: new Date() };
    if (triggered) set.last_triggered_at = new Date();
    await this.db.updateTable('ai_business_alerts').set(set)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id as any).executeTakeFirst().catch(() => null);
  }
}
