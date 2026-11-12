import { describe, it, expect } from 'vitest';
import { evenSplit, splitPreview } from './tipSplitPreview';

describe('evenSplit', () => {
  it('exact cents; the remainder goes one cent each to the first technicians; always sums to the total', () => {
    expect(evenSplit(1000, 3)).toEqual({ parts: [334, 333, 333], remainderCents: 1 });
    expect(evenSplit(1001, 3)).toEqual({ parts: [334, 334, 333], remainderCents: 2 });
    expect(evenSplit(900, 3)).toEqual({ parts: [300, 300, 300], remainderCents: 0 });
    expect(evenSplit(1, 2)).toEqual({ parts: [1, 0], remainderCents: 1 });
    expect(evenSplit(500, 0)).toEqual({ parts: [], remainderCents: 0 });
    for (const [t, n] of [[9999, 7], [12345, 4], [3, 5]]) expect(evenSplit(t, n).parts.reduce((a, b) => a + b, 0)).toBe(t);
  });
});
describe('splitPreview', () => {
  it('before → after and the change per technician; balanced only when Σ equals the collected tip', () => {
    const p = splitPreview(1000, [{ technicianId: 'a', name: 'An', beforeCents: 1000, afterCents: 334 }, { technicianId: 'b', name: 'Bao', beforeCents: 0, afterCents: 333 }, { technicianId: 'c', name: 'Chi', beforeCents: 0, afterCents: 333 }]);
    expect(p.rows.map((r) => r.deltaCents)).toEqual([-666, 333, 333]);
    expect(p).toMatchObject({ sumAfterCents: 1000, differenceCents: 0, balanced: true, changed: true });
    expect(splitPreview(1000, [{ technicianId: 'a', name: null, beforeCents: 1000, afterCents: 990 }])).toMatchObject({ balanced: false, differenceCents: 10 });
  });
});
