// checkout-error-taxonomy.vitest.spec.ts — Payments mandate §134–§136 (wave 3): a refusal the service throws AS a
// taxonomy code reaches the client as the registry's status + sentence + code; a free-text refusal stays a 400 with its
// own words. The provider's own vocabulary never reaches the screen.
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { ValidationError } from './checkout.service';

const ctl = (fail: () => never) => new CheckoutController({ getKpis: async () => fail() } as any);
const req: any = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'OWNER', permissions: [] } };

describe('checkout controller — error taxonomy mapping', () => {
  it('TERMINAL_BUSY → 409 with the registry sentence and the code', async () => {
    let caught: any;
    try { await ctl(() => { throw new ValidationError('TERMINAL_BUSY'); }).kpis(req); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(409);
    expect(caught.getResponse()).toEqual({ code: 'TERMINAL_BUSY', message: 'This payment terminal is currently being used by another checkout.' });
  });
  it('PAYMENT_ALREADY_COMPLETED → 409 "already paid"; PAYMENT_STATUS_UNKNOWN → 409 "being verified"', async () => {
    for (const [code, re] of [['PAYMENT_ALREADY_COMPLETED', /already paid/], ['PAYMENT_STATUS_UNKNOWN', /being verified/]] as const) {
      let caught: any;
      try { await ctl(() => { throw new ValidationError(code); }).kpis(req); } catch (e) { caught = e; }
      expect(caught.getStatus()).toBe(409);
      expect(caught.getResponse().code).toBe(code);
      expect(caught.getResponse().message).toMatch(re);
    }
  });
  it('a free-text refusal stays a 400 with its own words (no code invented)', async () => {
    let caught: any;
    try { await ctl(() => { throw new ValidationError('Choose one of this location\'s registers.'); }).kpis(req); } catch (e) { caught = e; }
    expect(caught.getStatus()).toBe(400);
    expect(caught.getResponse()).toBe('Choose one of this location\'s registers.');
  });
});
