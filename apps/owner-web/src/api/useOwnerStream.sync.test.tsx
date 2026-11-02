// useOwnerStream.sync.test.tsx — Smooth Refresh spec closing line + §81/§110: the Owner App keeps its screens current
// through an always-on background safety sync (45 s, the §81 detail/summary class), not only while live updates are down.
// jsdom has no EventSource — exactly the "realtime OFF" case (§110).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useOwnerStream } from './useOwnerStream';

function Probe({ onEvent }: { onEvent: (e: string) => void }) { useOwnerStream(onEvent); return null; }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Owner App background safety sync', () => {
  it('asks every screen to refresh every 45 s while visible, with no live stream at all', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const seen: string[] = [];
    render(<Probe onEvent={(e) => seen.push(e)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(44_999); });
    expect(seen.filter((e) => e === 'reconcile')).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(seen.filter((e) => e === 'reconcile')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(seen.filter((e) => e === 'reconcile')).toHaveLength(3);
  });

  it('unmounting stops it (no timer outlives the screen)', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const seen: string[] = [];
    const { unmount } = render(<Probe onEvent={(e) => seen.push(e)} />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(seen.filter((e) => e === 'reconcile')).toHaveLength(0);
  });
});
