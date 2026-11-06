// route-resource-scope.vitest.spec — Security Deep Scan §38 / §39 (Nov 5 2026): every route in the manifest carries the
// boundary of the records it touches (`resource=SCOPE/source`), and the audit fails when a session route has none.
// The labels are cross-checked against the IDOR table — the classification the live sweep attacks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeResourceScope, ROUTE_RESOURCE_SCOPES } from '@aipowersalon/permissions';
import { idorRoutes, branchScopeOf } from '../../scripts/idor-routes.mjs';

const MANIFEST = readFileSync(join(__dirname, '../../openapi/manifest.txt'), 'utf8');
const lines = MANIFEST.split('\n').filter((l) => l && !l.startsWith('#'));
const resourceOf = (l: string) => /\sresource=(\S+)/.exec(l)?.[1] ?? null;
const byPath = new Map(lines.filter((l) => l.startsWith('GET ')).map((l) => [l.split(/\s+/)[1], resourceOf(l)]));

describe('§38: every route declares its resource scope', () => {
  it('every manifest line has resource=SCOPE/source', () => {
    const missing = lines.filter((l) => !resourceOf(l));
    expect(missing).toEqual([]);
  });
  it('no session route is UNSCOPED or INVALID — declare @ResourceScope(...) on it', () => {
    const bad = lines.filter((l) => /resource=(UNSCOPED|INVALID)/.test(l)).map((l) => l.split(/\s{2,}/)[0]);
    expect(bad).toEqual([]);
  });
  it('every scope in the manifest is one of the vocabulary', () => {
    const seen = new Set(lines.map((l) => resourceOf(l)!.split('/')[0]));
    for (const s of seen) expect(ROUTE_RESOURCE_SCOPES as readonly string[]).toContain(s);
  });
  it('the realms hold: Super Admin → PLATFORM, customer app → OWN, public → PUBLIC', () => {
    for (const l of lines) {
      const r = resourceOf(l)!;
      if (/\srealm=super_admin\s/.test(l) && !/\/declared$/.test(r)) expect(r, l).toBe('PLATFORM/realm');
      if (/\srealm=customer\s/.test(l) && /\sauth=session\s/.test(l)) expect(r, l).toBe('OWN/realm');
      if (/\sauth=public\s/.test(l) && !/\/declared$/.test(r)) expect(r, l).toBe('PUBLIC/realm');
    }
  });
});

describe('§38 labels agree with the IDOR table (the live sweep attacks this classification)', () => {
  const routes = idorRoutes(MANIFEST);
  it('a route whose records are location-bound is never labelled salon-wide', () => {
    const wrong = routes.filter((r) => branchScopeOf(r).scope === 'branch' && !/^(BRANCH|OWN|ASSIGNED)\//.test(byPath.get(r.path) ?? ''));
    expect(wrong.map((r) => `${r.path} ${byPath.get(r.path)}`)).toEqual([]);
  });
  it('a route whose records are salon-wide (reviewed, with a reason) is not labelled BRANCH', () => {
    const wrong = routes.filter((r) => branchScopeOf(r).scope === 'salon-wide' && /^BRANCH\//.test(byPath.get(r.path) ?? ''));
    expect(wrong.map((r) => `${r.path} ${byPath.get(r.path)}`)).toEqual([]);
  });
});

describe('routeResourceScope (the derivation)', () => {
  const base = { path: '/pos/x', auth: 'session' as const, realm: 'staff', perms: [] as string[] };
  it('declared wins; an unknown declared value is INVALID', () => {
    expect(routeResourceScope({ ...base, declared: 'TENANT', records: 'branch' })).toEqual({ scope: 'TENANT', source: 'declared' });
    expect(routeResourceScope({ ...base, declared: 'EVERYTHING' })).toEqual({ scope: 'INVALID', source: 'declared' });
  });
  it('realm and path', () => {
    expect(routeResourceScope({ ...base, auth: 'public' }).scope).toBe('PUBLIC');
    expect(routeResourceScope({ ...base, auth: 'api_key' }).scope).toBe('INTEGRATION');
    expect(routeResourceScope({ ...base, realm: 'super_admin' }).scope).toBe('PLATFORM');
    expect(routeResourceScope({ ...base, realm: 'customer' }).scope).toBe('OWN');
    expect(routeResourceScope({ ...base, path: '/tech/earnings' })).toEqual({ scope: 'OWN', source: 'path' });
  });
  it('the record ids in the path come before the permission', () => {
    expect(routeResourceScope({ ...base, records: 'salon-wide', perms: ['checkout.process_payment'] })).toEqual({ scope: 'TENANT', source: 'records' });
    expect(routeResourceScope({ ...base, records: 'branch' })).toEqual({ scope: 'BRANCH', source: 'records' });
  });
  it('a session route nothing decides is UNSCOPED', () => {
    expect(routeResourceScope(base)).toEqual({ scope: 'UNSCOPED', source: null });
  });
});
