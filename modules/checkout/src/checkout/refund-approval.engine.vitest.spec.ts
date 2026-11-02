// refund-approval.engine — BUILD_PLAN Phase 9 (agent D): a refund past the salon's limit is SENT FOR APPROVAL through the
// salon approvals engine instead of a 403; the salon's own limits (the refund policy) replace the platform-wide env values;
// the approved request is executed by the engine through the canonical refund (as the approver, exactly once).
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ForbiddenError } from './checkout.service';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';

const perms = (role: string) => [...((ROLE_PERMISSIONS as any)[role] ?? [])];
// a refund clerk: may refund (the refund key) but NOT past the limit (no checkout.approve_refund) — a custom role / template
const fd: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u-fd', role: 'FRONT_DESK', permissions: [...perms('FRONT_DESK'), 'checkout.manage_overrides'] };
// the stock front desk: cannot refund at all (pos.checkout.refund → checkout.manage_overrides) — asks through the engine
const desk: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u-desk', role: 'FRONT_DESK', permissions: perms('FRONT_DESK') };
const mgr: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u-mgr', role: 'MANAGER', permissions: perms('MANAGER') };

/** A stand-in for the engine port (the real one is pgtested in modules/workforce approvals). */
function fakeEngine(policy: { thresholdCents: number; cashThresholdCents: number }) {
  const requests: any[] = []; const executors: Record<string, any> = {};
  return {
    requests, executors,
    registerExecutor(kind: string, ex: any) { executors[kind] = ex; },
    async policy() { return { kind: 'refund', enabled: true, ...policy }; },
    async request(actor: any, body: any) {
      const live = requests.find((r) => r.subjectId === body.subjectId && r.status === 'pending');
      if (live) return { request: live, created: false };
      const r = { id: `apr-${requests.length + 1}`, status: 'pending', expiresAt: '2026-10-09T12:00:00.000Z', requestedByUserId: actor.userId, branchId: actor.branchId, ...body };
      requests.push(r); return { request: r, created: true };
    },
  };
}
async function paidCash(repo: InMemoryCheckoutRepository, svc: CheckoutService, ticket = 'tk_2042') {
  const due = (await repo.totalsFor(mgr, ticket, 'cash'))!.totalDueCents;
  const { payment } = await svc.payCash(mgr, ticket, { amountReceivedCents: due });
  return { paymentId: payment.paymentId, due };
}

describe('a refund past the limit becomes an approval request (not a 403)', () => {
  it('front desk, cash past the salon cash limit → approval_pending with the request id; nothing refunded', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 1_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    const { paymentId } = await paidCash(repo, svc);
    const r: any = await svc.refund(fd, paymentId, { reason: 'Customer unhappy', amountCents: 1_500 });
    expect(r).toMatchObject({ status: 'approval_pending', approvalId: 'apr-1', expiresAt: '2026-10-09T12:00:00.000Z' });
    expect(eng.requests[0]).toMatchObject({ kind: 'refund', subjectType: 'payment', subjectId: paymentId, amountCents: 1_500, payload: { paymentId, amountCents: 1_500, reason: 'Customer unhappy', method: 'cash' } });
    expect(await repo.refundedTotalCents(fd, paymentId)).toBe(0);
    // asking again returns the same pending request
    expect(await svc.refund(fd, paymentId, { reason: 'Customer unhappy', amountCents: 1_500 })).toMatchObject({ status: 'approval_pending', approvalId: 'apr-1' });
    expect(eng.requests).toHaveLength(1);
  });
  it('the SALON\'s limits apply (not the env): under the salon cash limit front desk refunds directly', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 9_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    const { paymentId } = await paidCash(repo, svc);
    expect(await svc.refund(fd, paymentId, { reason: 'Customer unhappy', amountCents: 6_000 })).toMatchObject({ status: 'refunded' });   // env default $50 would have refused
    expect(eng.requests).toHaveLength(0);
  });
  it('the registered executor refunds as the approver, once the engine runs it', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 1_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    const { paymentId } = await paidCash(repo, svc);
    await svc.refund(fd, paymentId, { reason: 'Customer unhappy', amountCents: 1_500 });
    expect(typeof eng.executors.refund?.execute).toBe('function');
    const out = await eng.executors.refund.execute({ ...mgr, branchId: 'br_cherryhill' }, { ...eng.requests[0] });
    expect(out).toMatchObject({ status: 'refunded', amountCents: 1_500, paymentId });
    expect(await repo.refundedTotalCents(fd, paymentId)).toBe(1_500);
  });
  it('the executor refuses an approver who lacks the approval key (no shortcut around the rule)', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 1_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    const { paymentId } = await paidCash(repo, svc);
    await svc.refund(fd, paymentId, { reason: 'Customer unhappy', amountCents: 1_500 });
    await expect(eng.executors.refund.execute(fd, { ...eng.requests[0] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await repo.refundedTotalCents(fd, paymentId)).toBe(0);
  });
  it('without the engine (a process that does not load it) the old 403 stands', async () => {
    const repo = new InMemoryCheckoutRepository(); const svc = new CheckoutService(repo);
    const { paymentId } = await paidCash(repo, svc);
    await expect(svc.refund(fd, paymentId, { reason: 'x', amountCents: 6_000 })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('a ticket refund stops at the tender that went for approval and names the request', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 1_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    await paidCash(repo, svc);
    const r: any = await svc.refundTicket(fd, 'tk_2042', { reason: 'Customer unhappy', amountCents: 1_500 });
    expect(r.refundedCents).toBe(0);
    expect(r.tenders[0]).toMatchObject({ status: 'approval_pending', approvalId: 'apr-1' });
  });
  it('prepare: the engine validates a front-desk ask against the payment and rebuilds the payload (never the client\'s)', async () => {
    const repo = new InMemoryCheckoutRepository(); const eng = fakeEngine({ thresholdCents: 20_000, cashThresholdCents: 1_000 });
    const svc = new CheckoutService(repo).useApprovals(eng as any);
    const { paymentId, due } = await paidCash(repo, svc);
    const prep = eng.executors.refund.prepare;
    await expect(svc.refund(desk, paymentId, { reason: 'x', amountCents: 100 })).rejects.toBeInstanceOf(ForbiddenError);   // the stock front desk cannot refund
    const out = await prep(desk, { subjectType: 'payment', subjectId: paymentId, amountCents: null, reason: 'Wrong service', payload: { paymentId: 'someone-elses', amountCents: 1, method: 'card' } });
    expect(out).toMatchObject({ subjectId: paymentId, amountCents: due, payload: { paymentId, amountCents: due, method: 'cash', reason: 'Wrong service' } });
    await expect(prep(desk, { subjectType: 'payment', subjectId: paymentId, amountCents: due + 1, reason: 'r', payload: {} })).rejects.toThrow(/refundable balance/);
    await expect(prep(desk, { subjectType: 'payment', subjectId: 'nope', amountCents: 100, reason: 'r', payload: {} })).rejects.toThrow(/not found/i);
    await expect(prep(desk, { subjectType: 'ticket', subjectId: paymentId, amountCents: 100, reason: 'r', payload: {} })).rejects.toThrow(/names the payment/);
    await expect(prep(desk, { subjectType: 'payment', subjectId: paymentId, amountCents: 100, reason: 'r', payload: { serviceLineIds: ['not-on-ticket'] } })).rejects.toThrow(/belong to this ticket/);
  });
});
