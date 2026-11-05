// branch-switch-guard.vitest.spec.ts — Owner & Manager Payment App mandate §120–§121 + §141 on the platform's ONE branch
// switch (POST /auth/select-branch). §121: only a branch this person may enter (BranchSelectionService — unchanged). §120:
// before the session moves to ANOTHER branch, every registered BRANCH_SWITCH_GUARD is asked whether a payment is still
// active (the checkout module answers for the Payment App); a "yes" is 409 PAYMENT_IN_PROGRESS and the session is NOT
// re-signed. A guard that cannot answer fails CLOSED (503). §141: a real move is audited 'branch_switched' (from → to).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthController } from './auth.controller';
import { BranchSelectionService, InMemoryBranchAccessRepository } from './branch-access';
import { signSession } from './auth-session-token';
import { BRANCH_SWITCH_GUARD, type BranchSwitchGuardPort } from './branch-switch-guard';

const SECRET = 'test-secret-branch-switch-guard-0123456789';
const T = 't1'; const B1 = 'b1'; const B2 = 'b2';
const branches = new BranchSelectionService(new InMemoryBranchAccessRepository({ [T]: [{ id: B1, isActive: true }, { id: B2, isActive: true }] }));

function res() {
  const r: any = { code: 0, body: undefined, cookies: [] as any[] };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.cookie = (...a: any[]) => { r.cookies.push(a); return r; };
  r.clearCookie = () => r;
  return r;
}
function req(branchId: string | null) {
  const token = signSession({ userId: 'u_owner', tenantId: T, branchId, role: 'OWNER' as any, permissions: ['pos.view'], subscriptionStatus: 'active' }, { secret: SECRET });
  return { headers: { authorization: `Bearer ${token}`, 'x-aps-client': 'native' }, originalUrl: '/api/v1/auth/select-branch', method: 'POST' };
}
function controller(guard: BranchSwitchGuardPort | null | 'throws-on-lookup', audit = { record: vi.fn() }) {
  const moduleRef: any = { get: vi.fn((token: unknown) => {
    expect(token).toBe(BRANCH_SWITCH_GUARD);
    if (guard === 'throws-on-lookup' || guard === null) throw new Error('Nest could not find BRANCH_SWITCH_GUARD');
    return guard;
  }) };
  const ctl = new AuthController({} as any, branches, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, audit as any, moduleRef);
  return { ctl, audit, moduleRef };
}

describe('§120 POST /auth/select-branch asks the branch-switch guard before moving the session', () => {
  const saved = process.env.AUTH_SESSION_SECRET;
  beforeEach(() => { process.env.AUTH_SESSION_SECRET = SECRET; });
  afterEach(() => { if (saved === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = saved; });

  it('an active payment → 409 PAYMENT_IN_PROGRESS, "finish or cancel", no new session, guard told the device', async () => {
    const blockReason = vi.fn(async () => ({ code: 'PAYMENT_IN_PROGRESS', message: 'Finish or cancel the active payment on this phone before switching location.' }));
    const { ctl, audit } = controller({ blockReason });
    const r = res();
    await ctl.selectBranch({ branchId: B2, deviceId: 'iphone-1' }, req(B1), r);
    expect(r.code).toBe(409);
    expect(r.body).toMatchObject({ ok: false, code: 'PAYMENT_IN_PROGRESS' });
    expect(r.body.message).toMatch(/finish or cancel/i);
    expect(r.cookies).toHaveLength(0);
    expect(blockReason).toHaveBeenCalledWith({ tenantId: T, branchId: B1, userId: 'u_owner', deviceId: 'iphone-1', targetBranchId: B2 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('nothing active → 200 with the re-signed session for the new branch, audited branch_switched from → to', async () => {
    const { ctl, audit } = controller({ blockReason: async () => null });
    const r = res();
    await ctl.selectBranch({ branchId: B2, deviceId: 'iphone-1' }, req(B1), r);
    expect(r.code).toBe(200);
    expect(r.body.principal).toMatchObject({ branchId: B2 });
    expect(typeof r.body.accessToken).toBe('string');
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [actx, ev] = audit.record.mock.calls[0] as any[];
    expect(actx).toMatchObject({ tenantId: T, branchId: B2, userId: 'u_owner' });
    expect(ev).toMatchObject({ module: 'auth', action: 'branch_switched', resourceType: 'branch', resourceId: B2, metadata: { fromBranchId: B1, toBranchId: B2, deviceId: 'iphone-1' } });
  });

  it('§121 a branch outside this person’s allowed list is still refused (404) — the guard is not even asked', async () => {
    const blockReason = vi.fn(async () => null);
    const { ctl } = controller({ blockReason });
    const r = res();
    await ctl.selectBranch({ branchId: 'b_foreign' }, req(B1), r);
    expect(r.code).toBe(404);
    expect(blockReason).not.toHaveBeenCalled();
  });

  it('a guard that cannot answer fails CLOSED (503) — never a switch with a payment possibly in flight', async () => {
    const { ctl } = controller({ blockReason: async () => { throw new Error('db down'); } });
    const r = res();
    await ctl.selectBranch({ branchId: B2 }, req(B1), r);
    expect(r.code).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: 'BRANCH_SWITCH_CHECK_UNAVAILABLE' });
  });

  it('the first pick after sign-in (no branch yet) and re-selecting the same branch skip the guard and the audit', async () => {
    const blockReason = vi.fn(async () => ({ code: 'PAYMENT_IN_PROGRESS', message: 'x' }));
    const { ctl, audit } = controller({ blockReason });
    const r1 = res(); await ctl.selectBranch({ branchId: B1 }, req(null), r1);
    const r2 = res(); await ctl.selectBranch({ branchId: B1 }, req(B1), r2);
    expect([r1.code, r2.code]).toEqual([200, 200]);
    expect(blockReason).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('no guard registered in this deployment (e.g. a slim test app) → the switch proceeds as before', async () => {
    const { ctl } = controller(null);
    const r = res();
    await ctl.selectBranch({ branchId: B2 }, req(B1), r);
    expect(r.code).toBe(200);
  });
});

describe('§120 wiring — the guard another Nest module provides is found without identity importing it', () => {
  it('a module that does NOT export BRANCH_SWITCH_GUARD is still reached (ModuleRef strict:false); none → null', async () => {
    await import('reflect-metadata');
    const { Module } = await import('@nestjs/common');
    const { NestFactory } = await import('@nestjs/core');
    const guard: BranchSwitchGuardPort = { blockReason: async () => null };
    @Module({ providers: [{ provide: BRANCH_SWITCH_GUARD, useValue: guard }] }) class PayModule {}
    @Module({ controllers: [AuthController] }) class AuthOnly {}
    @Module({ imports: [AuthOnly, PayModule] }) class Root {}
    const app = await NestFactory.createApplicationContext(Root, { logger: false });
    try { expect((app.get(AuthController, { strict: false }) as any).branchSwitchGuard()).toBe(guard); } finally { await app.close(); }
    @Module({ imports: [AuthOnly] }) class Bare {}
    const bare = await NestFactory.createApplicationContext(Bare, { logger: false });
    try { expect((bare.get(AuthController, { strict: false }) as any).branchSwitchGuard()).toBeNull(); } finally { await bare.close(); }
  });
});
