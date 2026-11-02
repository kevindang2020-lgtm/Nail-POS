import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService, ValidationError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import type { PaymentRecord } from './checkout.dto';

// Adversarial coverage for the refund money-integrity guards: a refund must be a positive whole-cent amount, the original
// must have captured funds (approved/partial), and cumulative refunds can never exceed the captured amount (which also
// blocks double-refunds). Drives the real service + in-memory repo (its refund ledger is now real, not a no-op).
const ctx: CheckoutContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.refund'] };

let repo: InMemoryCheckoutRepository;
let svc: CheckoutService;
const seed = (over: Partial<PaymentRecord> = {}) =>
  repo.recordPayment(ctx, { paymentId: 'pay_x', ticketId: 'tk1', method: 'cash', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: new Date().toISOString(), ...over } as PaymentRecord);

beforeEach(() => { repo = new InMemoryCheckoutRepository(); svc = new CheckoutService(repo); });

describe('refund money-integrity guards', () => {
  it('allows a single full refund of an approved payment', async () => {
    await seed();
    const r = await svc.refund(ctx, 'pay_x', { reason: 'customer return', amountCents: 5000 } as any);
    expect((r as any).status).toBe('refunded');
    expect(await repo.refundedTotalCents(ctx, 'pay_x')).toBe(5000);
  });

  it('REJECTS a second refund once fully refunded (no double-refund)', async () => {
    await seed();
    await svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 5000 } as any);
    await expect(svc.refund(ctx, 'pay_x', { reason: 'again', amountCents: 5000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS an over-refund larger than the captured amount', async () => {
    await seed();
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 6000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS negative, zero, and fractional amounts', async () => {
    await seed();
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: -100 } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 0 } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 100.5 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('REJECTS refunding a non-approved payment (declined / not_configured)', async () => {
    await seed({ status: 'declined' });
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 1000 } as any)).rejects.toBeInstanceOf(ValidationError);
    repo = new InMemoryCheckoutRepository(); svc = new CheckoutService(repo);
    await seed({ status: 'not_configured' });
    await expect(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 1000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows cumulative partial refunds up to the captured amount, then rejects the overflow', async () => {
    await seed();
    expect((await svc.refund(ctx, 'pay_x', { reason: 'p1', amountCents: 2000 } as any) as any).status).toBe('refunded');
    expect((await svc.refund(ctx, 'pay_x', { reason: 'p2', amountCents: 3000 } as any) as any).status).toBe('refunded');
    expect(await repo.refundedTotalCents(ctx, 'pay_x')).toBe(5000);
    await expect(svc.refund(ctx, 'pay_x', { reason: 'p3', amountCents: 1 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('still requires a reason', async () => {
    await seed();
    await expect(svc.refund(ctx, 'pay_x', { amountCents: 1000 } as any)).rejects.toBeInstanceOf(ValidationError);
  });
});
