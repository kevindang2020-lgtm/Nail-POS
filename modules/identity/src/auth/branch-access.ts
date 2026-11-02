// branch-access.ts — branch selection for multi-branch tenants. Pure service + data port (Nest-free, testable). After
// login returns BRANCH_SELECTION_REQUIRED (authenticated, no branch), the client calls select-branch with a branchId;
// this validates the branch belongs to the user's tenant and is active, then returns the session claims to re-issue with
// the branch set. The Postgres adapter is staged; the in-memory adapter returns no branches.
import type { Role } from '@aipowersalon/permissions';
import type { SessionClaims } from './auth-session-token';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface BranchSummary { id: string; isActive: boolean; name?: string; city?: string | null }

export interface BranchAccessPort {
  branchesForTenant(tenantId: string): Promise<BranchSummary[]>;
  /** Branch ids this USER is explicitly granted (user_branch_access). Returns [] when the user has no explicit
   *  grants — the common case for ordinary staff, who are scoped by users.branch_id instead. */
  branchIdsForUser?(tenantId: string, userId: string): Promise<string[]>;
  /** The specific role the user holds in this branch. */
  roleForBranch?(tenantId: string, userId: string, branchId: string): Promise<string | null>;
  /** BUILD_PLAN Phase 9: the branches this person may ENTER under their template scope (grants → home → any);
   *  null = every branch. When present it replaces branchIdsForUser for the decision. */
  enterableBranchesFor?(tenantId: string, userId: string, role: string): Promise<string[] | null>;
}

export type BranchErrorCode = 'invalid' | 'not_authenticated' | 'branch_not_found' | 'branch_inactive';
export class BranchError extends Error {
  constructor(public code: BranchErrorCode, message: string) { super(message); this.name = 'BranchError'; }
}

export interface BranchSessionInput {
  userId: string; tenantId: string | null; branchId: string | null;
  role: Role; permissions: string[]; subscriptionStatus: string;
  /** Session row id. MUST be carried into the re-signed token after branch selection — dropping it would leave
   *  every multi-branch user with an unrevocable session. */
  sid?: string;
  /** BUILD_PLAN Phase 9: the authorization versions the session's permissions were derived at — carried unchanged. */
  av?: number;
  tv?: number | null;
}

export class BranchSelectionService {
  constructor(private readonly port: BranchAccessPort) {}

  /**
   * The branches this user may actually work in — spec §6: "User has access to the branch".
   *
   * Previously both the picker and selectBranch used the tenant's FULL branch list, so a user with an explicit,
   * limited grant (user_branch_access — the Owner Multi-Salon model, access levels owner/manager/viewer) could
   * select a branch they were never granted and receive a session scoped to it. The owner APIs enforce their own
   * scope, but the session itself should never be minted for a branch the user cannot access.
   *
   * Fail-safe by design: when the user has NO explicit grants (ordinary staff), behavior is unchanged — the full
   * tenant list is returned. This closes the hole for users whose access IS explicitly limited without locking out
   * staff who legitimately float between locations.
   */
  private async accessibleBranches(session: BranchSessionInput): Promise<BranchSummary[]> {
    const all = await this.port.branchesForTenant(session.tenantId!);
    // Oct 12 2026 merge (workforce audit P2 #28): a TECHNICIAN session fails CLOSED — her branches are her employment
    // (one user_branch_access grant per active membership). A lookup error, a port that cannot answer, or an answer of
    // "any branch" gives her NO branch, never the salon's whole list. Owners / managers / front desk keep the
    // documented fail-open below (no lockout on a DB blip).
    const technician = session.role === 'TECHNICIAN';
    const fallback = technician ? [] : all;
    // BUILD_PLAN Phase 9 — the template SCOPE decides (Kevin's decision (1)): explicit grants confine; a BRANCH /
    // SELECTED_BRANCHES person without grants is confined to their home branch; TENANT (owner / GM) and legacy accounts
    // with neither go anywhere. A failed lookup confines nobody further than before (no lockout on a DB blip).
    if (this.port.enterableBranchesFor) {
      let allowed: string[] | null = null;
      try { allowed = await this.port.enterableBranchesFor(session.tenantId!, session.userId, session.role); } catch { return fallback; }
      if (allowed === null) return fallback;
      const set = new Set(allowed);
      return all.filter((b) => set.has(b.id));
    }
    if (!this.port.branchIdsForUser) return fallback;            // port doesn't model per-user grants
    let granted: string[] = [];
    try { granted = await this.port.branchIdsForUser(session.tenantId!, session.userId); } catch { return fallback; }
    if (!granted.length) return fallback;                        // no explicit grants → open for staff, closed for technicians
    const allowed = new Set(granted);
    return all.filter((b) => allowed.has(b.id));
  }

  // List the tenant's branches for the picker (requires an authenticated tenant session).
  async list(session: BranchSessionInput | null): Promise<BranchSummary[]> {
    if (!session || !session.userId) throw withCode(new BranchError('not_authenticated', 'Sign in before listing branches.'), 'AUTH_REQUIRED');
    if (!session.tenantId) throw withCode(new BranchError('invalid', 'Branch selection does not apply to this account.'), 'BRANCH_SELECTION_NOT_APPLICABLE');
    return this.accessibleBranches(session);
  }

  async selectBranch(session: BranchSessionInput | null, branchId: string): Promise<SessionClaims> {
    if (!session || !session.userId) throw withCode(new BranchError('not_authenticated', 'Sign in before selecting a branch.'), 'AUTH_REQUIRED');
    if (typeof branchId !== 'string' || !branchId.trim()) throw new BranchError('invalid', 'A branchId is required.');
    if (!session.tenantId) throw withCode(new BranchError('invalid', 'Branch selection does not apply to this account.'), 'BRANCH_SELECTION_NOT_APPLICABLE');
    const branches = await this.accessibleBranches(session);
    const match = branches.find((b) => b.id === branchId);
    if (!match) throw withCode(new BranchError('branch_not_found', 'That branch is not available for your account.'), 'BRANCH_ACCESS_DENIED');
    if (!match.isActive) throw withCode(new BranchError('branch_inactive', 'That branch is not active.'), 'BRANCH_INACTIVE');

    // BUILD_PLAN Phase 9 (audit: branch-access.ts:73-87): a per-branch role row (user_branch_access.role) may only NARROW.
    // It used to REPLACE the session role at selection, so a front-desk account with a 'MANAGER' row in one branch became
    // a manager there (and the Sep 2026 code recomputed the role's full defaults on top). Now the session keeps its own
    // role AND its own permission list; the request path (authorization-state.ts narrowByBranchRole) intersects it with
    // the branch role's defaults for every request in that branch — so moving on to another branch never carries one
    // branch's narrowing along, and no branch row can ever add a permission.
    const permissions = session.permissions;

    return {
      userId: session.userId, tenantId: session.tenantId, branchId,
      role: session.role, permissions, subscriptionStatus: session.subscriptionStatus,
      ...(session.sid ? { sid: session.sid } : {}),   // preserve revocability across branch selection
      ...(typeof session.av === 'number' ? { av: session.av, tv: session.tv ?? null } : {}),
    };
  }
}

export class InMemoryBranchAccessRepository implements BranchAccessPort {
  constructor(private branches: Record<string, BranchSummary[]> = {}) {}
  async branchesForTenant(tenantId: string): Promise<BranchSummary[]> { return this.branches[tenantId] ?? []; }
}
