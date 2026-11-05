// compensation-retail-policy.service.ts — salon-level retail commission rate (spec §16). Stored in the generic
// tenant_settings JSONB store under category 'compensation', key 'retailCommission'. Default { method:'none', value:0 }
// = retail commission OFF (unchanged behaviour); a rate is applied only when the salon explicitly configures it. Read on
// the compute path by loadTicketMeta and applied to retail lines (never mixed with service commission, §5). This covers
// the common §16 methods (percent of gross retail price, fixed per item); gross-profit / tiered / per-category are
// documented follow-ons.
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import type { RetailMethod, RetailPolicy } from '@aipowersalon/api-contracts/tenant';
export type { RetailMethod, RetailPolicy };   // owned by packages/api-contracts (Constitution 13 §13)
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

 // percent 0..100, or cents-per-item for fixed
export interface RetailPolicyCtx { tenantId: string; branchId: string | null; userId?: string | null; }

export function cleanRetailPolicy(j: any): RetailPolicy {
  const m = j?.method;
  const method: RetailMethod = m === 'percent' || m === 'fixed' ? m : 'none';
  let value = Number(j?.value);
  if (!Number.isFinite(value) || value < 0) value = 0;
  if (method === 'percent' && value > 100) value = 100;
  return { method, value: method === 'none' ? 0 : Math.round(value) };
}

export class RetailCommissionService {
  constructor(private readonly db: Kysely<DB> | null, private readonly rt?: RealtimeEmitter) {}

  private async row(ctx: RetailPolicyCtx): Promise<{ id?: string; json: any } | null> {
    if (!this.db) return null;
    const s: any = await (this.db as any).selectFrom('tenant_settings').select(['id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'compensation')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]))
      .orderBy('branch_id', 'desc').executeTakeFirst().catch(() => null);
    if (!s) return null;
    const json = s.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : {};
    return { id: s.id, json };
  }

  async get(ctx: RetailPolicyCtx): Promise<RetailPolicy> {
    try { const r = await this.row(ctx); return cleanRetailPolicy(r?.json?.retailCommission || {}); }
    catch { return { method: 'none', value: 0 }; }
  }

  async set(ctx: RetailPolicyCtx, input: unknown): Promise<RetailPolicy> {
    const rc = cleanRetailPolicy(input || {});
    if (this.db) {
      // NOT best-effort any more. This block used to sit inside `try { … } catch { /* best-effort */ }`, so a
      // failed write was swallowed and the method still returned the NEW value as if it had been saved. The owner
      // was told the policy changed while the database kept the old one, and payroll computed against the old
      // one. A failed save of a payroll setting must fail visibly. Only the audit write stays best-effort.
      {
        const existing = await this.row(ctx);
        const json = { ...(existing?.json || {}), retailCommission: rc };
        if (existing?.id) await (this.db as any).updateTable('tenant_settings').set({ settings_json: json as any, updated_by_user_id: ctx.userId ?? null, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', existing.id).execute();
        else await (this.db as any).insertInto('tenant_settings').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, category: 'compensation', settings_json: json as any, updated_by_user_id: ctx.userId ?? null } as any).execute();
        notifySettingsChanged(this.rt, ctx.tenantId, 'compensation.retail_policy');   // after the write succeeded — never on failure
        try {
          await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
            VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId ?? null}, ${'OWNER'}, ${'compensation_retail_policy_updated'}, ${'compensation'}, ${'retail_policy'}, ${JSON.stringify(rc)}::jsonb)`.execute(this.db);
        } catch { /* audit best-effort */ }
      }
    }
    return rc;
  }
}
