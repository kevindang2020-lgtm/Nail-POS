// compensation-tip-policy.service.ts — salon-level 3+-technician tip-split policy (spec §11). Stored in the generic
// tenant_settings JSONB store under category 'compensation'. Default is 'proportional' (safe, unchanged behaviour);
// 'equal' is only ever applied when the salon explicitly opts in. Read on the compute path by loadTicketMeta.
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export type ManyTechTipMethod = 'proportional' | 'equal';
export interface TipPolicyCtx { tenantId: string; branchId: string | null; userId?: string | null; }

export class CompensationTipPolicyService {
  constructor(private readonly db: Kysely<DB> | null, private readonly rt?: RealtimeEmitter) {}

  private async row(ctx: TipPolicyCtx): Promise<{ id?: string; json: any } | null> {
    if (!this.db) return null;
    const s: any = await (this.db as any).selectFrom('tenant_settings').select(['id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'compensation')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]))
      .orderBy('branch_id', 'desc').executeTakeFirst().catch(() => null);
    if (!s) return null;
    const json = s.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : {};
    return { id: s.id, json };
  }

  async get(ctx: TipPolicyCtx): Promise<{ manyTechTipMethod: ManyTechTipMethod }> {
    try { const r = await this.row(ctx); return { manyTechTipMethod: r?.json?.manyTechTipMethod === 'equal' ? 'equal' : 'proportional' }; }
    catch { return { manyTechTipMethod: 'proportional' }; }
  }

  async set(ctx: TipPolicyCtx, method: unknown): Promise<{ manyTechTipMethod: ManyTechTipMethod }> {
    const m: ManyTechTipMethod = method === 'equal' ? 'equal' : 'proportional';
    if (this.db) {
      // NOT best-effort any more. This block used to sit inside `try { … } catch { /* best-effort */ }`, so a
      // failed write was swallowed and the method still returned the NEW value as if it had been saved. The owner
      // was told the policy changed while the database kept the old one, and payroll computed against the old
      // one. A failed save of a payroll setting must fail visibly. Only the audit write stays best-effort.
      {
        const existing = await this.row(ctx);
        const json = { ...(existing?.json || {}), manyTechTipMethod: m };
        if (existing?.id) await (this.db as any).updateTable('tenant_settings').set({ settings_json: json as any, updated_by_user_id: ctx.userId ?? null, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', existing.id).execute();
        else await (this.db as any).insertInto('tenant_settings').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, category: 'compensation', settings_json: json as any, updated_by_user_id: ctx.userId ?? null } as any).execute();
        notifySettingsChanged(this.rt, ctx.tenantId, 'compensation.tip_policy');   // after the write succeeded — never on failure
        try {
          await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
            VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId ?? null}, ${'OWNER'}, ${'compensation_tip_policy_updated'}, ${'compensation'}, ${'tip_policy'}, ${JSON.stringify({ manyTechTipMethod: m })}::jsonb)`.execute(this.db);
        } catch { /* audit best-effort */ }
      }
    }
    return { manyTechTipMethod: m };
  }
}
