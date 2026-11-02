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
  it('without a stock port nothing is attempted (a deployment without inventory)', async () => {
    const repo = new SandboxRepo(); const svc = new CheckoutService(repo);
    const due = (await svc.recalculate(ctx, TK, 'cash') as any).totalDueCents;
    await svc.payCash(ctx, TK, { amountReceivedCents: due } as any);
    await expect(svc.refundTicket(ctx, TK, { reason: 'x', serviceLineIds: ['l1'] } as any)).resolves.toBeTruthy();
  });
});
