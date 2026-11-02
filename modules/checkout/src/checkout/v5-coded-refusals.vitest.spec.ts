// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): the most-seen free-text checkout refusals carry a REGISTRY code
// (+ params) beside the unchanged English sentence, through the real service and the controller's error mapping; the route
// status is unchanged (400). The POS words the code in Vietnamese (apps/pos-web/src/i18n/deal-reason-text.test.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { CheckoutService, ValidationError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import type { PaymentRecord } from './checkout.dto';
import { CheckoutController } from './checkout.controller';

const ctx: CheckoutContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.checkout.refund', 'pos.checkout.void'] };
let repo: InMemoryCheckoutRepository; let svc: CheckoutService;
const seed = (over: Partial<PaymentRecord> = {}) => repo.recordPayment(ctx, { paymentId: 'pay_x', ticketId: 'tk1', method: 'cash', amountCents: 5000, tipCents: 0, status: 'approved', createdAt: new Date().toISOString(), ...over } as PaymentRecord);
beforeEach(() => { repo = new InMemoryCheckoutRepository(); svc = new CheckoutService(repo); });
const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as ValidationError; } };

describe('V-5: checkout refusals carry their registry code', () => {
  it('the service: refund reason / amount / over-refund', async () => {
    await seed();
    expect(await caught(svc.refund(ctx, 'pay_x', { amountCents: 1000 } as any))).toMatchObject({ code: 'REFUND_REASON_REQUIRED', message: 'Refund requires a reason' });
    expect(await caught(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: -1 } as any))).toMatchObject({ code: 'REFUND_AMOUNT_INVALID' });
    const over = await caught(svc.refund(ctx, 'pay_x', { reason: 'r', amountCents: 6000 } as any));
    expect(over).toMatchObject({ code: 'REFUND_EXCEEDS_REFUNDABLE' });
    expect(typeof (over as any).params?.remainingCents).toBe('number');
  });
  it('the controller answers 400 with { code, message, details } — the English sentence unchanged', async () => {
    await seed();
    const ctl = new CheckoutController(svc);
    let e: unknown; try { await ctl.refund({ ctx }, 'pay_x', { reason: 'r', amountCents: 6000 }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(400);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'REFUND_EXCEEDS_REFUNDABLE', message: expect.stringMatching(/^Refund exceeds/), details: { remainingCents: 5000 } });
    // a free-text refusal (no code) is still the plain 400 it was
    const plain = new CheckoutController({ refund: async () => { throw new ValidationError('Payment not found'); } } as any);
    let p: unknown; try { await plain.refund({ ctx }, 'x', {}); } catch (x) { p = x; }
    expect((p as HttpException).getStatus()).toBe(400);
    expect((p as HttpException).getResponse()).toBe('Payment not found');
  });
});
