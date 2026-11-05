// ai-business-branch-scope.ts — the authorized-branch resolver the branch-aware tools depend on.
// It does NOT reimplement branch authorization: it delegates to OwnerService.listAuthorizedBranches, which is backed
// by owner_branch_access + role rules (OWNER → whole tenant, MANAGER → assigned branch only). This is the single
// security gate that guarantees a comparison can only ever touch branches the caller is entitled to (spec §5, §14).
import type { AiBusinessContext } from './ai-business.dto';

export interface AuthorizedBranch { branchId: string; branchName: string; status: string }

/** Port consumed by branch-aware tools. Kept minimal + injectable so tools are unit-testable with a fake. */
export interface BranchScopeResolver {
  listAuthorizedBranches(ctx: AiBusinessContext): Promise<AuthorizedBranch[]>;
}

/** Structural view of the reused OwnerService (only the method we need). Avoids a hard type import cycle. */
export interface OwnerBranchScopePort {
  listAuthorizedBranches(ctx: { tenantId: string; userId: string; role: string; permissions: string[]; selectedBranchId?: string }): Promise<AuthorizedBranch[]>;
}

/** Adapter: maps the trusted AiBusinessContext onto the OwnerContext shape and delegates. No client-supplied branch
 *  is ever passed as authority — selectedBranchId is only the caller's own server-derived branch. */
export class OwnerServiceBranchScopeResolver implements BranchScopeResolver {
  constructor(private readonly owner: OwnerBranchScopePort) {}
  listAuthorizedBranches(ctx: AiBusinessContext): Promise<AuthorizedBranch[]> {
    return this.owner.listAuthorizedBranches({
      tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions,
      selectedBranchId: ctx.branchId || undefined,
    });
  }
}
