// core.ts — @aipowersalon/realtime-client: the pure, transport-free core shared by every app (Constitution 9 §174).
//
// The event registry (EVENTS, EVENT_VERSIONS, rooms, event→screen routing) is NOT copied here any more: it is the one
// registry in @aipowersalon/realtime-contracts (Constitution 13 §77), the same module apps/api emits from. Before that
// package existed this file carried a verbatim copy guarded by a parity test — and before THAT, the POS copy had
// drifted 27 names behind the server. Re-exported so every app keeps importing it from here.
export { EVENTS, EVENT_VERSIONS, eventVersion, rooms, screensToRefetch, type EventName } from '@aipowersalon/realtime-contracts';

// ── P2 (Jul 27, 2026): pure, testable resilience pieces — the EventSource shell stays thin ─────────────────

// §18 connection states. DEGRADED = repeated failures; screens switch to fallback polling until recovery.
export type RealtimeStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE' | 'DEGRADED';

// §29/§30 reconnect delay: exponential backoff with full jitter, bounded. attempt is 1-based.
export function reconnectDelayMs(attempt: number, baseMs = 1000, capMs = 30000, rand: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.floor(exp / 2 + rand() * (exp / 2));            // 50–100% of the exponential step — herd spreads out
}

/** The connection brain, free of EventSource so it runs under jsdom/vitest.
 *  Feed it transport facts (opened / errored / network offline / online); it answers with the §18 status,
 *  whether a §15 reconciliation refetch is owed, and when to try reconnecting next. */
export class ConnectionStateMachine {
  status: RealtimeStatus = 'RECONNECTING';                    // until the first hello, we are trying — not lying
  attempts = 0;
  private everConnected = false;
  private wasDisrupted = false;
  constructor(private readonly degradeAfter = 3) {}

  opened(): { reconcile: boolean } {
    const reconcile = this.wasDisrupted && this.everConnected; // §15: missed-window refetch only after a REAL gap
    this.status = 'CONNECTED';
    this.attempts = 0;
    this.everConnected = true;
    this.wasDisrupted = false;
    return { reconcile };
  }
  errored(): { retryInMs: number } {
    this.attempts += 1;
    this.wasDisrupted = true;
    this.status = this.attempts >= this.degradeAfter ? 'DEGRADED' : 'RECONNECTING';
    return { retryInMs: reconnectDelayMs(this.attempts) };
  }
  networkOffline(): void { this.wasDisrupted = true; this.status = 'OFFLINE'; }
  networkOnline(): { retryNow: boolean } { if (this.status === 'OFFLINE') this.status = 'RECONNECTING'; return { retryNow: true }; }
}

// §17 tab-resume: refetch only when the tab was hidden long enough that state is plausibly stale.
export function shouldRefreshOnVisible(hiddenAtMs: number | null, nowMs: number, staleThresholdMs = 30000): boolean {
  return hiddenAtMs != null && nowMs - hiddenAtMs >= staleThresholdMs;
}

// §19/§20 — mirror of the server-side tracker (kept in both cores by design, like the screens map).
export class EventTracker {
  private seen = new Map<string, true>();
  private versions = new Map<string, number>();
  constructor(private readonly cap = 2000) {}
  /** `resourceVersion` (§43, Oct 28 2026): the server's projected aggregate version. Several events of ONE change can share a
   *  version (ticket paid + payment recorded), so only a STRICTLY older frame is stale; an exact duplicate is the eventId's job. */
  shouldApply(e: { eventId?: string; resourceType?: string; resourceId?: string; version?: number; resourceVersion?: number | null }): boolean {
    if (e.eventId) {
      if (this.seen.has(e.eventId)) return false;
      this.seen.set(e.eventId, true);
      if (this.seen.size > this.cap) this.seen.delete(this.seen.keys().next().value as string);
    }
    if (e.resourceType && e.resourceId && typeof e.version === 'number') {
      const key = `${e.resourceType}:${e.resourceId}`;
      const prev = this.versions.get(key);
      if (prev != null && e.version <= prev) return false;
      this.versions.set(key, e.version);
      if (this.versions.size > this.cap) this.versions.delete(this.versions.keys().next().value as string);
    } else if (e.resourceType && e.resourceId && typeof e.resourceVersion === 'number') {
      const key = `rv:${e.resourceType}:${e.resourceId}`;
      const prev = this.versions.get(key);
      if (prev != null && e.resourceVersion < prev) return false;   // an older state arriving late (lanes / reconnect replay): never repaint it
      if (prev == null || e.resourceVersion > prev) this.versions.set(key, e.resourceVersion);
      if (this.versions.size > this.cap) this.versions.delete(this.versions.keys().next().value as string);
    }
    return true;
  }
}

// §31 — one refetch per screen per window, not one per event.
export class RefetchCoalescer {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  // The timer functions are called UNBOUND (see the note in sync-policy.ts): `this.setT(...)` handed the browser's
  // setTimeout `this` = the coalescer and Chromium threw "Illegal invocation" on the first realtime event — the refetch
  // an event should trigger never ran in a real browser (since Sep 19 2026; invisible to Node/jsdom tests).
  private readonly setT: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearT: (t: ReturnType<typeof setTimeout>) => void;
  constructor(private readonly run: (screen: string) => void, private readonly windowMs = 250,
              setT: typeof setTimeout = setTimeout, clearT: typeof clearTimeout = clearTimeout) {
    this.setT = (fn, ms) => { const f = setT; return f(fn, ms); };
    this.clearT = (h) => { const f = clearT; f(h); };
  }
  request(screen: string): void {
    if (this.pending.has(screen)) return;
    this.pending.set(screen, this.setT(() => { this.pending.delete(screen); this.run(screen); }, this.windowMs));
  }
  cancelAll(): void { for (const t of this.pending.values()) this.clearT(t); this.pending.clear(); }
}

/**
 * Constitution 9 §31–33 — per-stream sequence tracking on the client.
 *
 * The server numbers every frame per room (monotonic, gap-free at the origin). The client's only job is to
 * notice an ABSENCE: 1021 then 1023 means 1022 was lost somewhere between the gateway and this tab, and the
 * stream is no longer trustworthy until a snapshot is reloaded (§34). §253: never silently accept a gap.
 *
 * Pure and side-effect free so it can be tested without an EventSource, and shared by every app's client.
 */
export class SequenceTracker {
  private last = -1;                    // -1: no baseline yet (first frame after connect sets it)
  /** Adopt the server's stated position on connect / after a resync — nothing before it can be "missed". */
  baseline(seq: number): void { if (Number.isFinite(seq)) this.last = seq; }
  /** Feed the seq of a received frame. 'gap' means at least one frame between the previous and this one was lost. */
  observe(seq: unknown): 'ok' | 'gap' | 'duplicate' | 'ignored' {
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return 'ignored';
    if (this.last < 0) { this.last = seq; return 'ok'; }
    if (seq <= this.last) return 'duplicate';          // already seen (or a replay of an older frame): never a gap, never applied twice
    const gap = seq > this.last + 1;
    this.last = seq;
    return gap ? 'gap' : 'ok';
  }
  get lastSeq(): number { return this.last; }
}
