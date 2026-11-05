// support-session-realtime.ts — Constitution 9 §225: "Support session Tenant A cannot subscribe Tenant B.
// Expired support session loses streams."
//
// WHAT ALREADY EXISTS (and is reused, not rebuilt): `support_access_sessions` with `tenant_id`,
// `expires_at` and `ended_at`, plus `SupportSessionsService` which creates and ends them. This file adds only
// the realtime half — nothing about the session model itself is duplicated.
//
// THE TWO RULES, and why they are different mechanisms:
//
//   1. SCOPE is decided at SUBSCRIBE time. A support session is granted for ONE tenant; a stream for any other
//      tenant must be refused outright. This is a check, not a version — there is nothing to re-derive.
//
//   2. EXPIRY must terminate a stream ALREADY OPEN. A support session that expires at 14:00 and a stream
//      opened at 13:55 is exactly the §42 problem the authz-revalidation poll exists for: the authorization
//      ends, but the socket does not notice. So expiry is folded into the AUTHORIZATION VERSION rather than
//      given its own timer — one poll, one mechanism, and it cannot drift from the guard that already runs.
//
// The version treats an expired, ended or missing session as a DIFFERENT value from a live one, so the
// existing `untilAuthzChanged` terminates the stream on the next 15 s tick without any new machinery.
import { createHash } from 'node:crypto';

export interface SupportSessionFacts {
  sessionId: string;
  /** The ONE tenant this session may act on. */
  tenantId: string;
  expiresAt: string;
  endedAt: string | null;
}

/** Port: how the gateway asks "is there a live support session for this super admin right now". */
export interface SupportSessionSource {
  activeSessionFor(superAdminUserId: string, now: Date): Promise<SupportSessionFacts | null>;
}

export class SupportSessionScopeError extends Error {
  readonly status = 403;
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SupportSessionScopeError';
  }
}

export function isLive(s: SupportSessionFacts | null, now: Date): boolean {
  if (!s) return false;
  if (s.endedAt !== null) return false;
  return new Date(s.expiresAt).getTime() > now.getTime();
}

/**
 * §225 rule 1, at subscribe time. Throws rather than returning false: a refused subscription must not be
 * mistakable for an empty stream.
 *
 * A super admin WITHOUT a support session is unchanged by this — platform channels are theirs by role, and
 * `requireSupportSession` is only consulted for a TENANT-scoped room. That is deliberate: making a support
 * session mandatory for platform rooms would break the Super Admin live-ops screens, which is a different
 * question from tenant data access.
 */
export function assertSupportScope(session: SupportSessionFacts | null, targetTenantId: string, now: Date): SupportSessionFacts {
  if (!session) throw new SupportSessionScopeError('no active support session — a super admin needs one to subscribe to a tenant stream', 'support_session_required');
  if (!isLive(session, now)) {
    throw new SupportSessionScopeError(
      session.endedAt !== null ? 'support session has ended' : 'support session has expired',
      session.endedAt !== null ? 'support_session_ended' : 'support_session_expired',
    );
  }
  if (session.tenantId !== targetTenantId) {
    // The heart of §225. A live session for Tenant A is not a key to Tenant B.
    throw new SupportSessionScopeError('support session is scoped to a different tenant', 'support_session_wrong_tenant');
  }
  return session;
}

/**
 * §225 rule 2 — the contribution to the connection's authorization version.
 *
 * Returns a stable token for a live session and a DIFFERENT one the moment it expires or ends, so the existing
 * 15 s revalidation poll terminates the stream. The expiry timestamp is part of the hash: extending a session
 * is also an authorization change, and the client simply reconnects with the new window.
 *
 * `none` for a connection with no support session, so ordinary users and un-scoped super admins hash stably.
 */
export function supportSessionVersionPart(session: SupportSessionFacts | null, now: Date): string {
  if (!session) return 'none';
  if (!isLive(session, now)) return `dead:${session.sessionId}`;
  return createHash('sha256').update(`${session.sessionId}|${session.tenantId}|${session.expiresAt}`).digest('hex').slice(0, 16);
}

/** Reads the existing table. No writes: creating and ending sessions stays with SupportSessionsService. */
export class KyselySupportSessionSource implements SupportSessionSource {
  constructor(private readonly db: unknown | null) {}
  async activeSessionFor(superAdminUserId: string, now: Date): Promise<SupportSessionFacts | null> {
    if (!this.db) return null;
    const db = this.db as { selectFrom: (t: string) => any };
    try {
      // Constitution 7: ONE Support Mode store (support_access_sessions). The legacy super_admin_support_sessions rows
      // were copied into it and the table dropped (migration 541, BUILD_PLAN Phase 10).
      const row = await db.selectFrom('support_access_sessions')
        .select(['id', 'tenant_id', 'expires_at', 'ended_at', 'started_at'])
        .where('admin_user_id', '=', superAdminUserId)
        .where('ended_at', 'is', null)
        .where('expires_at', '>', now)
        .orderBy('started_at', 'desc')
        .executeTakeFirst();
      if (!row) return null;
      return {
        sessionId: String(row.id), tenantId: String(row.tenant_id),
        expiresAt: new Date(row.expires_at).toISOString(),
        endedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
      };
    } catch {
      // Fail CLOSED here, unlike the authz poll. That poll fails open because a lookup error must not
      // disconnect an entire salon of ordinary staff; this one governs a super admin reaching into a tenant's
      // data, where the safe answer to "I could not check" is no.
      return null;
    }
  }
}
