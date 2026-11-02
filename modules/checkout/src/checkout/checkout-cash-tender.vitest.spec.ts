import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// Money-integrity hardening for cash tenders. payCash already rejects underpayment and computes change as
// (received - due); these lock in that the amount received must be a non-negative WHOLE number of cents (a
// fractional value would otherwise produce a fractional change_due), and assert the conservation invariant:
// the cash applied to the ticket plus the change returned equals exactly the cash received — no cents created
// or lost. The recorded payment amount is always the server-computed due, never the (possibly larger) tender.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'] };
const TK = 'tk_2042';
function setup() { const repo = new InMemoryCheckoutRepository(); return { repo, svc: new CheckoutService(repo) }; }
const dueOf = (repo: InMemoryCheckoutRepository) => repo.totalsFor(ctx, TK, 'cash').then((t) => t!.totalDueCents);

describe('payCash — tender validation + money conservation', () => {
  it('rejects a FRACTIONAL amount received', async () => {
    const { repo, svc } = setup(); const due = await dueOf(repo);
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: due + 0.5 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a NEGATIVE amount received', async () => {
    const { svc } = setup();
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: -100 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects underpayment (received < due)', async () => {
    const { svc } = setup();
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: 1 } as any)).rejects.toThrow(/less than the total due/i);
  });

  it('conserves cash on overpayment: applied (= due) + change (= received - due) === received', async () => {
    const { repo, svc } = setup(); const due = await dueOf(repo);
    const received = due + 1234;
    const { payment, changeDueCents } = await svc.payCash(ctx, TK, { amountReceivedCents: received });
    expect(payment.amountCents).toBe(due);                        // recorded payment is the due, not the tender
    expect(changeDueCents).toBe(1234);                            // change = received - due
    expect(payment.amountCents + changeDueCents).toBe(received);  // conservation: nothing created or lost
    expect(payment.status).toBe('approved');
  });

  it('exact payment returns zero change', async () => {
    const { repo, svc } = setup(); const due = await dueOf(repo);
    const { changeDueCents } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(changeDueCents).toBe(0);
  });
});
