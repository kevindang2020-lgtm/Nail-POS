// useRealtime.test.tsx — the safety sync (Smooth Refresh spec, Sep 30 2026) + §31 coalescing at the HOOK level.
// jsdom has no EventSource, so ensureRealtimeConnected no-ops — which is exactly the §54 scenario: realtime
// unavailable. The hook must keep the screen current via its visible-only fallback, and when events DO arrive
// (dispatched as the client would), a burst must collapse to one refetch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRealtime } from './useRealtime';
import { REALTIME_EVENT, REALTIME_RECONCILE } from './realtime-client';

function Probe({ screens, onRefetch, fallbackMs }: { screens: string | string[]; onRefetch: () => void; fallbackMs?: number }) {
  useRealtime(screens, onRefetch, fallbackMs ? { fallbackMs } : undefined);
  return null;
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useRealtime — the §38 default policy in one hook', () => {
  it('Smooth Refresh spec §4/§19/§37/§44: an ALWAYS-ON safety sync every 15 s ± 2 s while visible — whether or not the stream is up — single-flight', async () => {
    // Supersedes the Jul-27/Constitution-9 "poll only while the stream is down, 10 s after a 15 s grace" rule: the
    // spec makes the 15 s safety sync unconditional (§82 "Background Safety Sync = 15 seconds"; §110 realtime off →
    // still correct via the safety sync). jsdom has no EventSource, so this is also the realtime-unavailable scenario.
    vi.useFakeTimers();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // jitter → exactly 15 s
    const refetch = vi.fn();
    render(<Probe screens="queue" onRefetch={refetch} />);
    expect(refetch).not.toHaveBeenCalled();                    // mount itself never refetches — the screen's own effect does that
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(refetch).toHaveBeenCalledTimes(1);                  // first safety tick at 15 s
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(refetch).toHaveBeenCalledTimes(4);                  // 15 s cadence, visible tab
    rand.mockRestore();
  });

  it('§40: a hidden tab slows the safety sync to 60 s; coming back to a stale tab refetches at once (§41)', async () => {
    vi.useFakeTimers();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const refetch = vi.fn();
    render(<Probe screens="queue" onRefetch={refetch} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(refetch).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(refetch).toHaveBeenCalledTimes(1);                  // 45 s hidden → no 15 s ticks
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(refetch).toHaveBeenCalledTimes(2);                  // the 60 s hidden cadence
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });            // 20 s since the last sync ≥ 15 s → stale
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refetch).toHaveBeenCalledTimes(3);                  // immediate on return, no reload, no spinner
    rand.mockRestore();
  });

  it('§31: fifteen events in one burst → ONE coalesced refetch; an unrelated screen refetches nothing', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<Probe screens="queue" onRefetch={refetch} />);
    act(() => {
      for (let i = 0; i < 15; i++) {
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'queue_updated', screens: ['queue', 'tech-queue'] } }));
      }
      window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'settings_updated', screens: ['settings'] } }));
    });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('§15: a reconcile signal refetches IMMEDIATELY, bypassing the coalescing window', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<Probe screens="booking" onRefetch={refetch} />);
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_RECONCILE, { detail: { reason: 'reconnected' } })); });
    expect(refetch).toHaveBeenCalledTimes(1);                  // no 250ms wait after a gap
  });

  it('multi-screen subscription refetches once per burst across ANY of its screens, and unmount tears everything down', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { unmount } = render(<Probe screens={['booking', 'technicians']} onRefetch={refetch} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_created', screens: ['booking'] } }));
      window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'time_clock_updated', screens: ['technicians'] } }));
    });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).toHaveBeenCalledTimes(1);                  // one coalescer across the pair
    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_created', screens: ['booking'] } }));
      vi.advanceTimersByTime(60_000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);                  // §14: hidden/unmounted modules cost nothing
  });
});

// 200-technician mandate §22/§61 (M5 pilot, Oct 24 2026): a screen may say how much of it an event touches
function ScopedProbe({ onRefetch, relevance }: { onRefetch: (reason?: string, scope?: string) => void; relevance: (d: { event: string; payload?: unknown }) => 'skip' | 'partial' | 'full' }) {
  useRealtime('booking', onRefetch, { relevance });
  return null;
}
describe('useRealtime — relevance (§22 off-screen changes)', () => {
  const fire = (payload: Record<string, unknown>) => window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_created', screens: ['booking'], payload } }));
  const rel = (d: { payload?: unknown }) => ((d.payload as { scope?: 'skip' | 'partial' | 'full' })?.scope ?? 'full');
  it('a skipped event never refetches; a burst of partial events → ONE partial refetch', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<ScopedProbe onRefetch={refetch} relevance={rel} />);
    act(() => { for (let i = 0; i < 10; i++) fire({ scope: 'skip' }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).not.toHaveBeenCalled();
    act(() => { for (let i = 0; i < 10; i++) fire({ scope: 'partial' }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenLastCalledWith('manual', 'partial');
  });
  it('one full event in a partial burst widens the refetch to full', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<ScopedProbe onRefetch={refetch} relevance={rel} />);
    act(() => { fire({ scope: 'partial' }); fire({ scope: 'full' }); fire({ scope: 'partial' }); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenLastCalledWith('manual', 'full');
  });
  it('a reconcile (a gap in the stream) is always full', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<ScopedProbe onRefetch={refetch} relevance={rel} />);
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_RECONCILE, { detail: { reason: 'reconnected' } })); });
    expect(refetch).toHaveBeenLastCalledWith('reconcile', 'full');
  });
  it('a relevance function that throws never hides the change (full)', () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<ScopedProbe onRefetch={refetch} relevance={() => { throw new Error('bug'); }} />);
    act(() => { fire({}); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(refetch).toHaveBeenLastCalledWith('manual', 'full');
  });
});
