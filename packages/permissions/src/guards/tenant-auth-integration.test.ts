// tenant-auth-integration.test.ts — Constitution 3 Step 7: a VERIFIED API key (actorType INTEGRATION + apiKeyId, set
// only by the middleware) passes the salon-routes guard; the role name alone does not.
import { describe, it, expect } from 'vitest';
import { TenantAuthGuard } from './tenant-auth.guard';
const ctxOf = (c: any) => ({ switchToHttp: () => ({ getRequest: () => ({ ctx: c }) }) }) as any;
describe('TenantAuthGuard and integrations', () => {
  const g = new TenantAuthGuard();
  it('a verified key passes; staff pass; a bare INTEGRATION role, a customer and no context are refused', () => {
    expect(g.canActivate(ctxOf({ role: 'INTEGRATION', actorType: 'INTEGRATION', apiKeyId: 'k1' }))).toBe(true);
    expect(g.canActivate(ctxOf({ role: 'FRONT_DESK' }))).toBe(true);
    expect(() => g.canActivate(ctxOf({ role: 'INTEGRATION' }))).toThrow(/Tenant POS access only/);
    expect(() => g.canActivate(ctxOf({ role: 'INTEGRATION', actorType: 'INTEGRATION' }))).toThrow();
    expect(() => g.canActivate(ctxOf({ role: 'CUSTOMER', actorType: 'INTEGRATION', apiKeyId: 'k1' }))).toThrow();
    expect(() => g.canActivate(ctxOf(undefined))).toThrow();
  });
});
