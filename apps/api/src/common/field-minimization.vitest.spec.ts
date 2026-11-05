// Constitution 7 §82 — the interceptor minimises Super Admin responses for narrower roles only.
import { describe, it, expect } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { platformPermissionsFor, MASK } from '@aipowersalon/permissions';
import { FieldMinimizationInterceptor } from './field-minimization.interceptor';

function run(role: string, perms: string[], path: string, body: unknown) {
  const req = { ctx: { role, permissions: perms }, route: { path } };
  const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
  return lastValueFrom(new FieldMinimizationInterceptor().intercept(ctx, { handle: () => of(body) }) as any);
}
const body = { rows: [{ customerName: 'Jane', commissionRate: 0.6, service: 'Gel' }] };

describe('FieldMinimizationInterceptor', () => {
  it('Support on a Super Admin route: sensitive fields masked', async () => {
    expect(await run('SUPER_ADMIN', platformPermissionsFor('PLATFORM_SUPPORT') as string[], '/super-admin/appointment-oversight/search', body))
      .toEqual({ rows: [{ customerName: MASK, commissionRate: MASK, service: 'Gel' }] });
  });
  it('a Platform Super Admin, a tenant owner, and non-platform paths are untouched', async () => {
    expect(await run('SUPER_ADMIN', platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[], '/super-admin/x', body)).toBe(body);
    expect(await run('OWNER', [], '/pos/reports', body)).toBe(body);
  });
});
