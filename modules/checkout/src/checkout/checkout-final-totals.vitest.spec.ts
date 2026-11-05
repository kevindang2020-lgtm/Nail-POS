// checkout-final-totals.vitest.spec.ts — a PAID ticket carries its final money (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: at the end of the pilot day the Owner app's Finance summary said revenue $0.00, average
// ticket $0.00 and a NEGATIVE profit (−commission) after four paid tickets and $411.25 collected. Owner finance reads the
// paid ticket's subtotal / tax / total columns (tickets.subtotal_cents, tax_cents, total_cents) — and nothing ever wrote
// them: checkout priced the bill on the fly and recorded only the payments. Paying now stamps the ticket's final
// subtotal (after discounts), tax, surcharge and total collected, once, in the post-payment step every path runs.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'] };

describe('paying a ticket stamps its final totals on the ticket', () => {
  it('cash: subtotal (after discounts), tax, surcharge 0 and the total collected', async () => {
    const repo = new InMemoryCheckoutRepository();
    const finals: any[] = [];
    (repo as any).setFinalTotals = async (_c: any, id: string, t: any) => { finals.push({ id, ...t }); };
    const svc = new CheckoutService(repo);
    const totals = (await repo.totalsFor(ctx, 'tk_2042', 'cash'))!;
    const r: any = await svc.payCash(ctx, 'tk_2042', { amountReceivedCents: totals.totalDueCents + 1000 } as any);
    expect(['approved', 'paid']).toContain(r.status ?? 'approved');
    const paid = await repo.paidTotalCents(ctx, 'tk_2042');
    expect(finals).toEqual([{ id: 'tk_2042', subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, surchargeCents: 0, totalCents: paid }]);
    expect(paid).toBe(totals.totalDueCents);
  });
});
