import { describe, it, expect } from 'vitest';
import { readFeedSweep } from './bookingFeed';

describe('readFeedSweep (M4 — the Booking board follows a paged change feed)', () => {
  it('one quiet page: no follow-up request', async () => {
    const calls: string[] = [];
    const s = await readFeedSweep(async (c) => { calls.push(c); return { appointments: [], cursor: 'v1.next' }; }, 'v1.a');
    expect(calls).toEqual(['v1.a']);
    expect(s).toMatchObject({ rows: [], cursor: 'v1.next', pages: 1, resync: false });
  });
  it('a busy minute: follows hasMore with each continuation and returns every row and the final cursor', async () => {
    const pages: Record<string, any> = {
      'v1.a': { appointments: [{ id: 1 }, { id: 2 }], cursor: 'v2.p1', hasMore: true },
      'v2.p1': { appointments: [{ id: 3 }], cursor: 'v2.p2', hasMore: true },
      'v2.p2': { appointments: [{ id: 4 }], cursor: 'v1.next', hasMore: false },
    };
    const calls: string[] = [];
    const s = await readFeedSweep(async (c) => { calls.push(c); return pages[c]; }, 'v1.a');
    expect(calls).toEqual(['v1.a', 'v2.p1', 'v2.p2']);
    expect(s.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4]);
    expect(s).toMatchObject({ cursor: 'v1.next', pages: 3, resync: false });
  });
  it('a sweep that never ends within maxPages → resync (the board reloads its snapshot instead of dropping rows)', async () => {
    let n = 0;
    const s = await readFeedSweep(async () => ({ appointments: [{ id: n++ }], cursor: 'v2.more', hasMore: true }), 'v1.a', 4);
    expect(s.pages).toBe(4);
    expect(s.resync).toBe(true);
  });
});
