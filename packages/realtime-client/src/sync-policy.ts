// sync-policy.ts — the ONE place the platform's refresh cadences live (Smooth Refresh spec §6, §81, §82, §96).
//
// Three layers, in this order of authority:
//   1. realtime push (SSE) — immediate; the primary mechanism (§17)
//   2. POS background safety sync — every 15 s ± 2 s jitter while the tab is visible (§4, §37), 60 s while hidden (§40),
//      immediately on focus / reconnect (§41, §42); a safety net for missed events, NOT the primary mechanism (§19)
//   3. server reconciliation — every ~20 s in the worker process (§5, §34) — see apps/api SyncReconciliationWorker
//
// Nothing here ever reloads a page, clears data, or shows a spinner (§1, §20). A tick only calls the screen's own
// refetch, which replaces state in place. Overlapping ticks are skipped (single-flight, §44): when a refetch is still
// in flight the next tick is dropped and counted, never queued behind it.

export const SYNC_POLICY = {
  /** §4/§82: active operational screens (booking, queue, serving, checkout, technician status). */
  operationalMs: 15_000,
  /** §37: ±2 s so many POS devices do not hit the API in the same millisecond. */
  jitterMs: 2_000,
  /** §40/§96: hidden browser tab — noncritical cadence. */
  hiddenMs: 60_000,
  /** §81: customer detail / inventory summary while visible. */
  detailMs: 45_000,
  /** §81: historical reports / analytics — manual or 1–5 min. */
  reportsMs: 120_000,
  /** §31 (Jul-27 standard): a burst of realtime events → one refetch. */
  coalesceMs: 250,
  /** §83: server reconciliation cadence (worker). Kept here so the client and server agree in one file. */
  serverReconciliationMs: 20_000,
} as const;

/** `base ± jitter`, uniformly. `rand` is injectable for tests. */
export function jittered(baseMs: number, jitterMs: number, rand: () => number = Math.random): number {
  const j = Math.max(0, jitterMs);
  return Math.max(1_000, Math.round(baseMs + (rand() * 2 - 1) * j));
}

export type SyncTickReason = 'interval' | 'focus' | 'reconnect' | 'reconcile' | 'manual' | 'visible';

export interface SafetySyncOptions {
  intervalMs?: number;          // default SYNC_POLICY.operationalMs
  jitterMs?: number;            // default SYNC_POLICY.jitterMs
  hiddenMs?: number;            // default SYNC_POLICY.hiddenMs; 0 = suspend entirely while hidden
  isHidden?: () => boolean;     // default: document.hidden when a document exists
  now?: () => number;
  rand?: () => number;
  setT?: typeof setTimeout;
  clearT?: typeof clearTimeout;
  /** Called after every tick outcome — feeds the status store / metrics (§100). */
  onOutcome?: (o: SyncOutcome) => void;
}

export interface SyncOutcome {
  reason: SyncTickReason;
  result: 'ok' | 'error' | 'skipped_inflight' | 'skipped_hidden';
  durationMs: number;
  at: number;
  error?: unknown;
}

/**
 * Always-on safety revalidation for one screen (one instance per hook user).
 *   • jittered interval while visible, slower interval while hidden (never a page refresh — it only calls `run`)
 *   • `nudge(reason)` = immediate tick (focus / reconnect / reconcile / manual), single-flight like any other tick
 *   • single-flight: if `run` returned a promise that has not settled, the tick is skipped and counted
 *   • `stop()` disarms every timer (safe to call twice)
 */
export class SafetySync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private stopped = false;
  private hidden = false;
  lastSyncedAt: number | null = null;
  lastError: unknown = null;
  readonly counters = { ok: 0, error: 0, skippedInflight: 0, skippedHidden: 0 };

  constructor(private readonly run: (reason: SyncTickReason) => unknown, private readonly opts: SafetySyncOptions = {}) {
    this.hidden = !!opts.isHidden?.();
  }

  // Timer functions are ALWAYS called unbound (`this` = undefined). A browser's setTimeout/clearTimeout throw
  // "Illegal invocation" when called as a method of another object (`this.setT(...)` passes `this` = this SafetySync);
  // Node and jsdom do not check, so every unit test passed while every POS screen crashed in Chromium (found Sep 30 2026
  // by the real-browser profiling harness). Pinned by the strict-timer test in sync-policy.test.ts.
  private now(): number { const f = this.opts.now ?? Date.now; return f(); }
  private setT(fn: () => void, ms: number): ReturnType<typeof setTimeout> { const f = this.opts.setT ?? setTimeout; return f(fn, ms); }
  private clearT(t: ReturnType<typeof setTimeout>): void { const f = this.opts.clearT ?? clearTimeout; f(t); }

  private nextDelay(): number {
    const base = this.hidden ? (this.opts.hiddenMs ?? SYNC_POLICY.hiddenMs) : (this.opts.intervalMs ?? SYNC_POLICY.operationalMs);
    return jittered(base, this.hidden ? 0 : (this.opts.jitterMs ?? SYNC_POLICY.jitterMs), this.opts.rand);
  }

  start(): this {
    this.stopped = false;
    this.arm();
    return this;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { this.clearT(this.timer); this.timer = null; }
  }

  private arm(): void {
    if (this.stopped) return;
    if (this.timer) { this.clearT(this.timer); this.timer = null; }
    if (this.hidden && (this.opts.hiddenMs ?? SYNC_POLICY.hiddenMs) === 0) return;   // §40: suspend while hidden
    if ((this.opts.intervalMs ?? SYNC_POLICY.operationalMs) <= 0) return;             // events-only mode: no timer at all
    this.timer = this.setT(() => { this.timer = null; void this.tick('interval'); this.arm(); }, this.nextDelay());
  }

  /** §40/§41: the tab's visibility changed. Returning to a visible tab with a stale screen syncs immediately. */
  visibilityChanged(hidden: boolean): void {
    const was = this.hidden;
    this.hidden = hidden;
    if (was && !hidden) {
      const interval = this.opts.intervalMs ?? SYNC_POLICY.operationalMs;
      const stale = interval > 0 && (this.lastSyncedAt == null || this.now() - this.lastSyncedAt >= interval);
      if (stale) void this.tick('visible');
    }
    this.arm();
  }

  /** Immediate tick (focus / reconnect / reconcile / manual). */
  nudge(reason: SyncTickReason): void { void this.tick(reason); this.arm(); }

  private async tick(reason: SyncTickReason): Promise<void> {
    const at = this.now();
    if (this.inFlight) { this.counters.skippedInflight++; this.opts.onOutcome?.({ reason, result: 'skipped_inflight', durationMs: 0, at }); return; }
    if (this.hidden && reason === 'interval' && (this.opts.hiddenMs ?? SYNC_POLICY.hiddenMs) === 0) {
      this.counters.skippedHidden++; this.opts.onOutcome?.({ reason, result: 'skipped_hidden', durationMs: 0, at }); return;
    }
    this.inFlight = true;
    try {
      const r = this.run(reason);
      if (r && typeof (r as Promise<unknown>).then === 'function') await (r as Promise<unknown>);
      this.lastSyncedAt = this.now(); this.lastError = null; this.counters.ok++;
      this.opts.onOutcome?.({ reason, result: 'ok', durationMs: this.lastSyncedAt - at, at });
    } catch (e) {
      this.lastError = e; this.counters.error++;
      this.opts.onOutcome?.({ reason, result: 'error', durationMs: this.now() - at, at, error: e });
    } finally {
      this.inFlight = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Global sync status — one small store per app so the indicator (§23/§92) and the metrics (§100) do not require
// every screen to re-render on every tick. Screens never read it; the status pill and diagnostics do.
// ---------------------------------------------------------------------------------------------------------------
export interface SyncStatusSnapshot {
  inFlight: number;
  lastSyncedAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  ticks: number;
  errors: number;
  skippedInflight: number;
  /** §100: background-fetch duration summary over the last `capacity` completed ticks. */
  durationMs: { count: number; p50: number; p95: number; max: number };
  /** §100: what background syncs actually downloaded / found changed (screens that report it — the change feed does). */
  payload: { samples: number; bytesTotal: number; bytesP50: number; bytesMax: number; recordsChangedTotal: number; emptyTicks: number; resyncs: number };
}

export class SyncStatusStore {
  private listeners = new Set<(s: SyncStatusSnapshot) => void>();
  private durations: number[] = [];
  private inFlight = 0;
  private lastSyncedAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;
  private ticks = 0; private errors = 0; private skippedInflight = 0;
  private bytes: number[] = []; private bytesTotal = 0; private recordsChangedTotal = 0; private emptyTicks = 0; private resyncs = 0;
  constructor(private readonly capacity = 200) {}

  /** §100: a background sync reports what it downloaded and how many records had changed (0 = a quiet tick). */
  recordPayload(p: { bytes: number; recordsChanged: number }): void {
    const b = Math.max(0, Math.round(p.bytes || 0));
    this.bytes.push(b); if (this.bytes.length > this.capacity) this.bytes.shift();
    this.bytesTotal += b; this.recordsChangedTotal += Math.max(0, p.recordsChanged | 0);
    if (!p.recordsChanged) this.emptyTicks++;
    this.emit();
  }
  /** §26/§27: the server answered RESYNC_REQUIRED and a snapshot was loaded instead of a delta. */
  recordResync(): void { this.resyncs++; this.emit(); }

  record(o: SyncOutcome): void {
    if (o.result === 'skipped_inflight') { this.skippedInflight++; this.emit(); return; }
    if (o.result === 'skipped_hidden') return;
    this.ticks++;
    if (o.result === 'ok') {
      this.lastSyncedAt = o.at + o.durationMs;
      this.durations.push(o.durationMs); if (this.durations.length > this.capacity) this.durations.shift();
    } else {
      this.errors++; this.lastErrorAt = o.at;
      this.lastError = o.error instanceof Error ? o.error.message : (o.error ? String(o.error) : 'refresh failed');
    }
    this.emit();
  }
  begin(): void { this.inFlight++; this.emit(); }
  end(): void { this.inFlight = Math.max(0, this.inFlight - 1); this.emit(); }

  snapshot(): SyncStatusSnapshot {
    const d = [...this.durations].sort((a, b) => a - b);
    const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : 0);
    return {
      inFlight: this.inFlight, lastSyncedAt: this.lastSyncedAt, lastErrorAt: this.lastErrorAt, lastError: this.lastError,
      ticks: this.ticks, errors: this.errors, skippedInflight: this.skippedInflight,
      durationMs: { count: d.length, p50: q(0.5), p95: q(0.95), max: d.length ? d[d.length - 1] : 0 },
      payload: (() => { const b = [...this.bytes].sort((x, y) => x - y); return { samples: b.length, bytesTotal: this.bytesTotal,
        bytesP50: b.length ? b[Math.floor(0.5 * (b.length - 1))] : 0, bytesMax: b.length ? b[b.length - 1] : 0,
        recordsChangedTotal: this.recordsChangedTotal, emptyTicks: this.emptyTicks, resyncs: this.resyncs }; })(),
    };
  }
  subscribe(fn: (s: SyncStatusSnapshot) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(): void { const s = this.snapshot(); this.listeners.forEach((l) => { try { l(s); } catch { /* a listener must not break syncing */ } }); }
  reset(): void { this.durations = []; this.inFlight = 0; this.lastSyncedAt = null; this.lastErrorAt = null; this.lastError = null; this.ticks = this.errors = this.skippedInflight = 0; this.bytes = []; this.bytesTotal = this.recordsChangedTotal = this.emptyTicks = this.resyncs = 0; this.emit(); }
}

/** "Last synced 12s ago" / "Couldn't refresh" — text for the small indicator (§23/§92); null when nothing to say. */
export function syncIndicatorText(s: SyncStatusSnapshot, now: number): string | null {
  if (s.lastErrorAt != null && (s.lastSyncedAt == null || s.lastErrorAt > s.lastSyncedAt)) {
    return s.lastSyncedAt == null ? "Couldn't refresh" : `Couldn't refresh — showing data from ${relative(now - s.lastSyncedAt)}`;
  }
  if (s.inFlight > 0 && s.lastSyncedAt == null) return 'Syncing…';
  return null;
}

/** Vietnamese POS §21 (Oct 27 2026): the same indicator as a code + vars (structurally @aipowersalon/api-contracts
 *  CodedText — this package does not depend on it), so an app words it in its own language (POS: srv.SYNC.*). The
 *  English of syncIndicatorText is unchanged for the apps that show it as is. */
export function syncIndicatorCoded(s: SyncStatusSnapshot, now: number): { code: string; vars?: Record<string, number> } | null {
  if (s.lastErrorAt != null && (s.lastSyncedAt == null || s.lastErrorAt > s.lastSyncedAt)) {
    if (s.lastSyncedAt == null) return { code: 'SYNC.FAILED' };
    const sec = Math.max(0, Math.round((now - s.lastSyncedAt) / 1000));
    if (sec < 60) return { code: 'SYNC.FAILED_AGO_S', vars: { n: sec } };
    const min = Math.round(sec / 60);
    return min < 60 ? { code: 'SYNC.FAILED_AGO_MIN', vars: { n: min } } : { code: 'SYNC.FAILED_AGO_H', vars: { n: Math.round(min / 60) } };
  }
  if (s.inFlight > 0 && s.lastSyncedAt == null) return { code: 'SYNC.SYNCING' };
  return null;
}

function relative(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

/**
 * The safety sync for an app adapter (Owner / Technician / Customer apps): a SafetySync plus the tab-visibility wiring,
 * in one call. Returns stop(). Spec closing line: "apply this architecture across … Owner App, and Technician App".
 * Cadence per spec §81 is the caller's choice from SYNC_POLICY (operational 15 s, detail 45 s).
 */
export function startVisibleSafetySync(run: () => unknown, opts: SafetySyncOptions & { doc?: { hidden: boolean; addEventListener: Document['addEventListener']; removeEventListener: Document['removeEventListener'] } } = {}): () => void {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const sync = new SafetySync(() => run(), { ...opts, isHidden: opts.isHidden ?? (() => !!doc?.hidden) }).start();
  const onVis = () => sync.visibilityChanged(!!doc?.hidden);
  doc?.addEventListener('visibilitychange', onVis);
  return () => { doc?.removeEventListener('visibilitychange', onVis); sync.stop(); };
}
