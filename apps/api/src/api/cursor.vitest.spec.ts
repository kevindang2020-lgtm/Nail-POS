// cursor.vitest.spec — Constitution 5 §46: keyset pagination (sortValue, id) + hasMore without COUNT.
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, paginate, CursorPageDefinition } from './cursor';

type Item = { id: string; created_at: string; name: string };
const def: CursorPageDefinition<Item> = { sortKey: 'created_at', sortKeyType: 'date', extractId: i => i.id };
const items: Item[] = [
  { id: 'a', created_at: '2026-01-01T00:00:00Z', name: 'A' },
  { id: 'b', created_at: '2026-01-02T00:00:00Z', name: 'B' },
  { id: 'c', created_at: '2026-01-02T00:00:00Z', name: 'C' },
  { id: 'd', created_at: '2026-01-03T00:00:00Z', name: 'D' },
];

describe('keyset cursor pagination', () => {
  it('encodes and decodes a (sortValue, id) pair', () => {
    const cur = encodeCursor({ sortValue: '2026-01-02T00:00:00Z', id: 'b' });
    const dec = decodeCursor(cur);
    expect(dec).toEqual({ sortValue: '2026-01-02T00:00:00Z', id: 'b' });
  });
  it('rejects malformed cursors', () => {
    expect(decodeCursor('not a cursor')).toBeNull();
    expect(decodeCursor('aaa')).toBeNull();
    expect(() => paginate({ limit: 10, cursor: 'junk' }, items, def)).toThrow();
  });
  it('first page without cursor, limit 2: shows A, B and a cursor for C', () => {
    const p = paginate({ limit: 2 }, items, def);
    expect(p.items).toEqual([items[0], items[1]]);
    expect(p.hasMore).toBe(true);
    expect(p.nextCursor).toBeTruthy();
  });
  it('second page: cursor for B yields C, D (and no more)', () => {
    const cur = encodeCursor({ sortValue: '2026-01-02T00:00:00Z', id: 'b' });
    const p = paginate({ limit: 10, cursor: cur }, items, def);
    expect(p.items).toEqual([items[2], items[3]]);  // C, D
    expect(p.hasMore).toBe(false);
    expect(p.nextCursor).toBeNull();
  });
  it('desc order: D, C (same date uses id order); next yields B, A', () => {
    const p1 = paginate({ limit: 2, direction: 'desc' }, items, def);
    expect(p1.items.map(i => i.id)).toEqual(['d', 'c']);
    const cur = encodeCursor({ sortValue: '2026-01-02T00:00:00Z', id: 'c' });
    const p2 = paginate({ limit: 10, cursor: cur, direction: 'desc' }, items, def);
    expect(p2.items.map(i => i.id)).toEqual(['b', 'a']);
  });
  it('limit is clamped to [1, 100]', () => {
    const p = paginate({ limit: 1000 }, items, def);
    expect(p.items.length).toBeLessThanOrEqual(100);
    const p0 = paginate({ limit: 0 }, items, def);
    expect(p0.items.length).toBeGreaterThanOrEqual(1);
  });
  it('orders by the definition sortKey; a request ?sort= does not change the order', () => {
    const byDef = paginate({ limit: 10 }, items, def).items.map((i: any) => i.id);
    const withSort = paginate({ limit: 10, sort: 'name' }, items, def).items.map((i: any) => i.id);
    expect(withSort).toEqual(byDef);
    const want = [...items].sort((a: any, b: any) => String(a[def.sortKey]).localeCompare(String(b[def.sortKey])) || a.id.localeCompare(b.id)).map((i: any) => i.id);
    expect(byDef).toEqual(want);
  });
});
