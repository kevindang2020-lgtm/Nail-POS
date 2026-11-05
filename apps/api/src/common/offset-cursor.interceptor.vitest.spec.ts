import { describe, it, expect } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { encodeOffsetCursor, decodeOffsetCursor } from '@aipowersalon/api-contracts';
import { OffsetCursorInterceptor, applyCursorToQuery, offsetPageOf } from './offset-cursor.interceptor';

const ctxFor = (req: any) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as any;
const run = (req: any, body: any) => lastValueFrom(new OffsetCursorInterceptor().intercept(ctxFor(req), { handle: () => of(body) }) as any);
const nested = (page: number, totalPages: number) => ({ items: [1], pagination: { page, pageSize: 20, totalItems: totalPages * 20, totalPages } });

describe('OffsetCursorInterceptor', () => {
  it('adds nextCursor to a nested offset page and null on the last page', async () => {
    const out: any = await run({ method: 'GET', query: { sort: 'created_at', dir: 'desc' } }, nested(1, 3));
    expect(decodeOffsetCursor(out.nextCursor)).toMatchObject({ page: 2, pageSize: 20, sortKey: 'created_at', direction: 'desc', sizeKey: 'pageSize' });
    expect(((await run({ method: 'GET', query: {} }, nested(3, 3))) as any).nextCursor).toBeNull();
  });
  it('handles the flat {items, page, limit, total} shape and remembers the size key', async () => {
    const out: any = await run({ method: 'GET', query: {} }, { rows: [], page: 1, limit: 10, total: 25 });
    expect(decodeOffsetCursor(out.nextCursor)).toMatchObject({ page: 2, pageSize: 10, sizeKey: 'limit' });
    const nl: any = await run({ method: 'GET', query: {} }, { items: [], pagination: { page: 1, limit: 10, totalItems: 25, totalPages: 3 } });
    expect(decodeOffsetCursor(nl.nextCursor)).toMatchObject({ page: 2, pageSize: 10, sizeKey: 'limit' });
  });
  it('leaves responses that already carry nextCursor, non-pages and non-GETs alone', async () => {
    const own = { items: [], nextCursor: 'keyset-v2', pagination: { page: 1, pageSize: 5, totalPages: 9 } };
    expect(await run({ method: 'GET', query: {} }, own)).toBe(own);
    const plain = { items: [1, 2] };
    expect(await run({ method: 'GET', query: {} }, plain)).toBe(plain);
    const posted = nested(1, 3);
    expect(await run({ method: 'POST', query: {} }, posted)).toBe(posted);
  });
  it('turns ?cursor= into page/size/sort/dir on the request', () => {
    const q: any = { cursor: encodeOffsetCursor({ page: 4, pageSize: 10, sortKey: 'occurred_at', direction: 'desc', sizeKey: 'limit' }) };
    expect(applyCursorToQuery(q)).toBeNull();
    expect(q).toMatchObject({ page: '4', limit: '10', sort: 'occurred_at', dir: 'desc' });
  });
  it('leaves other cursor formats untouched (nail-showcase timestamp cursor)', () => {
    const q: any = { cursor: '2026-10-01T12:00:00.000Z' };
    expect(applyCursorToQuery(q)).toBeNull();
    expect(q.page).toBeUndefined();
  });
  it('refuses a tampered cursor and a cursor that disagrees with ?page=', async () => {
    const bad = Buffer.from(JSON.stringify({ v: 3, offset: 7, limit: 20 })).toString('base64url');
    expect(() => new OffsetCursorInterceptor().intercept(ctxFor({ method: 'GET', query: { cursor: bad } }), { handle: () => of(nested(1, 2)) })).toThrow(expect.objectContaining({ status: 400 }));
    const c = encodeOffsetCursor({ page: 2, pageSize: 20 });
    expect(applyCursorToQuery({ cursor: c, page: '5' })).toMatch(/disagree/);
    expect(applyCursorToQuery({ cursor: c, page: '2', pageSize: '20' })).toBeNull();
    const q: any = { cursor: c, pageSize: '500' };   // client re-sends a size the server clamped → cursor's size wins
    expect(applyCursorToQuery(q)).toBeNull();
    expect(q.pageSize).toBe('20');
  });
  it('does not mistake malformed pagination for a page', () => {
    expect(offsetPageOf({ pagination: { page: '1', pageSize: 20, totalPages: 2 } })).toBeNull();
    expect(offsetPageOf({ items: [], page: 1, pageSize: 20 })).toBeNull();
    expect(offsetPageOf([1, 2])).toBeNull();
  });
});
