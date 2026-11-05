// Management repository port (writes to the real promotions table) + in-memory + Kysely impls. Read-modify-write of the
// promotion status/approval fields; the SERVICE validates every change through promotion-lifecycle-core first.
import { sql } from 'kysely';
import { KyselyDealsMarketplace } from '@aipowersalon/deals';
import { OutboxWriter } from '@aipowersalon/events';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL } from '@aipowersalon/deals';

export interface PromotionAdminRow { id: string; status: string; approvalStatus: string; tenantId: string; name: string | null }

export interface PromotionManagementRepositoryPort {
  getPromotion(id: string): Promise<PromotionAdminRow | null>;
  setApproval(id: string, approvalStatus: string, status: string, reason: string | null): Promise<PromotionAdminRow | null>;
  setStatus(id: string, status: string): Promise<PromotionAdminRow | null>;
  disable(id: string, reason: string): Promise<PromotionAdminRow | null>;
}

export class InMemoryPromotionManagementRepository implements PromotionManagementRepositoryPort {
  rows = new Map<string, PromotionAdminRow & { disabledReason?: string; decisionReason?: string }>();
  async getPromotion(id: string) { return this.rows.get(id) || null; }
  async setApproval(id: string, approvalStatus: string, status: string, reason: string | null) { const r = this.rows.get(id); if (!r) return null; r.approvalStatus = approvalStatus; r.status = status; if (reason) r.decisionReason = reason; return r; }
  async setStatus(id: string, status: string) { const r = this.rows.get(id); if (!r) return null; r.status = status; return r; }
  async disable(id: string, reason: string) { const r = this.rows.get(id); if (!r) return null; r.status = 'disabled'; r.disabledReason = reason; r.decisionReason = reason; return r; }
}

// BUILD_PLAN Phase 5: Super Admin promotion management acts on the ONE deals domain (tenant_promotions is frozen —
// migration 523). A promotion id is a deal id, or a pre-Phase-5 tenant_promotions id resolved through deals.legacy_id.
// "disable" is a Super Admin suspension: a reason, audited, every unpaid use given back (deals-marketplace.kysely.ts).
// CROSS-TENANT BY DESIGN: Super Admin oversight across salons (behind SuperAdminGuard); each write names the row's tenant.
const OUT: Record<string, string> = { canceled: 'cancelled', sold_out: 'completed' };
const IN: Record<string, string> = { cancelled: 'canceled', completed: 'expired', disabled: 'canceled' };
const map = (r: any): PromotionAdminRow => ({ id: String(r.id), status: r.suspended_at ? 'disabled' : (OUT[r.status] ?? r.status),
  approvalStatus: r.status === 'pending_approval' ? 'pending' : r.status === 'rejected' ? 'rejected' : 'approved', tenantId: String(r.tenant_id), name: r.title ?? null });
const UUID = /^[0-9a-f-]{36}$/i;

export class KyselyPromotionManagementRepository implements PromotionManagementRepositoryPort {
  constructor(private readonly db: AppDatabase, private readonly outbox: OutboxWriter | null = null) {}
  private async row(id: string): Promise<any> {
    if (!UUID.test(String(id || ''))) return null;
    return (await sql`select id, status, tenant_id, title, suspended_at from deals where (id = ${id} or legacy_id = ${id}) and kind <> 'announcement' limit 1`.execute(this.db as any)).rows[0] ?? null;
  }
  async getPromotion(id: string) { const r = await this.row(id); return r ? map(r) : null; }
  async setApproval(id: string, approvalStatus: string, status: string, reason: string | null) {
    const cur = await this.row(id); if (!cur) return null;
    const to = IN[status] ?? status;
    const r: any = (await sql`update deals set status = ${to}, version = version + 1, updated_at = now() where tenant_id = ${cur.tenant_id} and id = ${cur.id} and status = ${cur.status} and ${canMoveToSql(DEAL, to)} returning id, status, tenant_id, title, suspended_at`.execute(this.db as any)).rows[0];
    if (r) await sql`insert into deal_approvals (deal_id, tenant_id, decision, reason, deal_version) select ${cur.id}, ${cur.tenant_id}, ${approvalStatus === 'approved' ? 'approved' : 'rejected'}, ${reason}, version from deals where tenant_id = ${cur.tenant_id} and id = ${cur.id}`.execute(this.db as any);
    return r ? map(r) : null;
  }
  async setStatus(id: string, status: string) {
    const cur = await this.row(id); if (!cur) return null;
    if (status === 'disabled') return this.disable(id, 'Disabled by platform administration');
    const to = IN[status] ?? status;
    const r: any = (await sql`update deals set status = ${to}, version = version + 1, updated_at = now(), expired_at = case when ${to} = 'expired' then now() else expired_at end
                               where tenant_id = ${cur.tenant_id} and id = ${cur.id} and status = ${cur.status} and ${canMoveToSql(DEAL, to)} returning id, status, tenant_id, title, suspended_at`.execute(this.db as any)).rows[0];
    return r ? map(r) : null;
  }
  async disable(id: string, reason: string) {
    const cur = await this.row(id); if (!cur) return null;
    await new KyselyDealsMarketplace(this.db, this.outbox).superSuspendDeal(String(cur.id), reason, { userId: null, role: 'SUPER_ADMIN' });
    return this.getPromotion(String(cur.id));
  }
}
