// sync-policy.test.ts — the 15 s safety sync: jitter, single-flight, hidden cadence, focus, no overlap (spec §37, §40, §41, §44).
import { describe, it, expect, vi } from 'vitest';
import { SafetySync, SyncStatusStore, jittered, syncIndicatorText, SYNC_POLICY, startVisibleSafetySync } from './sync-policy';
import { RefetchCoalescer } from './core';

describe('jittered', () => {
  it('spreads 15 s across 13–17 s and never below 1 s', () => {
    expect(jittered(15_000, 2_000, () => 0)).toBe(13_000);
    expect(jittered(15_000, 2_000, () => 1)).toBe(17_000);
    expect(jittered(15_000, 2_000, () => 0.5)).toBe(15_000);
    expect(jittered(500, 2_000, () => 0)).toBe(1_000);
  });
});

describe('SafetySync', () => {
  it('§4/§37: ticks every 15 s ± 2 s while visible, on the screen\'s own refetch only', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const s = new SafetySync(run, { rand: () => 0.5, isHidden: () => false }).start();
    await vi.advanceTimersByTimeAsync(14_999); expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);      expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); expect(run).toHaveBeenCalledTimes(2);
    s.stop(); await vi.advanceTimersByTimeAsync(60_000); expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('§44: a tick that fires while the previous refetch is still in flight is SKIPPED, not queued', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const outcomes: string[] = [];
    const s = new SafetySync(run, { rand: () => 0.5, isHidden: () => false, onOutcome: (o) => outcomes.push(o.result) }).start();
    vi.advanceTimersByTime(15_000); expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000); expect(run).toHaveBeenCalledTimes(1);   // still in flight → skipped
    expect(outcomes).toEqual(['skipped_inflight']);
    expect(s.counters.skippedInflight).toBe(1);
    resolve(); await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(15_000); expect(run).toHaveBeenCalledTimes(2);
    s.stop(); vi.useRealTimers();
  });

  it('§40/§41: hidden tab slows to 60 s; returning to a stale tab syncs immediately, a fresh one does not', () => {
    vi.useFakeTimers();
    let t = 0; const now = () => t;
    const run = vi.fn(() => undefined);
    const s = new SafetySync(run, { rand: () => 0.5, isHidden: () => false, now }).start();
    const step = (ms: number) => { t += ms; vi.advanceTimersByTime(ms); };
    step(15_000); expect(run).toHaveBeenCalledTimes(1);
    s.visibilityChanged(true);
    step(59_999); expect(run).toHaveBeenCalledTimes(1);
    step(1);      expect(run).toHaveBeenCalledTimes(2);      // 60 s hidden cadence
    s.visibilityChanged(false);                                // just synced → not stale → no extra tick
    expect(run).toHaveBeenCalledTimes(2);
    s.visibilityChanged(true); step(30_000); s.visibilityChanged(false);   // 30 s since last sync ≥ 15 s → stale → immediate
    expect(run).toHaveBeenCalledTimes(3);
    s.stop(); vi.useRealTimers();
  });

  it('§41/§42: nudge(focus|reconnect) is immediate and re-arms the interval', () => {
    vi.useFakeTimers();
    const run = vi.fn(() => undefined);
    const s = new SafetySync(run, { rand: () => 0.5, isHidden: () => false }).start();
    vi.advanceTimersByTime(10_000); s.nudge('reconnect'); expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(14_999); expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);      expect(run).toHaveBeenCalledTimes(2);
    s.stop(); vi.useRealTimers();
  });

  it('a failing refetch is recorded, never thrown, and the next tick still runs', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const store = new SyncStatusStore();
    const s = new SafetySync(run, { rand: () => 0.5, isHidden: () => false, onOutcome: (o) => store.record(o) }).start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.snapshot().errors).toBe(1);
    expect(syncIndicatorText(store.snapshot(), Date.now())).toBe("Couldn't refresh");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.snapshot().ticks).toBe(2);
    expect(syncIndicatorText(store.snapshot(), Date.now())).toBeNull();   // healthy again → nothing to say
    s.stop(); vi.useRealTimers();
  });
});

describe('SyncStatusStore', () => {
  it('§100: p50/p95/max of background-fetch durations; the indicator names the last good data age after an error', () => {
    const st = new SyncStatusStore();
    [40, 60, 80, 100, 500].forEach((d, i) => st.record({ reason: 'interval', result: 'ok', durationMs: d, at: 1_000 * i }));
    const s = st.snapshot();
    expect(s.durationMs).toEqual({ count: 5, p50: 80, p95: 500, max: 500 });
    st.record({ reason: 'interval', result: 'error', durationMs: 10, at: 10_000, error: new Error('502') });
    expect(syncIndicatorText(st.snapshot(), 20_500)).toMatch(/showing data from 16s ago/);
  });
  it('policy constants are the spec\'s numbers', () => {
    expect(SYNC_POLICY.operationalMs).toBe(15_000); expect(SYNC_POLICY.jitterMs).toBe(2_000); expect(SYNC_POLICY.serverReconciliationMs).toBe(20_000);
  });
});

describe('startVisibleSafetySync (Owner / Technician / Customer app adapters)', () => {
  it('ticks at the given cadence while visible, slows while hidden, catches up on return, and stop() ends it', async () => {
    vi.useFakeTimers();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const listeners: Record<string, () => void> = {};
    const doc = { hidden: false, addEventListener: (t: string, f: any) => { listeners[t] = f; }, removeEventListener: (t: string) => { delete listeners[t]; } } as any;
    const run = vi.fn();
    const stop = startVisibleSafetySync(run, { intervalMs: SYNC_POLICY.detailMs, doc });
    await vi.advanceTimersByTimeAsync(45_000); expect(run).toHaveBeenCalledTimes(1);
    doc.hidden = true; listeners.visibilitychange();
    await vi.advanceTimersByTimeAsync(59_999); expect(run).toHaveBeenCalledTimes(1);   // hidden → 60 s cadence
    await vi.advanceTimersByTimeAsync(1);      expect(run).toHaveBeenCalledTimes(2);
    doc.hidden = false; await vi.advanceTimersByTimeAsync(0); listeners.visibilitychange();
    stop();
    expect(listeners.visibilitychange).toBeUndefined();
    const n = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000); expect(run).toHaveBeenCalledTimes(n);  // stopped means stopped
    rand.mockRestore(); vi.useRealTimers();
  });
});

describe('browser timer rule — timers must be called unbound (regression: "Illegal invocation" in Chromium, Sep 30 2026)', () => {
  // A real browser's setTimeout/clearTimeout throw when called as a method of another object. Node and jsdom do not,
  // which let `this.setT(...)` pass every unit test while crashing every POS screen in Chromium. These strict stand-ins
  // enforce the browser's rule so the bug fails HERE.
  const strict = <F extends (...a: any[]) => any>(real: F): F => (function (this: unknown, ...args: any[]) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return real(...args);
  }) as unknown as F;
  it('SafetySync start / nudge / visibility / stop never call a timer as a method', async () => {
    const st = strict(setTimeout), ct = strict(clearTimeout);
    const run = vi.fn();
    const s = new SafetySync(run, { setT: st, clearT: ct, isHidden: () => false, intervalMs: 20 });
    expect(() => { s.start(); s.nudge('focus'); s.visibilityChanged(true); s.visibilityChanged(false); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(() => s.stop()).not.toThrow();
    expect(run).toHaveBeenCalled();
  });
  it('RefetchCoalescer request / cancelAll never call a timer as a method', async () => {
    const run = vi.fn();
    const c = new RefetchCoalescer(run, 10, strict(setTimeout), strict(clearTimeout));
    expect(() => { c.request('booking'); c.request('booking'); }).not.toThrow();
    await new Promise((r) => setTimeout(r, 30));
    expect(run).toHaveBeenCalledTimes(1);
    expect(() => { c.request('queue'); c.cancelAll(); }).not.toThrow();
  });
});

describe('SyncStatusStore payload telemetry (spec §100)', () => {
  it('records bytes, records changed, quiet ticks and resyncs; reset clears them and notifies', () => {
    const st = new SyncStatusStore();
    st.recordPayload({ bytes: 106, recordsChanged: 0 });
    st.recordPayload({ bytes: 2400, recordsChanged: 3 });
    st.recordPayload({ bytes: 110, recordsChanged: 0 });
    st.recordResync();
    const p = st.snapshot().payload;
    expect(p).toEqual({ samples: 3, bytesTotal: 2616, bytesP50: 110, bytesMax: 2400, recordsChangedTotal: 3, emptyTicks: 2, resyncs: 1 });
    let seen: any = null; st.subscribe((s) => { seen = s; });
    st.reset();
    expect(seen.payload).toEqual({ samples: 0, bytesTotal: 0, bytesP50: 0, bytesMax: 0, recordsChangedTotal: 0, emptyTicks: 0, resyncs: 0 });
  });
});

// Vietnamese POS §21 (Oct 27 2026): the indicator as a code + vars, one per English sentence shape
import { syncIndicatorCoded } from './sync-policy';
describe('syncIndicatorCoded', () => {
  const snap = (o: Partial<{ lastErrorAt: number | null; lastSyncedAt: number | null; inFlight: number }>) => ({ inFlight: 0, lastSyncedAt: null, lastErrorAt: null, lastError: null, ticks: 0, errors: 0, skippedInflight: 0, durationMs: { count: 0, p50: 0, p95: 0, max: 0 }, payload: {} as any, ...o }) as any;
  it('matches syncIndicatorText case by case', () => {
    expect(syncIndicatorCoded(snap({ lastErrorAt: 5 }), 10)).toEqual({ code: 'SYNC.FAILED' });
    expect(syncIndicatorCoded(snap({ lastErrorAt: 20_000, lastSyncedAt: 4_000 }), 20_500)).toEqual({ code: 'SYNC.FAILED_AGO_S', vars: { n: 17 } });
    expect(syncIndicatorText(snap({ lastErrorAt: 20_000, lastSyncedAt: 4_000 }), 20_500)).toBe("Couldn't refresh — showing data from 17s ago");
    expect(syncIndicatorCoded(snap({ lastErrorAt: 900_000, lastSyncedAt: 0 }), 900_000)).toEqual({ code: 'SYNC.FAILED_AGO_MIN', vars: { n: 15 } });
    expect(syncIndicatorCoded(snap({ lastErrorAt: 9_000_000, lastSyncedAt: 0 }), 9_000_000)).toEqual({ code: 'SYNC.FAILED_AGO_H', vars: { n: 3 } });
    expect(syncIndicatorCoded(snap({ inFlight: 1 }), 0)).toEqual({ code: 'SYNC.SYNCING' });
    expect(syncIndicatorCoded(snap({ lastSyncedAt: 5 }), 10)).toBeNull();
  });
});
