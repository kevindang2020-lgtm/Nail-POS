// realtime-resilience.test.tsx — §15-§18, §29/§30 client resilience, pure-core level (Jul 27, 2026).
// The EventSource shell can't run under jsdom; everything that DECIDES is in realtime-core and tested here.
import { describe, it, expect } from 'vitest';
import { ConnectionStateMachine, reconnectDelayMs, shouldRefreshOnVisible } from './realtime-core';
import { SequenceTracker } from './realtime-core';

describe('§18 connection state machine', () => {
  it('starts RECONNECTING, becomes CONNECTED on open, and owes NO reconcile on the very first connect', () => {
    const sm = new ConnectionStateMachine();
    expect(sm.status).toBe('RECONNECTING');
    const r = sm.opened();
    expect(sm.status).toBe('CONNECTED');
    expect(r.reconcile).toBe(false);                          // first connect = nothing was missed
  });

  it('§15 after a real gap, the next successful open owes a reconciliation refetch', () => {
    const sm = new ConnectionStateMachine();
    sm.opened();
    sm.errored();                                             // disruption
    const r = sm.opened();
    expect(r.reconcile).toBe(true);                           // never assume no events were missed
    expect(sm.attempts).toBe(0);                              // backoff resets on success
  });

  it('degrades after repeated failures, and network-online restarts immediately from OFFLINE', () => {
    const sm = new ConnectionStateMachine(3);
    sm.opened();
    sm.errored(); sm.errored();
    expect(sm.status).toBe('RECONNECTING');
    sm.errored();
    expect(sm.status).toBe('DEGRADED');                       // §36: screens fall back to polling
    sm.networkOffline();
    expect(sm.status).toBe('OFFLINE');
    const { retryNow } = sm.networkOnline();
    expect(retryNow).toBe(true);
    expect(sm.status).toBe('RECONNECTING');
    expect(sm.opened().reconcile).toBe(true);                 // the whole disruption ends in one reconcile
  });
});

describe('§29/§30 jittered backoff', () => {
  it('grows exponentially, is capped, and jitters within [half, full] of the step', () => {
    const lo = reconnectDelayMs(1, 1000, 30000, () => 0);
    const hi = reconnectDelayMs(1, 1000, 30000, () => 0.999999);
    expect(lo).toBe(500);
    expect(hi).toBeGreaterThanOrEqual(999);
    expect(reconnectDelayMs(3, 1000, 30000, () => 0)).toBe(2000);      // 4000/2
    expect(reconnectDelayMs(10, 1000, 30000, () => 0.999999)).toBeLessThanOrEqual(30000);  // §30 bounded
    // §29: two clients with different rolls reconnect at different times — the herd spreads.
    expect(reconnectDelayMs(2, 1000, 30000, () => 0.1)).not.toBe(reconnectDelayMs(2, 1000, 30000, () => 0.9));
  });
});

describe('§17 tab resume threshold', () => {
  it('a few hidden seconds do nothing; ≥30s hidden refetches', () => {
    const t0 = Date.parse('2026-07-27T15:00:00Z');
    expect(shouldRefreshOnVisible(t0, t0 + 5_000)).toBe(false);
    expect(shouldRefreshOnVisible(t0, t0 + 30_000)).toBe(true);
    expect(shouldRefreshOnVisible(null, t0)).toBe(false);     // never hidden → nothing owed
  });
});

describe('Constitution 9 §31–33 sequence tracking (client side)', () => {
  it('a contiguous stream is ok; a skipped number is a GAP; an older number is a duplicate, never a gap', () => {
    const t = new SequenceTracker();
    expect(t.observe(1)).toBe('ok');            // first frame sets the baseline
    expect(t.observe(2)).toBe('ok');
    expect(t.observe(4)).toBe('gap');           // 3 was lost — §253: never silently accept this
    expect(t.observe(4)).toBe('duplicate');     // §182: redelivery of the same frame
    expect(t.observe(3)).toBe('duplicate');     // late arrival of the lost one: too late, already resynced
    expect(t.lastSeq).toBe(4);
  });
  it('baseline() from connected/resync_required means nothing before it can count as missed', () => {
    const t = new SequenceTracker();
    t.baseline(40);
    expect(t.observe(41)).toBe('ok');
    expect(t.observe(43)).toBe('gap');
  });
  it('frames without a seq are ignored, not treated as gaps (older servers, heartbeats)', () => {
    const t = new SequenceTracker();
    expect(t.observe(undefined)).toBe('ignored');
    expect(t.observe('7')).toBe('ignored');
    expect(t.observe(1)).toBe('ok');
  });
});
