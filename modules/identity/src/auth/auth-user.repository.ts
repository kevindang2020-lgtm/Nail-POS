/**
 * auth-user.repository.ts — the login-facts lookup port + an in-memory implementation.
 *
 * The login orchestrator (next slice) combines this lookup with password.verifyPassword to build the LoginFacts that
 * auth-flow.decideLogin consumes. Keeping the lookup behind a port means the orchestrator is testable with a fake repo
 * and identical across tenant login, branded-URL login, and super-admin login. Column mapping mirrors
 * 001_auth_foundation.sql (tenants, users, branches, tenant_subscriptions). Tenant isolation is enforced by always
 * scoping the user lookup to the resolved tenant id (a client can never supply a tenant).
 *
 * The Postgres/Kysely implementation is intentionally deferred to the live-integration slice (same caveat as the other
 * adapters: it would type-check/build but cannot run against a real database in this environment).
 */
import type { Role } from '@aipowersalon/permissions';
import type { TenantStatus, UserStatus, SubStatus } from './auth-flow';
import type { NormalizedIdentifier } from '@aipowersalon/auth';

export interface LoginUserRecord {
  userId: string;
  tenantId: string | null;        // null for SUPER_ADMIN
  branchId: string | null;
  role: Role;
  status: UserStatus;
  passwordHash: string | null;    // null when the user has not set a password yet (invited)
  mfaEnabled: boolean;
  fullName: string | null;
  totpSecret?: string | null;   // decrypted base32 secret of the user's CONFIRMED TOTP factor, if any (else null)
}

/** One CUSTOMER account, with just enough context to finish the login. */
export interface CustomerLoginCandidate {
  user: LoginUserRecord;
  tenantStatus: TenantStatus;
  subscriptionStatus?: SubStatus;
  salonName: string;
  /** When the customer chose this salon account as their default (users.customer_default_at, migration 493). */
  defaultAt?: string | null;
}

/** A person, and the salons they belong to. The identity is what has a password; the links are their accounts. */
export interface CustomerIdentity {
  identityId: string;
  passwordHash: string | null;
  status: string;
  salons: Array<{ tenantId: string; userId: string; salonName: string; tenantStatus: TenantStatus; subscriptionStatus?: SubStatus; defaultAt?: string | null }>;
}

/** An owner, and the salons they hold. */
export interface OwnerLoginRecord {
  user: LoginUserRecord;
  /** Every salon they own, primary first. Empty means an owner with no salons yet — a real state, not an error. */
  salons: Array<{ suspensionReasonCode?: string | null; tenantId: string; branchId: string | null; salonName: string; tenantStatus: TenantStatus; subscriptionStatus?: SubStatus; isPrimaryOwner: boolean }>;
}

export interface LoginLookup {
  tenantFound: boolean;
  tenantStatus?: TenantStatus;
  /** Constitution 7 §19 — why the salon is suspended (null when it is not) */
  suspensionReasonCode?: string | null;
  user?: LoginUserRecord;         // present iff a matching user row exists within the tenant
  subscriptionStatus?: SubStatus; // latest tenant_subscriptions.status for the tenant
  branchCount: number;            // ACTIVE branches only — an inactive branch is not selectable
  singleBranchId?: string;        // ID of the single active branch (when branchCount === 1)
  /** Status of the branch the user is assigned to (undefined when the user has no assigned branch).
   *  Login must not issue a session scoped to a branch that is not active. */
  assignedBranchActive?: boolean;
}

export interface AuthUserRepository {
  /**
   * This salon's permission overrides for one TECHNICIAN. Optional: the in-memory/seed adapter has none, and a
   * technician with no overrides simply carries the TECHNICIAN role defaults, exactly as before.
   *
   * Overrides only — `allowed:false` on a role default is a salon revoking something the role grants. The keys
   * are filtered against TECH_PERMISSION_KEYS by `effectiveTechPermissions` before they can reach a session, so
   * a corrupt row cannot widen anybody's authority.
   */
  techPermissionOverrides?(tenantId: string, userId: string): Promise<{ permission: string; allowed: boolean }[]>;
  /**
   * Oct 12 2026 merge (workforce audit P0 #4): the TECHNICIAN's GLOBAL account status (global_tech_profiles.status,
   * via users.global_tech_profile_id or the technicians roster row, scoped to THIS salon). A platform pause / lock /
   * suspend / anonymize / merge must refuse the per-salon login too. Null = no global profile (the login then proceeds on
   * users.status alone, exactly as before).
   */
  technicianGlobalStatus?(userId: string, tenantId: string | null): Promise<string | null>;
  /** Functional Decision 12: the staff member's role-template permissions in this salon, or null for base-role defaults. */
  staffTemplatePermissions?(tenantId: string, userId: string, baseRole: string): Promise<string[] | null>;
  /** Constitution 7 §5 — a platform account's platform role (users.platform_role), or null. */
  platformRoleOf?(userId: string): Promise<string | null>;
  /** BUILD_PLAN Phase 9: the account's (and its salon's) authorization versions, minted into the session. */
  authorizationVersions?(userId: string, tenantId: string | null): Promise<{ av: number; tv: number | null } | null>;
  /** BUILD_PLAN Phase 9: the branches this staff member may enter (template scope + grants + home); null = any. */
  enterableBranchesFor?(tenantId: string, userId: string, role: string): Promise<string[] | null>;
  /** A staff or platform account's CURRENT role, salon and status — read on every token refresh (Oct 6 2026). */
  userStateForRefresh?(userId: string): Promise<{ role: string; tenantId: string | null; status: string } | null>;
  /** Resolve a tenant by its salon code, then a user within it by email/phone. */
  findTenantUserForLogin(tenantCode: string, id: NormalizedIdentifier): Promise<LoginLookup>;
  /** Resolve a platform SUPER_ADMIN (tenant_id IS NULL) by email/phone. */
  findSuperAdminForLogin(id: NormalizedIdentifier): Promise<{ user?: LoginUserRecord }>;
  /**
   * Customer-app login. Finds CUSTOMER accounts by phone/email ACROSS salons — no salon code, because a customer
   * does not have one. Only `role = 'CUSTOMER'` rows are ever returned, so a manager/technician/owner can never
   * authenticate through the customer app even with correct credentials.
   *
   * A phone/email may legitimately have an account at more than one salon; all are returned and the caller
   * decides (after the password is proven).
   */
  findCustomersForLogin?(id: NormalizedIdentifier): Promise<CustomerLoginCandidate[]>;

  /**
   * The customer's GLOBAL identity (one person, one password, many salons).
   *
   * Returns null when they have no identity row — in which case login falls back to the per-salon lookup and the
   * customer signs in exactly as before. That fallback is deliberate: the identity layer ships without a flag day,
   * and if it were wrong it degrades to today's behaviour rather than locking anyone out.
   */
  findCustomerIdentity?(id: NormalizedIdentifier): Promise<CustomerIdentity | null>;

  /**
   * Owner-app login. Finds OWNER accounts by phone/email — **no Store Code**, because an owner with several
   * salons does not have one. Only `role = 'OWNER'` rows are returned, so staff can never sign in here.
   *
   * Returns every salon they own, so the session can be opened at their primary salon and the portfolio is
   * immediately available.
   */
  findOwnerForLogin?(id: NormalizedIdentifier): Promise<OwnerLoginRecord | null>;
  /** Atomically advance the last-used TOTP time-step for the user's confirmed factor. Returns false if `step` was
   *  already consumed (replay) or there is no confirmed factor — used to enforce RFC 6238 §5.2 single-use codes. */
  markTotpStepUsed(userId: string, step: number): Promise<boolean>;
  /** Constitution 3 §66–67: spend one recovery code of this user (single use); false if none matched. Optional. */
  consumeRecoveryCode?(userId: string, code: string): Promise<boolean>;
  /** Update user status from 'invited' to 'active' on first successful password login. */
  activateUser?(userId: string): Promise<void>;
}

/* --------------------------------- in-memory --------------------------------- */
export interface MemTenant { id: string; tenantCode: string; status: TenantStatus; }
export interface MemUser extends LoginUserRecord { email: string | null; normalizedPhone: string | null; }
export interface MemSubscription { tenantId: string; status: SubStatus; }
export interface MemBranch { tenantId: string; }
export interface AuthSeed { tenants: MemTenant[]; users: MemUser[]; subscriptions: MemSubscription[]; branches: MemBranch[]; }

function matches(u: MemUser, id: NormalizedIdentifier): boolean {
  if (id.kind === 'email') return !!u.email && u.email.toLowerCase() === id.value;
  if (id.kind === 'phone') return !!u.normalizedPhone && u.normalizedPhone === id.value;
  return false; // 'unknown' never matches
}
function strip(u: MemUser): LoginUserRecord {
  const { email: _e, normalizedPhone, ...rec } = u;
  // Carry the phone through for the super-admin SMS second factor (auth-login.service reads (user).phone). Only the
  // super-admin branch uses it; for every other role it is simply ignored.
  (rec as { phone?: string | null }).phone = normalizedPhone;
  return rec;
}

export class InMemoryAuthUserRepository implements AuthUserRepository {
  constructor(private seed: AuthSeed) {}

  async findTenantUserForLogin(tenantCode: string, id: NormalizedIdentifier): Promise<LoginLookup> {
    const tenant = this.seed.tenants.find((t) => t.tenantCode === tenantCode);
    if (!tenant) return { tenantFound: false, branchCount: 0 };
    const user = this.seed.users.find((u) => u.tenantId === tenant.id && u.role !== 'SUPER_ADMIN' && u.role !== 'CUSTOMER' && matches(u, id));
    const subscriptionStatus = this.seed.subscriptions.find((s) => s.tenantId === tenant.id)?.status;
    const branchCount = this.seed.branches.filter((b) => b.tenantId === tenant.id).length;
    return { tenantFound: true, tenantStatus: tenant.status, user: user ? strip(user) : undefined, subscriptionStatus, branchCount };
  }

  async findSuperAdminForLogin(id: NormalizedIdentifier): Promise<{ user?: LoginUserRecord }> {
    const user = this.seed.users.find((u) => u.tenantId === null && u.role === 'SUPER_ADMIN' && matches(u, id));
    return { user: user ? strip(user) : undefined };
  }

  private lastTotpStep = new Map<string, number>();
  async markTotpStepUsed(userId: string, step: number): Promise<boolean> {
    const prev = this.lastTotpStep.get(userId);
    if (prev !== undefined && step <= prev) return false; // replay: this (or an earlier) step was already consumed
    this.lastTotpStep.set(userId, step);
    return true;
  }

  async activateUser(userId: string): Promise<void> {
    const u = this.seed.users.find((user) => user.userId === userId);
    if (u && u.status === 'invited') u.status = 'active';
  }
}

/** A customer with accounts at several salons signs in to their DEFAULT one — the most recently chosen (customer_default_at),
 *  then the existing order for accounts never chosen (Oct 3 2026; before, simply the first one found). */
export function pickDefaultSalon<T extends { defaultAt?: string | null }>(list: T[]): T {
  const at = (x: T) => (x.defaultAt ? Date.parse(x.defaultAt) : -Infinity);
  return list.reduce((best, x) => (at(x) > at(best) ? x : best), list[0]);
}
