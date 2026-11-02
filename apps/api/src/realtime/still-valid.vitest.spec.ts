// Security Deep Scan C11: a device-token stream ends when the token stops being valid (polled).
import { describe, it, expect, vi } from 'vitest';
import { Subject } from 'rxjs';
import { untilStillValid } from './realtime-stream';

describe('untilStillValid', () => {
  it('completes the stream once the check answers false (or throws); no check = untouched', async () => {
    vi.useFakeTimers();
    const src = new Subject<number>(); let valid = true; let done = false; const seen: number[] = [];
    src.pipe(untilStillValid(async () => valid, 1000)).subscribe({ next: (v) => seen.push(v), complete: () => { done = true; } });
    src.next(1); await vi.advanceTimersByTimeAsync(1000); expect(done).toBe(false);
    valid = false; await vi.advanceTimersByTimeAsync(1000); expect(done).toBe(true);
    src.next(2); expect(seen).toEqual([1]);
    let threw = false; const s2 = new Subject<number>();
    s2.pipe(untilStillValid(async () => { throw new Error('db down'); }, 1000)).subscribe({ complete: () => { threw = true; } });
    await vi.advanceTimersByTimeAsync(1000); expect(threw).toBe(true);
    vi.useRealTimers();
  });
});
