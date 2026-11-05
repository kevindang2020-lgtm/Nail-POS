import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService, ValidationError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import type { PaymentRecord } from './checkout.dto';

// Adversarial coverage for the VOID money-integrity guards (previously missing): a void may only target a payment that
// actually captured funds (approved/partial) and has not already been reversed — so voiding a declined/not_configured
// payment, a row that is itself a void/refund, or an already-refunded payment is rejected. Drives the real service.
const ctx: CheckoutContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.void', 'pos.checkout.refund'] };

// A sandbox gateway so the happy-path void actually settles (the default in-memory repo is 'not_configured').
class SandboxRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { const s = await super.settings(c); return { ...s, fiservStatus: 'sandbox' } as any; }
}

let repo: SandboxRepo;
let svc: CheckoutService;
const seed = (over: Partial<PaymentRecord> = {}) =>
  repo.recordPayment(ctx, { paymentId: 'pay_x', ticketId: 'tk1', method: 'card', amountCents: 5000, tipCents: 0, status: 'approved', processorTransactionId: 'sbx_auth_1', createdAt: new Date().toISOString(), ...over } as PaymentRecord);

beforeEach(() => { repo = new SandboxRepo(); svc = new CheckoutService(repo); });

describe('void money-integrity guards', () => {
  it('allows voiding an approved payment', async () => {
    await seed();
    const r = await svc.void(ctx, 'pay_x', { reason: 'entered wrong amount' } as any);
    expect((r as any).status).toBe('voided');
  });

  it('requires a reason', async () => {
    await seed();
    await expect(svc.void(ctx, 'pay_x', { reason: '   ' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS voiding a declined payment', async () => {
    await seed({ status: 'declined' });
    await expect(svc.void(ctx, 'pay_x', { reason: 'r' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS voiding a not_configured payment', async () => {
    await seed({ status: 'not_configured' });
    await expect(svc.void(ctx, 'pay_x', { reason: 'r' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS voiding a row that is itself a void (no double-void of a void record)', async () => {
    await seed({ status: 'voided' });
    await expect(svc.void(ctx, 'pay_x', { reason: 'r' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS voiding a payment that has already been refunded', async () => {
    await seed({ method: 'cash' }); // cash refunds settle without a gateway
    await svc.refund(ctx, 'pay_x', { reason: 'returned', amountCents: 5000 } as any);
    await expect(svc.void(ctx, 'pay_x', { reason: 'now void it too' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS voiding the SAME payment twice (the original is marked voided, not just a new void row)', async () => {
    await seed();
    expect((await svc.void(ctx, 'pay_x', { reason: 'first void' } as any) as any).status).toBe('voided');
    await expect(svc.void(ctx, 'pay_x', { reason: 'second void' } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS refunding a payment that was already voided (no double money-return — matters for Clover void=refund)', async () => {
    await seed();
    await svc.void(ctx, 'pay_x', { reason: 'void it' } as any);
    await expect(svc.refund(ctx, 'pay_x', { reason: 'now refund too', amountCents: 5000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a voided payment no longer counts toward the ticket paid-total (reversed funds stop counting)', async () => {
    await seed();
    expect(await repo.paidTotalCents(ctx, 'tk1')).toBe(5000);
    await svc.void(ctx, 'pay_x', { reason: 'void it' } as any);
    expect(await repo.paidTotalCents(ctx, 'tk1')).toBe(0);
  });

  it('voiding the only payment returns the ticket to a payable state (reappears in checkout, not hidden as paid)', async () => {
    // luxe001 has real seeded tickets; tk_2044 is an unpaid Classic Manicure.
    const lux: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.void', 'pos.checkout.view'] };
    const { payment } = await svc.payCash(lux, 'tk_2044', { amountReceivedCents: 100000 } as any);
    expect((await repo.ticket(lux, 'tk_2044'))!.status).toBe('paid');               // fully paid → filtered out of the active checkout list
    await svc.void(lux, payment.paymentId, { reason: 'wrong ticket' } as any);
    expect((await repo.ticket(lux, 'tk_2044'))!.status).toBe('ready_for_payment');  // void reopened it for payment
    expect(await repo.paidTotalCents(lux, 'tk_2044')).toBe(0);
  });
});
