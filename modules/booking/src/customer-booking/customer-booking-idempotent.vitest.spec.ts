// customer-booking-idempotent.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §14–15): a booking create retried after a
// lost answer (dropped connection, app killed mid-request) must not create a second appointment. POST /customer/booking
// carries @Idempotent(); the Customer App sends one key per booking attempt.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CustomerBookingController } from './customer-booking.controller';

describe('customer booking create is idempotent', () => {
  it('book carries @Idempotent()', () => {
    expect(Reflect.getMetadata('aps:idempotent', CustomerBookingController.prototype.book)).toEqual({ required: false });
  });
});
