// checkout-payment-metrics.vitest.spec.ts — wave 3 PAYI §104: the card path counts attempts, approvals, declines and
// unknown outcomes (a processor that throws = PAYMENT_STATUS_UNKNOWN), and an idempotent replay is NOT a new attempt.
import { describe, it, expect, beforeEach } from 'vitest';
import { integrationBusinessCounts, resetIntegrationBusinessCountsForTests } from '@aipowersalon/observability';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected', cardSurchargeEnabled: true } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
const proc = (mode: 'approve' | 'decline' | 'throw') => ({
  name: 'spy',
  async authorizeAndCapture() {
    if (mode === 'throw') throw new Error('socket hang up');
    return mode === 'approve' ? { approved: true, retref: 'RET-1', authCode: 'A1', respstat: 'A', respText: 'Approved' } : { approved: false, retref: 'DEC-1', respstat: 'C', respText: 'Declined' };
  },
  async voidTransaction(i: any) { return { ok: true, retref: i.retref }; },
  async refund() { return { ok: true }; },
}) as any;

describe('payment business counters (§104)', () => {
  beforeEach(() => resetIntegrationBusinessCountsForTests());
  it('approval: one attempt, one approval; a same-key replay adds nothing', async () => {
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, proc('approve'));
    await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'K1' } as any);
    await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'K1' } as any);
    expect(integrationBusinessCounts().payments).toEqual({ attempt: 1, approved: 1 });
  });
  it('decline is counted as a decline', async () => {
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, proc('decline'));
    await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'K2' } as any);
    expect(integrationBusinessCounts().payments).toEqual({ attempt: 1, declined: 1 });
  });
  it('a processor that throws is an UNKNOWN outcome (never a decline)', async () => {
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, proc('throw'));
    await expect(svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'K3' } as any)).rejects.toThrow();
    expect(integrationBusinessCounts().payments).toEqual({ attempt: 1, unknown: 1 });
  });
});
