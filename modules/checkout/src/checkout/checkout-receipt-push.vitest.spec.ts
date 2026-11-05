// checkout-receipt-push.vitest.spec.ts — developer merge (Oct 6 2026): a receipt saved to the customer's app pushes
// "Receipt saved" to the customer's devices — typed RECEIPT category (routes to the app's Receipts screen), no amount on
// the lock screen, keyed by the receipt number; a ticket without an app account pushes nothing; no push port → nothing,
// and a failing push never fails the receipt.
import { describe, it, expect } from 'vitest';
import { CheckoutService } from './checkout.service';

const ctx: any = { tenantId: 'luxe001', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.receipts.send'] };
function harness(opts: { userId: string | null; pushFails?: boolean }) {
  const pushed: any[] = [];
  const repo: any = {
    ticket: async () => ({ id: 'tk1', customerId: 'c1', customerPhone: null, customerEmail: null, method: 'cash' }),
    totalsFor: async () => ({ totalDueCents: 10300, tipCents: 1500, surchargeCents: 0 }),
    paidBreakdown: async () => ({ totalCents: 10300, surchargeCents: 0 }),
    recordReceipt: async () => ({ receiptId: 'r1', receiptNumber: 'R-77' }),
    customerUserIdForTicket: async () => opts.userId,
  };
  const push = { dispatchToUser: async (t: string | null, u: string, msg: any) => { if (opts.pushFails) throw new Error('provider down'); pushed.push({ t, u, msg }); return {}; } };
  const svc = new CheckoutService(repo).usePush(push);
  return { svc, pushed };
}

describe('receipt saved to the app → push', () => {
  it('pushes the customer’s account once, typed RECEIPT, keyed by the receipt number, no amount', async () => {
    const { svc, pushed } = harness({ userId: 'user-9' });
    const r = await svc.receiptApp(ctx, 'tk1');
    expect(r).toMatchObject({ channel: 'app', delivery: 'saved', receiptNumber: 'R-77' });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ t: 'luxe001', u: 'user-9', msg: { title: 'Receipt saved', category: 'RECEIPT', reference: 'receipt:R-77', data: { kind: 'receipt_saved', ticketId: 'tk1' } } });
    expect(pushed[0].msg.body).not.toMatch(/\$|103/);
  });
  it('a customer without an app account: receipt saved, nothing pushed', async () => {
    const { svc, pushed } = harness({ userId: null });
    expect((await svc.receiptApp(ctx, 'tk1')).delivery).toBe('saved');
    expect(pushed).toHaveLength(0);
  });
  it('pushes to active owners as well as customer when activeOwnerUserIds is present', async () => {
    const { svc, pushed } = harness({ userId: 'user-9' });
    (svc as any).repo.activeOwnerUserIds = async () => ['owner-1'];
    await svc.receiptApp(ctx, 'tk1');
    expect(pushed).toHaveLength(2);
    expect(pushed[0]).toMatchObject({ t: 'luxe001', u: 'user-9', msg: { title: 'Receipt saved', category: 'RECEIPT' } });
    expect(pushed[1]).toMatchObject({ t: 'luxe001', u: 'owner-1', msg: { title: 'Receipt generated', category: 'RECEIPT' } });
  });
});
