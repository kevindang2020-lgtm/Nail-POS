// authz-declared.vitest.spec — Constitution 12 §27 (deny by default) and §62 (every endpoint declares its auth), as a
// CI gate over EVERY route, read from the framework's own decorator metadata.
//
// A route is DECLARED when at least one of these is true:
//   • it is public by design — excluded from TenantContextMiddleware in app.module.ts (webhooks, login, health…);
//   • it sits in a realm RealmGuard enforces from the path (/pos, /owner, /tenant, /tech, /customer, /super-admin);
//   • a realm or scope guard is on the class or handler (SuperAdminGuard, TenantAuthGuard, CustomerAuthGuard,
//     VoiceAuthGuard, IntegrationPermissionGuard, EventPermissionGuard, OwnerPortfolioGuard);
//   • it requires a permission (@RequirePermission).
// Anything else is reachable by a valid session of ANY realm and relies on its handler or service to check. The
// routes like that TODAY are listed in security/authz-baseline.json. The gate fails when a NEW undeclared route
// appears, and when a baselined route is fixed or removed without being taken off the list — the list only shrinks.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { codeRoots } from '../../test-support/code-roots';
import { join } from 'node:path';
import { routeFirstSegment } from '@aipowersalon/permissions';

const ROOT = process.cwd();
const BASELINE = join(ROOT, 'security/authz-baseline.json');
const DECLARING_GUARDS = new Set(['SuperAdminGuard', 'TenantAuthGuard', 'CustomerAuthGuard', 'VoiceAuthGuard', 'IntegrationPermissionGuard', 'EventPermissionGuard', 'OwnerPortfolioGuard', 'TechAuthGuard', 'StaffSessionGuard', 'SignedInUserGuard']);   // SignedInUserGuard: a person's own account security routes (Oct 2026)   // StaffSessionGuard: own-row self-service (Sep 2026 merge)
const REALM_SEGMENTS = new Set(['pos', 'owner', 'tenant', 'tech', 'customer', 'super-admin']);
const METHOD = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });

async function undeclared(): Promise<string[]> {
  const app = readFileSync(join(ROOT, 'src/app.module.ts'), 'utf8');
  const excl = [...app.matchAll(/\{ path: '([^']+)', method: RequestMethod\.([A-Z]+) \}/g)].map((m) => ({ re: new RegExp('^/' + m[1].replace(/\(\.\*\)/g, '.*').replace(/:[A-Za-z]+/g, '[^/]+') + '$'), method: m[2] }));
  const out: string[] = [];
  // Constitution 13: controllers live in apps/api/src AND in every domain module — walking only src/ made moved routes
  // look 'declared or gone' (the push controller did, the moment communications left the API).
  for (const f of codeRoots().flatMap((r) => walk(r)).filter((x) => /@Controller\(/.test(readFileSync(x, 'utf8')))) {
    const mod: any = await import(f);
    for (const exp of Object.values(mod) as any[]) {
      if (typeof exp !== 'function' || !Reflect.hasMetadata('__controller__', exp)) continue;
      const prefix = String(Reflect.getMetadata('path', exp) ?? '');
      const clsGuards = (Reflect.getMetadata('__guards__', exp) || []).map((g: any) => g?.name);
      const clsPerm = Reflect.getMetadata('perm', exp);
      for (const name of Object.getOwnPropertyNames(exp.prototype)) {
        const h = exp.prototype[name];
        if (typeof h !== 'function' || Reflect.getMetadata('method', h) === undefined) continue;
        const method = METHOD[Reflect.getMetadata('method', h)] ?? 'ALL';
        const full = ('/' + [prefix, String(Reflect.getMetadata('path', h) ?? '')].filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
        const guards = [...clsGuards, ...((Reflect.getMetadata('__guards__', h) || []).map((g: any) => g?.name))];
        const declared = excl.some((e) => (e.method === 'ALL' || e.method === method) && e.re.test(full))
          || REALM_SEGMENTS.has(routeFirstSegment(full))
          || guards.some((g) => DECLARING_GUARDS.has(g))
          || !!(Reflect.getMetadata('perm', h) ?? clsPerm);
        if (!declared) out.push(`${method} ${full}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

describe('§27 every route declares its authorization', () => {
  it('no NEW undeclared route; the baseline only shrinks', async () => {
    const now = await undeclared();
    if (process.env.AUTHZ_BASELINE_WRITE === '1' || !existsSync(BASELINE)) {
      writeFileSync(BASELINE, JSON.stringify({ note: 'Routes reachable by a session of ANY realm that rely on their handler/service to authorize. Only ever remove entries. Constitution 12 §27.', routes: now }, null, 1) + '\n');
    }
    const base: string[] = JSON.parse(readFileSync(BASELINE, 'utf8')).routes;
    const added = now.filter((r) => !base.includes(r));
    const stale = base.filter((r) => !now.includes(r));
    expect(added, `NEW undeclared routes — add a realm guard, @RequirePermission, or a public exclusion:\n${added.join('\n')}`).toEqual([]);
    expect(stale, `these are declared or gone now — remove them from security/authz-baseline.json:\n${stale.join('\n')}`).toEqual([]);
  }, 240_000);
});
