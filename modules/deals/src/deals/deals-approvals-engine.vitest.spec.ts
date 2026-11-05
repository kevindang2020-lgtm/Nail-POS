// deals-approvals-engine — BUILD_PLAN Phase 9 (agent D): a deal waiting for approval is a request in the salon's ONE
// approvals engine. Submitting files it; the legacy approve / reject routes decide THROUGH the engine (so its policy —
// separation of duties, approver key, limits — applies); the engine's executor moves the deal. Without the engine the
// old direct path stands. (The engine itself is pgtested in modules/workforce approvals.)
import { describe, it, expect } from 'vitest';
import { InMemoryDealsRepository } from './deals.repository';
import { DealsService, DealForbiddenError } from './deals.service';

const T = 'te-1';
const mgr: any = { tenantId: T, branchId: '', userId: 'u-mgr', role: 'MANAGER', permissions: ['marketing.manage', 'approvals.decide'] };
const owner: any = { tenantId: T, branchId: '', userId: 'u-own', role: 'OWNER', permissions: ['marketing.manage', 'approvals.decide'] };

function fakeEngine(opts: { requireDifferentApprover?: boolean } = {}) {
  const reqs: any[] = []; const ex: Record<string, any> = {};
  return {
    reqs, ex,
    registerExecutor(kind: string, e: any) { ex[kind] = e; },
    async request(actor: any, body: any) {
      const live = reqs.find((r) => r.subjectId === body.subjectId && r.status === 'pending');
      if (live) return { request: live, created: false };
      const extra = ex[body.kind]?.prepare ? await ex[body.kind].prepare(actor, { ...body, payload: body.payload ?? {} }) : {};
      const r = { id: `apr-${reqs.length + 1}`, version: 1, status: 'pending', requestedByUserId: actor.userId, branchId: null, ...body, ...extra };
      reqs.push(r); return { request: r, created: true };
    },
    async liveFor(_a: any, kind: string, subjectType: string, subjectId: string) { return reqs.find((r) => r.kind === kind && r.subjectType === subjectType && r.subjectId === subjectId && r.status === 'pending') ?? null; },
    async decide(actor: any, id: string, body: any) {
      const r = reqs.find((x) => x.id === id);
      if (opts.requireDifferentApprover && r.requestedByUserId === actor.userId) throw Object.assign(new Error('You asked for this — someone else has to approve it.'), { code: 'requester_cannot_approve', status: 403 });
      if (body.decision === 'approve') { r.status = 'approved'; await ex[r.kind].execute(actor, { ...r, decisionNote: body.note ?? null }); r.status = 'executed'; }
      else { r.status = 'rejected'; await ex[r.kind].onReject?.(actor, r, body.note ?? null); }
      return r;
    },
  };
}
const salonDeal = { ownerType: 'salon' as const, title: 'Spring Mani', discountType: 'percent' as const, discountPercent: 20, originalPriceCents: 5_000 };

describe('deal approvals on the engine', () => {
  it('submit files ONE request (kind deal_publish, subject the deal) — re-submitting after changes reuses it', async () => {
    const eng = fakeEngine(); const svc = new DealsService(new InMemoryDealsRepository()).useApprovals(eng as any);
    const d = await svc.createDeal(mgr, salonDeal);
    await svc.submit(mgr, d.id);
    expect(eng.reqs).toHaveLength(1);
    expect(eng.reqs[0]).toMatchObject({ kind: 'deal_publish', subjectType: 'deal', subjectId: d.id, title: 'Deal: Spring Mani', requestedByUserId: 'u-mgr' });
  });
  it('the approve route decides through the engine; its executor moves the deal to approved', async () => {
    const eng = fakeEngine(); const svc = new DealsService(new InMemoryDealsRepository()).useApprovals(eng as any);
    const d = await svc.createDeal(mgr, salonDeal); await svc.submit(mgr, d.id);
    const out = await svc.approve(owner, d.id, 'looks good');
    expect(out.status).toBe('approved');
    expect(eng.reqs[0].status).toBe('executed');
  });
  it('the engine\'s separation rule now applies to the deals route (audit: no requester ≠ approver before)', async () => {
    const eng = fakeEngine({ requireDifferentApprover: true }); const svc = new DealsService(new InMemoryDealsRepository()).useApprovals(eng as any);
    const d = await svc.createDeal(mgr, salonDeal); await svc.submit(mgr, d.id);
    await expect(svc.approve(mgr, d.id)).rejects.toBeInstanceOf(DealForbiddenError);
    expect((await svc.getDeal(mgr, d.id)).status).toBe('pending_approval');
    expect((await svc.approve(owner, d.id)).status).toBe('approved');
  });
  it('reject through the engine needs a reason and moves the deal to rejected', async () => {
    const eng = fakeEngine(); const svc = new DealsService(new InMemoryDealsRepository()).useApprovals(eng as any);
    const d = await svc.createDeal(mgr, salonDeal); await svc.submit(mgr, d.id);
    const out = await svc.reject(owner, d.id, 'price too low');
    expect(out.status).toBe('rejected'); expect(eng.reqs[0].status).toBe('rejected');
  });
  it('prepare refuses a request for a deal that is not waiting for approval', async () => {
    const eng = fakeEngine(); const svc = new DealsService(new InMemoryDealsRepository()).useApprovals(eng as any);
    const d = await svc.createDeal(mgr, salonDeal);
    await expect(eng.ex.deal_publish.prepare(mgr, { kind: 'deal_publish', subjectType: 'deal', subjectId: d.id, reason: 'please', payload: {} })).rejects.toThrow(/not waiting for approval/);
  });
  it('a deal already pending before the engine (no live request) is still approvable directly', async () => {
    const repo = new InMemoryDealsRepository();
    const legacy = new DealsService(repo);
    const d = await legacy.createDeal(mgr, salonDeal); await legacy.submit(mgr, d.id);
    const eng = fakeEngine(); const svc = new DealsService(repo).useApprovals(eng as any);
    expect((await svc.approve(owner, d.id)).status).toBe('approved');
  });
  it('without the engine nothing changes', async () => {
    const svc = new DealsService(new InMemoryDealsRepository());
    const d = await svc.createDeal(mgr, salonDeal); await svc.submit(mgr, d.id);
    expect((await svc.approve(mgr, d.id)).status).toBe('approved');
  });
});
