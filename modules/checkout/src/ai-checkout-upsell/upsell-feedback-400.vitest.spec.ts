// upsell-feedback-400 — Security Deep Scan §163 run 3 (Oct 27 2026): POST /pos/ai-checkout-upsell/checkout/:checkoutId/feedback
// with a rating outside the vocabulary threw INVALID_FEEDBACK, which the controller's map did not know → 500. Every code the
// service throws is now mapped, and an error outside the taxonomy reaches the platform filter unwrapped.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AiCheckoutUpsellController } from './ai-checkout-upsell.controller';
import { AiCheckoutUpsellService } from './ai-checkout-upsell.service';

const req = { ctx: { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.ai_checkout_upsell.view', 'pos.checkout.view'] } };
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return e instanceof HttpException ? e.getStatus() : 500; } };

describe('§163 run 3 — upsell feedback', () => {
  it('an unknown rating is 400 INVALID_FEEDBACK; a known one records', async () => {
    const svc: any = Object.create(AiCheckoutUpsellService.prototype);
    const recorded: string[] = []; svc.dismissals = { recordFeedback: async (_c: any, _id: string, _r: string, rating: string) => { recorded.push(rating); } };
    const ctl = new AiCheckoutUpsellController(svc);
    expect(await status(ctl.feedback(req, 'chk1', { recommendationId: 'r1', rating: "' OR '1'='1" }))).toBe(400);
    expect(recorded).toEqual([]);
    expect(await status(ctl.feedback(req, 'chk1', { recommendationId: 'r1', rating: 'helpful' }))).toBe(200);
    expect(recorded).toEqual(['helpful']);
  });
  it('every code the service throws has a status; an unknown error is passed through (the filter decides)', async () => {
    const thrower = (e: Error) => new AiCheckoutUpsellController({ recordFeedback: async () => { throw e; } } as any);
    for (const [code, want] of [['INVALID_RECOMMENDATION_TRANSITION', 409], ['BOOKING_OPEN_NOT_AVAILABLE', 503], ['LOYALTY_ENROLL_NOT_AVAILABLE', 503], ['LOYALTY_REDEEM_NOT_AVAILABLE', 503], ['SETTINGS_NOT_PERSISTED', 503]] as const) {
      expect(await status(thrower(new Error(code)).feedback(req, 'c', {})), code).toBe(want);
    }
    const db = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    await expect(thrower(db).feedback(req, 'c', {})).rejects.toBe(db);
  });
});
