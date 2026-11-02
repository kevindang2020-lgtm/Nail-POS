// ai-scheduling-core.vitest.spec.ts — pure minute-interval arithmetic. Touching endpoints don't overlap (back-to-back is
// allowed); merge/subtract/clip/buffer/fit/chain are the primitives every later stage builds on. Nothing mutates inputs.
import { describe, it, expect } from 'vitest';
import { overlaps, contains, adjacent, intersect, mergeRanges, subtractRanges, clipAll, applyBuffer, fits, freeWindows, totalCovered, chainServices } from './ai-scheduling-core';

describe('interval predicates', () => {
  it('overlap treats touching endpoints as non-overlapping', () => {
    expect(overlaps({ start: 0, end: 60 }, { start: 30, end: 90 })).toBe(true);
    expect(overlaps({ start: 0, end: 60 }, { start: 60, end: 120 })).toBe(false);
    expect(overlaps({ start: 0, end: 60 }, { start: 70, end: 90 })).toBe(false);
    expect(contains({ start: 0, end: 120 }, { start: 30, end: 90 })).toBe(true);
    expect(adjacent({ start: 0, end: 60 }, { start: 60, end: 120 })).toBe(true);
  });
});

describe('set operations', () => {
  it('intersect / merge / subtract / clip', () => {
    expect(intersect({ start: 0, end: 60 }, { start: 30, end: 90 })).toEqual({ start: 30, end: 60 });
    expect(intersect({ start: 0, end: 60 }, { start: 70, end: 90 })).toBeNull();
    expect(mergeRanges([{ start: 0, end: 30 }, { start: 20, end: 50 }, { start: 60, end: 80 }, { start: 80, end: 100 }])).toEqual([{ start: 0, end: 50 }, { start: 60, end: 100 }]);
    expect(subtractRanges({ start: 0, end: 480 }, [{ start: 60, end: 120 }, { start: 300, end: 360 }])).toEqual([{ start: 0, end: 60 }, { start: 120, end: 300 }, { start: 360, end: 480 }]);
    expect(subtractRanges({ start: 0, end: 100 }, [{ start: 0, end: 100 }])).toEqual([]);
    expect(clipAll([{ start: -30, end: 30 }, { start: 200, end: 300 }], { start: 0, end: 250 })).toEqual([{ start: 0, end: 30 }, { start: 200, end: 250 }]);
  });
});

describe('buffers, fit, windows, chaining', () => {
  it('handles buffers, fit checks, free windows, total coverage, and multi-service chaining', () => {
    expect(applyBuffer({ start: 60, end: 120 }, { before: 10, after: 10 })).toEqual({ start: 50, end: 130 });
    expect(fits({ start: 0, end: 60 }, 45, { setup: 5, cleanup: 5 })).toBe(true);
    expect(fits({ start: 0, end: 60 }, 55, { setup: 5, cleanup: 5 })).toBe(false);
    expect(freeWindows({ start: 540, end: 1020 }, [{ start: 720, end: 780 }])).toEqual([{ start: 540, end: 720 }, { start: 780, end: 1020 }]);
    expect(totalCovered([{ start: 0, end: 60 }, { start: 30, end: 90 }])).toBe(90);
    const chain = chainServices(600, [{ duration: 20, cleanup: 5 }, { duration: 60 }], 10);
    expect(chain.blocks).toEqual([{ start: 600, end: 620 }, { start: 635, end: 695 }]);
    expect(chain.span).toEqual({ start: 600, end: 695 });
  });
});
