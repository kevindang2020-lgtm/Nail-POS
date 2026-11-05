// BUILD_PLAN Phase 12 — Constitution 5 DoD #2 (every route has a business domain), #30/#52 (every route carries an
// api-contracts wire type or is in the shrinking baseline) and #57 (every frontend calls /api/v1: check:v1-clients).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routesInSource } = require('../../scripts/audit-routes.js');
const rd: any = await import('../../openapi/route-domains.mjs');
const gen: any = await import('../../scripts/openapi.mjs');
const c: any = await import('../../scripts/check-api-contract.mjs');
const rt: any = await import('../../scripts/route-contract-types.mjs');
const v1: any = await import('../../scripts/check-v1-clients.mjs');
const one = (src: string, file = 'modules/booking/src/booking/fixture.controller.ts') => routesInSource(src, '/fixture.controller.ts').map((r: any) => ({ ...r, file }));

describe('#2 — every route has a business domain (the ownership registry vocabulary)', () => {
  it('the vocabulary is the registry’s 22 domains', () => {
    expect(rd.DOMAINS).toHaveLength(22);
    for (const d of Object.values(rd.SOURCE_DOMAINS)) if (d) expect(rd.DOMAINS).toContain(d);
    for (const [d] of [...rd.PATH_RULES, ...rd.FULL_PATH_RULES]) expect(rd.DOMAINS).toContain(d);
  });
  it('@Domain wins, then the module directory, then the path rules; nothing → null', () => {
    const [byDeco] = one(`@Controller('pos') export class A { @Domain('loyalty') @Get('x') x() {} }`);
    expect(rd.domainOfRoute(byDeco)).toBe('loyalty');
    const [bySource] = one(`@Controller('pos') export class A { @Get('anything') x() {} }`);
    expect(rd.domainOfRoute(bySource)).toBe('booking');                                     // modules/booking/src/booking
    const [byPath] = one(`@Controller('super-admin/platform') export class A { @Get('payment-gateways') x() {} }`, 'modules/super-admin/src/super-admin-platform/x.ts');
    expect(rd.domainOfRoute(byPath)).toBe('payments');                                      // a mixed directory → path rules
    const [none] = one(`@Controller('pos') export class A { @Get('zzz-unknown') x() {} }`, 'brand-new-dir/x.controller.ts');
    expect(rd.domainOfRoute(none)).toBeNull();
    const [bad] = one(`@Controller('pos') export class A { @Domain('not-a-domain') @Get('x') x() {} }`);
    expect(rd.domainOfRoute(bad)).toBeNull();                                               // only the vocabulary counts
  });
  it('the manifest line and the OpenAPI operation carry it; check:api-contract names a route without one', () => {
    const rs = one(`@Controller('pos') export class A { @RequirePermission('pos.customers.view') @Get('c') c() {} }`);
    expect(gen.manifestLine(gen.factsOf(rs[0]))).toContain('  domain=booking  ');
    expect(gen.buildSpec(rs).paths['/pos/c'].get['x-domain']).toBe('booking');
    expect(c.undomained(one(`@Controller('pos') export class A { @Get('zzz-unknown') x() {} }`, 'brand-new-dir/x.controller.ts'))).toEqual(['GET /pos/zzz-unknown  (brand-new-dir/x.controller.ts)']);
  });
  it('the real tree: every route placed', () => {
    expect(c.undomained()).toEqual([]);
  });
});

describe('#30/#52 — api-contracts wire types, ratcheted', () => {
  it('reads the names a controller imports from api-contracts and finds them in a handler signature', () => {
    const src = `import type { TenantHealth, X as Y } from '@aipowersalon/api-contracts/platform';
import { Other } from 'kysely';
export class C {
  @Get('a') async health(@Param('id') id: string): Promise<TenantHealth> { return null as any; }
  @Post('b') save(@Body() b: Y) { return 1; }
  @Get('c') plain(@Query('q') q: Other) { return 2; }
}`;
    expect([...rt.contractImports(src)].sort()).toEqual(['TenantHealth', 'Y']);
    expect(rt.signatureOf(src, 'health')).toContain('Promise<TenantHealth>');
    expect(rt.signatureOf(src, 'save')).toContain('b: Y');
    expect(rt.signatureOf(src, 'nope')).toBeNull();
  });
  it('a new untyped route fails; a baseline line that is typed or gone fails until removed', () => {
    const rs = one(`@Controller('pos') export class A { @Get('a') a() {} @Get('b') b() {} }`);
    const r = c.typesRatchet(rs, ['GET /pos/a', 'GET /pos/gone']);
    expect(r.newUntyped).toEqual(['GET /pos/b']);
    expect(r.stale).toEqual(['GET /pos/gone']);
  });
  it('the real tree matches the committed baseline (typed routes counted)', () => {
    const r = c.typesRatchet();
    expect(r.newUntyped).toEqual([]); expect(r.stale).toEqual([]);
    expect(r.typed).toBeGreaterThan(60);
  });
});

describe('#57 — check:v1-clients: no app spells a legacy API path', () => {
  const segs = ['pos', 'owner', 'customer', 'super-admin', 'auth', 'media', 'platform', 'go-check-in'];
  const keep = ['health', 'media', 'platform', 'auth/refresh', 'api'];
  const rules = (rel: string, text: string) => v1.scanSource(rel, text, segs, keep).map((f: any) => f.rule);
  it('R1 — only the resolver reads the API origin', () => {
    expect(rules('apps/pos-web/src/api/x.ts', `const B = (import.meta as any).env?.VITE_API_BASE || '';`)).toEqual(['R1']);
    expect(rules('apps/pos-web/src/api/apiBase.ts', `const B = (import.meta as any).env?.VITE_API_BASE || ''; buildApiUrl(B, p)`)).toEqual([]);
  });
  it('R2 — a legacy path handed to fetch / a stream; never a path that stays put, never an SPA link', () => {
    expect(rules('apps/x/src/a.ts', `fetch('/super-admin/disputes/exports', {})`)).toEqual(['R2']);
    expect(rules('apps/x/src/a.ts', `createRealtimeClient({ streamPath: '/customer/stream' })`)).toEqual(['R2']);
    expect(rules('apps/x/src/a.ts', `fetch('/api/v1/pos/x'); fetch('/media/a.png'); fetch('/platform/branding')`)).toEqual([]);
    expect(rules('apps/x/src/a.tsx', `<a href="/pos/customers">Customers</a>`)).toEqual([]);
    expect(rules('apps/x/src/a.ts', `// fetch('/pos/x') in a comment`)).toEqual([]);
  });
  it('R3 — a base glued to a path by hand; R4 — the unversioned builder', () => {
    expect(rules('apps/x/src/a.ts', 'fetch(`${apiBase()}/owner/stream`)')).toContain('R3');
    expect(rules('apps/x/src/a.ts', `const BASE = API_ORIGIN + '/pos/booking';`)).toEqual(['R3']);
    expect(rules('apps/x/src/a.ts', 'const u = `${apiBase}/api/v1/pos/x`; const m = `${API_BASE}/media/a`;')).toEqual([]);
    expect(rules('apps/x/src/a.ts', `fetch(buildUrl(BASE, path))`)).toEqual(['R4']);
    expect(rules('apps/go-check-in-kiosk/index.html', 'const url = (p) => `${API}/go-check-in${p}`;')).toEqual(['R3']);
  });
  it('R6 — the client and the server keep the same unversioned list', () => {
    expect(v1.alternationOf("const UNVERSIONED = /^\\/(health|auth\\/refresh)(\\/|$|\\?)/;", 'UNVERSIONED')).toEqual(['auth/refresh', 'health']);
  });
  it('the real tree: every app, the kiosk and the shared packages are clean', () => {
    const r = v1.evaluate();
    expect(r.failures).toEqual([]); expect(r.stale).toEqual([]);
    expect(r.files).toBeGreaterThan(500);
  });
});
