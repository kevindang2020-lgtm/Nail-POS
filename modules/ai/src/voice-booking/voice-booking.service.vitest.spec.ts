// voice-booking.service.vitest.spec.ts — Phase 1a: the read-only Voice Booking Gateway adapters.
// Verifies the gateway (1) reuses the canonical CustomerBookingService, (2) projects only safe public fields, (3) uses
// integer-cent prices, (4) never fabricates availability (empty in → empty out), and (5) computes end times correctly.
import { describe, it, expect, vi } from 'vitest';
import { VoiceBookingService, addMinutes } from './voice-booking.service';

function fakeBooking(overrides: any = {}) {
  return {
    getOptions: vi.fn(async () => ({
      services: [
        { serviceId: 'svc_gel', name: 'Gel Manicure', description: 'Long-lasting gel', durationMinutes: 45, basePriceCents: 4500, category: 'manicure', bookable: true },
        { serviceId: 'svc_hidden', name: 'Internal', durationMinutes: 30, basePriceCents: 0, bookable: false },
      ],
      technicians: [
        { technicianId: 't_lily', displayName: 'Lily', serviceIds: ['svc_gel'], bookable: true, ssn: 'PRIVATE', email: 'lily@x.com' },
        { technicianId: 't_mia', displayName: 'Mia', serviceIds: ['svc_pedi'], bookable: true },
      ],
    })),
    availability: vi.fn(async () => ({
      date: '2026-05-12', serviceId: 'svc_gel', durationMinutes: 45,
      window: { open: '09:00', close: '17:00', stepMinutes: 15 },
      slots: [
        { startTime: '10:15', available: true, technicianIds: ['t_lily'] },
        { startTime: '10:30', available: false, technicianIds: [] },   // taken — must be excluded
        { startTime: '11:00', available: true, technicianIds: ['t_lily', 't_mia'] },
      ],
    })),
    ...overrides,
  } as any;
}

const V = { tenantId: 'ten_1', branchId: 'br_1' };

describe('VoiceBookingService read adapters', () => {
  it('services(): reuses getOptions and returns integer-cent prices + safe fields', async () => {
    const booking = fakeBooking();
    const svc = new VoiceBookingService(booking);
    const out = await svc.services(V);
    expect(booking.getOptions).toHaveBeenCalledOnce();
    const gel = out.find((s) => s.serviceId === 'svc_gel')!;
    expect(gel.priceCents).toBe(4500);          // integer cents, from the real service
    expect(gel.durationMinutes).toBe(45);
    expect(out.find((s) => s.serviceId === 'svc_hidden')!.bookable).toBe(false);
  });

  it('technicians(): projects only public fields (no SSN/email leak) and filters by service', async () => {
    const svc = new VoiceBookingService(fakeBooking());
    const all = await svc.technicians(V);
    expect(JSON.stringify(all)).not.toMatch(/PRIVATE|@x.com/); // no private employee data projected
    const forGel = await svc.technicians(V, { serviceId: 'svc_gel' });
    expect(forGel.map((t) => t.technicianId)).toEqual(['t_lily']); // Mia doesn't perform svc_gel
  });

  it('availability(): returns ONLY real open slots, never fabricates, with correct end times + price', async () => {
    const svc = new VoiceBookingService(fakeBooking());
    const opts = await svc.availability(V, { serviceId: 'svc_gel', date: '2026-05-12' });
    expect(opts.map((o) => o.startTime)).toEqual(['10:15', '11:00']); // the taken 10:30 slot is excluded
    expect(opts[0]).toMatchObject({ endTime: '11:00', durationMinutes: 45, priceEstimateCents: 4500, technicianId: 't_lily' });
  });

  it('availability(): honest empty result when the backend returns no open slots', async () => {
    const booking = fakeBooking({ availability: vi.fn(async () => ({ date: '2026-05-12', serviceId: 'svc_gel', durationMinutes: 45, window: { open: '09:00', close: '17:00', stepMinutes: 15 }, slots: [{ startTime: '10:15', available: false, technicianIds: [] }] })) });
    const svc = new VoiceBookingService(booking);
    expect(await svc.availability(V, { serviceId: 'svc_gel', date: '2026-05-12' })).toEqual([]);
  });

  it('availability(): honors a preferred technician when that tech is free in the slot', async () => {
    const svc = new VoiceBookingService(fakeBooking());
    const opts = await svc.availability(V, { serviceId: 'svc_gel', date: '2026-05-12', technicianId: 't_mia' });
    expect(opts.find((o) => o.startTime === '11:00')!.technicianId).toBe('t_mia');
  });
});

describe('addMinutes', () => {
  it('adds whole minutes across the hour', () => {
    expect(addMinutes('10:15', 45)).toBe('11:00');
    expect(addMinutes('09:50', 20)).toBe('10:10');
    expect(addMinutes('23:30', 45)).toBe('00:15'); // wraps
  });

  // Round 3 H2 (gap 3): without the optimizer, availability asks the booking engine under the call's session — so a time
  // THIS call holds is offered back to it while other sessions' holds are excluded (customer-booking-availability-holds).
  it('availability() fallback passes the call\'s booking session to CustomerBookingService.availability', async () => {
    const booking = fakeBooking();
    const svc = new VoiceBookingService(booking);
    await svc.availability(V, { serviceId: 'svc_gel', date: '2026-05-12', bookingSessionId: 'a6770000-0000-4000-8000-000000000001' });
    expect(booking.availability).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), { serviceId: 'svc_gel', date: '2026-05-12', technicianId: undefined, bookingSessionId: 'a6770000-0000-4000-8000-000000000001' });
    await svc.availabilityWithHold(V, { serviceId: 'svc_gel', date: '2026-05-12', bookingSessionId: 'a6770000-0000-4000-8000-000000000002' });
    expect(booking.availability).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ bookingSessionId: 'a6770000-0000-4000-8000-000000000002' }));
  });
});
