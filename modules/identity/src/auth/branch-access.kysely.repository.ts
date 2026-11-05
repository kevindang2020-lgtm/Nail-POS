/**
 * branch-access.kysely.repository.ts — Postgres (Kysely) BranchAccessPort.
 * ⚠️ STAGED: type-checked, not run against a live DB (runbook §8). Lists a tenant's branches from `branches`
 * (isActive = status === 'active'). Reconcile the active-status string if your data differs.
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BranchAccessPort, BranchSummary } from './branch-access';
import { enterableBranchesForUser } from './authorization-state';

export class KyselyBranchAccessRepository implements BranchAccessPort {
  constructor(private readonly db: Kysely<DB>) {}
  async branchesForTenant(tenantId: string): Promise<BranchSummary[]> {
    const rows = await this.db.selectFrom('branches').select(['id', 'name', 'city', 'status']).where('tenant_id', '=', tenantId).orderBy('name', 'asc').execute();
    return (rows as any[]).map((r) => ({ id: r.id, name: r.name, city: r.city ?? null, isActive: (r.status || '').toLowerCase() === 'active' }));
  }

  /** Explicit per-user branch grants (user_branch_access — the Owner Multi-Salon model). Empty for ordinary
   *  staff, who are scoped by users.branch_id; the service then leaves behavior unchanged for them. */
  async branchIdsForUser(tenantId: string, userId: string): Promise<string[]> {
    try {
      const rows = await this.db
        .selectFrom('user_branch_access').select('branch_id')
        .where('tenant_id', '=', tenantId)
        .where('user_id', '=', userId)
        .execute();
      return (rows as any[]).map((r) => String(r.branch_id));
    } catch {
      return [];   // degrade to the previous behavior rather than locking anyone out
    }
  }

  async roleForBranch(tenantId: string, userId: string, branchId: string): Promise<string | null> {
    try {
      const row = await this.db
        .selectFrom('user_branch_access').select('role')
        .where('tenant_id', '=', tenantId)
        .where('user_id', '=', userId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      return row?.role ? String(row.role) : null;
    } catch {
      return null;
    }
  }

  /** BUILD_PLAN Phase 9: template scope → grants → home branch → any (null). */
  async enterableBranchesFor(tenantId: string, userId: string, role: string): Promise<string[] | null> {
    return enterableBranchesForUser(this.db, tenantId, userId, role);
  }
}
