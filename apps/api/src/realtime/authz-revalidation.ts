// authz-revalidation.ts — Constitution 9 §42/§43/§44/§127/§128: a long-lived stream must not outlive the
// authorization it was opened with.
//
// The problem (§42): ctx.role / ctx.branchId come from the JWT. When an admin demotes a BRANCH_MANAGER, moves
// them to another branch, suspends the user, suspends the tenant (§43) or deactivates the branch (§44), every
// ordinary HTTP call starts failing at the next request — but an SSE stream opened an hour ago keeps streaming
// Branch B's queue to someone who no longer has Branch B. "Do not wait until next login."
//
// The mechanism (§127): an AUTHORIZATION VERSION per connection — a hash of exactly the facts authorization
// depends on (role, home branch, user status, branch-access set, tenant status, branch status). Recorded at
// connect, re-derived on the same 15 s poll the session-revocation guard already runs (§128 "periodically
// revalidate"). Any change terminates the stream; the client's normal reconnect re-authorizes from scratch
// through the guards, which now see the new facts. No new table, no new column: the version is derived from
// rows that already exist, so it cannot drift from what the HTTP guards enforce.
//
// Deliberately NOT part of the version: users.updated_at (no trigger maintains it, and a display-name edit must
// not kick a stream) and the permissions array in the JWT (it is derived from role; role is in the hash).
//
// Fail-open, like the session guard: a lookup error must not disconnect every user in the salon. A user or
// tenant that no longer EXISTS is a version change (null vs recorded) and does terminate.
import { createHash } from 'node:crypto';
import type { Observable } from 'rxjs';
import { interval, of } from 'rxjs';
import { switchMap, filter, take, takeUntil, catchError } from 'rxjs/operators';

export interface AuthzFacts {
  role: string;
  branchId: string | null;
  userStatus: string;
  tenantStatus: string;
  branchStatus: string | null;
  branchAccess: string[];        // sorted branch ids from user_branch_access
  /**
   * §225: the super-admin support session governing this connection, as an opaque token
   * (`supportSessionVersionPart`). 'none' or undefined for every ordinary user, so their version is unchanged
   * by this field existing. A session expiring, ending or being extended changes the token, which makes the
   * poll below terminate the stream — one mechanism, not a second timer.
   */
  supportSession?: string;
  /** BUILD_PLAN Phase 9: the role template, the live per-user overrides (id:effect:branch:expiry, sorted) and the two
   *  authorization versions (users / tenants, bumped by database triggers on every authority change). A narrowed template,
   *  a new DENY, a temporary grant or a salon's custom-role edit now ends a stream too — the role alone did not change. */
  templateKey?: string | null;
  overrides?: string[];
  userVersion?: number | null;
  tenantVersion?: number | null;
}

/** Port: how the gateway asks "what does this user's authorization look like RIGHT NOW". */
export interface AuthzVersionSource {
  facts(userId: string, tenantId: string): Promise<AuthzFacts | null>;
}

/** §127: the version is a stable hash of the facts — equal facts ⇒ equal version, on any instance. */
export function authzVersion(f: AuthzFacts | null): string {
  if (!f) return 'absent';
  const s = [f.role, f.branchId ?? '', f.userStatus, f.tenantStatus, f.branchStatus ?? '', [...f.branchAccess].sort().join(','), f.supportSession ?? 'none',
    f.templateKey ?? '', [...(f.overrides ?? [])].sort().join(','), f.userVersion ?? '', f.tenantVersion ?? ''].join('|');
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** §43/§44: some facts are terminal on their own — no comparison needed. */
export function isTerminal(f: AuthzFacts | null): boolean {
  if (!f) return true;
  if (f.userStatus !== 'active') return true;
  if (f.tenantStatus !== 'active') return true;
  if (f.branchId && f.branchStatus && f.branchStatus !== 'active') return true;
  return false;
}

export const AUTHZ_POLL_MS = 15_000;

/**
 * rxjs operator: complete the stream when the connection's authorization version changes or becomes terminal.
 * `initial()` returns the version recorded at connect (null until that lookup resolves, in which case only
 * terminal states are enforced on that tick).
 */
export function untilAuthzChanged<T>(
  userId: string | undefined,
  tenantId: string | undefined,
  source: AuthzVersionSource | undefined,
  initial: () => string | null,          // a getter: the connect-time lookup is async, so the value may arrive after the first tick
  onTerminate?: (reason: 'authz_changed' | 'terminal') => void,
  pollMs = AUTHZ_POLL_MS,
) {
  return (stream: Observable<T>): Observable<T> => {
    if (!userId || !tenantId || !source) return stream;      // nothing to check — behave exactly as before
    const changed$ = interval(pollMs).pipe(
      switchMap(async () => {
        try {
          const f = await source.facts(userId, tenantId);
          if (isTerminal(f)) return 'terminal' as const;
          const base = initial();
          if (base !== null && authzVersion(f) !== base) return 'authz_changed' as const;
          return null;
        } catch { return null; }                              // a DB blip must not disconnect everyone
      }),
      catchError(() => of(null)),
      filter((r): r is 'terminal' | 'authz_changed' => r !== null),
      take(1),
    );
    return stream.pipe(takeUntil(changed$.pipe(switchMap((r) => { onTerminate?.(r); return of(r); }))));
  };
}

/** The Kysely-backed source: one query, the same rows the HTTP guards read. */
export class KyselyAuthzVersionSource implements AuthzVersionSource {
  constructor(private readonly db: any) {}
  async facts(userId: string, tenantId: string): Promise<AuthzFacts | null> {
    const u = await this.db.selectFrom('users as u')
      .innerJoin('tenants as t', 't.id', 'u.tenant_id')
      .leftJoin('branches as b', 'b.id', 'u.branch_id')
      .select(['u.role', 'u.branch_id', 'u.status as user_status', 't.status as tenant_status', 'b.status as branch_status', 'u.authorization_version as user_version', 't.authorization_version as tenant_version'])
      .where('u.id', '=', userId).where('u.tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!u) return null;
    const rows = await this.db.selectFrom('user_branch_access').select('branch_id')
      .where('user_id', '=', userId).where('tenant_id', '=', tenantId).execute();
    const tpl = await this.db.selectFrom('staff_role_assignments').select('template_key')
      .where('user_id', '=', userId).where('tenant_id', '=', tenantId).executeTakeFirst();
    const ov = await this.db.selectFrom('tenant_user_permission_overrides').select(['id', 'effect', 'branch_id', 'expires_at'])
      .where('user_id', '=', userId).where('tenant_id', '=', tenantId).where('revoked_at', 'is', null).execute();
    return {
      role: String(u.role), branchId: u.branch_id ? String(u.branch_id) : null, userStatus: String(u.user_status),
      tenantStatus: String(u.tenant_status), branchStatus: u.branch_status == null ? null : String(u.branch_status),
      branchAccess: rows.map((r: any) => String(r.branch_id)).sort(),
      templateKey: tpl?.template_key ? String(tpl.template_key) : null,
      overrides: ov.map((r: any) => `${r.id}:${r.effect}:${r.branch_id ?? ''}:${r.expires_at ? new Date(r.expires_at).toISOString() : ''}`).sort(),
      userVersion: u.user_version == null ? null : Number(u.user_version), tenantVersion: u.tenant_version == null ? null : Number(u.tenant_version),
    };
  }
}
