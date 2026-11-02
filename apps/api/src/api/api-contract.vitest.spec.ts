// Constitution 5 Phase 3/19 — scripts/check-api-contract.mjs: the realm × permission contract.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routesInSource } = require('../../scripts/audit-routes.js');
const c: any = await import('../../scripts/check-api-contract.mjs');
const one = (src: string) => routesInSource(src, '/fixture.controller.ts');

describe('realm × permission contract', () => {
  it('a staff key some tenant role holds is reachable', () => {
    const r = c.evaluate(one(`@Controller('pos') export class A { @RequirePermission('pos.customers.view') @Get('c') c() {} }`));
    expect(r).toEqual({ unreachable: [], unclassified: [], unkeyedStaff: [], ineffective: [], ungated: [] });
    expect(c.holders('/pos/c', 'pos.customers.view')).toContain('OWNER');
  });

  it('a platform key on a staff route is unreachable — no role allowed into /pos holds it', () => {
    const r = c.evaluate(one(`@Controller('pos') export class A { @RequirePermission('super_admin.tenants.view') @Get('c') c() {} }`));
    expect(r.unreachable).toEqual(['GET /pos/c  perm=super_admin.tenants.view']);
  });

  it('an unclassified /super-admin path is reported (it is denied to every platform identity)', () => {
    const r = c.evaluate(one(`@Controller('super-admin') export class A { @Get('not-a-domain-xyz') x() {} }`));
    expect(r.unclassified).toEqual(['GET /super-admin/not-a-domain-xyz']);
  });

  it('GET /super-admin/stream derives the System Status key and is reachable (403 for every Super Admin before Oct 4)', () => {
    const r = c.evaluate(one(`@Controller('super-admin') export class S { @Sse('stream') s() {} }`));
    expect(r).toEqual({ unreachable: [], unclassified: [], unkeyedStaff: [], ineffective: [], ungated: [] });
    expect(c.holders('/super-admin/stream', 'super_admin.system_operations.view')).toContain('PLATFORM_SUPER_ADMIN');
  });

  it('a DERIVED platform key nobody in the realm holds is unreachable too (not silently treated as unkeyed)', () => {
    const tenantOnly = c.PRINCIPALS.filter((p: any) => p.role !== 'SUPER_ADMIN');
    const r = c.evaluate(one(`@Controller('super-admin') export class S { @Sse('stream') s() {} }`), tenantOnly);
    expect(r.unreachable).toEqual(['GET /super-admin/stream  derived=super_admin.system_operations.view']);
  });

  it('a class-level @RequirePermission is reported as ineffective, and the route counts as unkeyed (what the guard sees)', () => {
    const r = c.evaluate(one(`@Controller('pos') @RequirePermission('pos.customers.view') export class A { @Get('a') a() {} }`));
    expect(r.ineffective).toEqual(['GET /pos/a  (A)']);
    expect(r.unkeyedStaff).toEqual(['GET /pos/a']);
  });

  it('a staff route with no key is unkeyed debt; customer and shared routes are not (identity-authorised)', () => {
    const r = c.evaluate(one(`
@Controller('pos') export class A { @Get('a') a() {} }
@Controller('customer') export class B { @Get('me') me() {} }
@Controller('me') export class C { @Get('x') x() {} }`));
    expect(r.unkeyedStaff).toEqual(['GET /pos/a']);
  });

  it('BUILD_PLAN Phase 12 (#13): a route of a plan-gated feature without its @RequireFeature is UNGATED; class-level or handler-level counts; the wrong key does not', () => {
    const bare = c.evaluate(one(`@Controller('pos/loyalty') export class L { @RequirePermission('pos.customers.view') @Get('state') s() {} }`));
    expect(bare.ungated).toEqual([`GET /pos/loyalty/state  needs @RequireFeature('loyalty')  (L)`]);
    expect(c.evaluate(one(`@RequireFeature('loyalty') @Controller('pos/loyalty') export class L { @RequirePermission('pos.customers.view') @Get('state') s() {} }`)).ungated).toEqual([]);
    expect(c.evaluate(one(`@Controller('pos/loyalty') export class L { @RequireFeature('loyalty') @RequirePermission('pos.customers.view') @Get('state') s() {} }`)).ungated).toEqual([]);
    expect(c.evaluate(one(`@RequireFeature('marketing') @Controller('pos/loyalty') export class L { @RequirePermission('pos.customers.view') @Get('state') s() {} }`)).ungated).toHaveLength(1);
    expect(c.evaluate(one(`@Controller('pos/loyalty-points-not-a-prefix') export class L { @RequirePermission('pos.customers.view') @Get('x') s() {} }`)).ungated).toEqual([]);
  });

  it('a key held only by a role that RealmGuard keeps out of the realm does not count', () => {
    const only = [{ role: 'CUSTOMER', label: 'CUSTOMER', permissions: ['pos.customers.view', 'customers.view'] }];
    expect(c.holders('/pos/c', 'pos.customers.view', only)).toEqual([]);
  });

  it('the real tree: every effective key reachable, no unclassified platform path', () => {
    const r = c.evaluate();
    expect(r.unreachable).toEqual([]);
    expect(r.ungated).toEqual([]);   // Phase 12: every route of a plan-gated feature carries its @RequireFeature
    expect(r.unclassified).toEqual([]);
    expect(r.ineffective).toEqual([]);
  });
});
