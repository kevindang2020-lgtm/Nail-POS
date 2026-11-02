// support-session-gate.ts — BUILD_PLAN Phase 14 (Constitution 12 "Support Mode expires"; Constitution 9 §225).
//
// A Super Admin support session (support_access_sessions: one tenant, expires_at, ended_at) is the ONLY thing that may
// ever let a platform person act inside a salon. Today no request path grants access through one — sessions are opened,
// noticed to the owner, extended and ended, but nothing reads one to let a request through. That is exactly the moment
// to put the check in the one place a grant would have to pass, so a future grant cannot skip expiry:
//
//   • TenantContextMiddleware — a session token that carries a support-session id (claim `ssid`) is admitted only while
//     THAT session is live, for THAT admin and THAT salon (assertLiveSupportSession below); otherwise 403 and the
//     request never reaches a controller. req.ctx.supportSessionId is set ONLY from a session verified here — never
//     from the client.
//   • RealtimeStreamFactory — a stream opened under a support session ends when the session expires or is ended
//     (untilSupportSessionDead, polled with the same 15 s cadence as the authorization revalidation).
//
// Fail CLOSED: a lookup error, a missing database or an unknown id refuses — the safe answer to "I could not check
// whether a platform person may be in this salon" is no.
import { Observable, interval, of, from } from 'rxjs';
import { catchError, filter, switchMap, take, takeUntil } from 'rxjs/operators';
import { SupportSessionScopeError, assertSupportScope, isLive, type SupportSessionFacts } from '../realtime/support-session-realtime';

export const SUPPORT_SESSION_GATE = 'SUPPORT_SESSION_GATE';

export interface SupportSessionLookup {
  /** The session row by id with its admin, or null. Throws on a lookup error. */
  byId(sessionId: string): Promise<(SupportSessionFacts & { adminUserId: string }) | null>;
}

export class KyselySupportSessionLookup implements SupportSessionLookup {
  constructor(private readonly db: any | null) {}
  async byId(sessionId: string): Promise<(SupportSessionFacts & { adminUserId: string }) | null> {
    if (!this.db) throw new Error('no database: support sessions cannot be verified');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return null;
    const row = await this.db.selectFrom('support_access_sessions').select(['id', 'tenant_id', 'admin_user_id', 'expires_at', 'ended_at'])
      .where('id', '=', sessionId).executeTakeFirst();
    if (!row) return null;
    return {
      sessionId: String(row.id), tenantId: String(row.tenant_id), adminUserId: String(row.admin_user_id),
      expiresAt: new Date(row.expires_at).toISOString(), endedAt: row.ended_at == null ? null : new Date(row.ended_at).toISOString(),
    };
  }
}

/** The check every support-session grant passes: the session exists, is the caller's own, is for this salon, and is
 *  neither ended nor expired. Throws SupportSessionScopeError (403) otherwise — including on any lookup failure. */
export async function assertLiveSupportSession(lookup: SupportSessionLookup | null | undefined, sessionId: string, adminUserId: string, tenantId: string, now: Date = new Date()): Promise<SupportSessionFacts> {
  let s: (SupportSessionFacts & { adminUserId: string }) | null;
  try { s = lookup ? await lookup.byId(sessionId) : null; }
  catch { throw new SupportSessionScopeError('the support session could not be verified', 'support_session_unverifiable'); }
  if (!lookup) throw new SupportSessionScopeError('the support session could not be verified', 'support_session_unverifiable');
  if (!s) throw new SupportSessionScopeError('no such support session', 'support_session_required');
  if (s.adminUserId !== adminUserId) throw new SupportSessionScopeError('the support session belongs to another admin', 'support_session_not_yours');
  return assertSupportScope(s, tenantId, now);
}

/** rxjs operator: complete a stream when its support session stops being live (expired, ended, deleted, unverifiable). */
export function untilSupportSessionDead<T>(lookup: SupportSessionLookup | null | undefined, sessionId: string | null | undefined, onEnd?: () => void, pollMs = 15_000, now: () => Date = () => new Date()) {
  return (stream: Observable<T>): Observable<T> => {
    if (!sessionId) return stream;   // not a support-session connection — unchanged
    const dead$ = interval(pollMs).pipe(
      switchMap(() => from((async () => {
        try { const s = lookup ? await lookup.byId(sessionId) : null; return !isLive(s, now()); }
        catch { return true; }       // fail closed
      })())),
      catchError(() => of(true)),
      filter((d) => d), take(1),
    );
    return stream.pipe(takeUntil(dead$.pipe(switchMap((d) => { onEnd?.(); return of(d); }))));
  };
}
