// cursor.ts — Constitution 5 §46 / G10: the ONE cursor codec (server + apps). Two schemes:
//   v2 keyset  {v:2, s:sortValue, id}            — repositories that ORDER BY (sort_value, id)
//   v3 offset  {v:3, offset, limit, sort, dir, k} — repositories still on OFFSET (the API bridge emits these)
//
// Most list repositories still page with OFFSET. Until each moves to keyset (ORDER BY sort_value, id), the API hands
// clients an opaque `nextCursor` that encodes the next offset; clients send it back as `?cursor=` unchanged. When a
// repository goes keyset, its cursor format changes to v2 (apps/api/src/api/cursor.ts) and clients notice nothing.
//
// Wire format (v3, unchanged from Step 5a): base64url(JSON {v:3, offset, limit, sort, dir, k}). `k` names the
// page-size query parameter the endpoint reads ('pageSize' or 'limit').
//
// Browser-safe and dependency-free (package rule §111): no Buffer, no TextEncoder — a small UTF-8 base64url below,
// byte-identical to Node's Buffer.from(json).toString('base64url') (tested), so cursors minted before this move decode.

export type OffsetSortDirection = 'asc' | 'desc';
export type PageSizeKey = 'pageSize' | 'limit';
export interface OffsetPaginationParams { page: number; pageSize: number; sortKey?: string; direction?: OffsetSortDirection; sizeKey?: PageSizeKey }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IDENT = /^[A-Za-z0-9_.]{1,64}$/;
const MAX_OFFSET = 10_000_000;
const MAX_LIMIT = 1000;

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8String(b: number[]): string | null {
  let s = '';
  for (let i = 0; i < b.length;) {
    const x = b[i];
    const n = x < 0x80 ? 1 : (x & 0xe0) === 0xc0 ? 2 : (x & 0xf0) === 0xe0 ? 3 : (x & 0xf8) === 0xf0 ? 4 : 0;
    if (!n || i + n > b.length) return null;
    let c = n === 1 ? x : x & (0xff >> (n + 1));
    for (let j = 1; j < n; j++) { if ((b[i + j] & 0xc0) !== 0x80) return null; c = (c << 6) | (b[i + j] & 63); }
    s += String.fromCodePoint(c); i += n;
  }
  return s;
}

function b64urlEncode(text: string): string {
  const b = utf8Bytes(text); let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}

function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((j) => (i + j < s.length ? B64.indexOf(s[i + j]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    b.push((n >> 16) & 255);
    if (i + 2 < s.length) b.push((n >> 8) & 255);
    if (i + 3 < s.length) b.push(n & 255);
  }
  return utf8String(b);
}

function parse(cursor: unknown): any {
  if (typeof cursor !== 'string' || !cursor) return undefined;
  const json = b64urlDecode(cursor);
  if (json === null) return undefined;
  try { const d = JSON.parse(json); return d && typeof d === 'object' && !Array.isArray(d) ? d : undefined; } catch { return undefined; }
}

// ── v2 keyset ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface CursorPair { sortValue: any; id: string }
export function encodeCursor(pair: CursorPair): string {
  return b64urlEncode(JSON.stringify({ v: 2, s: pair.sortValue, id: pair.id }));
}
/** null = absent, malformed, or another scheme. A caller that received a cursor and got null must refuse it (400). */
export function decodeCursor(cursor: unknown): CursorPair | null {
  const d = parse(cursor);
  if (!d || d.v !== 2 || d.s === undefined || typeof d.id !== 'string' || !d.id) return null;
  return { sortValue: d.s, id: d.id };
}

// ── v3 offset ───────────────────────────────────────────────────────────────────────────────────────────────────
export function encodeOffsetCursor(p: OffsetPaginationParams): string {
  const limit = Math.max(1, Math.trunc(p.pageSize));
  const offset = Math.max(0, (Math.max(1, Math.trunc(p.page)) - 1) * limit);
  const sort = p.sortKey && IDENT.test(p.sortKey) ? p.sortKey : '';
  const dir = p.direction === 'desc' ? 'desc' : 'asc';
  const k = p.sizeKey === 'limit' ? 'limit' : 'pageSize';
  return b64urlEncode(JSON.stringify({ v: 3, offset, limit, sort, dir, k }));
}

/** 'other' = not an offset cursor at all (some endpoints own their own cursor format — leave it alone).
 *  'invalid' = a v3 offset cursor whose contents are out of range or not ours (tampered) — the caller refuses it. */
export type OffsetCursorDecode = { kind: 'ok'; params: OffsetPaginationParams } | { kind: 'other' } | { kind: 'invalid' };

export function inspectOffsetCursor(cursor: unknown): OffsetCursorDecode {
  const d = parse(cursor);
  if (!d || d.v !== 3) return { kind: 'other' };
  const okInt = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
  if (!okInt(d.offset, 0, MAX_OFFSET) || !okInt(d.limit, 1, MAX_LIMIT) || d.offset % d.limit !== 0) return { kind: 'invalid' };
  if (d.sort !== undefined && d.sort !== '' && (typeof d.sort !== 'string' || !IDENT.test(d.sort))) return { kind: 'invalid' };
  if (d.dir !== undefined && d.dir !== 'asc' && d.dir !== 'desc') return { kind: 'invalid' };
  if (d.k !== undefined && d.k !== 'pageSize' && d.k !== 'limit') return { kind: 'invalid' };
  return { kind: 'ok', params: { page: d.offset / d.limit + 1, pageSize: d.limit, sortKey: d.sort || undefined, direction: d.dir === 'desc' ? 'desc' : 'asc', sizeKey: d.k === 'limit' ? 'limit' : 'pageSize' } };
}

export function decodeOffsetCursor(cursor: unknown): OffsetPaginationParams | null {
  const r = inspectOffsetCursor(cursor);
  return r.kind === 'ok' ? r.params : null;
}
