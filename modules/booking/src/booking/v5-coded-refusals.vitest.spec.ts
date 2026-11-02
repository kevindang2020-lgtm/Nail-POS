// v5-coded-refusals — Vietnamese POS §58 V-5 (Oct 27 2026): booking refusals carry a registry code beside the English
// sentence; the booking controller answers 400 { code, message } (unchanged status).
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';

describe('V-5: booking refusals carry their registry code', () => {
  it('cancel without a reason → 400 CANCEL_REASON_REQUIRED through the real service method and the controller', async () => {
    const svc: any = Object.create(BookingService.prototype);
    svc.need = () => undefined; svc.bookingOr404 = async () => ({ id: 'a1', status: 'booked' });
    const ctl = new BookingController(svc);
    let e: unknown; try { await ctl.cancel({ ctx: { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] } }, 'a1', { reason: '  ' }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(400);
    expect((e as HttpException).getResponse()).toMatchObject({ code: 'CANCEL_REASON_REQUIRED', message: 'Cancelling requires a reason' });
  });
  it('V-5 all modules: a missing booking → BOOKING_NOT_FOUND on the thrown error (withCode), the English unchanged', async () => {
    const svc: any = Object.create(BookingService.prototype);
    svc.repo = { booking: async () => null };
    let e: any; try { await svc.bookingOr404({ tenantId: 't1' }, 'a404'); } catch (x) { e = x; }
    expect(e).toMatchObject({ apiCode: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
  });
});
