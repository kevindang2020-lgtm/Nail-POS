// network-state.ts — BUILD_PLAN Phase 13 (Constitution 6 §16): is this app online, offline, or online-but-failing?
//
// `navigator.onLine` alone lies in both directions: it says "online" on a captive Wi-Fi that reaches nothing, and the
// browser only learns otherwise much later. So the transport reports every outcome here: DEGRADED_AFTER consecutive
// transport failures (network error, timeout, 5xx) while the browser says "online" is DEGRADED; one success clears it.
// The browser's `offline` event wins over everything — no request is needed to know the radio is off.
//
// One store per JS context (every transport in an app shares it). Screens read it through `useNetworkState()`
// (./react.ts); the offline banner and the server-state layer (agent C, Phase 13) build on it.
export type NetworkStatus = 'online' | 'offline' | 'degraded';
export interface NetworkSnapshot {
  status: NetworkStatus;
  /** When the status last changed (ms since epoch) — "offline since 10:42". */
  since: number;
  /** Consecutive transport failures since the last success. */
  failures: number;
}

export const DEGRADED_AFTER = 2;

const browserOnline = (): boolean => (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? true : navigator.onLine);

let failures = 0;
let snap: NetworkSnapshot = { status: browserOnline() ? 'online' : 'offline', since: Date.now(), failures: 0 };
const listeners = new Set<() => void>();
let wired = false;

function compute(): NetworkStatus {
  if (!browserOnline()) return 'offline';
  return failures >= DEGRADED_AFTER ? 'degraded' : 'online';
}
function publish(): void {
  const status = compute();
  if (status === snap.status && failures === snap.failures) return;
  snap = { status, since: status === snap.status ? snap.since : Date.now(), failures };
  for (const l of [...listeners]) { try { l(); } catch { /* a listener never breaks the store */ } }
}
function wire(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('online', () => { failures = 0; publish(); });   // the radio came back: give requests a fresh chance
  window.addEventListener('offline', publish);
}
wire();

export const networkState = {
  get(): NetworkSnapshot { wire(); if (snap.status !== compute()) publish(); return snap; },
  subscribe(fn: () => void): () => void { wire(); listeners.add(fn); return () => { listeners.delete(fn); }; },
  /** A response arrived (any status below 500) — the network works. */
  recordSuccess(): void { failures = 0; publish(); },
  /** A network error, a timeout or a 5xx. A caller's own abort is NOT a failure. */
  recordFailure(): void { failures++; publish(); },
  isOnline(): boolean { return this.get().status !== 'offline'; },
};

/** Test helper. */
export function resetNetworkState(): void {
  failures = 0;
  snap = { status: compute(), since: Date.now(), failures: 0 };
}
