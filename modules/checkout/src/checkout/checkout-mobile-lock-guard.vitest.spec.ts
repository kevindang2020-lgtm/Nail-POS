import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError, type CheckoutLockRead } from './checkout.service';

// POS↔mobile mutual exclusion: when the Owner & Manager Payment App holds an active lock on a ticket, the POS must
// refuse to charge it. When no lock read is wired (the default for every existing test), behaviour is unchanged.
const ctx: CheckoutContext = {
  tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment'],
};
const TK = 'tk_2042';
const dueOf = (repo: InMemoryCheckoutRepository) => repo.totalsFor(ctx, TK, 'cash').then((t) => t!.totalDueCents);

const lockStub = (status: { locked: boolean; source?: string }): CheckoutLockRead => ({
  async getStatus() { return { locked: status.locked, heldBy: status.locked ? { source: status.source ?? 'mobile' } : null }; },
});

describe('POS pay respects the mobile checkout lock', () => {
  it('blocks a POS cash payment while a mobile lock is active', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, lockStub({ locked: true, source: 'mobile' }));
    const due = await dueOf(repo);
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: due } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: due } as any)).rejects.toThrow(/mobile device/i);
  });

  it('allows the POS payment when the lock is not held (or is a POS-origin lock)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, lockStub({ locked: false }));
    const due = await dueOf(repo);
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment).toBeTruthy();
  });

  it('is a no-op when no lock read is wired (unchanged behaviour)', async () => {
    const repo = new InMemoryCheckoutRepository();
    const svc = new CheckoutService(repo); // no lock dependency
    const due = await dueOf(repo);
    const { payment } = await svc.payCash(ctx, TK, { amountReceivedCents: due });
    expect(payment).toBeTruthy();
  });
});
