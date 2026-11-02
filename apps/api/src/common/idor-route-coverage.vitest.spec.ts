// idor-route-coverage — Constitution 12 §286 / §299 (BUILD_PLAN Phase 14): the automated IDOR suite is GENERATED from the
// OpenAPI manifest, so it cannot silently fall behind the API. Every GET route of the tenant realms with a path
// parameter must be classified by scripts/idor-routes.mjs — a fixture (where salon A's real id comes from, which
// scripts/live-phase14-idor.mjs seeds and attacks as salon B) or an exemption WITH its reason. A new by-id route the
// table cannot classify fails here, in the every-push lane, before it ships.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — a plain .mjs script module (no types)
import { idorRoutes, classifyIdorRoute, PARAM_FIXTURES, SEGMENT_FIXTURES, EXEMPT, BRANCH_TABLES, branchScopeOf } from '../../scripts/idor-routes.mjs';

const API = join(__dirname, '..', '..');
const created = new Set<string>();
for (const f of readdirSync(join(API, 'db', 'migrations')).filter((x) => x.endsWith('.sql'))) {
  for (const m of readFileSync(join(API, 'db', 'migrations', f), 'utf8').matchAll(/create table (?:if not exists )?(?:public\.)?"?([a-z0-9_]+)"?/gi)) created.add(m[1].toLowerCase());
}

describe('§299 the IDOR route table covers the manifest', () => {
  const routes = idorRoutes();
  it('finds the tenant-realm GET-by-id routes in the manifest (the generator is not reading nothing)', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(routes.some((r: any) => r.path === '/pos/customers/{customerId}')).toBe(true);
  });
  it('every one is classified — a fixture for each path parameter, or an exemption with a reason', () => {
    const unclassified = routes.map((r: any) => ({ r, c: classifyIdorRoute(r) })).filter(({ c }: any) => c.unclassified).map(({ r, c }: any) => `${r.path} (${c.unclassified.join(', ')})`);
    expect(unclassified, 'add the new route to scripts/idor-routes.mjs (a fixture, or an exemption with its reason)').toEqual([]);
    for (const r of routes) { const c = classifyIdorRoute(r); if (c.exempt) expect(String(c.exempt).length).toBeGreaterThan(20); }
  });
  it('exemptions stay the exception: session routes exempted by name are few and each names why', () => {
    const named = routes.filter((r: any) => r.auth === 'session' && classifyIdorRoute(r).exempt);
    expect(named.length).toBeLessThanOrEqual(EXEMPT.length * 2);
    expect(named.length).toBeLessThanOrEqual(8);
  });
  it('every fixture names a table the migrations create (a renamed table cannot leave a dead fixture)', () => {
    const tables = [...Object.values(PARAM_FIXTURES), ...SEGMENT_FIXTURES.map(([, f]: any) => f)].filter((f: any) => f.table).map((f: any) => f.table);
    const missing = [...new Set(tables)].filter((t) => !created.has(t as string));
    expect(missing).toEqual([]);
  });
  it('the guard is not vacuous: an unknown by-id route IS reported unclassified', () => {
    const fake = idorRoutes('GET /pos/widgets/{widgetId}  realm=staff  auth=session  domain=operations  perm=pos.widgets.view\n');
    expect(fake).toHaveLength(1);
    expect(classifyIdorRoute(fake[0]).unclassified).toEqual(['widgetId']);
    const known = idorRoutes('GET /pos/widgets/{customerId}  realm=staff  auth=session  domain=operations\n');
    expect(classifyIdorRoute(known[0]).params.customerId.table).toBe('customers');
  });
  it('§75 / §187 branch rows: every fixture table with a branch_id is classified location-scoped or salon-wide with a reason', () => {
    const kt = readFileSync(join(API, '..', '..', 'packages', 'database', 'src', 'kysely.types.ts'), 'utf8');
    const iface: Record<string, string> = {}; for (const m of kt.matchAll(/export interface (\w+) \{([^}]*)\}/g)) iface[m[1]] = m[2];
    const dbi: Record<string, string> = {}; for (const m of kt.matchAll(/^\s+([a-z0-9_]+): (\w+);/gm)) dbi[m[1]] = m[2];
    const tables = new Set<string>(); for (const r of routes) { const c = classifyIdorRoute(r); if (c.params) for (const f of Object.values(c.params) as any[]) if (f.table) tables.add(f.table); }
    const withBranch = [...tables].filter((t) => /\bbranch_id\b/.test(iface[dbi[t]] ?? ''));
    expect(withBranch.length).toBeGreaterThan(20);
    expect(withBranch.filter((t) => !(t in BRANCH_TABLES)), 'classify in scripts/idor-routes.mjs BRANCH_TABLES').toEqual([]);
    for (const [t, v] of Object.entries(BRANCH_TABLES) as any[]) if (v !== 'branch') expect(String(v.salonWide).length, t).toBeGreaterThan(20);
    const branchRows = routes.filter((r: any) => branchScopeOf(r).scope === 'branch');
    expect(branchRows.length).toBeGreaterThan(10);
    expect(branchRows.some((r: any) => r.path === '/pos/checkout/tickets/{ticketId}')).toBe(true);
  });
  it('the live script attacks every location-scoped route as the other location\'s manager', () => {
    const s = readFileSync(join(API, 'scripts', 'live-phase14-idor.mjs'), 'utf8');
    expect(s).toMatch(/branchScopeOf\(c\)/);
    expect(s).toMatch(/no location-scoped route hands a location-2 manager location 1's record/);
  });
  it('the live script attacks every classified route and fails on a leak or a crash', () => {
    const s = readFileSync(join(API, 'scripts', 'live-phase14-idor.mjs'), 'utf8');
    expect(s).toMatch(/idorRoutes\(\)/);
    expect(s).toMatch(/no route hands salon B salon A/);
    expect(s).toMatch(/no route crashes on another salon/);
  });
});
