// BUILD_PLAN Phase 12 (#17): the booking board's body validation, route by route on the real controller — the bodies
// pos-web sends today pass intact, unknown fields are stripped, a `status` is refused, bad bodies are 400s naming the field.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { BookingController as B } from './booking/booking.controller';
import { CustomerBookingController as CB } from './customer-booking/customer-booking.controller';
import { BookingVerificationController as V } from './customer-booking/booking-verification.controller';
import { CustomerActivationController as CA } from './customer-activation/customer-activation.controller';

const S1 = '44444444-4444-4444-8444-444444444444', T1 = '55555555-5555-4555-8555-555555555555';
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/booking/appointments', ctl: B, handler: 'create', today: [
      { serviceIds: [S1], serviceLines: [{ serviceId: S1, name: 'Gel mani', durationMinutes: 45, priceCents: 4500, overrideReason: 'promo' }, { serviceId: S1, name: 'French', durationMinutes: 10, priceCents: 1000, isAddon: true, parentServiceId: S1 }],
        priceOverrides: { [S1]: { priceCents: 4000, reason: 'promo' } }, partySize: 1, date: '2026-10-09', startTime: '10:00', technicianId: T1, source: 'manual', notes: '[DRAFT] call first', customerId: S1, customerName: 'Ana Lee', customerPhone: '6095551234' },   // POSNewBookingScreen
      { customerName: 'Walk In', serviceIds: [S1], technicianId: T1, date: '2026-10-09', startTime: '14:30', source: 'phone', notes: 'first visit' },   // POSBookingScreen quick create
    ], bad: [{ customerName: 'x', serviceIds: S1 }, 'serviceIds'] },
  { route: 'PATCH /pos/booking/appointments/:id', ctl: B, handler: 'update', today: [{ customerName: 'Ana', notes: 'late', expectedVersion: 3 }], bad: [{ notes: 'x', status: 'completed' }, 'status'] },
  { route: 'POST /pos/booking/appointments/:id/reschedule', ctl: B, handler: 'reschedule', today: [
      { startTime: '11:00', date: '2026-10-09', expectedVersion: 2, technicianId: T1 },
      { startTime: '11:00', date: '2026-10-09', notifyCustomer: true, reason: 'tech sick', expectedVersion: 2, overbookConfirmed: true, overbookReason: 'tech sick' },
    ], bad: [{ startTime: '11:00', expectedVersion: 'v2' }, 'expectedVersion'] },
  { route: 'POST /pos/booking/appointments/:id/assign-technician', ctl: B, handler: 'assign', today: [{ technicianId: T1 }], bad: [{ technicianId: [T1] }, 'technicianId'] },
  { route: 'POST /pos/booking/appointments/:id/cancel', ctl: B, handler: 'cancel', today: [{ reason: 'customer called' }], bad: [{ reason: { r: 1 } }, 'reason'] },
  { route: 'POST /pos/booking/appointments/:id/no-show', ctl: B, handler: 'noShow', today: [{ reason: 'no answer' }], bad: [{ reason: 'x'.repeat(1001) }, 'reason'] },
  { route: 'POST /pos/booking/blocked-times', ctl: B, handler: 'addBlockedTime', today: [{ technicianId: T1, date: '2026-10-09', startTime: '12:00', endTime: '13:00', reason: 'lunch' }], bad: [{ technicianId: T1, startTime: 1200 }, 'startTime'] },
  { route: 'POST /pos/booking/conflicts/check', ctl: B, handler: 'conflict', today: [{ technicianId: T1, startTime: '10:00', endTime: '10:45', date: '2026-10-09' }], bad: [{ technicianId: {} }, 'technicianId'] },
  { route: 'POST /customer/booking', ctl: CB, handler: 'book', today: [
      { serviceId: S1, technicianId: T1, date: '2026-10-09', startTime: '10:00' },                                                        // minimal shape (the booking-html page, removed Phase 15)
      { serviceId: S1, technicianId: T1, date: '2026-10-09', startTime: '10:00', bookingSessionId: 'bs.sealed.token' },
      { salonId: S1, serviceId: S1, serviceIds: [S1], technicianId: T1, date: '2026-10-09', startTime: '10:00', inspirationNote: 'like the photo', inspirationPhotoId: S1, dealId: S1, dealIdempotencyKey: 'k-1' },   // customer-web
    ], bad: [{ serviceId: S1, technicianId: T1, date: '2026-10-09', startTime: '10:00', status: 'confirmed' }, 'status'] },
  { route: 'POST /customer/booking/appointments/:id/reschedule', ctl: CB, handler: 'reschedule', today: [{ date: '2026-10-10', startTime: '11:00' }], bad: [{ date: ['2026-10-10'] }, 'date'] },
  { route: 'POST /customer/booking/verification/send', ctl: V, handler: 'send', today: [{ bookingSessionId: 'bs.sealed' }, { bookingSessionId: 'bs.sealed', captchaToken: 'cap' }, {}], bad: [{ bookingSessionId: 'bs', phone: '6095551234' }, 'phone'] },
  { route: 'POST /customer/booking/verification/check', ctl: V, handler: 'check', today: [{ bookingSessionId: 'bs.sealed', code: '123456' }], bad: [{ bookingSessionId: 'bs', code: { c: 1 } }, 'code'] },
  { route: 'POST /customer/auth/activation/request-code', ctl: CA, handler: 'requestCode', today: [{ phone: '6095551234' }], bad: [{ phone: ['6095551234'] }, 'phone'] },
  { route: 'POST /customer/auth/activation/resend-code', ctl: CA, handler: 'resend', today: [{ phone: '6095551234' }], bad: [{ phone: {} }, 'phone'] },
  { route: 'POST /customer/auth/activation/verify-code', ctl: CA, handler: 'verify', today: [{ phone: '6095551234', code: '123456' }], bad: [{ phone: '1', code: [] }, 'code'] },
  { route: 'POST /customer/auth/activation/select-salon', ctl: CA, handler: 'selectSalon', today: [{ ticket: 't.k', choiceId: S1 }], bad: [{ ticket: {}, choiceId: S1 }, 'ticket'] },
];
describe('booking — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
