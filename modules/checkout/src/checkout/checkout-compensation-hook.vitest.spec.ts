import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// P6 wiring: after a ticket is flipped to 'paid', checkout fires the compensation snapshot hook (spec §13–§16).
// The hook is best-effort and NON-THROWING: a snapshot failure must never affect the already-captured payment.
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'] };
const TK = 'tk_2042';

describe('checkout → compensation snapshot hook (post-payment, best-effort)', () => {
  it('calls snapshotPaidTicket with the paid ticket after a successful cash payment', async () => {
    const repo = new InMemoryCheckoutRepository();
    const calls: { tenantId: string; ticketId: string }[] = [];
    const compensation = { snapshotPaidTicket: async (c: any, ticketId: string) => { calls.push({ tenantId: c.tenantId, ticketId }); return { ok: true }; } };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, compensation);
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment.status).toBe('approved');
    expect(calls).toEqual([{ tenantId: 'luxe001', ticketId: TK }]); // hook fired exactly once, post-payment
  });

  it('SAFETY: a throwing compensation hook does NOT fail the payment', async () => {
    const repo = new InMemoryCheckoutRepository();
    const compensation = { snapshotPaidTicket: async () => { throw new Error('snapshot db down'); } };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, compensation);
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due }); // must not throw
    expect(payment.status).toBe('approved');
  });

  it('works with NO compensation hook (backward compatible)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo); // no hook injected
    const due = (await repo.totalsFor(ctx, TK, 'cash'))!.totalDueCents;
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment.status).toBe('approved');
  });
});

describe('checkout → technician-split review preview (spec §13, read-only)', () => {
  const threeTechHook = {
    snapshotPaidTicket: async () => ({ ok: true }),
    computeForTicket: async () => ({ perTechnician: [
      { technicianId: 'A', serviceEarningsCents: 7000, cardTipCents: 300, cashTipCents: 0 },
      { technicianId: 'B', serviceEarningsCents: 3000, cardTipCents: 300, cashTipCents: 0 },
      { technicianId: 'C', serviceEarningsCents: 5000, cardTipCents: 300, cashTipCents: 0 },
    ] }),
  };
  it('returns per-technician earnings + tips and counts service participants', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, undefined, threeTechHook);
    const out = await svc.technicianSplit(ctx, TK);
    expect(out.participantCount).toBe(3);
    expect(out.technicians.map((t) => t.technicianId)).toEqual(['A', 'B', 'C']);
    expect(out.technicians[0]).toMatchObject({ serviceEarningsCents: 7000, cardTipCents: 300 });
  });
  it('returns empty when no compensation hook is wired', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    expect(await svc.technicianSplit(ctx, TK)).toEqual({ participantCount: 0, technicians: [] });
  });
});
