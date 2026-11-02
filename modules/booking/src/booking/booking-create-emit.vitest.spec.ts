import { describe, it, expect } from 'vitest';
import { BookingService, bookingFailureClassification, ValidationError, ConflictError } from './booking.service';
import { InMemoryBookingRepository, type BookingContext } from './booking.repository';
import type { FailedEventInput } from '@aipowersalon/reports';

const ctx: BookingContext = { tenantId: 'luxe001', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.booking.create'] };

function stubRecorder() {
  const events: FailedEventInput[] = [];
  return { events, recordFailedEvent: async (i: FailedEventInput) => { events.push(i); } };
}

describe('booking failure classification', () => {
  it('marks validation errors as permanent (not_retryable)', () => {
    expect(bookingFailureClassification(new ValidationError('bad'))).toEqual({ category: 'booking', failureType: 'validation_error', retryStatus: 'not_retryable' });
  });
  it('marks conflicts as retry_available (transient)', () => {
    expect(bookingFailureClassification(new ConflictError('dbl'))).toEqual({ category: 'booking', failureType: 'booking_conflict', retryStatus: 'retry_available' });
  });
  it('marks unknown errors as failed', () => {
    expect(bookingFailureClassification(new Error('x'))).toEqual({ category: 'booking', failureType: 'unknown_error', retryStatus: 'failed' });
  });
});

describe('booking create emits monitor failures fail-soft', () => {
  it('records a booking failed-event when create validation fails, then rethrows', async () => {
    const rec = stubRecorder();
    const svc = new BookingService(new InMemoryBookingRepository(), rec);
    await expect(svc.create(ctx, {} as any)).rejects.toBeInstanceOf(ValidationError);
    expect(rec.events.length).toBe(1);
    expect(rec.events[0]).toMatchObject({ tenantId: 'luxe001', branchId: 'b1', category: 'booking', failureType: 'validation_error', retryStatus: 'not_retryable' });
    expect(rec.events[0].errorMessage).toBeTruthy();
  });

  it('is safe when no recorder is wired (optional dependency)', async () => {
    const svc = new BookingService(new InMemoryBookingRepository());
    await expect(svc.create(ctx, {} as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not record a monitor failure for permission denials (ForbiddenError)', async () => {
    const rec = stubRecorder();
    const svc = new BookingService(new InMemoryBookingRepository(), rec);
    await expect(svc.create({ ...ctx, role: 'CUSTOMER' }, {} as any)).rejects.toThrow();
    expect(rec.events.length).toBe(0); // auth denials are not booking failures
  });
});
