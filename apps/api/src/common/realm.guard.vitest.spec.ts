// realm.guard.vitest.spec — Constitution 12 §6/§27: customer ≠ staff, enforced for every route.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RealmGuard } from './realm.guard';
import { canAccessRoutePrefix, routeFirstSegment } from '@aipowersalon/permissions';

const ctxFor = (path: string, role?: string, extra: Record<string, unknown> = {}) => ({
  getType: () => 'http',
  switchToHttp: () => ({ getRequest: () => ({ method: 'POST', route: { path }, ctx: role ? { role, tenantId: 't1', userId: 'u1', ...extra } : undefined }) }),
}) as any;
const guard = new RealmGuard();

describe('segment matching — the reasons the dead control could not be switched on as written', () => {
  it('/customer-display is NOT the customer realm (the POS\'s paired screen)', () => expect(canAccessRoutePrefix('MANAGER' as any, '/customer-display/device/pay')).toBe(true));
  it('/posts is NOT the pos realm', () => expect(routeFirstSegment('/posts/1')).toBe('posts'));
  it('a TECHNICIAN keeps any POS route they use today — per-staff-role access is not this guard\'s job', () => expect(canAccessRoutePrefix('TECHNICIAN' as any, '/pos/queue')).toBe(true));
});

describe('RealmGuard', () => {
  it('a CUSTOMER session on a staff route is refused — as a 404, not confirming the route exists (§265)', () => {
    for (const p of ['/pos/cash-drawer/open', '/owner/compensation/rules', '/tenant/help/articles', '/tech/queue']) expect(() => guard.canActivate(ctxFor(p, 'CUSTOMER'))).toThrow(NotFoundException);
  });
  it('a STAFF session on a customer route is refused with 403', () => {
    expect(() => guard.canActivate(ctxFor('/customer/payment-methods', 'MANAGER'))).toThrow(ForbiddenException);
  });
  it('the right realm passes', () => {
    expect(guard.canActivate(ctxFor('/customer/payment-methods', 'CUSTOMER'))).toBe(true);
    expect(guard.canActivate(ctxFor('/pos/cash-drawer/open', 'FRONT_DESK'))).toBe(true);
  });
  it('a public route (no session — the middleware is excluded for it) passes untouched', () => {
    expect(guard.canActivate(ctxFor('/customer/auth/register'))).toBe(true);
  });
  it('an unlisted prefix is left to per-route declaration (check:authz), not guessed here', () => {
    expect(guard.canActivate(ctxFor('/push/register', 'CUSTOMER'))).toBe(true);
  });
  it('non-HTTP contexts are not its business', () => expect(guard.canActivate({ getType: () => 'ws' } as any)).toBe(true));
  it('a refusal is recorded as PRIVILEGE_ESCALATION_ATTEMPT', () => {
    const seen: any[] = [];
    const g = new RealmGuard({ record: async (e: any) => { seen.push(e); return true; } } as any);
    expect(() => g.canActivate(ctxFor('/owner/payroll/run', 'CUSTOMER'))).toThrow();
    expect(seen[0]).toMatchObject({ type: 'PRIVILEGE_ESCALATION_ATTEMPT', resourceId: 'owner', actorType: 'customer' });
  });
});

describe('the sweep — EVERY real route, from the framework\'s own metadata', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
  it('no route under /pos, /owner, /tenant or /tech is reachable by a customer session; no /customer route by staff', async () => {
    const files = codeRoots().flatMap((r) => walk(r)).filter((f) => /@Controller\(/.test(readFileSync(f, 'utf8')));
    let staff = 0, customer = 0;
    for (const f of files) {
      const mod: any = await import(f);
      for (const exp of Object.values(mod) as any[]) {
        if (typeof exp !== 'function' || !Reflect.hasMetadata('__controller__', exp)) continue;
        const prefix = String(Reflect.getMetadata('path', exp) ?? '');
        for (const name of Object.getOwnPropertyNames(exp.prototype)) {
          const h = exp.prototype[name];
          if (typeof h !== 'function' || Reflect.getMetadata('method', h) === undefined) continue;
          const full = '/' + [prefix, String(Reflect.getMetadata('path', h) ?? '')].filter(Boolean).join('/');
          const seg = routeFirstSegment(full);
          if (['pos', 'owner', 'tenant', 'tech'].includes(seg)) { staff++; expect(() => guard.canActivate(ctxFor(full, 'CUSTOMER')), full).toThrow(NotFoundException); }
          if (seg === 'customer') { customer++; expect(() => guard.canActivate(ctxFor(full, 'OWNER')), full).toThrow(ForbiddenException); }
        }
      }
    }
    expect(staff).toBeGreaterThan(500);   // the sweep really walked the staff surface
    expect(customer).toBeGreaterThan(50);
  }, 240_000);
});

describe('wiring', () => {
  it('RealmGuard is a global guard, registered BEFORE RolePermissionGuard', () => {
    const app = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    const realm = app.indexOf('{ provide: APP_GUARD, useClass: RealmGuard }');
    expect(realm).toBeGreaterThan(0);
    expect(realm).toBeLessThan(app.indexOf('{ provide: APP_GUARD, useClass: RolePermissionGuard }'));
  });
});
