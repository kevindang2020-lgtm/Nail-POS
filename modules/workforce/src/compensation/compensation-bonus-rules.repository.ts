/**
 * compensation-bonus-rules.repository.ts — persistence for target-based bonus rules (spec §17, table bonus_rules).
 * List active rules, create one, archive one. NUMERIC/BIGINT columns come back as strings from pg, so they are parsed.
 */
import type { BonusRuleRow } from '@aipowersalon/api-contracts/tenant';
export type { BonusRuleRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BonusMetric } from './compensation-bonus';
import { canMoveToSql } from '@aipowersalon/database';
import { BONUS_RULE } from '../workforce-lifecycles';

export interface BonusRuleCtx { tenantId: string; branchId?: string | null; userId?: string }
export interface BonusRuleInput { technicianId?: string | null; branchId?: string | null; metric: BonusMetric; target: number; amountCents: number; label?: string | null }

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const mapRow = (r: any): BonusRuleRow => ({
  id: r.id, technicianId: r.technician_id ?? null, branchId: r.branch_id ?? null, metric: r.metric,
  target: Number(r.target_value ?? 0), amountCents: Number(r.amount_cents ?? 0), label: r.label ?? null,
  status: r.status, effectiveStart: iso(r.effective_start), createdAt: iso(r.created_at),
});

export interface BonusRulesRepo {
  list(ctx: BonusRuleCtx): Promise<BonusRuleRow[]>;
  create(ctx: BonusRuleCtx, input: BonusRuleInput): Promise<BonusRuleRow>;
  archive(ctx: BonusRuleCtx, id: string): Promise<boolean>;
}

export class KyselyBonusRulesRepo implements BonusRulesRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: BonusRuleCtx): Promise<BonusRuleRow[]> {
    const rows = await this.db.selectFrom('bonus_rules').selectAll().where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    return rows.map(mapRow);
  }
  async create(ctx: BonusRuleCtx, input: BonusRuleInput): Promise<BonusRuleRow> {
    const r: any = await this.db.insertInto('bonus_rules').values({
      tenant_id: ctx.tenantId, branch_id: input.branchId ?? null, technician_id: input.technicianId ?? null,
      metric: input.metric, target_value: input.target, amount_cents: input.amountCents,
      label: input.label ?? null, status: 'active', created_by: ctx.userId ?? null,
    }).returningAll().executeTakeFirstOrThrow();
    return mapRow(r);
  }
  async archive(ctx: BonusRuleCtx, id: string): Promise<boolean> {
    const r: any = await this.db.updateTable('bonus_rules').set({ status: 'archived' } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(BONUS_RULE, 'archived') as any).executeTakeFirst().catch(() => undefined);
    return !!r && Number(r.numUpdatedRows ?? 0) > 0;
  }
}

export class InMemoryBonusRulesRepo implements BonusRulesRepo {
  private rows: any[] = [];
  private seq = 0;
  async list(ctx: BonusRuleCtx): Promise<BonusRuleRow[]> { return this.rows.filter((r) => r.tenant_id === ctx.tenantId && r.status === 'active').map(mapRow); }
  async create(ctx: BonusRuleCtx, input: BonusRuleInput): Promise<BonusRuleRow> {
    const r = { id: 'br_' + (++this.seq), tenant_id: ctx.tenantId, branch_id: input.branchId ?? null, technician_id: input.technicianId ?? null, metric: input.metric, target_value: input.target, amount_cents: input.amountCents, label: input.label ?? null, status: 'active', effective_start: new Date().toISOString(), created_at: new Date().toISOString() };
    this.rows.push(r); return mapRow(r);
  }
  async archive(ctx: BonusRuleCtx, id: string): Promise<boolean> { const r = this.rows.find((x) => x.id === id && x.tenant_id === ctx.tenantId && x.status === 'active'); if (!r) return false; r.status = 'archived'; return true; }
}
