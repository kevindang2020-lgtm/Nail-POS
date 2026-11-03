// ai-business-alerts.kysely.repository.ts — Postgres adapter. Tenant scoping server-derived from ctx.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  BusinessAlert, AlertContext, CreateAlertInput, UpdateAlertInput, AlertsRepositoryPort,
  AlertMetric, AlertOperator, AlertChannel, AlertFrequency,
} from './ai-business-alerts.repository';

function toDomain(r: any): BusinessAlert {
  return {
    id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, title: String(r.title), metricId: String(r.metric_id) as AlertMetric,
    operator: String(r.operator) as AlertOperator, threshold: Number(r.threshold), preset: String(r.preset),
    minSampleSize: Number(r.min_sample_size ?? 5), frequency: String(r.frequency) as AlertFrequency,
    channel: String(r.channel) as AlertChannel, active: !!r.active,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
    lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at).toISOString() : null,
  };
}
const COLS = ['id', 'branch_id', 'title', 'metric_id', 'operator', 'threshold', 'preset', 'min_sample_size', 'frequency', 'channel', 'active', 'created_at', 'last_checked_at', 'last_triggered_at'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KyselyAlertsRepository implements AlertsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  /** Nov 3 audit: a branch-scoped session reads and changes ONLY its branch's rules (pause / delete used to check the tenant only) */
  private scoped<Q extends { where: (...a: any[]) => Q }>(q: Q, ctx: AlertContext): Q {
    const B = ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : null;
    return (B ? q.where('branch_id', '=', B) : q).where('archived_at', 'is', null);
  }

  async list(ctx: AlertContext): Promise<BusinessAlert[]> {
    const rows = await this.scoped(this.db.selectFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId), ctx)
      .select(COLS as any).orderBy('created_at', 'desc').limit(500).execute();
    return rows.map(toDomain);
  }
  async get(ctx: AlertContext, id: string): Promise<BusinessAlert | null> {
    if (!UUID_RE.test(id)) return null;
    const r = await this.scoped(this.db.selectFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId).where('id', '=', id), ctx)
      .select(COLS).executeTakeFirst();
    return r ? toDomain(r) : null;
  }
  async create(ctx: AlertContext, input: CreateAlertInput & { metricId: AlertMetric; operator: AlertOperator }): Promise<BusinessAlert> {
    const row = await this.db.insertInto('ai_business_alerts').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, created_by_user_id: ctx.userId,
      title: input.title, metric_id: input.metricId, operator: input.operator, threshold: input.threshold,
      preset: input.preset ?? 'today', min_sample_size: input.minSampleSize ?? 5,
      frequency: input.frequency ?? 'daily', channel: input.channel ?? 'in_app', active: true,
    }).returning(COLS).executeTakeFirstOrThrow();
    return toDomain(row);
  }
  async update(ctx: AlertContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert | null> {
    const set: any = {};
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.threshold !== undefined) set.threshold = patch.threshold;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.preset !== undefined) set.preset = patch.preset;
    if (patch.minSampleSize !== undefined) set.min_sample_size = patch.minSampleSize;
    if (Object.keys(set).length === 0) return this.get(ctx, id);
    if (!UUID_RE.test(id)) return null;
    const row = await this.scoped(this.db.updateTable('ai_business_alerts').set(set)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id), ctx)
      .returning(COLS).executeTakeFirst();
    return row ? toDomain(row) : null;
  }
  /** A rule with evaluation history is archived (inactive, hidden), so its history survives; a never-evaluated rule is deleted. */
  async remove(ctx: AlertContext, id: string): Promise<boolean> {
    if (!UUID_RE.test(id)) return false;
    return this.db.transaction().execute(async (trx) => {
      const rule = await this.scoped(trx.selectFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId).where('id', '=', id), ctx).select('id').forUpdate().executeTakeFirst();
      if (!rule) return false;
      const used = await trx.selectFrom('ai_business_alert_events').where('tenant_id', '=', ctx.tenantId).where('alert_id', '=', id).select('id').limit(1).executeTakeFirst();
      if (used) {
        await trx.updateTable('ai_business_alerts').set({ archived_at: new Date(), active: false } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
        return true;
      }
      const res = await trx.deleteFrom('ai_business_alerts').where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows ?? 0) > 0;
    });
  }
  async markChecked(ctx: AlertContext, id: string, triggered: boolean): Promise<void> {
    const set: any = { last_checked_at: new Date() };
    if (triggered) set.last_triggered_at = new Date();
    await this.db.updateTable('ai_business_alerts').set(set)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => null);
  }
}
