// tenant-scope.kysely.ts — STEP 3. The ONE helper to scope every tenant query.
// Usage:  const rows = await scoped(db.selectFrom('tickets'), ctx).selectAll().execute();
//         settings/tenant-wide tables: scoped(db.selectFrom('tenant_settings'), ctx, { includeNullBranch: true })
import { tenantScopeFilter, Ctx } from '@aipowersalon/permissions';

export function scoped<QB extends { where: (...a: any[]) => QB }>(qb: QB, ctx: Ctx, opts?: { includeNullBranch?: boolean }): QB {
  const f = tenantScopeFilter(ctx, !!opts?.includeNullBranch);
  let out = qb.where("tenant_id", "=", f.tenantId);
  if (f.includeNullBranch) {
    out = out.where((eb: any) => eb.or([eb("branch_id", "=", f.branchId), eb("branch_id", "is", null)]));
  } else {
    out = out.where("branch_id", "=", f.branchId);
  }
  return out;
}
