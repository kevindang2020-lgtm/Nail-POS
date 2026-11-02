// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): membership refusals carry their registry code (withCode).
import { describe, it, expect } from 'vitest';
import { MembershipsService } from './memberships.service';
const stub = () => new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : async () => null) }) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error & { apiCode?: string; apiParams?: Record<string, unknown> }; } throw new Error("expected a refusal"); };
const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] };
describe('V-5: membership refusals carry their registry code', () => {
  it('a missing plan → PLAN_NOT_FOUND; a nameless plan → PLAN_NAME_REQUIRED; a long name → PLAN_NAME_TOO_LONG', async () => {
    const svc = new MembershipsService(stub());
    expect(await fails(svc.getPlan(ctx, 'nope'))).toMatchObject({ apiCode: 'PLAN_NOT_FOUND', message: 'Plan not found' });
    expect(await fails(svc.createPlan(ctx, { name: ' ' } as any))).toMatchObject({ apiCode: 'PLAN_NAME_REQUIRED' });
    expect(await fails(svc.createPlan(ctx, { name: 'x'.repeat(121) } as any))).toMatchObject({ apiCode: 'PLAN_NAME_TOO_LONG' });
  });
});
