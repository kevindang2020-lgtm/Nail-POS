import { describe, it, expect } from 'vitest';
import { encodeOffsetCursor, decodeOffsetCursor, inspectOffsetCursor, encodeCursor, decodeCursor } from './cursor';

const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('offset cursor codec', () => {
  it('round-trips page, size, sort, direction and size key', () => {
    const c = encodeOffsetCursor({ page: 3, pageSize: 25, sortKey: 'created_at', direction: 'desc', sizeKey: 'limit' });
    expect(decodeOffsetCursor(c)).toEqual({ page: 3, pageSize: 25, sortKey: 'created_at', direction: 'desc', sizeKey: 'limit' });
  });
  it('is byte-identical to Node base64url (the Step 5a server format)', () => {
    for (const p of [1, 2, 7, 400]) {
      const c = encodeOffsetCursor({ page: p, pageSize: 50 });
      expect(Buffer.from(c, 'base64url').toString('utf8')).toBe(JSON.stringify({ v: 3, offset: (p - 1) * 50, limit: 50, sort: '', dir: 'asc', k: 'pageSize' }));
    }
  });
  it('decodes a Step 5a cursor (no k field)', () => {
    expect(decodeOffsetCursor(enc({ v: 3, offset: 100, limit: 50, sort: '', dir: 'asc' }))).toMatchObject({ page: 3, pageSize: 50, sizeKey: 'pageSize' });
  });
  it('treats other formats (timestamps, keyset v2, junk) as not-ours', () => {
    for (const c of ['2026-10-01T00:00:00Z', enc({ v: 2, s: 'x', id: 'y' }), 'not base64!', '', undefined]) expect(inspectOffsetCursor(c).kind).toBe('other');
  });
  it('refuses tampered v3 cursors', () => {
    for (const o of [{ v: 3, offset: -50, limit: 50 }, { v: 3, offset: 10, limit: 50 }, { v: 3, offset: 0, limit: 0 }, { v: 3, offset: 0, limit: 5000 },
      { v: 3, offset: 0, limit: 50, sort: 'x; drop table' }, { v: 3, offset: 0, limit: 50, dir: 'sideways' }, { v: 3, offset: 0, limit: 50, k: 'offset' }])
      expect(inspectOffsetCursor(enc(o)).kind).toBe('invalid');
  });
  it('drops a non-identifier sort key instead of encoding it', () => {
    const d = decodeOffsetCursor(encodeOffsetCursor({ page: 1, pageSize: 10, sortKey: 'a b' }));
    expect(d).not.toBeNull();
    expect(d?.sortKey).toBeUndefined();
  });
});

describe('keyset cursor codec (v2)', () => {
  it('is byte-identical to the Node Buffer encoding for ASCII, accents, CJK and emoji', () => {
    for (const s of ['2026-10-01T00:00:00.000Z', 42, 'José Núñez', '美甲沙龙', 'nails 💅🏽', '']) {
      const c = encodeCursor({ sortValue: s, id: 'a1b2' });
      expect(c).toBe(Buffer.from(JSON.stringify({ v: 2, s, id: 'a1b2' })).toString('base64url'));
      expect(decodeCursor(c)).toEqual({ sortValue: s, id: 'a1b2' });
    }
  });
  it('refuses other schemes and broken input', () => {
    expect(decodeCursor(encodeOffsetCursor({ page: 2, pageSize: 10 }))).toBeNull();
    expect(decodeCursor(enc({ v: 2, s: 1 }))).toBeNull();
    expect(decodeCursor(Buffer.from([0x7b, 0xff, 0xfe]).toString('base64url'))).toBeNull();
    expect(decodeCursor('%%%')).toBeNull();
  });
  it('an offset decoder sees a keyset cursor as another scheme', () => {
    expect(inspectOffsetCursor(encodeCursor({ sortValue: 1, id: 'x' })).kind).toBe('other');
  });
});
