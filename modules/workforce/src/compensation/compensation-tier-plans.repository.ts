/**
 * compensation-tier-plans.repository.ts — persistence for per-technician tiered commission plans (spec §2, table
 * technician_tier_plans from migration 411). Payroll already READS these (via PayrollAutoBuildAdapter.resolveTierPlan);
 * this is the authoring side: list active plans, create one, archive one. Bands are stored as JSONB.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TierBand } from './compensation-tiered';
import { canMoveToSql } from '@aipowersalon/database';
import { TIER_PLAN } from '../workforce-lifecycles';

export interface TierPlanCtx { tenantId: string; branchId?: string | null; userId?: string }
export interface TierPlanInput { technicianId: string; branchId?: string | null; mode: 'entire' | 'marginal'; bands: TierBand[] }
export interface TierPlanRow { id: string; technicianId: string; branchId: string | null; mode: string; bands: TierBand[]; status: string; effectiveStart: string; createdAt: string }

export interface TierPlansRepo {
  list(ctx: TierPlanCtx): Promise<TierPlanRow[]>;
  create(ctx: TierPlanCtx, input: TierPlanInput): Promise<TierPlanRow>;
  archive(ctx: TierPlanCtx, id: string): Promise<boolean>;
}

const parseBands = (raw: any): TierBand[] => {
  const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(a) ? a.map((x: any) => ({ uptoCents: x.uptoCents == null ? null : Number(x.uptoCents), ratePercent: Number(x.ratePercent) })) : [];
};
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const mapRow = (r: any): TierPlanRow => ({ id: r.id, technicianId: r.technician_id, branchId: r.branch_id ?? null, mode: r.mode, bands: parseBands(r.bands_json), status: r.status, effectiveStart: iso(r.effective_start), createdAt: iso(r.created_at) });

export class KyselyTierPlansRepo implements TierPlansRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: TierPlanCtx): Promise<TierPlanRow[]> {
    const rows = await this.db.selectFrom('technician_tier_plans').selectAll().where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').orderBy('created_at', 'desc').execute().catch(() => [] as any[]);
    return (rows as any[]).map(mapRow);
  }
  async create(ctx: TierPlanCtx, input: TierPlanInput): Promise<TierPlanRow> {
    const r: any = await this.db.insertInto('technician_tier_plans').values({
      tenant_id: ctx.tenantId, technician_id: input.technicianId, branch_id: input.branchId ?? null, mode: input.mode,
      bands_json: sql`${JSON.stringify(input.bands)}::jsonb`, status: 'active', created_by: ctx.userId ?? null,
    } as any).returningAll().executeTakeFirstOrThrow();
    return mapRow(r);
  }
  async archive(ctx: TierPlanCtx, id: string): Promise<boolean> {
    const r: any = await this.db.updateTable('technician_tier_plans').set({ status: 'archived' } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(TIER_PLAN, 'archived') as any).executeTakeFirst().catch(() => undefined);
    return !!r && Number(r.numUpdatedRows ?? 0) > 0;
  }
}

export class InMemoryTierPlansRepo implements TierPlansRepo {
  private rows: any[] = [];
  private seq = 0;
  async list(ctx: TierPlanCtx): Promise<TierPlanRow[]> { return this.rows.filter((r) => r.tenant_id === ctx.tenantId && r.status === 'active').map(mapRow); }
  async create(ctx: TierPlanCtx, input: TierPlanInput): Promise<TierPlanRow> {
    const r = { id: 'tp_' + (++this.seq), tenant_id: ctx.tenantId, technician_id: input.technicianId, branch_id: input.branchId ?? null, mode: input.mode, bands_json: input.bands, status: 'active', effective_start: new Date().toISOString(), created_at: new Date().toISOString() };
    this.rows.push(r); return mapRow(r);
  }
  async archive(ctx: TierPlanCtx, id: string): Promise<boolean> { const r = this.rows.find((x) => x.id === id && x.tenant_id === ctx.tenantId && x.status === 'active'); if (!r) return false; r.status = 'archived'; return true; }
}
