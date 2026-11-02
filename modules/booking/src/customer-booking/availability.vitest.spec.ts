import { describe, it, expect } from 'vitest';
import { computeAvailableSlots, resolveWindow } from './availability';
import { CustomerBookingService } from './customer-booking.service';
import type { CustomerBookingDataPort } from './customer-booking.repository';

const win = { open: '09:00', close: '12:00', stepMinutes: 60, bufferMinutes: 0 };

describe('computeAvailableSlots (pure)', () => {
  it('marks a slot unavailable when the only technician is busy, and lists free technicians otherwise', () => {
    // tech t1 busy 10:00–11:00; t2 free all day. 60-min service.
    const existing = [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '11:00', status: 'booked' }];
    const slots = computeAvailableSlots(win, 60, ['t1'], existing);
    const at = (hhmm: string) => slots.find((s) => s.startTime === hhmm)!;
    expect(at('09:00').available).toBe(true);
    expect(at('10:00').available).toBe(false);      // overlaps t1's appointment
    expect(at('11:00').available).toBe(true);        // starts when the appointment ends (no overlap)
    // with a second free technician, 10:00 becomes available via t2 (and excludes the busy t1)
    const slots2 = computeAvailableSlots(win, 60, ['t1', 't2'], existing);
    const s10 = slots2.find((s) => s.startTime === '10:00')!;
    expect(s10.available).toBe(true);
    expect(s10.technicianIds).toEqual(['t2']);
  });
  it('only emits slots that fit before close', () => {
    const slots = computeAvailableSlots({ open: '09:00', close: '12:00', stepMinutes: 60, bufferMinutes: 0 }, 90, ['t1'], []);
    expect(slots.map((s) => s.startTime)).toEqual(['09:00', '10:00']); // 11:00+90m would end 12:30 > close
  });
  it('applies the window buffer: a slot starting exactly when an appointment ends is blocked when buffer > 0', () => {
    const existing = [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '11:00', status: 'booked' }];
    const noBuf = computeAvailableSlots({ open: '09:00', close: '13:00', stepMinutes: 60, bufferMinutes: 0 }, 60, ['t1'], existing);
    expect(noBuf.find((s) => s.startTime === '11:00')!.available).toBe(true);   // touches, no overlap → free at buffer 0
    const withBuf = computeAvailableSlots({ open: '09:00', close: '13:00', stepMinutes: 60, bufferMinutes: 5 }, 60, ['t1'], existing);
    expect(withBuf.find((s) => s.startTime === '11:00')!.available).toBe(false); // 5-min gap required → blocked
    expect(withBuf.find((s) => s.startTime === '12:00')!.available).toBe(true);  // clear of the buffer
  });
  it('resolveWindow falls back to a sane default (buffer 5, matching the POS booking default)', () => {
    expect(resolveWindow({})).toEqual({ open: '09:00', close: '19:00', stepMinutes: 30, bufferMinutes: 5 });
    expect(resolveWindow({ BOOKING_OPEN: '08:00', BOOKING_CLOSE: '20:00', BOOKING_SLOT_MINUTES: '15', BOOKING_BUFFER_MINUTES: '10' })).toEqual({ open: '08:00', close: '20:00', stepMinutes: 15, bufferMinutes: 10 });
    expect(resolveWindow({ BOOKING_BUFFER_MINUTES: '0' }).bufferMinutes).toBe(0); // opt back out of buffering
  });
});

// service-level: availability() resolves the service duration + technicians and returns the conflict-aware grid.
function stubRepo(over: Partial<CustomerBookingDataPort> = {}): CustomerBookingDataPort {
  return {
    resolveCustomerId: async () => ({ id: 'c1', fullName: 'Casey' }),
    listServices: async () => [{ id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 }],
    listTechnicians: async () => [{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Anna' }],
    getService: async (_c, id) => (id === 's1' ? { id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 } : null),
    getTechnician: async (_c, id) => ([{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Anna' }].find((t) => t.id === id) || null),
    existingForDate: async () => [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '11:00', status: 'booked' }],
    insertBooking: async () => 'x',
    insertBookingAtomic: async () => ({ ok: true, id: 'x' }),
    ...over,
  };
}

describe('CustomerBookingService.availability', () => {
  const ctx = { tenantId: 'T', branchId: 'B', userId: 'U' };
  it('returns conflict-aware slots for a service (any technician)', async () => {
    const svc = new CustomerBookingService(stubRepo());
    const res = await svc.availability(ctx, { serviceId: 's1', date: '2026-07-01' });
    expect(res.durationMinutes).toBe(60);
    const s10 = res.slots.find((s) => s.startTime === '10:00')!;
    expect(s10.available).toBe(true);                 // t2 is free at 10:00
    expect(s10.technicianIds).toEqual(['t2']);        // t1 excluded (busy)
  });
  // Developer merge (Oct 6 2026): booking at a salon OTHER than the session's default looked up the default salon's
  // services / technicians / appointments — the picked salon's calendar was never consulted. `salonId` now scopes the
  // query, and only to one of this tenant's own branches (the same gate getOptions / book use).
  it('salonId scopes the lookup to that branch when it belongs to the tenant, and is refused otherwise', async () => {
    const seen: string[] = [];
    const repo = stubRepo({
      branchBelongsToTenant: async (_c, b) => b === 'B2',
      getService: async (c, id) => { seen.push(c.branchId); return id === 's1' ? { id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 } : null; },
      listTechnicians: async (c) => { seen.push(c.branchId); return [{ id: 't1', fullName: 'Lisa' }]; },
      existingForDate: async (c) => { seen.push(c.branchId); return []; },
    });
    const svc = new CustomerBookingService(repo);
    await svc.availability(ctx, { serviceId: 's1', date: '2026-07-01', salonId: 'B2' });
    expect(new Set(seen)).toEqual(new Set(['B2']));
    await expect(svc.availability(ctx, { serviceId: 's1', date: '2026-07-01', salonId: 'OTHER' })).rejects.toThrow(/not available/);
  });
  it('rejects an unknown service / bad date', async () => {
    const svc = new CustomerBookingService(stubRepo());
    await expect(svc.availability(ctx, { serviceId: 'nope', date: '2026-07-01' })).rejects.toBeTruthy();
    await expect(svc.availability(ctx, { serviceId: 's1', date: 'bad' })).rejects.toBeTruthy();
  });
});
