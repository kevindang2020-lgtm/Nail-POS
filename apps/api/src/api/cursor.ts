// cursor.ts — Constitution 5 §46: keyset pagination over offset. A cursor encodes (sortValue, entityId) so every
// query orders by both to give a total order; limit+1 answers hasMore without a COUNT. One cursor per
// sort+direction pair; malformed cursors throw rather than degrade. The definition's sortKey IS the order
// (a per-request ?sort= is not honoured here — an endpoint that needs several orders defines one definition per order).
export interface CursorPage<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export type SortDirection = 'asc' | 'desc';
export interface CursorRequest { limit: number; cursor?: string; sort?: string; direction?: SortDirection }

// The codec itself (v2 keyset + v3 offset) lives in @aipowersalon/api-contracts so the apps decode the same bytes.
export { encodeCursor, decodeCursor, type CursorPair } from '@aipowersalon/api-contracts';
import { decodeCursor, encodeCursor } from '@aipowersalon/api-contracts';

export interface CursorPageDefinition<T> {
  sortKey: string;
  sortKeyType: 'number' | 'string' | 'date';  // affects how sortValue is compared
  extractId(item: T): string;
}
export function paginate<T>(req: CursorRequest, items: T[], def: CursorPageDefinition<T>): CursorPage<T> {
  const direction = req.direction === 'desc' ? 'desc' : 'asc';
  const limit = Math.max(1, Math.min(100, req.limit)); // clamp
  const cursor = decodeCursor(req.cursor);
  if (req.cursor && !cursor) throw new Error(`Malformed cursor: "${req.cursor}"`);
  if (cursor && (cursor.sortValue === undefined || !cursor.id)) throw new Error(`Invalid cursor pair`);
  // Sort items: primary by sort key, secondary by id (total order per §46)
  const cmp = def.sortKeyType === 'date' ? dateCompare : def.sortKeyType === 'number' ? numberCompare : stringCompare;
  const sorted = [...items].sort((a, b) => {
    const av = (a as any)[def.sortKey]; const bv = (b as any)[def.sortKey];
    const c = cmp(av, bv);
    if (c !== 0) return direction === 'asc' ? c : -c;
    return direction === 'asc' ? def.extractId(a).localeCompare(def.extractId(b)) : def.extractId(b).localeCompare(def.extractId(a));
  });
  // Filter by cursor
  let page = sorted;
  if (cursor) {
    page = direction === 'asc'
      ? sorted.filter(item => cmp((item as any)[def.sortKey], cursor.sortValue) > 0 ||
          (cmp((item as any)[def.sortKey], cursor.sortValue) === 0 && def.extractId(item) > cursor.id))
      : sorted.filter(item => cmp((item as any)[def.sortKey], cursor.sortValue) < 0 ||
          (cmp((item as any)[def.sortKey], cursor.sortValue) === 0 && def.extractId(item) < cursor.id));
  }
  const hasMore = page.length > limit;
  const trimmed = page.slice(0, limit);
  const nextCursor = hasMore && trimmed.length > 0
    ? encodeCursor({ sortValue: (trimmed[trimmed.length - 1] as any)[def.sortKey], id: def.extractId(trimmed[trimmed.length - 1]) })
    : null;
  return { items: trimmed, nextCursor, hasMore };
}

// Offset-based cursor: the one codec lives in @aipowersalon/api-contracts (apps decode the same bytes).
export { encodeOffsetCursor, decodeOffsetCursor, inspectOffsetCursor, type OffsetPaginationParams } from '@aipowersalon/api-contracts';
const stringCompare = (a: any, b: any): number => String(a || '').localeCompare(String(b || ''));
const numberCompare = (a: any, b: any): number => (Number(a) || 0) - (Number(b) || 0);
const dateCompare = (a: any, b: any): number => (new Date(String(a || '')).getTime() || 0) - (new Date(String(b || '')).getTime() || 0);
