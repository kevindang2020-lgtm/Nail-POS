// realtime-transport-core.ts — the SERVER transport's pure helpers (Constitution 9 §19/§20 ordering + idempotency,
// §31 backpressure, slow-client and connect limits). Split out of realtime-core.ts when the event contracts moved to
// packages/realtime-contracts (Constitution 13 §77): these are gateway/stream internals, not contracts a client needs.

// ── §19/§20 client-side ordering + idempotency, pure and testable ──────────────────────────────────────────
//
// Events can arrive twice (Redis redelivery, reconnect overlap) and out of order (two nodes, two sockets).
// The tracker answers one question per event: SHOULD THIS ONE BE APPLIED?
//   duplicate eventId              → no (idempotency)
//   older version for a resource   → no (an old event must not overwrite newer state)
//   otherwise                      → yes
// Bounded memory: both maps are LRU-capped so a day-long POS session cannot grow without limit.

export class EventTracker {
  private seen = new Map<string, true>();                     // eventId → seen (insertion-ordered = LRU)
  private versions = new Map<string, number>();               // resourceKey → highest applied version
  constructor(private readonly cap = 2000) {}

  shouldApply(e: { eventId?: string; resourceType?: string; resourceId?: string; version?: number }): boolean {
    if (e.eventId) {
      if (this.seen.has(e.eventId)) return false;             // §20 duplicate
      this.seen.set(e.eventId, true);
      if (this.seen.size > this.cap) this.seen.delete(this.seen.keys().next().value as string);
    }
    if (e.resourceType && e.resourceId && typeof e.version === 'number') {
      const key = `${e.resourceType}:${e.resourceId}`;
      const prev = this.versions.get(key);
      if (prev != null && e.version <= prev) return false;    // §19 stale version
      this.versions.set(key, e.version);
      if (this.versions.size > this.cap) this.versions.delete(this.versions.keys().next().value as string);
    }
    return true;
  }
}

// ── §31 backpressure: coalesce bursts into one refetch per screen ──────────────────────────────────────────
// 15 queue events inside 300ms should produce ONE refetch, not 15. Pure scheduler: callers provide the timer
// functions so tests drive time deterministically.

export class RefetchCoalescer {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly run: (screen: string) => void,
    private readonly windowMs = 250,
    private readonly setT: typeof setTimeout = setTimeout,
    private readonly clearT: typeof clearTimeout = clearTimeout,
  ) {}
  request(screen: string): void {
    if (this.pending.has(screen)) return;                     // a refetch is already scheduled — coalesce
    this.pending.set(screen, this.setT(() => { this.pending.delete(screen); this.run(screen); }, this.windowMs));
  }
  cancelAll(): void { for (const t of this.pending.values()) this.clearT(t); this.pending.clear(); }
}

/**
 * Constitution 9 §98/§102 — slow-client gate.
 *
 * The gateway must never buffer unlimited frames for a connection that is not draining (§253). The measure is
 * the connection's PENDING write bytes (Node's `writableLength`): above the cap, frames are DROPPED — not queued —
 * and the client is marked out of sync. Once it drains, it gets exactly one RESYNC_REQUIRED and reloads its
 * snapshot (§102: "client loads snapshot"); nothing that was dropped is replayed (§11). A client that stays
 * above the cap past the grace period is disconnected (§98 "disconnect unhealthy clients") — its reconnect
 * gets a fresh stream and a resync.
 */
export class SlowClientGate {
  private outOfSync = false;
  private aboveSince: number | null = null;
  dropped = 0;
  constructor(private readonly capBytes = 256 * 1024, private readonly graceMs = 30_000) {}
  /** Decide what to do with the next frame given the connection's current pending bytes. */
  admit(pendingBytes: number, now = Date.now()): 'send' | 'drop' | 'disconnect' {
    if (pendingBytes > this.capBytes) {
      this.outOfSync = true; this.dropped++;
      if (this.aboveSince === null) this.aboveSince = now;
      return now - this.aboveSince >= this.graceMs ? 'disconnect' : 'drop';
    }
    this.aboveSince = null;
    return 'send';
  }
  /** True exactly once, when a previously out-of-sync connection has drained: send RESYNC_REQUIRED now. */
  recovered(pendingBytes: number): boolean {
    if (!this.outOfSync || pendingBytes > this.capBytes) return false;
    this.outOfSync = false;
    return true;
  }
  get isOutOfSync(): boolean { return this.outOfSync; }
}

/**
 * Constitution 9 §38/§149/§150 — connection-attempt limiter.
 *
 * A reconnect storm (every POS in a salon reopening after a proxy blip, or one misbehaving client looping)
 * must not be able to exhaust the gateway. Sliding window per principal (user, or IP when unauthenticated):
 * more than `max` opens in `windowMs` are refused with a retry-after. Per-instance and in-memory on purpose:
 * it protects THIS process's event loop, which is the resource at risk; a fleet-wide budget would need the
 * Redis sorted-set shape already used by the login throttle, and is not justified until connection counts say so.
 */
export class ConnectLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly max = 30, private readonly windowMs = 60_000) {}
  /** Record an attempt; returns ok, or the ms until the oldest attempt in the window expires. */
  attempt(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
    const since = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (arr.length >= this.max) { this.hits.set(key, arr); return { ok: false, retryAfterMs: arr[0] + this.windowMs - now }; }
    arr.push(now); this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.hits.delete(this.hits.keys().next().value as string);   // bounded (§253)
    return { ok: true };
  }
}
