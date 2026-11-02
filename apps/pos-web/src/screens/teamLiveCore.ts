// teamLiveCore.ts — Team Management round 2A (TM-05): the pure rules behind the live indicator and the stale-answer guard.
export type LiveMode = 'live' | 'reconnecting' | 'polling';
type RealtimeStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' | 'DEGRADED';
/** CONNECTED → live; a first reconnect attempt → reconnecting; once a fallback poll has run, or the stream is offline /
 *  degraded → polling. Pure. */
export function liveModeOf(status: RealtimeStatus, polledWhileDown: boolean): LiveMode {
  if (status === 'CONNECTED') return 'live';
  if (status === 'OFFLINE' || status === 'DEGRADED' || polledWhileDown) return 'polling';
  return 'reconnecting';
}
/** an answer is stale when its server instant is strictly older than the one on screen. Pure. */
export function isStale(next: { asOf?: string | null } | null | undefined, cur: { asOf?: string | null } | null | undefined): boolean {
  const a = next?.asOf ? Date.parse(next.asOf) : NaN; const b = cur?.asOf ? Date.parse(cur.asOf) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}
