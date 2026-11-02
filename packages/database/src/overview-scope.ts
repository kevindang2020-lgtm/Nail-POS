// overview-scope.ts — Phase 1 of the Super Admin scope selector. A single optional tenant scope threaded through the
// read-only Overview aggregation so the platform view can be narrowed to one salon/tenant. When no scope is supplied
// every helper is a no-op, so the existing platform-wide behavior is preserved exactly (the default path cannot
// regress). Branch-level scoping (branchId) is intentionally deferred to a later phase — not every oversight table
// carries branch_id, so a uniform branch filter isn't clean yet; tenant scope is the primary "All Branches" use case.
import { sql, type RawBuilder } from 'kysely';

export interface OverviewScope {
  tenantId?: string | null;
}

// Normalize loose query input (string | string[] | undefined) into a scope, treating '', 'all', and absent as unscoped.
export function parseScope(tenantId: unknown): OverviewScope {
  const v = Array.isArray(tenantId) ? tenantId[0] : tenantId;
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.toLowerCase() !== 'all' ? { tenantId: s } : {};
}

export function isScoped(scope?: OverviewScope): boolean {
  return !!scope?.tenantId;
}

// Trailing predicate for a `where ... ${...}` position: ` and <col> = <id>` when scoped, else empty.
export function andTenant(scope: OverviewScope | undefined, col = 'tenant_id'): RawBuilder<unknown> {
  return scope?.tenantId ? sql`and ${sql.ref(col)} = ${scope.tenantId}` : sql``;
}

// Standalone predicate for a fresh `where ${...}` position: `<col> = <id>` when scoped, else `true`.
export function tenantPred(scope: OverviewScope | undefined, col = 'tenant_id'): RawBuilder<unknown> {
  return scope?.tenantId ? sql`${sql.ref(col)} = ${scope.tenantId}` : sql`true`;
}
