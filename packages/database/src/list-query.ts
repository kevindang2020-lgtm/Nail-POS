// list-query.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21 / #22 / #23): the ONE server-side parser for list
// endpoints' filtering, sorting, search, paging and date ranges, and the Kysely applier that turns its output into SQL.
//
// Every list endpoint declares a ListQuerySpec — the filters it allows (with their type and, when the repository uses the
// applier, the column), the sortable fields, the search columns, its page-size ceiling and its date-range cap — with
// `@ListQuery(spec)` on the handler or `@ListQueries({ handler: spec })` on the controller. The global ListQueryInterceptor
// (apps/api/src/common/list-query) runs parseListQuery on every decorated request:
//
//   - filter[field]=v  (or `a,b`, or repeated)  → only declared fields; anything else is 400 INVALID_FILTER (§49)
//   - the endpoint's older plain parameters (?status=active) are the SAME filters under their legacy names (aliases),
//     validated the same way, so no client breaks; other undeclared top-level parameters are ignored (cache-busters,
//     async=1, tracking parameters) — consistently (§49)
//   - sort=field | -field | a,-b  — and the older `?sort=field&dir=desc` pair — only declared fields, else INVALID_SORT (§50)
//   - q (or the endpoint's legacy `search`) — tenant scoping is the repository's WHERE, applied before the search (§51)
//   - limit (or pageSize) clamped to the endpoint's maxLimit (§47); cursor passes through to the cursor codec (§45/#20)
//   - from / to as YYYY-MM-DD (the branch's calendar day, via @aipowersalon/date-time) or ISO instants; a span longer than
//     maxDays is 400 DATE_RANGE_TOO_LARGE (§52); inverted or unparseable bounds are INVALID_FILTER
//
// Injection-safe by construction: a column, an operator and a sort direction only ever come from the spec (developer
// strings, checked against an identifier pattern when the spec is declared); request values only ever reach SQL as bound
// parameters. Nothing a client sends is interpolated.
import 'reflect-metadata';
import { sql } from 'kysely';
import { localDateTimeToEpochMs, isYmd, addDays } from '@aipowersalon/date-time';
import { maxRangeDays, rangeSpanDays, MAX_PAGE_SIZE, type RangeContext, type ListQueryErrorCode } from '@aipowersalon/api-contracts';

export type ListFilterType = 'enum' | 'uuid' | 'id' | 'text' | 'bool' | 'int' | 'number' | 'date';
export type ListFilterOp = 'eq' | 'ilike' | 'prefix' | 'gte' | 'lte';

export interface ListFilterSpec {
  type: ListFilterType;
  /** enum: the allowed values (matched case-insensitively; the client's spelling is kept for legacy handlers). */
  values?: readonly string[];
  /** The SQL column the applier filters on. Absent → the handler applies it itself (legacy repositories). */
  column?: string;
  /** How the applier compares (default eq). */
  op?: ListFilterOp;
  /** The value may be a list (`a,b` or a repeated parameter) → IN. */
  multi?: boolean;
  /** The endpoint's older plain query parameter names for this filter. Default: [the field name]. */
  aliases?: readonly string[];
  /** int / number bounds; text maximum length (default 200). */
  min?: number; max?: number; maxLength?: number;
}

export interface ListDateRangeSpec {
  /** The longest interactive span, in days, or a named context from MAX_RANGE_DAYS (api-contracts/date-range.ts). */
  maxDays: number | RangeContext;
  /** The column the applier ranges on. Absent → the handler applies the bounds itself. */
  column?: string;
  /** Legacy names for the bounds (default ['from'] / ['to']; the canonical names are always accepted). */
  from?: readonly string[];
  to?: readonly string[];
  /** Legacy look-back parameters (`?days=30`) — the same cap applies. */
  days?: readonly string[];
  /** The window (days back from now) the parse output carries when the client sends no bound. Never written back. */
  defaultDays?: number;
}

export interface ListSearchSpec {
  /** Legacy names for the search text (the canonical `q` is always accepted). */
  params?: readonly string[];
  /** Columns the applier searches (ILIKE, escaped). */
  columns?: readonly string[];
  maxLength?: number;
}

export interface ListQuerySpec {
  filters?: Record<string, ListFilterSpec>;
  /** Sortable fields → column (null: the handler sorts by this key itself; it is still allow-listed). */
  sorts?: Record<string, string | null>;
  /** e.g. '-createdAt' or 'name,-createdAt'. */
  defaultSort?: string;
  /** A unique column appended to every ORDER BY so pages are stable (§46), e.g. 'id'. */
  tiebreaker?: string;
  /** Legacy parameter names for the sort field and direction (defaults: sort / dir, direction, sortDir, order). */
  sortParams?: readonly string[];
  dirParams?: readonly string[];
  /** The direction of an unsigned field sent without a direction parameter (default 'asc'). An endpoint whose older
   *  `?sort=field` always meant descending keeps that meaning with 'desc'. */
  unsignedDirection?: 'asc' | 'desc';
  /** Where to write a canonical `sort=-x` back for a handler that reads a field + direction pair. */
  legacySort?: { by: string; dir?: string; descValue?: string; ascValue?: string };
  search?: ListSearchSpec | false;
  /** Page-size ceiling (§47). When declared, the clamped size is written back for the handler. */
  maxLimit?: number;
  defaultLimit?: number;
  /** Legacy names for the page size (canonical `limit` always accepted). Default ['limit', 'pageSize']. */
  limitParams?: readonly string[];
  dateRange?: ListDateRangeSpec;
  /** Other parameters the handler reads that are not filters (page, offset, cursor, presentation flags) — documentation. */
  params?: readonly string[];
}

export interface ListWhere { field: string; column: string; op: ListFilterOp | 'in'; value: unknown }
export interface ListOrder { field: string; column: string | null; direction: 'asc' | 'desc' }
export interface ListRange { fromMs: number; toMs: number; toExclusive: boolean; days: number; column: string | null; defaulted: boolean; source: 'bounds' | 'days' | 'default' }
export interface ParsedListQuery {
  filters: Record<string, unknown>;
  where: ListWhere[];
  q: string | null;
  searchColumns: readonly string[];
  sort: ListOrder[];
  tiebreaker: string | null;
  limit: number;
  cursor: string | null;
  range: ListRange | null;
}

export interface ListQueryErrorDetail { field?: string; allowed?: string[]; maxDays?: number }
export class ListQueryError extends Error {
  constructor(readonly code: ListQueryErrorCode, message: string, readonly details: ListQueryErrorDetail = {}) {
    super(message); this.name = 'ListQueryError';
  }
}

const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_MS = /^\d{12,14}$/;   // a client that sends Date.now()-style instants
const DAY_MS = 86_400_000;
const DEFAULT_SORT_PARAMS = ['sort', 'sortBy', 'orderBy'] as const;
const DEFAULT_DIR_PARAMS = ['dir', 'direction', 'sortDir', 'sortDirection', 'order'] as const;
const DEFAULT_LIMIT_PARAMS = ['limit', 'pageSize'] as const;
const TRUE = new Set(['true', '1', 'yes', 'on']);
const FALSE = new Set(['false', '0', 'no', 'off']);

/** A YYYY-MM-DD that names a real calendar day (Date.parse turns 2026-02-31 into March 3). */
function realYmd(s: string): boolean {
  if (!isYmd(s)) return false;
  const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const bad = (field: string, message: string, allowed?: string[]) => new ListQueryError('INVALID_FILTER', message, allowed ? { field, allowed } : { field });

/** Check a spec once, when it is declared — a typo in a column or a default sort fails at boot, not on a request. */
export function assertListQuerySpec(spec: ListQuerySpec, where = 'list query'): ListQuerySpec {
  const fail = (m: string) => { throw new Error(`${where}: ${m}`); };
  const col = (c: string | null | undefined, what: string) => { if (c != null && !IDENT.test(c)) fail(`${what} column "${c}" is not a plain identifier`); };
  for (const [f, s] of Object.entries(spec.filters ?? {})) {
    if (!FIELD.test(f)) fail(`filter name "${f}" is not a plain field name`);
    if (s.type === 'enum' && !(s.values && s.values.length)) fail(`enum filter "${f}" declares no values`);
    col(s.column, `filter "${f}"`);
    for (const a of s.aliases ?? []) if (!FIELD.test(a)) fail(`filter "${f}" alias "${a}" is not a plain parameter name`);
  }
  for (const [f, c] of Object.entries(spec.sorts ?? {})) { if (!FIELD.test(f)) fail(`sort field "${f}" is not a plain field name`); col(c, `sort "${f}"`); }
  if (spec.defaultSort) for (const k of splitSort(spec.defaultSort)) if (!(k.field in (spec.sorts ?? {}))) fail(`defaultSort "${k.field}" is not a declared sort`);
  col(spec.tiebreaker, 'tiebreaker');
  if (spec.search) for (const c of spec.search.columns ?? []) col(c, 'search');
  if (spec.dateRange) {
    col(spec.dateRange.column, 'dateRange');
    const m = maxRangeDays(spec.dateRange.maxDays);
    if (!Number.isFinite(m) || m < 1) fail('dateRange.maxDays must be a positive number of days');
  }
  if (spec.maxLimit !== undefined && !(Number.isInteger(spec.maxLimit) && spec.maxLimit >= 1)) fail('maxLimit must be a positive integer');
  return spec;
}

function splitSort(s: string): Array<{ field: string; direction: 'asc' | 'desc' }> {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith('-') ? { field: x.slice(1), direction: 'desc' as const } : { field: x.replace(/^\+/, ''), direction: 'asc' as const }));
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';
const first = (raw: Record<string, any>, names: readonly string[]) => { for (const n of names) if (present(raw[n])) return { name: n, value: raw[n] }; return null; };

/** The filter object of a request: `filter[x]=…` arrives as `{ filter: { x } }` (qs) or, unparsed, as `'filter[x]'` keys. */
export function requestFilters(raw: Record<string, any>, spec?: ListQuerySpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const f = raw?.filter;
  // an endpoint whose own older parameter is literally named `filter` (?filter=ready) keeps it: a plain string there is
  // that legacy filter, not the canonical object
  const legacyFilterParam = !!spec && Object.entries(spec.filters ?? {}).some(([k, s]) => (s.aliases ?? [k]).includes('filter'));
  if (f !== undefined && !(legacyFilterParam && (typeof f === 'string' || Array.isArray(f)))) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw bad('filter', 'filter must be given as filter[field]=value');
    Object.assign(out, f);
  }
  for (const k of Object.keys(raw ?? {})) { const m = /^filter\[([^\]]*)\]$/.exec(k); if (m) out[m[1]] = raw[k]; }
  return out;
}

function coerce(field: string, s: ListFilterSpec, v: unknown): unknown {
  if (Array.isArray(v) || (s.multi && typeof v === 'string' && v.includes(','))) {
    if (!s.multi) throw bad(field, `${field} takes one value`);
    const parts = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
    if (parts.length > 50) throw bad(field, `${field} takes at most 50 values`);
    return parts.map((p) => coerceOne(field, s, p));
  }
  if (v !== null && typeof v === 'object') throw bad(field, `${field} is not a plain value`);
  return coerceOne(field, s, v);
}

function coerceOne(field: string, s: ListFilterSpec, v: unknown): unknown {
  const str = String(v).trim();
  switch (s.type) {
    case 'enum': {
      const hit = s.values!.find((x) => x.toLowerCase() === str.toLowerCase());
      if (hit === undefined) throw bad(field, `${field} must be one of: ${s.values!.join(', ')}`, [...s.values!]);
      return str;
    }
    case 'uuid': if (!UUID.test(str) && !(s.values ?? []).includes(str)) throw bad(field, `${field} must be an id`); return str;
    case 'id': if (!ID.test(str)) throw bad(field, `${field} must be an id`); return str;
    case 'bool': { const l = str.toLowerCase(); if (TRUE.has(l)) return true; if (FALSE.has(l)) return false; throw bad(field, `${field} must be true or false`); }
    case 'int': case 'number': {
      const n = Number(str);
      if (str === '' || !Number.isFinite(n) || (s.type === 'int' && !Number.isInteger(n))) throw bad(field, `${field} must be a number`);
      if ((s.min !== undefined && n < s.min) || (s.max !== undefined && n > s.max)) throw bad(field, `${field} must be between ${s.min ?? '-∞'} and ${s.max ?? '∞'}`);
      return n;
    }
    case 'date': if (EPOCH_MS.test(str)) return str; if (!isYmd(str) && !INSTANT.test(str)) throw bad(field, `${field} must be a date (YYYY-MM-DD) or an ISO time`); if (Number.isNaN(Date.parse(str)) || !realYmd(str.slice(0, 10))) throw bad(field, `${field} is not a real date`); return str;
    case 'text': default: {
      const max = s.maxLength ?? 200;
      if (str.length > max) throw bad(field, `${field} is longer than ${max} characters`);
      return str;
    }
  }
}

interface Bound { ms: number; dateOnly: boolean; ymd?: string }
function parseBound(name: string, v: unknown, tz: string, end: boolean): Bound {
  if (Array.isArray(v) || (v !== null && typeof v === 'object')) throw bad(name, `${name} takes one date`);
  const s = String(v).trim();
  if (YMD.test(s)) {
    if (!realYmd(s)) throw bad(name, `${name} is not a real date`);
    // a date-only bound is the branch's calendar day: from = its first instant; to = the first instant of the next day
    return { ms: localDateTimeToEpochMs(end ? addDays(s, 1) : s, '00:00', tz), dateOnly: true, ymd: s };
  }
  if (EPOCH_MS.test(s)) return { ms: Number(s), dateOnly: false };
  if (!INSTANT.test(s) || Number.isNaN(Date.parse(s)) || !realYmd(s.slice(0, 10))) throw bad(name, `${name} must be a date (YYYY-MM-DD) or an ISO time`);
  return { ms: Date.parse(s), dateOnly: false };
}

export interface ParseListQueryOptions { timeZone?: string; nowMs?: number }

/**
 * Validate one request's query against the endpoint's spec. Throws ListQueryError (INVALID_FILTER / INVALID_SORT /
 * DATE_RANGE_TOO_LARGE); returns the validated, allow-listed parts. `raw` is the request query (or a repository's own
 * filter object, which uses the same legacy names).
 */
export function parseListQuery(raw: Record<string, any> | null | undefined, spec: ListQuerySpec, opts: ParseListQueryOptions = {}): ParsedListQuery {
  const q0 = raw ?? {};
  const tz = opts.timeZone || 'UTC';
  const now = opts.nowMs ?? Date.now();
  const declared = spec.filters ?? {};

  // ── filters: canonical filter[x] first (unknown → 400), then the legacy plain names
  const filters: Record<string, unknown> = {};
  const canonical = requestFilters(q0, spec);
  for (const [k, v] of Object.entries(canonical)) {
    if (!Object.prototype.hasOwnProperty.call(declared, k)) throw new ListQueryError('INVALID_FILTER', `"${k}" is not a filter here`, { field: k, allowed: Object.keys(declared) });
    if (present(v)) filters[k] = coerce(k, declared[k], v);
  }
  for (const [k, s] of Object.entries(declared)) {
    if (k in filters) continue;
    const hit = first(q0, s.aliases ?? [k]);
    if (hit) filters[k] = coerce(hit.name, s, hit.value);
  }
  const where: ListWhere[] = [];
  for (const [k, v] of Object.entries(filters)) {
    const s = declared[k];
    if (!s.column) continue;
    where.push({ field: k, column: s.column, op: Array.isArray(v) ? 'in' : (s.op ?? 'eq'), value: v });
  }

  // ── search
  let q: string | null = null;
  if (spec.search !== false) {
    const hit = first(q0, ['q', ...((spec.search && spec.search.params) || [])]);
    if (hit) {
      if (typeof hit.value !== 'string') throw bad(hit.name, `${hit.name} must be text`);
      const max = (spec.search && spec.search.maxLength) || 200;
      const t = hit.value.trim();
      if (t.length > max) throw bad(hit.name, `${hit.name} is longer than ${max} characters`);
      q = t || null;
    }
  }

  // ── sort: `a,-b` or the legacy `field` + direction pair
  const sorts = spec.sorts ?? {};
  const sortHit = first(q0, ['sort', ...(spec.sortParams ?? DEFAULT_SORT_PARAMS)]);   // the canonical `sort` is always accepted
  let sortKeys: Array<{ field: string; direction: 'asc' | 'desc' }>;
  if (sortHit) {
    if (typeof sortHit.value !== 'string') throw new ListQueryError('INVALID_SORT', 'sort must be text', { field: sortHit.name });
    sortKeys = splitSort(sortHit.value);
    if (spec.unsignedDirection === 'desc') for (const k of sortKeys) if (!sortHit.value.includes('-' + k.field) && !sortHit.value.includes('+' + k.field)) k.direction = 'desc';
    if (sortKeys.length > 5) throw new ListQueryError('INVALID_SORT', 'sort takes at most 5 fields', { field: sortHit.name });
    const dirHit = first(q0, spec.dirParams ?? DEFAULT_DIR_PARAMS);
    if (dirHit && sortKeys.length === 1 && !sortHit.value.trim().startsWith('-')) {
      const d = String(dirHit.value).toLowerCase();
      if (d !== 'asc' && d !== 'desc') throw new ListQueryError('INVALID_SORT', `${dirHit.name} must be asc or desc`, { field: dirHit.name, allowed: ['asc', 'desc'] });
      sortKeys[0].direction = d;
    }
    for (const k of sortKeys) if (!Object.prototype.hasOwnProperty.call(sorts, k.field)) throw new ListQueryError('INVALID_SORT', `"${k.field}" is not a sort order here`, { field: k.field, allowed: Object.keys(sorts) });
  } else sortKeys = spec.defaultSort ? splitSort(spec.defaultSort) : [];
  const sort: ListOrder[] = sortKeys.map((k) => ({ field: k.field, column: sorts[k.field] ?? null, direction: k.direction }));

  // ── limit / cursor
  const maxLimit = Math.min(spec.maxLimit ?? MAX_PAGE_SIZE, 1000);
  const limHit = first(q0, ['limit', ...(spec.limitParams ?? DEFAULT_LIMIT_PARAMS)]);
  let limit = Math.min(spec.defaultLimit ?? 50, maxLimit);
  if (limHit) {
    const n = Number(String(limHit.value));
    if (Array.isArray(limHit.value) || String(limHit.value).trim() === '' || !Number.isFinite(n)) throw bad(limHit.name, `${limHit.name} must be a number`);
    limit = Math.min(Math.max(1, Math.trunc(n)), maxLimit);   // clamped like clampPageSize — never more than the ceiling
  }
  const cursor = present(q0.cursor) ? String(q0.cursor) : null;
  if (cursor && cursor.length > 2048) throw bad('cursor', 'cursor is not valid — restart from the first page');

  // ── date range
  let range: ListRange | null = null;
  const dr = spec.dateRange;
  if (dr) {
    const cap = maxRangeDays(dr.maxDays);
    const col = dr.column ?? null;
    const fHit = first(q0, ['from', ...(dr.from ?? [])]);
    const tHit = first(q0, ['to', ...(dr.to ?? [])]);
    const dHit = dr.days ? first(q0, dr.days) : null;
    const tooLarge = (field: string) => new ListQueryError('DATE_RANGE_TOO_LARGE', `The maximum range here is ${cap} days. Use an export for a longer range.`, { field, maxDays: cap });
    if (fHit || tHit) {
      const f = fHit ? parseBound(fHit.name, fHit.value, tz, false) : null;
      const t = tHit ? parseBound(tHit.name, tHit.value, tz, true) : null;
      // a one-sided range is bounded by the cap: from → now, or (to − cap) → to
      const toMs = t ? t.ms : now;
      const fromMs = f ? f.ms : toMs - cap * DAY_MS;
      if (toMs < fromMs) throw bad(tHit ? tHit.name : 'to', 'The end date must not be before the start date.');
      const dateOnly = !!(f?.dateOnly && t?.dateOnly);
      // measured like validateDateRange: date-only bounds count calendar days between the two days given
      const days = dateOnly ? rangeSpanDays(f!.ms, localDateTimeToEpochMs(t!.ymd!, '00:00', tz), true) : rangeSpanDays(fromMs, toMs);
      if (days > cap) throw tooLarge(fHit ? fHit.name : tHit!.name);
      range = { fromMs, toMs, toExclusive: !t || t.dateOnly, days, column: col, defaulted: false, source: 'bounds' };
    } else if (dHit) {
      const n = Number(String(dHit.value));
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) throw bad(dHit.name, `${dHit.name} must be a whole number of days`);
      if (n > cap) throw tooLarge(dHit.name);
      range = { fromMs: now - n * DAY_MS, toMs: now, toExclusive: false, days: n, column: col, defaulted: false, source: 'days' };
    } else if (dr.defaultDays) {
      const n = Math.min(dr.defaultDays, cap);
      range = { fromMs: now - n * DAY_MS, toMs: now, toExclusive: false, days: n, column: col, defaulted: true, source: 'default' };
    }
  }

  return { filters, where, q, searchColumns: (spec.search && spec.search.columns) || [], sort, tiebreaker: spec.tiebreaker ?? null, limit, cursor, range };
}

/**
 * Write the canonical parameters a client sent (filter[x], q, sort=-x, limit, from/to) back under the legacy names the
 * endpoint's handler reads, so a handler that has not moved onto the applier sees the same request either way. Only
 * fills a legacy name the client did not send itself; mutates and returns `query`.
 */
export function writeLegacyParams(query: Record<string, any>, spec: ListQuerySpec, parsed: ParsedListQuery): Record<string, any> {
  const canonical = requestFilters(query, spec);
  for (const [k, v] of Object.entries(canonical)) {
    const s = spec.filters?.[k]; if (!s || !present(v)) continue;
    const name = (s.aliases ?? [k])[0];
    if (!present(query[name])) query[name] = Array.isArray(v) ? v.join(',') : String(v);
  }
  // the canonical filter object has been handed over under the handler's names — remove it, so a handler or repository
  // that passes the whole query on (or re-parses it against a narrower spec) never sees it twice
  if (Object.keys(canonical).length) {
    if (query.filter && typeof query.filter === 'object' && !Array.isArray(query.filter)) delete query.filter;
    for (const k of Object.keys(query)) if (/^filter\[[^\]]*\]$/.test(k)) delete query[k];
  }
  // a filter that arrived under one of its older alternative names reaches the handler under the name it reads (the first)
  for (const [k, s] of Object.entries(spec.filters ?? {})) {
    const names = s.aliases ?? [k];
    if (names.length < 2 || present(query[names[0]]) || k in canonical) continue;
    const hit = first(query, names.slice(1));
    if (hit && !(hit.name === 'filter' && typeof hit.value === 'object' && !Array.isArray(hit.value))) query[names[0]] = hit.value;
  }
  if (spec.search && spec.search.params?.length && present(query.q) && !present(query[spec.search.params[0]])) query[spec.search.params[0]] = String(query.q).trim();
  // the canonical `sort` (signed, or the legacy sort + dir pair) → the handler's own field + direction parameters
  const ls = spec.legacySort; const s0 = parsed.sort[0];
  if (ls && s0 && present(query.sort)) {
    query[ls.by] = s0.field;
    if (ls.dir) query[ls.dir] = s0.direction === 'desc' ? (ls.descValue ?? 'desc') : (ls.ascValue ?? 'asc');
  }
  const limNames = spec.limitParams ?? DEFAULT_LIMIT_PARAMS;
  if (present(query.limit) && limNames[0] && limNames[0] !== 'limit' && !present(query[limNames[0]])) query[limNames[0]] = String(parsed.limit);
  if (spec.maxLimit !== undefined) for (const n of ['limit', ...limNames]) if (present(query[n]) && Number(query[n]) > parsed.limit) query[n] = String(parsed.limit);
  const dr = spec.dateRange;
  if (dr) {
    if (dr.from?.length && present(query.from) && !present(query[dr.from[0]])) query[dr.from[0]] = query.from;
    if (dr.to?.length && present(query.to) && !present(query[dr.to[0]])) query[dr.to[0]] = query.to;
  }
  return query;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

export interface ApplyListQueryOptions { filters?: boolean; search?: boolean; range?: boolean; sort?: boolean; limit?: boolean }

/**
 * Apply a parsed list query to a Kysely select. Columns come only from the spec; values only as bound parameters.
 * Each part can be switched off (e.g. `{ sort: false, limit: false }` for the count query of an offset page).
 */
export function applyListQuery<QB extends { where: (...a: any[]) => any }>(qb: QB, p: ParsedListQuery, o: ApplyListQueryOptions = {}): QB {
  let q: any = qb;
  if (o.filters !== false) for (const w of p.where) {
    const ref = sql.ref(w.column);
    if (w.op === 'in') q = q.where(ref, 'in', w.value as unknown[]);
    else if (w.op === 'ilike') q = q.where(ref, 'ilike', `%${escapeLike(String(w.value))}%`);
    else if (w.op === 'prefix') q = q.where(ref, 'ilike', `${escapeLike(String(w.value))}%`);
    else if (w.op === 'gte') q = q.where(ref, '>=', w.value);
    else if (w.op === 'lte') q = q.where(ref, '<=', w.value);
    else q = q.where(ref, '=', w.value);
  }
  if (o.search !== false && p.q && p.searchColumns.length) {
    const pat = `%${escapeLike(p.q)}%`;
    q = q.where((eb: any) => eb.or(p.searchColumns.map((c) => eb(sql.ref(c), 'ilike', pat))));
  }
  if (o.range !== false && p.range?.column) {
    const ref = sql.ref(p.range.column);
    q = q.where(ref, '>=', new Date(p.range.fromMs)).where(ref, p.range.toExclusive ? '<' : '<=', new Date(p.range.toMs));
  }
  if (o.sort !== false) {
    for (const s of p.sort) if (s.column) q = q.orderBy(sql.ref(s.column), s.direction);
    if (p.tiebreaker && p.sort.some((s) => s.column)) q = q.orderBy(sql.ref(p.tiebreaker), p.sort.find((s) => s.column)!.direction);
  }
  if (o.limit !== false) q = q.limit(p.limit);
  return q as QB;
}

// ── declaration: @ListQuery(spec) on a handler, or @ListQueries({ handler: spec }) on a controller
export const LIST_QUERY_METADATA = 'aipowersalon:list-query';

/** Declare a handler's list query (validated once, at class definition). */
export function ListQuery(spec: ListQuerySpec): MethodDecorator {
  return (target, key, descriptor: PropertyDescriptor) => {
    assertListQuerySpec(spec, `${(target as any)?.constructor?.name ?? '?'}.${String(key)}`);
    Reflect.defineMetadata(LIST_QUERY_METADATA, spec, descriptor.value);
    return descriptor;
  };
}

/** Declare several handlers' list queries from one map (method name → spec) — every name must be a method of the class. */
export function ListQueries(map: Record<string, ListQuerySpec>): ClassDecorator {
  return (ctor: any) => {
    for (const [name, spec] of Object.entries(map)) {
      const fn = ctor.prototype[name];
      if (typeof fn !== 'function') throw new Error(`@ListQueries on ${ctor.name}: "${name}" is not a method of the controller`);
      assertListQuerySpec(spec, `${ctor.name}.${name}`);
      Reflect.defineMetadata(LIST_QUERY_METADATA, spec, fn);
    }
  };
}

/** The spec declared for a handler function, if any. */
export function listQuerySpecOf(handler: object): ListQuerySpec | undefined {
  return Reflect.getMetadata(LIST_QUERY_METADATA, handler);
}
