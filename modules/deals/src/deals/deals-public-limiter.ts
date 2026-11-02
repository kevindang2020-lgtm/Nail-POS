// deals-public-limiter.ts — BUILD_PLAN Phase 5: the guest deal routes (nearby, a deal's page, an estimate) have no
// session, and the app's per-tenant limiter skips requests without a tenant. Without this, anyone could hammer the
// nearby query or inflate a deal's view count (each view is a row) from a script.
//   • 60 requests a minute per client address across the guest deal routes → 429.
//   • A deal's page counts as a view once per address per 30 minutes (refreshes are not views).
// Per API instance, in memory, bounded (oldest keys dropped past MAX_KEYS) — with N instances the effective budget is
// N × 60/min, which still stops a single script; the global edge limiter is the place for anything stronger.
const MAX_KEYS = 50_000;

export class DealsPublicLimiter {
  private readonly hits = new Map<string, { start: number; n: number }>();
  private readonly views = new Map<string, number>();
  constructor(private readonly perMinute = 60, private readonly viewWindowMs = 30 * 60_000, private readonly now: () => number = Date.now) {}

  /** true = allowed. */
  hit(addr: string): boolean {
    const t = this.now(); const k = addr || 'unknown';
    const cur = this.hits.get(k);
    if (!cur || t - cur.start >= 60_000) { this.put(this.hits, k, { start: t, n: 1 }); return true; }
    cur.n += 1;
    return cur.n <= this.perMinute;
  }

  /** true the first time this address opens this deal in the window — only then is it a view. */
  firstView(addr: string, dealId: string): boolean {
    const t = this.now(); const k = `${addr || 'unknown'}|${dealId}`;
    const at = this.views.get(k);
    if (at != null && t - at < this.viewWindowMs) return false;
    this.put(this.views, k, t);
    return true;
  }

  private put<V>(m: Map<string, V>, k: string, v: V) {
    m.delete(k); m.set(k, v);
    if (m.size > MAX_KEYS) { const first = m.keys().next().value; if (first !== undefined) m.delete(first); }
  }
}
