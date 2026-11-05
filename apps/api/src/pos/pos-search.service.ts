// pos-search.service.ts — tenant-safe POS search orchestrator. Derives tenant/branch from session,
// enforces POS access + per-group permissions, runs ONLY tenant/branch-scoped repo queries, never the
// main/global customer DB, never cross-tenant. Framework-free for testability.
import {
  permittedGroups, hasPosSearchAccess, validateQuery, clampLimit, getResultRoute,
  emptyGrouped, totalCount, GroupedResults, PosSearchGroup,
} from "./pos-search-core";
import { hasPermission } from '@aipowersalon/permissions';

// the scope the repo MUST apply to every query (derived server-side; never from the client).
export interface Scope { tenantId: string; branchId: string | null; }

// repo ports — each returns rows ALREADY filtered by scope (the impl uses scoped() / WHERE tenant_id=… AND branch_id=…).
export interface SearchRepo {
  customers(scope: Scope, q: string, limit: number): Promise<any[]>;
  appointments(scope: Scope, q: string, limit: number): Promise<any[]>;
  services(scope: Scope, q: string, limit: number): Promise<any[]>;     // services may be branch-null but tenant must match
  technicians(scope: Scope, q: string, limit: number): Promise<any[]>;
  tickets(scope: Scope, q: string, limit: number): Promise<any[]>;
  receipts(scope: Scope, q: string, limit: number): Promise<any[]>;
  queue(scope: Scope, q: string, limit: number): Promise<any[]>;
}

export interface TenantContext { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }
// The search audit is its OWN legacy-shaped sink (audit_logs action_type/entity_*), wired in pos-search.module.ts — typed
// so a mismatch is a compile error, not a dropped row.
export interface PosSearchAuditEntry { tenantId: string; branchId: string | null; userId: string; role: string; actionType: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown>; createdAt?: string }
export interface Ctx { audit: { record(a: PosSearchAuditEntry): Promise<void> }; clock: { iso(): string }; }

export class PosSearchService {
  constructor(private repo: SearchRepo, private ctx: Ctx) {}

  // GET /pos/overview/search?q=  and  GET /pos/search?q=&scope=
  async search(tc: TenantContext, rawQuery: string | undefined, perGroupLimit?: number, opts?: { allLocations?: boolean }): Promise<{ query: string; results: GroupedResults; totalCount: number; scope: { tenant: string; location: string } }> {
    if (!hasPosSearchAccess(tc.role, tc.permissions)) throw new Error("forbidden_pos_search"); // CUSTOMER / SUPER_ADMIN / unprivileged tech
    const v = validateQuery(rawQuery);
    // "All my authorized locations" is allowed ONLY for OWNER/MANAGER; everyone else is pinned to the current branch.
    // BUILD_PLAN Phase 9: searching every location is the cross-branch view (owner.branches.view — owners and managers by
    // default), not the OWNER / MANAGER role names.
    const allLocations = !!opts?.allLocations && hasPermission(tc as any, "owner.branches.view");
    const scope: Scope = { tenantId: tc.tenantId, branchId: allLocations ? null : tc.branchId }; // derived server-side ONLY
    if (!v.ok) return { query: v.q, results: emptyGrouped(), totalCount: 0, scope: { tenant: "current", location: allLocations ? "all_authorized" : "current" } };
    const limit = clampLimit(perGroupLimit);
    const groups = permittedGroups(tc.role, tc.permissions);
    const out = emptyGrouped();
    const run: Record<PosSearchGroup, (s: Scope, q: string, l: number) => Promise<any[]>> = {
      customers: this.repo.customers, appointments: this.repo.appointments, services: this.repo.services,
      technicians: this.repo.technicians, tickets: this.repo.tickets, receipts: this.repo.receipts, queue: this.repo.queue,
    };
    const mapType: Record<PosSearchGroup, any> = { customers: "customer", appointments: "appointment", services: "service", technicians: "technician", tickets: "ticket", receipts: "receipt", queue: "queue_item" };
    for (const g of groups) {
      const rows = await run[g].call(this.repo, scope, v.q, limit);
      out[g] = rows.slice(0, limit).map((r) => ({
        id: String(r.id), type: mapType[g], title: r.title, subtitle: r.subtitle, badge: r.badge,
        route: getResultRoute(mapType[g], String(r.id), { status: r.status, route: r.route }),
        metadata: r.metadata,
      }));
    }
    return { query: v.q, results: out, totalCount: totalCount(out), scope: { tenant: "current", location: allLocations ? "all_authorized" : "current" } };
  }

  // §19 audit only when a result is OPENED (not per keystroke).
  async recordOpen(tc: TenantContext, resultType: string, entityId: string, query: string): Promise<void> {
    await this.ctx.audit.record({
      tenantId: tc.tenantId, branchId: tc.branchId, userId: tc.userId, role: tc.role,
      actionType: "pos_search_result_opened", entityType: resultType, entityId,
      metadata: { query, resultType }, createdAt: this.ctx.clock.iso(),
    });
  }
}
