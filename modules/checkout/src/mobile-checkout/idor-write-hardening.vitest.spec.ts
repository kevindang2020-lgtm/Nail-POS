// idor-write-hardening.vitest.spec — §74 (Nov 5 2026). The live write sweep (scripts/live-phase14-idor.mjs) sends
// salon B every write route with salon A's ids. It found routes that changed nothing of A's but answered wrongly:
//   · the mobile receipt's queued path wrote a RECEIPT_REQUESTED for a ticket that is not in the caller's salon;
//   · cancel-app-payment / move-to-front-desk-checkout answered {cancelled:true} and wrote an audit row for it;
//   · proceed-to-payment and add-retail crashed (500) on the foreign id instead of refusing.
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ServingValidationError, ServingForbiddenError, ServingConflictError } from '@aipowersalon/queue';
import { MobileCheckoutService } from './mobile-checkout.service';
import { MobileCheckoutController } from './mobile-checkout.controller';
import { ValidationError } from '../checkout/checkout.service';
import { SkipLineCheckoutService } from '../skip-line-checkout/skip-line-checkout.service';

const ctx = { tenantId: 'T-B', branchId: 'B1', userId: 'u_owner', role: 'OWNER', permissions: ['pos.receipts.send', 'pos.checkout.take_payment', 'pos.checkout.view'] } as never;

describe('mobile receipt: the queued path checks the ticket first', () => {
  function make(inScope: boolean) {
    const outbox = { write: vi.fn().mockResolvedValue(undefined) };
    const checkout = {
      assertTicketInScope: vi.fn(async () => { if (!inScope) throw new ValidationError('Ticket not found', 'TICKET_NOT_FOUND'); }),
      receiptSms: vi.fn(),
    };
    const svc = new MobileCheckoutService({} as never, undefined as never, checkout as never, undefined as never, undefined as never,
      undefined, undefined, undefined, undefined, { outbox } as never);
    return { svc, outbox, checkout };
  }
  it("another salon's ticket id queues nothing and is refused", async () => {
    const { svc, outbox } = make(false);
    await expect(svc.sendReceipt(ctx, 'tk-of-salon-A', 'sms')).rejects.toThrow(/Ticket not found/);
    expect(outbox.write).not.toHaveBeenCalled();
  });
  it('its own ticket is still queued', async () => {
    const { svc, outbox, checkout } = make(true);
    const r = await svc.sendReceipt(ctx, 'tk-own', 'email');
    expect(checkout.assertTicketInScope).toHaveBeenCalledWith(ctx, 'tk-own');
    expect(outbox.write).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ queued: true, channel: 'email' });
  });
});

describe('cancel-app-payment refuses a ticket outside the salon', () => {
  function make(hasTicket: boolean) {
    const audit = vi.fn().mockResolvedValue(undefined);
    const repo = {
      billForTicket: async () => (hasTicket ? { ticketId: 'tk1', customerId: 'c1', paid: false, totalDueCents: 100 } : null),
      pendingCashForTicket: vi.fn().mockResolvedValue(null),
      setIntentStatus: vi.fn(), setCashConfirmationStatus: vi.fn(), audit,
    };
    return { svc: new SkipLineCheckoutService(repo as never), repo, audit };
  }
  it('a foreign ticket: 404 TICKET_NOT_FOUND, no audit, nothing touched', async () => {
    const { svc, repo, audit } = make(false);
    await expect(svc.cancelAppPayment(ctx, 'tk-of-salon-A')).rejects.toMatchObject({ httpStatus: 404, apiCode: 'TICKET_NOT_FOUND' });
    expect(audit).not.toHaveBeenCalled();
    expect(repo.pendingCashForTicket).not.toHaveBeenCalled();
  });
  it('its own ticket is cancelled as before', async () => {
    const { svc, audit } = make(true);
    await expect(svc.cancelAppPayment(ctx, 'tk1')).resolves.toEqual({ cancelled: true });
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

describe('mobile checkout controller: refusals are 4xx, never 500', () => {
  const req = { ctx: { tenantId: 'T-B', branchId: 'B1', userId: 'u', role: 'OWNER', permissions: [] } };
  async function statusOf(p: unknown): Promise<number> {
    try { await p; return 200; } catch (e) { return e instanceof HttpException ? e.getStatus() : 500; }
  }
  it('proceed-to-payment on an unknown ticket → 400 (it was an unwrapped 500)', async () => {
    const svc = { evaluateProceed: async () => { throw new ValidationError('Ticket not found', 'TICKET_NOT_FOUND'); } };
    const c = new MobileCheckoutController(svc as never);
    expect(await statusOf(c.proceed(req, 'tk-of-salon-A', { sessionId: 's' }))).toBe(400);
  });
  it.each([
    [new ServingValidationError('Pick a product to sell.'), 400],
    [new ServingForbiddenError('No'), 403],
    [new ServingConflictError('Busy', 'TICKET_LOCKED'), 409],
  ])('add-retail: the serving engine refusal %s → %i', async (err, status) => {
    const svc = { addRetailToTicket: async () => { throw err; } };
    const c = new MobileCheckoutController(svc as never);
    expect(await statusOf(c.addRetail(req, 'tk-of-salon-A', {}))).toBe(status);
  });
});
