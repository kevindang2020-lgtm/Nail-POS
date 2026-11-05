// ai-money-protection-investigations.kysely.repository.ts — Kysely-backed investigations + append-only notes.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { MONEY_PROTECTION_INVESTIGATION } from '../ai-lifecycles';
import type { MoneyProtectionContext } from './ai-money-protection.dto';
import type {
  Investigation, InvestigationNote,
} from './ai-money-protection-investigations.dto';
import type {
  MoneyProtectionInvestigationRepositoryPort, InvestigationFilters, InvestigationPatch,
} from './ai-money-protection-investigations.repository';

function iso(v: any): string { try { return new Date(v).toISOString(); } catch { return String(v ?? ''); } }
function toInv(r: any): Investigation {
  const related = typeof r.related === 'string' ? safe(r.related) : (r.related ?? {});
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, title: r.title, category: r.category,
    severity: r.severity, status: r.status, assignedUserId: r.assigned_user_id ?? null,
    valueUnderReviewCents: Number(r.value_under_review_cents) || 0, recoveryAmountCents: Number(r.recovery_amount_cents) || 0,
    resolution: r.resolution ?? null, related, createdByUserId: r.created_by_user_id,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), closedAt: r.closed_at ? iso(r.closed_at) : null,
  };
}
function safe(s: string): any { try { return JSON.parse(s); } catch { return {}; } }

export class KyselyInvestigationRepository implements MoneyProtectionInvestigationRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async create(ctx: MoneyProtectionContext, data: any): Promise<Investigation> {
    const r: any = await this.db.insertInto('money_protection_investigations').values({
      tenant_id: ctx.tenantId, branch_id: data.branchId, title: data.title, category: data.category,
      severity: data.severity, value_under_review_cents: data.valueUnderReviewCents,
      related: JSON.stringify(data.related), created_by_user_id: data.createdByUserId,
    } as any).returningAll().executeTakeFirstOrThrow();
    return toInv(r);
  }
  async get(ctx: MoneyProtectionContext, id: string) {
    const r: any = await this.db.selectFrom('money_protection_investigations').selectAll()
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
    return r ? toInv(r) : null;
  }
  async list(ctx: MoneyProtectionContext, f: InvestigationFilters) {
    let q = this.db.selectFrom('money_protection_investigations').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (f.status) q = q.where('status', '=', f.status);
    if (f.branchId) q = q.where('branch_id', '=', f.branchId);
    const rows: any[] = await q.orderBy('updated_at', 'desc').limit(Math.min(100, Math.max(1, f.limit ?? 50))).execute();
    return rows.map(toInv);
  }
  async update(ctx: MoneyProtectionContext, id: string, patch: InvestigationPatch) {
    const set: any = { updated_at: sql`now()` };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.assignedUserId !== undefined) set.assigned_user_id = patch.assignedUserId;
    if (patch.resolution !== undefined) set.resolution = patch.resolution;
    if (patch.recoveryAmountCents !== undefined) set.recovery_amount_cents = patch.recoveryAmountCents;
    if (patch.closedAt !== undefined) set.closed_at = patch.closedAt;
    let q = this.db.updateTable('money_protection_investigations').set(set).where('tenant_id', '=', ctx.tenantId).where('id', '=', id);
    // Phase 12 (#27): a status write only along the money_protection_investigation machine, from the state the caller read
    if (patch.status !== undefined) q = q.where(canMoveToSql(MONEY_PROTECTION_INVESTIGATION, patch.status) as any);
    if (patch.fromStatus !== undefined) q = q.where('status', '=', patch.fromStatus as any);
    const r: any = await q.returningAll().executeTakeFirst();
    return r ? toInv(r) : null;
  }
  // Append-only: INSERT only.
  async addNote(ctx: MoneyProtectionContext, investigationId: string, authorUserId: string, body: string): Promise<InvestigationNote> {
    const r: any = await this.db.insertInto('money_protection_investigation_notes').values({
      tenant_id: ctx.tenantId, investigation_id: investigationId, author_user_id: authorUserId, body,
    } as any).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, investigationId: r.investigation_id, authorUserId: r.author_user_id, body: r.body, createdAt: iso(r.created_at) };
  }
  async listNotes(ctx: MoneyProtectionContext, investigationId: string): Promise<InvestigationNote[]> {
    const rows: any[] = await this.db.selectFrom('money_protection_investigation_notes').selectAll()
      .where('tenant_id', '=', ctx.tenantId).where('investigation_id', '=', investigationId)
      .orderBy('created_at', 'asc').execute();
    return rows.map((r) => ({ id: r.id, investigationId: r.investigation_id, authorUserId: r.author_user_id, body: r.body, createdAt: iso(r.created_at) }));
  }
}
