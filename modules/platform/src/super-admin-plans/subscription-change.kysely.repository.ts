// subscription-change.kysely.repository.ts — real reads/writes for the plan-change workflow. Immediate changes update
// the tenant subscription (plan, locked price, fresh billing period) and insert a ledger row in one transaction.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  SubscriptionChangeRepo, CurrentSubscription, CatalogPlan, ApplyImmediate, RecordScheduled, ChangeRow, AuditActor,
} from './subscription-change.repository';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { TENANT_SUBSCRIPTION, SUBSCRIPTION_CHANGE } from '../platform-lifecycles';

const ms = (v: any): number | null => (v == null ? null : new Date(v).getTime());

export class KyselySubscriptionChangeRepo implements SubscriptionChangeRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getSubscription(tenantId: string): Promise<CurrentSubscription | null> {
    const r: any = await sql`SELECT plan, plan_code, monthly_price_cents, current_period_start, current_period_end, status
                             FROM tenant_subscriptions WHERE tenant_id = ${tenantId}
                             ORDER BY created_at DESC LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; if (!x) return null;
    return {
      planText: x.plan ?? null, planCode: x.plan_code ?? null,
      monthlyPriceCents: x.monthly_price_cents == null ? null : Number(x.monthly_price_cents),
      periodStartMs: ms(x.current_period_start), periodEndMs: ms(x.current_period_end), status: x.status ?? null,
    };
  }

  async getPlanByCode(code: string): Promise<CatalogPlan | null> {
    const r: any = await sql`SELECT code, name, monthly_price_cents, billing_interval FROM subscription_plans WHERE code = ${code}`
      .execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; if (!x) return null;
    return { code: String(x.code), name: String(x.name), monthlyPriceCents: Number(x.monthly_price_cents), billingInterval: String(x.billing_interval ?? 'monthly') };
  }

  async applyImmediateChange(p: ApplyImmediate): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const interval = p.toPlan.billingInterval === 'annual' ? sql`interval '1 year'` : sql`interval '1 month'`;
      const has: any = await sql`SELECT id FROM tenant_subscriptions WHERE tenant_id = ${p.tenantId} ORDER BY created_at DESC LIMIT 1`.execute(trx);
      if (has.rows[0]) {
        await sql`UPDATE tenant_subscriptions SET plan = ${p.toPlan.name}, plan_code = ${p.toPlan.code},
                    monthly_price_cents = ${p.toPlan.monthlyPriceCents}, billing_interval = ${p.toPlan.billingInterval},
                    current_period_start = now(), current_period_end = now() + ${interval}, status = 'active', updated_at = now()
                  WHERE id = ${has.rows[0].id} AND (status = 'active' OR ${canMoveToSql(TENANT_SUBSCRIPTION, 'active')})`.execute(trx);
      } else {
        await sql`INSERT INTO tenant_subscriptions (tenant_id, plan, plan_code, monthly_price_cents, billing_interval, status, current_period_start, current_period_end)
                  VALUES (${p.tenantId}, ${p.toPlan.name}, ${p.toPlan.code}, ${p.toPlan.monthlyPriceCents}, ${p.toPlan.billingInterval}, 'active', now(), now() + ${interval})`.execute(trx);
      }
      const ins: any = await sql`INSERT INTO subscription_changes
          (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, proration_credit_cents, proration_charge_cents, net_cents, reason, created_by)
        VALUES (${p.tenantId}, ${p.fromPlanCode}, ${p.toPlan.code}, ${p.changeType}, 'immediate', 'applied', now(), ${p.creditCents}, ${p.chargeCents}, ${p.netCents}, ${p.reason}, ${p.createdBy})
        RETURNING id`.execute(trx);
      return String(ins.rows[0].id);
    });
  }

  async recordScheduledChange(p: RecordScheduled): Promise<string> {
    const ins: any = await sql`INSERT INTO subscription_changes
        (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, proration_credit_cents, proration_charge_cents, net_cents, reason, created_by)
      VALUES (${p.tenantId}, ${p.fromPlanCode}, ${p.toPlanCode}, ${p.changeType}, 'end_of_cycle', 'scheduled', ${new Date(p.effectiveAtMs).toISOString()}, 0, 0, 0, ${p.reason}, ${p.createdBy})
      RETURNING id`.execute(this.db);
    return String(ins.rows[0].id);
  }

  async getDueScheduledChanges(nowIso: string): Promise<{ id: string; tenantId: string; toPlanCode: string }[]> {
    const r: any = await sql`SELECT id, tenant_id, to_plan_code FROM subscription_changes
                             WHERE status = 'scheduled' AND effective_at <= ${nowIso}::timestamptz
                             ORDER BY effective_at ASC`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({ id: String(x.id), tenantId: String(x.tenant_id), toPlanCode: String(x.to_plan_code) }));
  }

  async applyScheduledChange(changeId: string, tenantId: string, toPlan: CatalogPlan): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const interval = toPlan.billingInterval === 'annual' ? sql`interval '1 year'` : sql`interval '1 month'`;
      const has: any = await sql`SELECT id FROM tenant_subscriptions WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1`.execute(trx);
      if (has.rows[0]) {
        await sql`UPDATE tenant_subscriptions SET plan = ${toPlan.name}, plan_code = ${toPlan.code},
                    monthly_price_cents = ${toPlan.monthlyPriceCents}, billing_interval = ${toPlan.billingInterval},
                    current_period_start = now(), current_period_end = now() + ${interval}, status = 'active', updated_at = now()
                  WHERE id = ${has.rows[0].id} AND (status = 'active' OR ${canMoveToSql(TENANT_SUBSCRIPTION, 'active')})`.execute(trx);
      } else {
        await sql`INSERT INTO tenant_subscriptions (tenant_id, plan, plan_code, monthly_price_cents, billing_interval, status, current_period_start, current_period_end)
                  VALUES (${tenantId}, ${toPlan.name}, ${toPlan.code}, ${toPlan.monthlyPriceCents}, ${toPlan.billingInterval}, 'active', now(), now() + ${interval})`.execute(trx);
      }
      // Phase 12 (#27): applied ONCE — a second scheduler pass that raced this one finds it no longer 'scheduled'
      const applied: any = await sql`UPDATE subscription_changes SET status = 'applied' WHERE id = ${changeId} AND ${canMoveToSql(SUBSCRIPTION_CHANGE, 'applied')} RETURNING id`.execute(trx);
      if (!applied.rows.length) throw new InvalidStateTransitionError(SUBSCRIPTION_CHANGE, null, 'applied', 'concurrent');
    });
  }

  async listChanges(tenantId: string): Promise<ChangeRow[]> {
    const r: any = await sql`SELECT id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at,
                                    net_cents, proration_credit_cents, proration_charge_cents, reason, created_at
                             FROM subscription_changes WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({
      id: String(x.id), fromPlanCode: x.from_plan_code ?? null, toPlanCode: String(x.to_plan_code), changeType: String(x.change_type),
      strategy: String(x.strategy), status: String(x.status), effectiveAt: new Date(x.effective_at).toISOString(),
      netCents: Number(x.net_cents), creditCents: Number(x.proration_credit_cents), chargeCents: Number(x.proration_charge_cents),
      reason: x.reason ?? null, createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: entityId, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'tenant_subscription', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }
}
