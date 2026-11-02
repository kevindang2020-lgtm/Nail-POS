// checkout-provider-unavailable.vitest.spec.ts — mandate §232 (Oct 20 2026): a processor PROBLEM is never a card DECLINE.
//
// Before: checkout read `!auth.approved` as declined — a CardPointe 'B' (retry: host problem, nothing charged) was
// recorded as 'declined' and the register said "the card was DECLINED"; the Clover adapter set `declined: !approved`,
// so a 'pending' charge became a decline too. Now the adapter says what its answer MEANS (outcome) and checkout acts
// on it: 'retry' → the claim is freed as 'failed', CARD_PROCESSOR_UNAVAILABLE (503, other tenders), no decline recorded;
// 'unknown' → the claim STAYS 'processing' (Verify / the sweep settle it), PAYMENT_STATUS_UNKNOWN; 'declined' → as before.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected' } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
const processor = (answer: any) => ({ name: 'spy', calls: 0, async authorizeAndCapture() { this.calls++; return answer; }, async voidTransaction() { return { approved: true }; }, async refund() { return { ok: true }; } }) as any;
const paymentsOf = async (repo: InMemoryCheckoutRepository) => (await repo.paymentsForTicket(ctx, 'tk_2042')).map((p) => p.status);

describe('a card charge whose processor answer is not an approval', () => {
  it("CardPointe 'B' (retry): PROVIDER_UNAVAILABLE, the claim is freed as 'failed' — no 'declined' row, and the cashier may try again or take another tender", async () => {
    const repo = new ConnectedRepo(); const proc = processor({ approved: false, declined: false, outcome: 'retry', respstat: 'B', respText: 'Retry' });
    const svc = new CheckoutService(repo, undefined, undefined, proc);
    await expect(svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'B-1' } as any)).rejects.toMatchObject({ message: 'CARD_PROCESSOR_UNAVAILABLE' });
    expect(await paymentsOf(repo)).not.toContain('declined');
    expect(await paymentsOf(repo)).not.toContain('processing');
    // a second try is a NEW charge (the claim was freed); cash is still available
    proc.authorizeAndCapture = async () => { proc.calls++; return { approved: true, declined: false, outcome: 'approved', retref: 'RET-2', respstat: 'A', respText: 'Approved' }; };
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'B-2' } as any);
    expect(r.status).toBe('approved');
    expect(proc.calls).toBe(2);
  });
  it("an UNKNOWN answer (Clover 'pending'): PAYMENT_STATUS_UNKNOWN, the claim stays 'processing' — never a decline, never a second charge", async () => {
    const repo = new ConnectedRepo(); const proc = processor({ approved: false, declined: false, outcome: 'unknown', retref: 'chg_p', respstat: 'U', respText: 'pending' });
    const svc = new CheckoutService(repo, undefined, undefined, proc);
    await expect(svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'U-1' } as any)).rejects.toMatchObject({ message: 'PAYMENT_STATUS_UNKNOWN' });
    expect(await paymentsOf(repo)).toContain('processing');
    expect(await paymentsOf(repo)).not.toContain('declined');
    // the same intent retried is answered from the claim, not charged again
    const again: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'U-1' } as any);
    expect(again.status).toBe('processing');
    expect(proc.calls).toBe(1);
  });
  it("an explicit decline ('C') is still a decline", async () => {
    const repo = new ConnectedRepo(); const proc = processor({ approved: false, declined: true, outcome: 'declined', respstat: 'C', respText: 'Insufficient funds' });
    const svc = new CheckoutService(repo, undefined, undefined, proc);
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'C-1' } as any);
    expect(r.status).toBe('declined');
    expect(await paymentsOf(repo)).toContain('declined');
  });
  it('an adapter that does not say (no outcome, not approved, not declined) is UNKNOWN — the old "not approved = declined" reading is gone', async () => {
    const repo = new ConnectedRepo(); const proc = processor({ approved: false, respstat: '', respText: '' });
    const svc = new CheckoutService(repo, undefined, undefined, proc);
    await expect(svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'N-1' } as any)).rejects.toMatchObject({ message: 'PAYMENT_STATUS_UNKNOWN' });
    expect(await paymentsOf(repo)).not.toContain('declined');
  });
});
