// overage.kysely.repository.ts — real reads/writes for overage metering. Charges are upserted per tenant×metric×period.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { OverageRepo, OverageRuleRow, OverageRuleDetail, OverageRuleUpsert, ChargeWrite, AuditActor } from './overage.repository';

export class KyselyOverageRepo implements OverageRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getActiveTenantIds(): Promise<string[]> {
    const r: any = await sql`SELECT id FROM tenants WHERE COALESCE(status,'active') <> 'archived'`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => String(x.id));
  }

  async getDefaultOverageRules(): Promise<OverageRuleRow[]> {
    const r: any = await sql`SELECT metric, unit_price_cents FROM overage_rules WHERE plan_id IS NULL`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({ metric: String(x.metric), unitPriceCents: Number(x.unit_price_cents) }));
  }

  async getRulesDetailed(): Promise<OverageRuleDetail[]> {
    const r: any = await sql`SELECT metric, unit_price_cents, grace_amount, warning_threshold_pct FROM overage_rules WHERE plan_id IS NULL ORDER BY metric`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({ metric: String(x.metric), unitPriceCents: Number(x.unit_price_cents), graceAmount: Number(x.grace_amount ?? 0), warningThresholdPct: x.warning_threshold_pct == null ? null : Number(x.warning_threshold_pct) }));
  }

  async upsertRule(c: OverageRuleUpsert): Promise<void> {
    const sets = [sql`unit_price_cents = ${c.unitPriceCents}`];
    if (c.graceAmount !== undefined) sets.push(sql`grace_amount = ${c.graceAmount}`);
    if (c.warningThresholdPct !== undefined) sets.push(sql`warning_threshold_pct = ${c.warningThresholdPct}`);
    sets.push(sql`updated_at = now()`);
    const upd: any = await sql`UPDATE overage_rules SET ${sql.join(sets, sql`, `)} WHERE plan_id IS NULL AND metric = ${c.metric} RETURNING id`.execute(this.db);
    if ((upd.rows as any[]).length === 0) {
      await sql`INSERT INTO overage_rules (id, metric, unit_price_cents, grace_amount, warning_threshold_pct, plan_id)
                VALUES (gen_random_uuid(), ${c.metric}, ${c.unitPriceCents}, ${c.graceAmount ?? 0}, ${c.warningThresholdPct ?? 90}, NULL)`.execute(this.db);
    }
  }

  async upsertCharge(c: ChargeWrite): Promise<void> {
    await sql`INSERT INTO overage_charges (tenant_id, metric, billing_period, included_qty, used_qty, overage_qty, unit_price_cents, amount_cents, status, computed_at)
              VALUES (${c.tenantId}, ${c.metric}, ${c.period}, ${c.includedQty}, ${c.usedQty}, ${c.overageQty}, ${c.unitPriceCents}, ${c.amountCents}, 'active', now())
              ON CONFLICT (tenant_id, metric, billing_period) DO UPDATE SET
                included_qty = EXCLUDED.included_qty, used_qty = EXCLUDED.used_qty, overage_qty = EXCLUDED.overage_qty,
                unit_price_cents = EXCLUDED.unit_price_cents, amount_cents = EXCLUDED.amount_cents, status = 'active', computed_at = now()`.execute(this.db);
  }

  async clearCharge(tenantId: string, metric: string, period: string): Promise<void> {
    await sql`DELETE FROM overage_charges WHERE tenant_id = ${tenantId} AND metric = ${metric} AND billing_period = ${period}`.execute(this.db);
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'overage_run', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }
}
