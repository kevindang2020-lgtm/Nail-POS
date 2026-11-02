// sync-failure-modes.test.tsx — Smooth Refresh spec §110–§114 at the hook level (the layer every POS screen uses).
// jsdom has no EventSource, so "realtime unavailable" is the default condition here; events are dispatched exactly as
// the realtime client dispatches them.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRealtime, syncStatus } from './useRealtime';
import { REALTIME_EVENT } from './realtime-client';

function Probe({ onRefetch, intervalMs }: { onRefetch: () => unknown; intervalMs?: number }) {
  useRealtime('booking', onRefetch, intervalMs != null ? { intervalMs } : undefined);
  return null;
}
const setHidden = (h: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); };
const step = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); syncStatus.reset(); });

describe('sync failure modes (spec §110–§114)', () => {
  it('§110 realtime OFF: the POS stays current through the 15 s safety sync alone', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await step(60_000);
    expect(refetch).toHaveBeenCalledTimes(4);            // 15, 30, 45, 60 s — no events needed
  });

  it('§111 polling OFF (intervalMs 0): realtime events alone still update the screen, and no timer ever fires', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} intervalMs={0} />);
    await step(120_000);
    expect(refetch).not.toHaveBeenCalled();              // no polling at all
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_created', screens: ['booking'] } })); await vi.advanceTimersByTimeAsync(300); });
    expect(refetch).toHaveBeenCalledTimes(1);            // the event did it
  });

  it('§113 browser SLEEP 10 minutes: resuming refetches immediately — and never reloads the page', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const reload = vi.fn(); const loc = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...loc, reload } });
    const refetch = vi.fn();
    render(<Probe onRefetch={refetch} />);
    await step(15_000); expect(refetch).toHaveBeenCalledTimes(1);
    act(() => setHidden(true));
    // A sleeping device runs NO timers: the clock jumps 10 minutes while nothing fires.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));                          // wake
    expect(refetch).toHaveBeenCalledTimes(2);             // immediately, not 15 s later
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(window, 'location', { configurable: true, value: loc });
  });

  it('§114 poor network: a refetch that takes 40 s never piles requests up — overlapping ticks are skipped and counted', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let inFlight = 0, maxInFlight = 0;
    const refetch = vi.fn(() => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<void>((r) => setTimeout(() => { inFlight--; r(); }, 40_000)); });
    render(<Probe onRefetch={refetch} />);
    await step(120_000);
    expect(maxInFlight).toBe(1);                          // never two at once on a slow link
    expect(syncStatus.snapshot().skippedInflight).toBeGreaterThan(0);
    expect(syncStatus.snapshot().durationMs.p50).toBeGreaterThanOrEqual(40_000);   // §100: the slowness is measured
  });
});
