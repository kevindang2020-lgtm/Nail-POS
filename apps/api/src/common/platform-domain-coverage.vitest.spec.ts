// platform-domain-coverage — Constitution 7 §6–§7: every /super-admin route has an effective permission. A route that
// declares none gets the key derived from its path; a path the domain map does not classify would be DENIED to every
// platform user at runtime, so this fails the build first — a new controller must be classified when it is written.
//
// Constitution 5 Step 8 (Oct 4 2026): this file used to carry its OWN route scan. It matched only @Get/@Post/@Put/
// @Patch/@Delete, so the @Sse('stream') route of SuperAdminRealtimeController was never seen — and that route WAS
// unclassified: every Super Admin got 403 on the admin app's live stream. It also counted a route as keyed when any
// `Require…Permission` appeared within 300 characters (a neighbour's decorator could hide an unclassified route). It
// now reads the ONE route table (scripts/audit-routes.js) and the handler-level key, exactly what the guards read.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { platformDomainKeyFor, platformPathKey, PLATFORM_PATH_DOMAIN } from '@aipowersalon/permissions';

const require = createRequire(import.meta.url);
const { routes: all } = require('../../scripts/audit-routes.js');
const gen: any = await import('../../scripts/openapi.mjs');
// A PUBLIC route (session middleware excluded) never carries a session, and PlatformDomainGuard acts only on a Super
// Admin session — so e.g. POST /auth/super-admin/forgot-password (public) is outside the guard by construction.
const routes = (all as any[]).filter((r) => platformPathKey(r.path) !== null && !gen.isPublic(r.method, r.path));
const keyed = (r: any) => r.decorators.some((d: any) => d.name === 'RequirePermission');   // handler-level, as the guards read it

describe('every platform route has an effective permission (§6, §7)', () => {
  it('finds the platform surface, streams included (sanity: the scan is not vacuous)', () => {
    expect(routes.length).toBeGreaterThan(900);
    expect(routes.some((r) => r.path === '/super-admin/stream' && r.stream)).toBe(true);
  });
  it('every UNKEYED platform route is classified by the domain map (else it would be denied to everyone)', () => {
    const unclassified = routes.filter((r) => !keyed(r) && platformDomainKeyFor(r.path, r.method) === null)
      .map((r) => `${r.method} ${r.path}  (${r.file})`);
    expect(unclassified).toEqual([]);
  });
  it('the map has no stale entries: every key in it matches at least one real route', () => {
    const used = new Set(routes.map((r) => platformPathKey(r.path)));
    expect(Object.keys(PLATFORM_PATH_DOMAIN).filter((k) => !used.has(k))).toEqual([]);
  });
});
