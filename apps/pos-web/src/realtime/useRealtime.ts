// useRealtime.ts — subscribe a screen to the realtime standard (Jul 27 2026) + the Smooth Refresh sync policy (Sep 30 2026).
//
// One hook gives a screen the whole policy:
//   • realtime events for this screen → ONE coalesced refetch per burst (§31 / spec §45)
//   • reconcile signals (reconnect / wake / tab-resume) → immediate refetch (spec §41–§43)
//   • BACKGROUND SAFETY SYNC every 15 s ± 2 s while visible, 60 s while hidden, immediate on focus (spec §4, §19, §37, §40)
//     — it calls the screen's own refetch, which replaces state in place; it never reloads, clears data or shows a
//     spinner (spec §1, §20). Overlapping ticks are skipped (single-flight, spec §44).
//   • every tick outcome feeds the app-wide SyncStatusStore → the RealtimeStatusPill's "Couldn't refresh — showing
//     data from …" line (spec §23, §92) and the §100 metrics (`window.__apsSync.snapshot()`).
//
// The SSE connection is shared across all hook users; listeners tear down on unmount so hidden modules cost nothing.
// Timer centralisation (spec §95): screens and shell widgets never own a setInterval — they use this file.
import { useEffect, useRef } from 'react';
import { ensureRealtimeConnected, REALTIME_EVENT, REALTIME_RECONCILE, type RealtimeDetail } from './realtime-client';
import { RefetchCoalescer, SafetySync, SyncStatusStore, SYNC_POLICY, type SyncTickReason } from '@aipowersalon/realtime-client';

/** App-wide sync status (indicator + metrics). One store per POS tab. */
export const syncStatus = new SyncStatusStore();
if (typeof window !== 'undefined') (window as any).__apsSync = { snapshot: () => syncStatus.snapshot(), reset: () => syncStatus.reset() };

export interface SyncOptions {
  /** Safety-sync cadence while visible. Default SYNC_POLICY.operationalMs (15 s). 0 disables the safety sync (events only). */
  intervalMs?: number;
  /** Cadence while the tab is hidden. Default SYNC_POLICY.hiddenMs (60 s); 0 suspends while hidden. */
  hiddenMs?: number;
  /** Back-compat name used by report screens: same as intervalMs. */
  fallbackMs?: number;
  /** 200-technician mandate §22/§61: how much of the screen one event touches. 'skip' ignores it; the widest scope of a
   *  coalesced burst is handed to the refetch (`onRefetch(reason, scope)`). Absent → every event is 'full' (as before). */
  relevance?: (detail: RealtimeDetail) => RefreshScope;
}
/** 'full' = reload the screen; 'partial' = the screen's cheap metadata only (the screen decides what that is). */
export type RefreshScope = 'skip' | 'partial' | 'full';
const SCOPE_RANK: Record<RefreshScope, number> = { skip: 0, partial: 1, full: 2 };

const hiddenNow = () => typeof document !== 'undefined' && !!document.hidden;

/**
 * Background safety sync only (no realtime events) — for widgets whose data has no event yet (shell inbox, badges).
 * Same cadence, hidden throttling, focus/reconnect nudges, single-flight and status reporting as useRealtime.
 */
export function useSafetySync(onRefetch: () => unknown, opts?: SyncOptions): void {
  const cb = useRef(onRefetch);
  cb.current = onRefetch;
  const intervalMs = opts?.intervalMs ?? opts?.fallbackMs ?? SYNC_POLICY.operationalMs;
  const hiddenMs = opts?.hiddenMs ?? SYNC_POLICY.hiddenMs;
  useEffect(() => {
    if (intervalMs === 0) return;
    const sync = makeSafetySync(() => cb.current(), intervalMs, hiddenMs);
    const onVisibility = () => sync.visibilityChanged(hiddenNow());
    const onReconcile = () => sync.nudge('reconcile');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(REALTIME_RECONCILE, onReconcile);
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener(REALTIME_RECONCILE, onReconcile); sync.stop(); };
  }, [intervalMs, hiddenMs]);
}

export function useRealtime(screen: string | string[], onRefetch: (reason?: SyncTickReason, scope?: RefreshScope) => unknown, opts?: SyncOptions): void {
  const cb = useRef(onRefetch);
  cb.current = onRefetch;
  const rel = useRef(opts?.relevance);
  rel.current = opts?.relevance;
  const key = (Array.isArray(screen) ? screen : [screen]).join('|');
  const intervalMs = opts?.intervalMs ?? opts?.fallbackMs ?? SYNC_POLICY.operationalMs;
  const hiddenMs = opts?.hiddenMs ?? SYNC_POLICY.hiddenMs;
  useEffect(() => {
    const screens = key.split('|');
    ensureRealtimeConnected();
    // Every refetch — event-driven, reconcile or timer — goes through ONE SafetySync so a burst, a reconnect and a
    // timer tick can never overlap each other (single-flight) and every outcome is reported once.
    // The screen receives WHY it is refetching: 'interval' / 'visible' ticks may take a cheaper path (e.g. the Booking
    // board asks the change feed first); events ('manual'), reconciles and focus always mean "load now".
    // the widest scope of the events coalesced into the next 'manual' (event) refetch; any other reason is 'full'
    let pendingScope: RefreshScope | null = null;
    const sync = makeSafetySync((reason) => {
      const scope: RefreshScope = reason === 'manual' && pendingScope ? pendingScope : 'full';
      if (reason === 'manual') pendingScope = null;
      return cb.current(reason, scope);
    }, intervalMs, hiddenMs);
    const coalescer = new RefetchCoalescer(() => sync.nudge('manual'), SYNC_POLICY.coalesceMs);   // §31: bursts → one refetch

    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<RealtimeDetail>).detail;
      if (!(detail && Array.isArray(detail.screens) && screens.some((sc) => detail.screens.includes(sc)))) return;
      let scope: RefreshScope = 'full';
      try { scope = rel.current ? rel.current(detail) : 'full'; } catch { scope = 'full'; }   // a relevance bug never hides a change
      if (scope === 'skip') return;
      pendingScope = pendingScope && SCOPE_RANK[pendingScope] >= SCOPE_RANK[scope] ? pendingScope : scope;
      coalescer.request(key);
    };
    const onReconcile = () => sync.nudge('reconcile');          // §15 / spec §42: after a gap, refetch NOW — not coalesced
    const onVisibility = () => sync.visibilityChanged(hiddenNow());

    window.addEventListener(REALTIME_EVENT, onEvent);
    window.addEventListener(REALTIME_RECONCILE, onReconcile);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener(REALTIME_EVENT, onEvent);
      window.removeEventListener(REALTIME_RECONCILE, onReconcile);
      document.removeEventListener('visibilitychange', onVisibility);
      sync.stop();
      coalescer.cancelAll();
    };
  }, [key, intervalMs, hiddenMs]);
}

function makeSafetySync(run: (reason: SyncTickReason) => unknown, intervalMs: number, hiddenMs: number): SafetySync {
  // The refetch is invoked SYNCHRONOUSLY (a reconcile/event refetch must not wait a microtask); its promise, if any,
  // is what single-flight waits on.
  const s = new SafetySync((reason: SyncTickReason) => {
    syncStatus.begin();
    let r: unknown;
    try { r = run(reason); } catch (e) { syncStatus.end(); throw e; }
    return Promise.resolve(r).finally(() => syncStatus.end());
  }, {
    intervalMs,
    hiddenMs,
    isHidden: hiddenNow,
    onOutcome: (o) => syncStatus.record(o),
  });
  return s.start();
}
