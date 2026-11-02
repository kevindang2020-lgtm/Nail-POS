// signed-in-user.test.ts — a person's own account routes: any signed-in person; never an integration.
import { describe, it, expect } from 'vitest';
import { SignedInUserGuard } from './signed-in-user.guard';
const ctxOf = (c: any) => ({ switchToHttp: () => ({ getRequest: () => ({ ctx: c }) }) }) as any;
describe('SignedInUserGuard', () => {
  const g = new SignedInUserGuard();
  it('staff, platform staff and customers pass; no session → 401; an API key or OAuth app → 403', () => {
    for (const role of ['OWNER', 'FRONT_DESK', 'SUPER_ADMIN', 'CUSTOMER']) expect(g.canActivate(ctxOf({ userId: 'u', role }))).toBe(true);
    expect(() => g.canActivate(ctxOf(undefined))).toThrow(/Sign in first/);
    expect(() => g.canActivate(ctxOf({ userId: 'k', role: 'INTEGRATION', actorType: 'INTEGRATION', apiKeyId: 'k' }))).toThrow(/Apps cannot/);
    expect(() => g.canActivate(ctxOf({ userId: 'g', role: 'FRONT_DESK', actorType: 'INTEGRATION' }))).toThrow(/Apps cannot/);
  });
});
