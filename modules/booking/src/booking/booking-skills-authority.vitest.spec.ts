// booking-skills-authority.vitest.spec.ts — mandate §51 / §78 (Oct 20 2026): ONE eligibility check on every booking path.
//
// Before: staff booking checked only the service CATEGORY (a technician with the "Manicure" skill could be booked for
// any manicure service, certified or not); the customer app checked NOTHING (any technician, any service). Now both
// ask the workforce eligibility authority through booking's TechnicianSkillsPort — exact service + certification +
// employment — on create, reschedule-to-another-technician, assign, first-available and the customer app's book() and
// availability(). Without the port (no database) the category rule still applies, so nothing here is weakened for tests.
import { describe, it, expect } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import { BookingService, ValidationError } from './booking.service';
import { InMemoryTechnicianSkills } from './technician-skills.port';
import { CustomerBookingService, BookingValidationError } from '../customer-booking/customer-booking.service';
import type { CustomerBookingDataPort } from '../customer-booking/customer-booking.repository';

const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule', 'pos.booking.assign_technician', 'booking.override'] };
const base = { customerName: 'Ava', serviceIds: ['svc_mani'], date: '2026-06-08', startTime: '10:30', source: 'manual' as const };

describe('staff booking asks the eligibility authority (exact service), not the category', () => {
  it('create with a named technician: approved for the service → booked; category-skilled but NOT approved for this exact service → refused with the authority\'s reason', async () => {
    const repo = new InMemoryBookingRepository();
    // tech_mia carries the 'Manicure' CATEGORY skill in the fixture (the old rule passed her); the authority says: svc_gel only
    const skills = new InMemoryTechnicianSkills({ tech_mia: ['svc_gel'] });
    const svc = new BookingService(repo, undefined, undefined, undefined, undefined, undefined, skills);
    await expect(svc.create(ctx, { ...base, technicianId: 'tech_mia' })).rejects.toThrow(/not currently approved for this service/);
    skills.approved.tech_mia = ['svc_mani'];
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia' });
    expect(row.technicianId).toBe('tech_mia');
  });
  it('without the port (no database) the category rule still decides — the old behaviour is not widened', async () => {
    const svc = new BookingService(new InMemoryBookingRepository());
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia' });
    expect(row.technicianId).toBe('tech_mia');
  });
  it('first available skips a technician the authority does not approve, even if her category matches', async () => {
    const repo = new InMemoryBookingRepository();
    const techs = await repo.technicians(ctx as any);
    const [first, second] = techs.filter((t) => t.available).sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId));
    const skills = new InMemoryTechnicianSkills(Object.fromEntries(techs.map((t) => [t.technicianId, t.technicianId === first.technicianId ? [] : ['svc_mani']])));
    const svc = new BookingService(repo, undefined, undefined, undefined, undefined, undefined, skills);
    const row = await svc.create(ctx, { ...base, startTime: '15:30', technicianId: null as any, anyTechnician: true } as any);
    expect(row.technicianId).not.toBe(first.technicianId);
    expect(row.technicianId).toBe(second.technicianId);
  });
  it('reschedule to another technician and assign are refused when the authority says no (never overridable)', async () => {
    const repo = new InMemoryBookingRepository();
    const skills = new InMemoryTechnicianSkills({ tech_mia: ['svc_mani', 'svc_gel'], tech_ava: [] });
    const svc = new BookingService(repo, undefined, undefined, undefined, undefined, undefined, skills);
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia' });
    await expect(svc.reschedule(ctx, row.appointmentId, { date: '2026-06-08', startTime: '11:30', technicianId: 'tech_ava', managerOverride: true } as any)).rejects.toThrow(ValidationError);
    await expect(svc.assignTechnician(ctx, row.appointmentId, { technicianId: 'tech_ava' } as any)).rejects.toThrow(/not currently approved/);
  });
});

function stubRepo(over: Partial<CustomerBookingDataPort> = {}): CustomerBookingDataPort {
  return {
    resolveCustomerId: async () => ({ id: 'c1', fullName: 'Casey' }),
    listServices: async () => [{ id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 }],
    listTechnicians: async () => [{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Anna' }],
    getService: async (_c, id) => (id === 's1' ? { id: 's1', name: 'Gel', durationMinutes: 60, priceCents: 4500 } : null),
    getTechnician: async (_c, id) => ([{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Anna' }].find((t) => t.id === id) || null),
    existingForDate: async () => [],
    insertBooking: async () => 'x',
    insertBookingAtomic: async () => ({ ok: true, id: 'x' }),
    ...over,
  } as any;
}
const cctx = { tenantId: 'T', branchId: 'B', userId: 'U' } as any;

describe('the customer app asks the same authority (before: no skills check at all)', () => {
  it('availability lists only technicians approved for the service', async () => {
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, undefined, new InMemoryTechnicianSkills({ t1: [], t2: ['s1'] }));
    const res = await svc.availability(cctx, { serviceId: 's1', date: '2026-07-01' });
    const s10 = res.slots.find((s) => s.startTime === '10:00')!;
    expect(s10.available).toBe(true);
    expect(s10.technicianIds).toEqual(['t2']);        // before: ['t1', 't2'] — Lisa offered for a service she is not approved for
  });
  it('book() refuses a technician who does not offer the service, with a customer-safe message; approved → proceeds', async () => {
    const skills = new InMemoryTechnicianSkills({ t1: [], t2: ['s1'] });
    const svc = new CustomerBookingService(stubRepo(), undefined, undefined, undefined, skills);
    await expect(svc.book(cctx, { serviceId: 's1', technicianId: 't1', date: '2026-07-01', startTime: '10:00' } as any)).rejects.toThrow(BookingValidationError);
    await expect(svc.book(cctx, { serviceId: 's1', technicianId: 't1', date: '2026-07-01', startTime: '10:00' } as any)).rejects.toThrow(/does not offer one of the selected services/);
    const ok: any = await svc.book(cctx, { serviceId: 's1', technicianId: 't2', date: '2026-07-01', startTime: '10:00' } as any);
    expect(ok).toBeTruthy();
  });
});
