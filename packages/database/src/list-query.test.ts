// list-query.test.ts — BUILD_PLAN Phase 12 (DoD #21/#22/#23): the one list-query parser + Kysely applier.
import { describe, it, expect } from 'vitest';
import { Kysely, DummyDriver, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import {
  parseListQuery, writeLegacyParams, applyListQuery, assertListQuerySpec, ListQueryError, ListQuery, ListQueries,
  listQuerySpecOf, type ListQuerySpec,
} from './list-query';

const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(), createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });

const SPEC: ListQuerySpec = {
  filters: {
    status: { type: 'enum', values: ['active', 'archived'], column: 'c.status', multi: true },
    branchId: { type: 'uuid', column: 'c.branch_id' },
    vip: { type: 'bool', column: 'c.is_vip' },
    minVisits: { type: 'int', min: 0, max: 1000, column: 'c.visit_count', op: 'gte' },
    source: { type: 'text', aliases: ['source', 'src'], column: 'c.source' },
  },
  sorts: { name: 'c.name', createdAt: 'c.created_at', visits: null },
  defaultSort: '-createdAt',
  tiebreaker: 'c.id',
  search: { params: ['search'], columns: ['c.name', 'c.phone'] },
  maxLimit: 100,
  dateRange: { maxDays: 31, column: 'c.created_at', from: ['startDate'], to: ['endDate'], days: ['days'] },
};
const code = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e instanceof ListQueryError ? `${e.code}:${e.details.field ?? ''}` : `other:${e.message}`; } return 'ok'; };
const NOW = Date.parse('2026-10-08T12:00:00Z');
const B = '0b6c5a1e-1111-4222-8333-944455556666';

describe('filters (§48–§49)', () => {
  it('accepts canonical filter[x] (qs object and raw bracket keys) and the legacy plain names', () => {
    expect(parseListQuery({ filter: { status: 'active' } }, SPEC).filters).toEqual({ status: 'active' });
    expect(parseListQuery({ 'filter[status]': 'archived' }, SPEC).filters).toEqual({ status: 'archived' });
    expect(parseListQuery({ status: 'active', src: 'walk-in' }, SPEC).filters).toEqual({ status: 'active', source: 'walk-in' });
  });
  it('rejects an unknown filter[x] with INVALID_FILTER and lists the allowed fields', () => {
    try { parseListQuery({ filter: { password_hash: 'x' } }, SPEC); throw new Error('no'); } catch (e: any) {
      expect(e).toBeInstanceOf(ListQueryError); expect(e.code).toBe('INVALID_FILTER'); expect(e.details.allowed).toContain('status');
    }
  });
  it('ignores undeclared plain parameters (cache-busters, async=1) — consistently', () => {
    expect(code(() => parseListQuery({ _: '123', async: '1', utm_source: 'x' }, SPEC))).toBe('ok');
  });
  it('validates each type', () => {
    expect(code(() => parseListQuery({ status: 'deleted' }, SPEC))).toBe('INVALID_FILTER:status');
    expect(parseListQuery({ status: 'ACTIVE' }, SPEC).filters.status).toBe('ACTIVE');      // case-insensitive, spelling kept
    expect(code(() => parseListQuery({ branchId: 'nope' }, SPEC))).toBe('INVALID_FILTER:branchId');
    expect(parseListQuery({ branchId: B }, SPEC).filters.branchId).toBe(B);
    expect(parseListQuery({ vip: 'yes' }, SPEC).filters.vip).toBe(true);
    expect(parseListQuery({ vip: '0' }, SPEC).filters.vip).toBe(false);
    expect(code(() => parseListQuery({ vip: 'maybe' }, SPEC))).toBe('INVALID_FILTER:vip');
    expect(parseListQuery({ minVisits: '3' }, SPEC).filters.minVisits).toBe(3);
    expect(code(() => parseListQuery({ minVisits: '3.5' }, SPEC))).toBe('INVALID_FILTER:minVisits');
    expect(code(() => parseListQuery({ minVisits: '5000' }, SPEC))).toBe('INVALID_FILTER:minVisits');
    expect(code(() => parseListQuery({ source: 'x'.repeat(201) }, SPEC))).toBe('INVALID_FILTER:source');
    const D: ListQuerySpec = { filters: { day: { type: 'date' } } };
    expect(parseListQuery({ day: '2026-02-28' }, D).filters.day).toBe('2026-02-28');
    expect(code(() => parseListQuery({ day: '2026-02-31' }, D))).toBe('INVALID_FILTER:day');
    expect(code(() => parseListQuery({ day: 'tomorrow' }, D))).toBe('INVALID_FILTER:day');
  });
  it('multi values: a,b and repeated parameters → IN; a single-value filter refuses a list', () => {
    const p = parseListQuery({ filter: { status: 'active,archived' } }, SPEC);
    expect(p.filters.status).toEqual(['active', 'archived']);
    expect(p.where.find((w) => w.field === 'status')?.op).toBe('in');
    expect(parseListQuery({ status: ['active', 'archived'] }, SPEC).filters.status).toEqual(['active', 'archived']);
    expect(code(() => parseListQuery({ branchId: [B, B] }, SPEC))).toBe('INVALID_FILTER:branchId');
  });
  it('refuses nested objects as values (qs injection shapes)', () => {
    expect(code(() => parseListQuery({ source: { $ne: '' } }, SPEC))).toBe('INVALID_FILTER:source');
    expect(code(() => parseListQuery({ filter: 'status=active' }, SPEC))).toBe('INVALID_FILTER:filter');
  });
  it('an endpoint whose older parameter is literally `filter` keeps it as a plain value', () => {
    const LEG: ListQuerySpec = { filters: { view: { type: 'enum', values: ['ready', 'all'], aliases: ['filter'] } } };
    expect(parseListQuery({ filter: 'ready' }, LEG).filters).toEqual({ view: 'ready' });
    expect(code(() => parseListQuery({ filter: 'nope' }, LEG))).toBe('INVALID_FILTER:filter');
    expect(parseListQuery({ filter: { view: 'all' } }, LEG).filters).toEqual({ view: 'all' });
    expect(code(() => parseListQuery({ filter: 'ready' }, SPEC))).toBe('INVALID_FILTER:filter');
  });
  it('an empty value is "not filtered"', () => {
    expect(parseListQuery({ status: '', filter: { source: '' } }, SPEC).filters).toEqual({});
  });
});

describe('sorting (§50)', () => {
  it('signed, multi-field, legacy pair, default', () => {
    expect(parseListQuery({ sort: '-name' }, SPEC).sort.map((s) => [s.field, s.direction])).toEqual([['name', 'desc']]);
    expect(parseListQuery({ sort: 'name,-createdAt' }, SPEC).sort.map((s) => s.direction)).toEqual(['asc', 'desc']);
    expect(parseListQuery({ sort: 'name', dir: 'DESC' }, SPEC).sort[0].direction).toBe('desc');
    expect(parseListQuery({ sortBy: 'visits', sortDir: 'asc' }, SPEC).sort[0]).toEqual({ field: 'visits', column: null, direction: 'asc' });
    expect(parseListQuery({}, SPEC).sort[0]).toEqual({ field: 'createdAt', column: 'c.created_at', direction: 'desc' });
  });
  it('unsignedDirection keeps an older endpoint\'s "sort=field means descending"', () => {
    const D: ListQuerySpec = { sorts: { a: 'a', b: 'b' }, unsignedDirection: 'desc' };
    expect(parseListQuery({ sort: 'a' }, D).sort[0].direction).toBe('desc');
    expect(parseListQuery({ sort: '+a' }, D).sort[0].direction).toBe('asc');
    expect(parseListQuery({ sort: 'a', direction: 'asc' }, D).sort[0].direction).toBe('asc');
    expect(parseListQuery({ sort: '-b' }, D).sort[0].direction).toBe('desc');
  });
  it('the named-order shape `sort: { allowed, default }` is honoured — "newest" is a sort there (Nov 7 2026)', () => {
    const S: ListQuerySpec = { filters: {}, sort: { allowed: ['newest', 'oldest'], default: 'newest' } };
    expect(parseListQuery({ sort: 'newest' }, S).sort.map((k) => k.field)).toEqual(['newest']);
    expect(parseListQuery({}, S).sort.map((k) => k.field)).toEqual(['newest']);            // the default applies
    expect(code(() => parseListQuery({ sort: 'password_hash' }, S))).toBe('INVALID_SORT:password_hash');   // still allow-listed
    expect(() => assertListQuerySpec({ sort: { allowed: ['a'], default: 'b' } })).toThrow();
  });
  it('a screen that declares its own `sort` FILTER (a named order) owns the `sort` param — no INVALID_SORT (Nov 7 2026)', () => {
    const S: ListQuerySpec = { filters: { sort: { type: 'enum', values: ['newest', 'name', 'last_order'] } } };
    const r = parseListQuery({ sort: 'newest' }, S);
    expect(r.filters.sort).toBe('newest'); expect(r.sort).toEqual([]);
    expect(code(() => parseListQuery({ sort: 'password_hash' }, S))).toBe('INVALID_FILTER:sort');   // still validated, as a filter
    expect(code(() => parseListQuery({ sort: 'name' }, SPEC))).toBe('ok');                               // column sorts unchanged elsewhere
  });
  it('an undeclared field is INVALID_SORT — including SQL in the sort parameter', () => {
    expect(code(() => parseListQuery({ sort: 'password_hash' }, SPEC))).toBe('INVALID_SORT:password_hash');
    expect(code(() => parseListQuery({ sort: 'name; drop table customers' }, SPEC))).toMatch(/^INVALID_SORT/);
    expect(code(() => parseListQuery({ sort: 'name', dir: 'desc;--' }, SPEC))).toBe('INVALID_SORT:dir');
    expect(code(() => parseListQuery({ sort: 'x' }, { filters: {} }))).toBe('INVALID_SORT:x');
  });
});

describe('search, limit, cursor (§45, §47, §51)', () => {
  it('q and the legacy search name; too long refused', () => {
    expect(parseListQuery({ q: ' ann ' }, SPEC).q).toBe('ann');
    expect(parseListQuery({ search: 'bo' }, SPEC).q).toBe('bo');
    expect(code(() => parseListQuery({ q: 'x'.repeat(300) }, SPEC))).toBe('INVALID_FILTER:q');
  });
  it('clamps limit / pageSize to maxLimit; refuses garbage', () => {
    expect(parseListQuery({ limit: '1000000' }, SPEC).limit).toBe(100);
    expect(parseListQuery({ pageSize: '20' }, SPEC).limit).toBe(20);
    expect(code(() => parseListQuery({ limit: 'lots' }, SPEC))).toBe('INVALID_FILTER:limit');
    expect(parseListQuery({ limit: '0' }, SPEC).limit).toBe(1);
    expect(parseListQuery({ cursor: 'abc' }, SPEC).cursor).toBe('abc');
  });
});

describe('date ranges (§52)', () => {
  it('date-only bounds are the branch calendar day (America/Chicago)', () => {
    const p = parseListQuery({ from: '2026-09-01', to: '2026-09-30' }, SPEC, { timeZone: 'America/Chicago', nowMs: NOW });
    expect(new Date(p.range!.fromMs).toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(new Date(p.range!.toMs).toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(p.range!.toExclusive).toBe(true);
    expect(p.range!.days).toBe(29);
  });
  it('a span over maxDays is DATE_RANGE_TOO_LARGE (legacy names too); exactly maxDays passes', () => {
    expect(code(() => parseListQuery({ from: '2018-01-01', to: '2026-07-03' }, SPEC))).toBe('DATE_RANGE_TOO_LARGE:from');
    expect(code(() => parseListQuery({ startDate: '2026-01-01', endDate: '2026-03-01' }, SPEC))).toBe('DATE_RANGE_TOO_LARGE:startDate');
    expect(code(() => parseListQuery({ from: '2026-09-01', to: '2026-10-02' }, SPEC))).toBe('ok');
    expect(code(() => parseListQuery({ from: '2026-09-01', to: '2026-10-03' }, SPEC))).toBe('DATE_RANGE_TOO_LARGE:from');
    expect(code(() => parseListQuery({ days: '400' }, SPEC))).toBe('DATE_RANGE_TOO_LARGE:days');
  });
  it('a one-sided range is bounded by the cap', () => {
    expect(code(() => parseListQuery({ from: '2020-01-01' }, SPEC, { nowMs: NOW }))).toBe('DATE_RANGE_TOO_LARGE:from');
    const p = parseListQuery({ to: '2026-10-01T00:00:00Z' }, SPEC, { nowMs: NOW });
    expect(p.range!.days).toBe(31);
  });
  it('inverted and unparseable bounds are INVALID_FILTER', () => {
    expect(code(() => parseListQuery({ from: '2026-09-10', to: '2026-09-01' }, SPEC))).toBe('INVALID_FILTER:to');
    expect(code(() => parseListQuery({ from: 'yesterday' }, SPEC))).toBe('INVALID_FILTER:from');
    expect(code(() => parseListQuery({ from: '2026-02-31' }, SPEC))).toBe('INVALID_FILTER:from');
    expect(code(() => parseListQuery({ from: "2026-09-01'; drop table x;--" }, SPEC))).toBe('INVALID_FILTER:from');
  });
  it('epoch-millisecond instants are accepted', () => {
    const p = parseListQuery({ from: String(Date.parse('2026-09-01T00:00:00Z')), to: String(Date.parse('2026-09-03T00:00:00Z')) }, SPEC);
    expect(p.range!.days).toBe(2);
  });
  it('instants and named caps', () => {
    const p = parseListQuery({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }, { dateRange: { maxDays: 'audit' } });
    expect(p.range!.days).toBe(1); expect(p.range!.toExclusive).toBe(false);
    expect(code(() => parseListQuery({ from: '2026-01-01', to: '2026-06-01' }, { dateRange: { maxDays: 'audit' } }))).toBe('DATE_RANGE_TOO_LARGE:from');
  });
  it('defaultDays fills the parse output only', () => {
    const p = parseListQuery({}, { dateRange: { maxDays: 90, defaultDays: 30 } }, { nowMs: NOW });
    expect(p.range).toMatchObject({ days: 30, defaulted: true, source: 'default' });
  });
});

describe('writeLegacyParams — canonical in, the handler sees its own names', () => {
  it('filter, q, sort, limit, from/to', () => {
    const spec: ListQuerySpec = { ...SPEC, legacySort: { by: 'sortBy', dir: 'sortDir' }, limitParams: ['pageSize'] };
    const query: any = { filter: { source: 'web' }, q: 'ann', sort: '-name', limit: '500', from: '2026-09-01', to: '2026-09-02' };
    writeLegacyParams(query, spec, parseListQuery(query, spec));
    expect(query).toMatchObject({ source: 'web', search: 'ann', sortBy: 'name', sortDir: 'desc', pageSize: '100', limit: '100', startDate: '2026-09-01', endDate: '2026-09-02' });
    expect(query.filter).toBeUndefined();   // handed over — never seen twice downstream
  });
  it('a value sent under an older alternative name reaches the handler under the name it reads', () => {
    const spec: ListQuerySpec = { filters: { status: { type: 'enum', values: ['ready', 'all'], aliases: ['status', 'filter'] } } };
    const query: any = { filter: 'ready' };
    writeLegacyParams(query, spec, parseListQuery(query, spec));
    expect(query.status).toBe('ready');
  });
  it('never overwrites a legacy value the client sent', () => {
    const query: any = { filter: { source: 'web' }, source: 'phone' };
    writeLegacyParams(query, SPEC, parseListQuery(query, SPEC));
    expect(query.source).toBe('phone');
  });
});

describe('applyListQuery — SQL from the spec only', () => {
  it('columns from the spec; every request value is a bound parameter', () => {
    const p = parseListQuery({ filter: { status: 'active,archived' }, branchId: B, q: "50%_off' or 1=1 --", sort: '-name', minVisits: '2', from: '2026-09-01', to: '2026-09-02', limit: '10' }, SPEC);
    const c = applyListQuery(db.selectFrom('customers as c').selectAll(), p).compile();
    expect(c.sql).toBe('select * from "customers" as "c" where "c"."status" in ($1, $2) and "c"."branch_id" = $3 and "c"."visit_count" >= $4 and ("c"."name" ilike $5 or "c"."phone" ilike $6) and "c"."created_at" >= $7 and "c"."created_at" < $8 order by "c"."name" desc, "c"."id" desc limit $9');
    expect(c.parameters[4]).toBe("%50\\%\\_off' or 1=1 --%");
    expect(c.sql).not.toContain('1=1');
  });
  it('parts can be switched off (count query)', () => {
    const c = applyListQuery(db.selectFrom('customers as c').select(db.fn.countAll().as('n')), parseListQuery({ sort: 'name' }, SPEC), { sort: false, limit: false }).compile();
    expect(c.sql).toBe('select count(*) as "n" from "customers" as "c"');
  });
});

describe('declaration', () => {
  it('a bad spec fails when declared, not on a request', () => {
    expect(() => assertListQuerySpec({ sorts: { name: 'name; drop' } })).toThrow(/plain identifier/);
    expect(() => assertListQuerySpec({ filters: { s: { type: 'enum' } } })).toThrow(/no values/);
    expect(() => assertListQuerySpec({ sorts: { a: 'a' }, defaultSort: '-b' })).toThrow(/defaultSort/);
    expect(() => assertListQuerySpec({ dateRange: { maxDays: 0 } })).toThrow(/maxDays/);
  });
  it('@ListQuery and @ListQueries attach the spec to the handler; a misspelt handler name fails at definition', () => {
    class A { @ListQuery(SPEC) list() { return 1; } other() { return 2; } }
    expect(listQuerySpecOf(A.prototype.list)).toBe(SPEC);
    @ListQueries({ other: { filters: {} } }) class Bc { other() { return 2; } }
    expect(listQuerySpecOf(Bc.prototype.other)).toEqual({ filters: {} });
    expect(() => { @ListQueries({ nope: {} }) class C { x() { return 1; } } return C; }).toThrow(/not a method/);
  });
});
