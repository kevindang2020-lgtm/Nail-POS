// mobile-checkout-foreign-id — BUILD_PLAN Phase 14 live IDOR run (scripts/live-phase14-idor.mjs): salon B asking for
// salon A's ticket through GET /mobile-checkout/tickets/:ticketId got a 500 — the service refused it correctly
// (tenant-filtered, "Ticket not found") but the handler was the one route in this controller that did not map domain
// errors. A foreign id must be a client error, never a crash (a 5xx pages on-call and hides real failures).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { MobileCheckoutController } from './mobile-checkout.controller';
import { ValidationError } from '../checkout/checkout.service';

describe('GET /mobile-checkout/tickets/:ticketId with another salon\'s ticket id', () => {
  it('answers 400 "Ticket not found" (the domain refusal), not a 500', async () => {
    const svc: any = { getTicketDetail: async () => { throw new ValidationError('Ticket not found'); } };
    const c = new MobileCheckoutController(svc);
    const err = await Promise.resolve().then(() => c.ticket({ ctx: { tenantId: 'tenant-b', branchId: 'branch-b', permissions: [] } }, 'salon-a-ticket')).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(400);
  });
});
