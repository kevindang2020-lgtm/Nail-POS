import { describe, it, expect } from 'vitest';
import { CustomerBookingService, BookingConflictError, type DealReservation } from './customer-booking.service';
import type { CustomerBookingDataPort } from './customer-booking.repository';

// A booking repo with no conflicts, so the flow reaches the insert. `insertBookingAtomic` is overridable per test.
function stubRepo(over: Partial<CustomerBookingDataPort> = {}): CustomerBookingDataPort {
  return {
    resolveCustomerId: async () => ({ id: 'c1', fullName: 'Casey' }),
    listServices: async () => [{ id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 }],
    listTechnicians: async () => [{ id: 't1', fullName: 'Lisa' }],
    getService: async (_c, id) => (id === 's1' ? { id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 } : null),
    getTechnician: async (_c, id) => (id === 't1' ? { id: 't1', fullName: 'Lisa' } : null),
    existingForDate: async () => [],
    insertBooking: async () => 'appt1',
    insertBookingAtomic: async () => ({ ok: true, id: 'appt1' }),
    ...over,
  } as CustomerBookingDataPort;
}

// Records what the booking asked the reservation layer to do.
function fakeDeals(opts: { soldOut?: boolean } = {}) {
  const calls: { reserve: any[]; consume: any[]; release: any[] } = { reserve: [], consume: [], release: [] };
  const deals: DealReservation = {
    async reserveDeal(ctx, dealId, customerId, idem) { calls.reserve.push({ dealId, customerId, idem }); return opts.soldOut ? { soldOut: true } : { soldOut: false, holdId: 'hold1', alreadyHeld: false }; },
    async consumeReservation(ctx, holdId, appointmentId) { calls.consume.push({ holdId, appointmentId }); return { consumed: true }; },
    async releaseReservation(ctx, holdId) { calls.release.push({ holdId }); return { released: true }; },
  };
  return { deals, calls };
}

const ctx = { tenantId: 'T', branchId: 'B', userId: 'U' } as any;
const req = (over: any = {}) => ({ serviceId: 's1', technicianId: 't1', date: '2026-08-01', startTime: '09:00', ...over });

describe('book-a-deal reservation wiring', () => {
  it('reserves the deal, then consumes the hold against the created appointment', async () => {
    const { deals, calls } = fakeDeals();
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, deals);
    const res = await svc.book(ctx, req({ dealId: 'D1' }));
    expect(res.appointmentId).toBe('appt1');
    expect(calls.reserve).toHaveLength(1);
    expect(calls.reserve[0]).toMatchObject({ dealId: 'D1', customerId: 'c1' });
    expect(calls.consume).toHaveLength(1);
    expect(calls.consume[0]).toEqual({ holdId: 'hold1', appointmentId: 'appt1' });
    expect(calls.release).toHaveLength(0);
  });

  it('a sold-out deal refuses the booking and never creates an appointment', async () => {
    const { deals, calls } = fakeDeals({ soldOut: true });
    let inserted = false;
    const repo = stubRepo({ insertBookingAtomic: async () => { inserted = true; return { ok: true, id: 'appt1' }; } });
    const svc = new CustomerBookingService(repo, undefined, undefined, deals);
    await expect(svc.book(ctx, req({ dealId: 'D1' }))).rejects.toBeInstanceOf(BookingConflictError);
    expect(inserted).toBe(false); // insert never reached
    expect(calls.consume).toHaveLength(0);
  });

  it('releases the hold if the slot is lost at insert time', async () => {
    const { deals, calls } = fakeDeals();
    const repo = stubRepo({ insertBookingAtomic: async () => ({ ok: false, conflictingAppointmentId: 'zzz' }) });
    const svc = new CustomerBookingService(repo, undefined, undefined, deals);
    await expect(svc.book(ctx, req({ dealId: 'D1' }))).rejects.toBeInstanceOf(BookingConflictError);
    expect(calls.release).toEqual([{ holdId: 'hold1' }]);
    expect(calls.consume).toHaveLength(0);
  });

  it('a booking without a dealId never touches the reservation layer', async () => {
    const { deals, calls } = fakeDeals();
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, deals);
    const res = await svc.book(ctx, req());
    expect(res.appointmentId).toBe('appt1');
    expect(calls.reserve).toHaveLength(0);
  });
});

// BUILD_PLAN Phase 5, bug 11: a deal the customer cannot have (ended, members only, already used, paused…) came back
// from the booking as a raw 500. It is a clean refusal now, nothing is created, and the verification is not spent.
describe('Phase 5 — a refused deal is a clean booking refusal', () => {
  const throwing = (name: string, message: string): DealReservation => ({
    async reserveDeal() { const e = new Error(message); e.name = name; throw e; },
    async consumeReservation() { return { consumed: true }; },
    async releaseReservation() { return { released: true }; },
  });
  it('DealConflictError (sold out / ended / not available) → BookingConflictError with the deal’s reason', async () => {
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, throwing('DealConflictError', 'This deal has ended.'));
    await expect(svc.book(ctx, req({ dealId: 'D1' }))).rejects.toMatchObject({ name: 'BookingConflictError', message: 'This deal has ended.' });
  });
  it('DealValidationError (members only, not for this service…) → BookingValidationError', async () => {
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, throwing('DealValidationError', 'This deal is for members only.'));
    await expect(svc.book(ctx, req({ dealId: 'D1' }))).rejects.toMatchObject({ name: 'BookingValidationError', message: 'This deal is for members only.' });
  });
  it('the reservation is told what is being booked (service, start, channel) so eligibility can be judged', async () => {
    const seen: any[] = [];
    const deals: DealReservation = {
      async reserveDeal(_c, _d, _cu, _i, facts) { seen.push(facts); return { soldOut: false, holdId: 'h1' }; },
      async consumeReservation() { return { consumed: true }; },
      async releaseReservation() { return { released: true }; },
    };
    await new CustomerBookingService(stubRepo(), undefined, undefined, deals).book(ctx, req({ dealId: 'D1' }));
    expect(seen[0]).toMatchObject({ serviceIds: ['s1'], date: '2026-08-01', startTime: '09:00', channel: 'customer_app' });
  });
});
