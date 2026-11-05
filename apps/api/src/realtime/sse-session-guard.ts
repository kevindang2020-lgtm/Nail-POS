// sse-session-guard.ts — terminate a live SSE stream when its session is revoked.
//
// The gap this closes: authentication on an SSE endpoint is checked ONCE, at connect. The stream then stays open
// for hours. So revoking a compromised session would 401 that attacker's ordinary HTTP calls while their OPEN
// realtime stream kept pushing live salon data — queue changes, check-ins, checkouts — indefinitely. Revocation
// that doesn't reach the streams isn't really revocation.
//
// Usage: `return merge(events$, heartbeat$).pipe(untilSessionRevoked(req, sessions));`
//
// Behaviour:
//   • polls every 15s, so a revoked stream dies within ~15s (a stream is cheap to poll; the store caches).
//   • no session id (tokens minted before revocation support) → the stream is left alone, exactly as before.
//   • a lookup error does NOT kill the stream: a transient DB blip must not disconnect every user in the salon.
//   • Oct 12 2026 (Kevin's POS auto-lock, server-enforced): a LOCKED session's stream ends too — the reconnect gets 423 until the
//     PIN. Only POS sessions are ever idle-locked (or locked by the POS itself), so every other client's stream is unaffected.
import type { Observable } from 'rxjs';
import { interval, of } from 'rxjs';
import { switchMap, filter, take, takeUntil, catchError } from 'rxjs/operators';
import type { SessionStore } from '@aipowersalon/identity';

const POLL_MS = 15_000;

export function untilSessionRevoked<T>(req: any, sessions?: SessionStore) {
  return (source: Observable<T>): Observable<T> => {
    const sid: string | null = req?.sessionId ?? null;
    if (!sid || !sessions) return source;   // nothing to check — behave exactly as before

    const revoked$ = interval(POLL_MS).pipe(
      switchMap(async () => {
        if (await sessions.isRevoked(sid).catch(() => false)) return true;   // a DB blip must not disconnect everyone
        return sessions.lockedAt ? !!(await sessions.lockedAt(sid).catch(() => null)) : false;
      }),
      catchError(() => of(false)),
      filter((ended) => ended === true),
      take(1),
    );
    return source.pipe(takeUntil(revoked$));
  };
}
