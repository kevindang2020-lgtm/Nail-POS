// offset-cursor.interceptor.ts — Constitution 5 §46 / G10: every OFFSET-paged list also speaks cursors, in one place.
//
// The same bridge pattern as VersionPreconditionInterceptor (ETag/If-Match): the 26+ list repositories keep their
// page/pageSize code; this interceptor translates at the edge.
//
//  REQUEST  GET ?cursor=<v3 offset cursor>  → req.query.page / pageSize|limit / sort / dir filled from the cursor.
//           A cursor in another format (an endpoint's own keyset or timestamp cursor) is left untouched.
//           A tampered v3 cursor, or one that disagrees with an explicit ?page=, is a 400 VALIDATION_FAILED —
//           (an explicit size is overridden by the cursor's, which is the size the server actually served) —
//           never silently "page 1" (that would duplicate rows in an infinite scroll).
//  RESPONSE A body carrying an offset page — `pagination: {page, pageSize|limit, totalPages}` or flat
//           `{items|rows|data: [], page, pageSize|limit, total|totalItems}` — and no `nextCursor` of its own gets
//           `nextCursor` (string, or null on the last page). Sort/direction from the request ride along in the cursor.
//
// When a repository moves to keyset pagination it returns its own `nextCursor` and this bridge steps aside.
import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { encodeOffsetCursor, inspectOffsetCursor, type OffsetPaginationParams, type PageSizeKey } from '@aipowersalon/api-contracts';

const int = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) ? x : null);
const qInt = (x: unknown): number | null => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null);
const refuse = (message: string) => new BadRequestException({ code: 'VALIDATION_FAILED', message });

/** Apply a decoded cursor to a query object. Returns an error message, or null on success / not-ours. */
export function applyCursorToQuery(query: Record<string, any>): string | null {
  const raw = query?.cursor;
  if (raw === undefined) return null;
  const r = inspectOffsetCursor(raw);
  if (r.kind === 'other') return null;
  if (r.kind === 'invalid') return 'cursor is not valid — restart from the first page';
  const p = r.params; const k = p.sizeKey ?? 'pageSize';
  // A different ?page= is a conflicting position → refuse. A different size is overridden: the cursor carries the size
  // the server actually used (after its clamp), and a client that re-sends its original larger size must not break.
  if (query.page !== undefined && qInt(query.page) !== p.page) return 'cursor and page parameter disagree — send one or the other';
  query.page = String(p.page); query[k] = String(p.pageSize);
  if (p.sortKey && query.sort === undefined) query.sort = p.sortKey;
  if (p.direction && p.sortKey && query.dir === undefined && query.direction === undefined) query.dir = p.direction;
  return null;
}

/** Read an offset page from a response body, or null if it is not one. */
export function offsetPageOf(body: any): { page: number; pageSize: number; totalPages: number; sizeKey: PageSizeKey } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'nextCursor' in body) return null;
  const pg = body.pagination;
  if (pg && typeof pg === 'object') {
    const page = int(pg.page), totalPages = int(pg.totalPages);
    const size = int(pg.pageSize) ?? int(pg.limit);
    if (page && size && totalPages !== null && page >= 1 && size >= 1) return { page, pageSize: size, totalPages, sizeKey: int(pg.pageSize) ? 'pageSize' : 'limit' };
    return null;
  }
  const list = Array.isArray(body.items) || Array.isArray(body.rows) || Array.isArray(body.data);
  const page = int(body.page), size = int(body.pageSize) ?? int(body.limit), total = int(body.totalItems) ?? int(body.total);
  if (list && page && size && total !== null && page >= 1 && size >= 1)
    return { page, pageSize: size, totalPages: int(body.totalPages) ?? Math.max(1, Math.ceil(total / size)), sizeKey: int(body.pageSize) ? 'pageSize' : 'limit' };
  return null;
}

export function nextCursorFor(pg: NonNullable<ReturnType<typeof offsetPageOf>>, query: Record<string, any>): string | null {
  if (pg.page >= pg.totalPages) return null;
  const dir = String(query?.dir ?? query?.direction ?? '').toLowerCase();
  const params: OffsetPaginationParams = { page: pg.page + 1, pageSize: pg.pageSize, sizeKey: pg.sizeKey,
    sortKey: typeof query?.sort === 'string' ? query.sort : undefined, direction: dir === 'desc' ? 'desc' : 'asc' };
  return encodeOffsetCursor(params);
}

@Injectable()
export class OffsetCursorInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    if (req.method !== 'GET') return next.handle();
    const err = applyCursorToQuery(req.query ?? {});
    if (err) throw refuse(err);
    return next.handle().pipe(map((body: any) => {
      const pg = offsetPageOf(body);
      return pg ? { ...body, nextCursor: nextCursorFor(pg, req.query ?? {}) } : body;
    }));
  }
}
