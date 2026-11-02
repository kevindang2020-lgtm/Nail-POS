// context.ts — Constitution 13 §72–74. Everything a request or a job knows about WHO is acting and FOR WHICH SALON.
//
// Built on what the API already did, in one place: TenantContextMiddleware derived `req.ctx` from the verified session
// (that block is now contextFromSession), and sixteen schedulers, sweeps and inbound handlers each hand-built a
// "system" context of their own shape ({ userId: 'system', role: 'system' } as any …) — that is systemContext now.
// Roles are the permissions package's business, so the shapes are generic over the role type: permissions defines
// `Ctx = TenantContext<Role>`; this package depends on nothing.

/** The trusted context of a request: which salon and branch, which user, with which role and permissions. Set once by
 *  the API's tenant-context middleware from a verified session — never from anything the client sent (§74). */
export interface TenantContext<R extends string = string> {
  tenantId: string;
  branchId: string;
  userId: string;
  role: R;
  permissions: string[];
  /** Security Deep Scan §36: the realm the principal acts in, set by the middleware from the VERIFIED principal (never
   *  inferred later from a path or a client value). Optional: system / worker contexts and tests may omit it. */
  realm?: SecurityRealm;
  /** Security Deep Scan §36: the device the session was opened on (auth_devices.id from the session row), or null. */
  deviceId?: string | null;
}

/** Security Deep Scan §36 / §49: the security realms. */
export type SecurityRealm = 'EMPLOYEE' | 'PLATFORM' | 'CUSTOMER' | 'DEVICE' | 'INTEGRATION' | 'SERVICE';
/** The realm a verified role acts in. */
export function realmOfRole(role: string | null | undefined): SecurityRealm {
  const r = String(role ?? '').toUpperCase();
  if (r === 'SUPER_ADMIN') return 'PLATFORM';
  if (r === 'CUSTOMER') return 'CUSTOMER';
  if (r === 'CUSTOMER_DISPLAY' || r === 'DISPLAY_DEVICE' || r === 'KIOSK') return 'DEVICE';
  if (r === 'INTEGRATION') return 'INTEGRATION';
  if (r === 'SYSTEM' || r === 'SERVICE') return 'SERVICE';
  return 'EMPLOYEE';
}

/** The salon + branch pair on its own (cache keys, rooms, scoped reads). */
export interface BranchContext { tenantId: string; branchId: string }

/** A request's context plus what long-lived connections need to re-check it (SSE revalidates the session id). */
export interface RequestContext<R extends string = string> extends TenantContext<R> { sessionId: string | null; /** Constitution 7 §19 — signed session restriction, e.g. SUSPENDED_BILLING_ONLY */ restriction?: string | null }

/** What a verified session carries. Shaped by the auth package's token / cookie session; only these fields matter here. */
export interface VerifiedSession<R extends string = string> {
  tenantId?: string | null;
  branchId?: string | null;
  userId: string;
  role: R;
  permissions?: string[] | null;
  sid?: string | null;
  restriction?: string | null;
}

/** THE derivation of a request's context from its verified session — the one place `req.ctx` is built. A missing
 *  tenant or branch becomes '' (a platform actor), never undefined, so every downstream comparison is a string
 *  comparison; permissions default to none. */
export function contextFromSession<R extends string>(session: VerifiedSession<R>): RequestContext<R> {
  return {
    tenantId: session.tenantId ?? '',
    branchId: session.branchId ?? '',
    userId: session.userId,
    role: session.role,
    permissions: session.permissions || [],
    sessionId: session.sid ?? null,
    restriction: session.restriction ?? null,
  };
}

/** The role every system actor carries. Not a user role: RBAC never grants it a permission, and any service that
 *  authorizes by role must treat it deliberately (a job acting for a salon is not that salon's owner). */
export const SYSTEM_ROLE = 'SYSTEM' as const;

/** A worker, scheduler, webhook or sweep acting FOR a tenant with no user behind it (§72 "worker tenant context").
 *  `actor` names the job so audit rows and logs say which system did it ('system:reminders'). */
export interface SystemContext extends TenantContext<typeof SYSTEM_ROLE> { actor: string }

/** THE factory for a system context. Exactly one shape, however many jobs there are. */
export function systemContext(input: { tenantId: string; branchId?: string | null; actor: string; permissions?: string[] }): SystemContext {
  const actor = input.actor.trim();
  if (!actor) throw new Error('systemContext: actor is required (the job or handler acting, e.g. "reminders")');
  return {
    tenantId: input.tenantId ?? '',
    branchId: input.branchId ?? '',
    userId: `system:${actor}`,
    role: SYSTEM_ROLE,
    permissions: input.permissions ? [...input.permissions] : [],
    actor,
  };
}

export const isSystemContext = (ctx: { role?: unknown } | null | undefined): ctx is SystemContext => !!ctx && (ctx as any).role === SYSTEM_ROLE;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request's branch as a value a UUID column can take: the id, or null. The context keeps '' for "no branch"
 *  (string comparisons stay simple); writing that '' into a `branch_id UUID` column fails the insert — after an SMS was
 *  already billed, or into a write whose error was swallowed into a phantom row (found Oct 6 2026 in four modules).
 *  Every write of a context branch goes through this. */
export function branchOrNull(branchId: string | null | undefined): string | null {
  const b = typeof branchId === 'string' ? branchId.trim() : '';
  return UUID_RE.test(b) ? b : null;
}
