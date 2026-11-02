import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// Membership-comp wiring: after a ticket is flipped to 'paid', checkout fires the membership-redemption commission
// booking (the technician's frozen 60/40 share → the payroll ledger). Best-effort and NON-THROWING: a booking failure
// must never affect the already-captured payment. The booking is idempotent and a no-op when the ticket has no
// redemption (verified in membership-compensation.service.vitest.spec.ts); here we verify the checkout WIRING and the
// non-throwing safety contract.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'] };
const TK = 'tk_2042';

describe('checkout → membership-comp booking hook (post-payment, best-effort)', () => {
  it('books membership comp for the paid ticket after a successful cash payment', async () => {
    const repo = new InMemoryCheckoutRepository();
    const calls: { tenantId: string; ticketId: string }[] = [];
    const membershipComp = { bookTicketMembershipComp: async (c: any, ticketId: string) => { calls.push({ tenantId: c.tenantId, ticketId }); return { booked: 0 }; } };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, membershipComp);
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment.status).toBe('approved');
    expect(calls).toEqual([{ tenantId: 'luxe001', ticketId: TK }]); // booked once, post-payment, tenant-scoped from session ctx
  });

  it('SAFETY: a throwing membership-comp hook does NOT fail the payment', async () => {
    const repo = new InMemoryCheckoutRepository();
    const membershipComp = { bookTicketMembershipComp: async () => { throw new Error('ledger db down'); } };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, membershipComp);
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due }); // must not throw
    expect(payment.status).toBe('approved');
  });

  it('works with NO membership-comp hook (backward compatible)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo); // no hooks injected
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment.status).toBe('approved');
  });

  it('hooks fire independently: a throwing compensation snapshot does not stop membership-comp booking', async () => {
    const repo = new InMemoryCheckoutRepository();
    const booked: string[] = [];
    const compensation = { snapshotPaidTicket: async () => { throw new Error('snapshot down'); } };
    const membershipComp = { bookTicketMembershipComp: async (_c: any, ticketId: string) => { booked.push(ticketId); return { booked: 0 }; } };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, compensation, membershipComp);
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment.status).toBe('approved');
    expect(booked).toEqual([TK]); // membership comp still booked despite the compensation hook throwing
  });
});
