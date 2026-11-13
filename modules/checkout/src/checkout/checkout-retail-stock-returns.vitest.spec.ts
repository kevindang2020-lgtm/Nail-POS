// checkout-retail-stock-returns — B-17 (Oct 20 2026): retail stock moved when the line was added and never came back.
// A void that leaves nothing captured, a full refund, or a line refund hands the ticket (or the refunded lines) to the
// stock port; an amount-only refund keeps the units (the product left with the guest). Drives the real service with
// the in-memory repository and a recording stock port.
import { describe, it, expect } from 'vitest';
import { CheckoutService, type RetailStockReturnsPort } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.refund', 'checkout.approve_refund', 'pos.checkout.void'] };
const TK = 'tk_2041';   // l1 Signature Manicure $55, l2 Gel Add-on $15

class SandboxRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { const s = await super.settings(c); return { ...s, fiservStatus: 'sandbox' } as any; }
}
function stockPort() {
  const calls: Array<{ ticketId: string; lineIds: string[] | null; reason: string }> = [];
  const port: RetailStockReturnsPort = { reverseRetailSale: async (_c, input) => { calls.push(input); return { returned: input.lineIds?.length ?? 2, byProduct: [] }; } };
  return { port, calls };
}
async function paid() {
  const repo = new SandboxRepo(); const stock = stockPort(); const svc = new CheckoutService(repo).useStock(stock.port);
  const due = (await svc.recalculate(ctx, TK, 'cash') as any).totalDueCents;
  await svc.payCash(ctx, TK, { amountReceivedCents: due } as any);
  return { repo, svc, stock, due };
}

describe('B-17: retail units come back on void / refund', () => {
  it('a line refund returns that line\'s units only', async () => {
    const { svc, stock } = await paid();
    await svc.refundTicket(ctx, TK, { reason: 'chipped polish', serviceLineIds: ['l1'] } as any);
    expect(stock.calls).toEqual([{ ticketId: TK, lineIds: ['l1'], reason: 'refund: chipped polish' }]);
  });
  it('a full refund returns every unit of the ticket', async () => {
    const { svc, stock, repo } = await paid();
    await svc.refundTicket(ctx, TK, { reason: 'unhappy', amountCents: await repo.paidTotalCents(ctx, TK) } as any);
    expect(stock.calls).toEqual([{ ticketId: TK, lineIds: null, reason: 'refund: unhappy' }]);
  });
  it('an amount-only partial refund keeps the units (the product left with the guest)', async () => {
    const { svc, stock } = await paid();
    await svc.refundTicket(ctx, TK, { reason: 'goodwill', amountCents: 500 } as any);
    expect(stock.calls).toEqual([]);
  });
  it('a void that leaves nothing captured returns every unit; the stock port failing never fails the void', async () => {
    const repo = new SandboxRepo(); const stock = stockPort(); const svc = new CheckoutService(repo).useStock(stock.port);
    await repo.recordPayment(ctx, { paymentId: 'pay_x', ticketId: 'tk1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'sbx_auth_1', createdAt: new Date().toISOString() } as any);
    expect(((await svc.void(ctx, 'pay_x', { reason: 'entered wrong amount' } as any)) as any).status).toBe('voided');
    expect(stock.calls).toEqual([{ ticketId: 'tk1', lineIds: null, reason: 'void: entered wrong amount' }]);
    const failing = new CheckoutService(new SandboxRepo()).useStock({ reverseRetailSale: async () => { throw new Error('inventory down'); } });
    await (failing as any).repo.recordPayment(ctx, { paymentId: 'pay_y', ticketId: 'tk2', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'sbx_auth_2', createdAt: new Date().toISOString() } as any);
    expect(((await failing.void(ctx, 'pay_y', { reason: 'r' } as any)) as any).status).toBe('voided');
  });
  it('round 11 (ADD-ONS 06): a void also gives back the add-on recipe use; a refund never does (the product was used)', async () => {
    const addOn: Array<{ ticketId: string; lineIds: string[] | null; reason: string }> = []; const retail: typeof addOn = [];
    const port: RetailStockReturnsPort = { reverseRetailSale: async (_c, i) => { retail.push(i); return { returned: 0, byProduct: [] }; }, reverseAddOnUsage: async (_c, i) => { addOn.push(i); return { returnedLines: 1 }; } };
    const repo = new SandboxRepo(); const svc = new CheckoutService(repo).useStock(port);
    await repo.recordPayment(ctx, { paymentId: 'pay_a', ticketId: 'tk9', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'sbx_auth_9', createdAt: new Date().toISOString() } as any);
    expect(((await svc.void(ctx, 'pay_a', { reason: 'wrong ticket' } as any)) as any).status).toBe('voided');
    expect(addOn).toEqual([{ ticketId: 'tk9', lineIds: null, reason: 'void: wrong ticket' }]);
    const paidOne = new SandboxRepo(); const addOn2: typeof addOn = [];
    const svc2 = new CheckoutService(paidOne).useStock({ reverseRetailSale: async () => ({ returned: 0, byProduct: [] }), reverseAddOnUsage: async (_c, i) => { addOn2.push(i); return { returnedLines: 0 }; } });
    const due = (await svc2.recalculate(ctx, TK, 'cash') as any).totalDueCents;
    await svc2.payCash(ctx, TK, { amountReceivedCents: due } as any);
    await svc2.refundTicket(ctx, TK, { reason: 'unhappy', amountCents: await paidOne.paidTotalCents(ctx, TK) } as any);
    expect(addOn2).toEqual([]);
    // a failing add-on return never fails the void
    const failing = new CheckoutService(new SandboxRepo()).useStock({ reverseRetailSale: async () => ({ returned: 0, byProduct: [] }), reverseAddOnUsage: async () => { throw new Error('inventory down'); } });
    await (failing as any).repo.recordPayment(ctx, { paymentId: 'pay_b', ticketId: 'tk8', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'sbx_auth_8', createdAt: new Date().toISOString() } as any);
    expect(((await failing.void(ctx, 'pay_b', { reason: 'r' } as any)) as any).status).toBe('voided');
  });
  it('without a stock port nothing is attempted (a deployment without inventory)', async () => {
    const repo = new SandboxRepo(); const svc = new CheckoutService(repo);
    const due = (await svc.recalculate(ctx, TK, 'cash') as any).totalDueCents;
    await svc.payCash(ctx, TK, { amountReceivedCents: due } as any);
    await expect(svc.refundTicket(ctx, TK, { reason: 'x', serviceLineIds: ['l1'] } as any)).resolves.toBeTruthy();
  });
});
