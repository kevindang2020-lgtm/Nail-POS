// entitlements-technicians-unlimited.vitest.spec.ts — product policy: technicians are UNLIMITED for every
// tenant, regardless of plan limit or tenant override. Enforcement, preflight, and display must all agree,
// while OTHER metrics keep enforcing normally.
import { describe, it, expect } from 'vitest';
import { EntitlementsService, LimitExceededError } from './entitlements.service';

// Repo that deliberately tries to CAP technicians (plan limit 2 + override 1) with heavy usage (99),
// and also caps branches (limit 2, used 5) to prove non-technician metrics still enforce.
function cappingRepo() {
  return {
    async tenantExists() { return true; },
    async getActivePlanText() { return 'starter'; },
    async mapCatalogPlan() { return { id: 'plan_starter', code: 'starter', name: 'Starter' } as any; },
    async getPlanLimits() { return { technicians: 2, branches: 2 }; },
    async getPlanFeatureStates() { return {}; },
    async getLimitOverrides() { return [{ metric: 'technicians', limit_value: 1, enforcement: 'hard', reason: 'x', expires_at: null }]; },
    async getFeatureOverrides() { return []; },
    async getUsedCounts() { return { technicians: 99, branches: 5 }; },
  };
}

describe('technicians are unlimited for all tenants', () => {
  it('checkLimit reports technicians as unlimited despite plan cap + override + heavy usage', async () => {
    const svc = new EntitlementsService(cappingRepo() as any);
    const r = await svc.checkLimit('t1', 'technicians');
    expect(r.effectiveValue).toBeNull();     // null = unlimited
    expect(r.status).toBe('unlimited');
    expect(r.allowed).toBe(true);
  });
  it('assertCanCreate never throws for technicians (even at used=99)', async () => {
    const svc = new EntitlementsService(cappingRepo() as any);
    await expect(svc.assertCanCreate('t1', 'technicians')).resolves.toBeUndefined();
  });
  it('getEntitlements shows technicians unlimited (value null, source plan)', async () => {
    const svc = new EntitlementsService(cappingRepo() as any);
    const ent = await svc.getEntitlements('t1');
    const tech = ent.limits.find((l: any) => l.metric === 'technicians');
    expect(tech.effectiveValue).toBeNull();
    expect(tech.evaluation.status).toBe('unlimited');
    expect(tech.override).toBeNull();        // technicians override is ignored
  });
  it('OTHER metrics still enforce — branches (limit 2, used 5) is blocked', async () => {
    const svc = new EntitlementsService(cappingRepo() as any);
    const b = await svc.checkLimit('t1', 'branches');
    expect(b.allowed).toBe(false);
    await expect(svc.assertCanCreate('t1', 'branches')).rejects.toBeInstanceOf(LimitExceededError);
  });
});
