// list-query.interceptor.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22/#23): the global ListQueryInterceptor runs the
// declared spec on every decorated list GET — 400s with registered codes, legacy names written back, branch time zone
// for date-only bounds, undecorated routes untouched — and every controller's declared specs are valid at boot.
import { describe, it, expect } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { isRegisteredCode, ERROR_REGISTRY } from '@aipowersalon/api-contracts';
import { ListQuery, ListQueries, type ListQuerySpec } from '@aipowersalon/database';
import { ListQueryInterceptor, needsTimeZone } from './list-query.interceptor';

const SPEC: ListQuerySpec = {
  filters: { status: { type: 'enum', values: ['active', 'archived'] }, technicianId: { type: 'id' } },
  sorts: { name: null, createdAt: null }, legacySort: { by: 'sortBy', dir: 'sortDir' },
  search: { params: ['search'] }, limitParams: ['pageSize'], maxLimit: 100,
  dateRange: { maxDays: 31, from: ['dateFrom'], to: ['dateTo'] },
};
class Ctl {
  @ListQuery(SPEC) list() { return 'ok'; }
  plain() { return 'plain'; }
}
@ListQueries({ list: { sorts: { a: null } } })
class Ctl2 { list() { return 2; } }

type Handler = (...a: any[]) => unknown;
const ctxFor = (req: any, handler: Handler) => ({ getType: () => 'http', getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) }) as any;
const call = (req: any, handler: Handler = Ctl.prototype.list, db?: any) =>
  lastValueFrom(new ListQueryInterceptor(db).intercept(ctxFor(req, handler), { handle: () => of('handled') }) as any);
const errOf = async (p: () => Promise<unknown>) => { try { await p(); return null; } catch (e: any) { return e; } };

describe('ListQueryInterceptor', () => {
  it('lets a valid request through and writes the canonical form back under the handler\'s own names', async () => {
    const req: any = { method: 'GET', query: { filter: { status: 'active' }, q: 'ann', sort: '-name', limit: '500', from: '2026-09-01', to: '2026-09-10' } };
    expect(await call(req)).toBe('handled');
    expect(req.query).toMatchObject({ status: 'active', search: 'ann', sortBy: 'name', sortDir: 'desc', pageSize: '100', dateFrom: '2026-09-01', dateTo: '2026-09-10' });
    expect(req.listQuery.filters).toEqual({ status: 'active' });
    expect(req.listQuery.range.days).toBe(9);
  });
  it('today\'s parameter names keep working unchanged', async () => {
    const req: any = { method: 'GET', query: { status: 'archived', search: 'x', sortBy: 'createdAt', sortDir: 'asc', pageSize: '20', dateFrom: '2026-09-01', dateTo: '2026-09-02', _: '1700000000' } };
    expect(await call(req)).toBe('handled');
    expect(req.query).toMatchObject({ status: 'archived', search: 'x', sortBy: 'createdAt', sortDir: 'asc', pageSize: '20' });
  });
  it.each([
    [{ filter: { password_hash: 'x' } }, 'INVALID_FILTER'],
    [{ status: 'deleted' }, 'INVALID_FILTER'],
    [{ technicianId: "1' or '1'='1" }, 'INVALID_FILTER'],
    [{ sort: 'password_hash' }, 'INVALID_SORT'],
    [{ sort: 'name;drop table users' }, 'INVALID_SORT'],
    [{ dateFrom: '2026-01-01', dateTo: '2026-06-01' }, 'DATE_RANGE_TOO_LARGE'],
    [{ from: '2026-09-10', to: '2026-09-01' }, 'INVALID_FILTER'],
  ])('refuses %j with 400 %s (a registered code, with details)', async (query, code) => {
    const e = await errOf(() => call({ method: 'GET', query }));
    expect(e).toBeInstanceOf(BadRequestException);
    const body = e.getResponse();
    expect(body.code).toBe(code);
    expect(isRegisteredCode(body.code)).toBe(true);
    expect(ERROR_REGISTRY[body.code as keyof typeof ERROR_REGISTRY].status).toBe(400);
    expect(body.details).toBeTypeOf('object');
  });
  it('leaves an undecorated handler and non-GETs alone', async () => {
    const req: any = { method: 'GET', query: { filter: { anything: 1 }, sort: 'whatever' } };
    expect(await call(req, Ctl.prototype.plain)).toBe('handled');
    expect(req.listQuery).toBeUndefined();
    expect(await call({ method: 'POST', query: { sort: 'nope' } })).toBe('handled');
  });
  it('class-level @ListQueries declares per handler', async () => {
    expect(await call({ method: 'GET', query: { sort: '-a' } }, Ctl2.prototype.list)).toBe('handled');
    const e = await errOf(() => call({ method: 'GET', query: { sort: 'b' } }, Ctl2.prototype.list));
    expect(e?.getResponse().code).toBe('INVALID_SORT');
  });
  it('date-only bounds are the branch calendar day (branches.timezone), looked up only when needed', async () => {
    let lookups = 0;
    const db: any = { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ executeTakeFirst: async () => { lookups++; return { timezone: 'America/Los_Angeles' }; } }) }) }) }) };
    const req: any = { method: 'GET', ctx: { tenantId: 't-1', branchId: 'b-la-' + Math.random() }, query: { from: '2026-09-01', to: '2026-09-01' } };
    await call(req, Ctl.prototype.list, db);
    expect(new Date(req.listQuery.range.fromMs).toISOString()).toBe('2026-09-01T07:00:00.000Z');
    expect(lookups).toBe(1);
    const req2: any = { method: 'GET', ctx: { tenantId: 't-1', branchId: 'b-2' }, query: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' } };
    await call(req2, Ctl.prototype.list, db);
    expect(lookups).toBe(1);
    expect(needsTimeZone({ dateFrom: '2026-09-01' }, SPEC)).toBe(true);
    expect(needsTimeZone({ q: 'x' }, SPEC)).toBe(false);
  });
});
