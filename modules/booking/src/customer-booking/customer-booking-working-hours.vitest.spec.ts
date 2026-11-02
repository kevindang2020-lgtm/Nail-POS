// customer-booking-working-hours.vitest.spec.ts — Wave 3 (Oct 13 2026), Smooth Refresh / Booking Concurrency spec §9, §71, §72:
// "Breaks are scheduling constraints … 12:45–1:30 must conflict unless approved override" and "Do not allow an 8 PM
// appointment if the technician stops at 7 PM without authorized override". The staff engine enforced both since Jul 2026
// (BookingService.windowsFor); the CUSTOMER APP (and the AI receptionist riding on CustomerBookingService) enforced only the
// env store window — a customer could book Sarah through her lunch or after her shift. The data port now answers the
// technician's bookable windows for the day (store hours ∩ schedule − breaks − blocked time, the same rule the staff engine
// uses) and book() / reschedule() refuse a visit outside them; availability() never offers such a slot.
import { describe, it, expect } from 'vitest';
import { CustomerBookingService, BookingValidationError } from './customer-booking.service';
import type { CustomerBookingDataPort } from './customer-booking.repository';

const ctx = { tenantId: 'T', branchId: 'B', userId: 'U' } as any;
// Sarah works 09:00–17:00 with lunch 13:00–13:30 (in minutes of day: two windows)
const SARAH = [{ start: 9 * 60, end: 13 * 60 }, { start: 13 * 60 + 30, end: 17 * 60 }];
const base = {
  resolveCustomerId: async () => ({ id: 'c1', fullName: 'Casey' }),
  getService: async () => ({ id: 's1', name: 'Gel', durationMinutes: 45, priceCents: 4500 }),
  getServiceAddOns: async () => [],
  getTechnician: async () => ({ id: 't1', fullName: 'Sarah' }),
  listTechnicians: async () => [{ id: 't1', fullName: 'Sarah' }],
  existingForDate: async () => [],
  getAppointmentForReschedule: async () => ({ technicianId: 't1', durationMinutes: 45, status: 'confirmed' }),
  rescheduleAtomic: async () => ({ ok: true }),
  insertBookingAtomic: async () => ({ ok: true, id: 'appt-1' }),
  technicianWindows: async (_c: any, technicianId: string) => (technicianId === 't1' ? SARAH : null),
};
const make = (over: Record<string, any> = {}) => new CustomerBookingService({ ...base, ...over } as unknown as CustomerBookingDataPort);
const BODY = { serviceId: 's1', technicianId: 't1', date: '2999-03-03' };

describe('§71/§72 — the customer app honours the technician\'s working hours, breaks and blocked time', () => {
  it('§71: 12:45–13:30 runs into lunch → refused, nothing inserted', async () => {
    let inserted = 0;
    const svc = make({ insertBookingAtomic: async () => { inserted++; return { ok: true, id: 'x' }; } });
    await expect(svc.book(ctx, { ...BODY, startTime: '12:45' })).rejects.toBeInstanceOf(BookingValidationError);
    expect(inserted).toBe(0);
  });
  it('§72: 16:30–17:15 runs past the end of her shift → refused', async () => {
    await expect(make().book(ctx, { ...BODY, startTime: '16:30' })).rejects.toBeInstanceOf(BookingValidationError);
  });
  it('a visit inside a window books; one that ENDS exactly at lunch books (half-open)', async () => {
    expect((await make().book(ctx, { ...BODY, startTime: '10:00' })).appointmentId).toBe('appt-1');
    expect((await make().book(ctx, { ...BODY, startTime: '12:15' })).appointmentId).toBe('appt-1');   // 12:15–13:00
  });
  it('reschedule is held to the same rule', async () => {
    await expect(make().reschedule(ctx, 'ap1', { date: '2999-03-03', startTime: '13:00' })).rejects.toBeInstanceOf(BookingValidationError);
    expect((await make().reschedule(ctx, 'ap1', { date: '2999-03-03', startTime: '13:30' })).endTime).toBe('14:15');
  });
  it('a data port that cannot answer (null / no method) does not refuse — the staff engine\'s rule is the default, not a guess', async () => {
    expect((await make({ technicianWindows: async () => null }).book(ctx, { ...BODY, startTime: '12:45' })).appointmentId).toBe('appt-1');
    expect((await make({ technicianWindows: undefined }).book(ctx, { ...BODY, startTime: '12:45' })).appointmentId).toBe('appt-1');
  });
  it('availability() never offers a slot the technician cannot take', async () => {
    const r = await make().availability(ctx, { serviceId: 's1', date: '2999-03-03', technicianId: 't1' });
    const at = (t: string) => r.slots.find((s) => s.startTime === t)!;
    expect(at('12:30').available).toBe(false);   // 12:30–13:15 crosses lunch
    expect(at('13:30').available).toBe(true);
    expect(at('16:30').available).toBe(false);   // past her 17:00
    expect(at('10:00').available).toBe(true);
  });
});
