// ai-scheduling-exact-skills.vitest.spec.ts — B-82 (Oct 23 2026): the scheduling optimizer (and the AI receptionist's
// availability, which asks it first) decided "qualified" by the service CATEGORY. With every service in one "Nails"
// category it offered a technician not approved for acrylic. With exact approvals loaded (the database adapter) the
// constraint gate uses the EXACT service, an add-on covered by a main service in the same request (D2); the category
// rule remains only without them.
import { describe, it, expect } from 'vitest';
import { constraintContext, type DayData, type DayTech } from './ai-scheduling-day';

const svc = (serviceId: string, categoryName: string) => ({ serviceId, name: serviceId, categoryName, durationMin: 45, setupMin: 0, cleanupMin: 0, maxGroupSize: null });
const tech = (id: string, extra: Partial<DayTech> = {}): DayTech => ({ technicianId: id, name: id, available: true, branchIds: ['b1'], skills: ['Nails'], shifts: [{ start: 540, end: 1140 }], breaks: [], timeOff: [], ...extra } as DayTech);
const day = (techs: DayTech[]): DayData => ({
  date: '2026-10-24', branchId: 'b1', timeZone: 'America/New_York', branchHours: { start: 540, end: 1140 }, bufferMin: 0, slotIntervalMin: 15,
  techs, services: { gel: svc('gel', 'Nails'), acrylic: svc('acrylic', 'Nails'), art: svc('art', 'Add-ons') },
  durationByTechService: {}, durationByService: {}, appts: [], holds: [], nowMin: null, isPast: false,
});

describe('optimizer skills: the exact service when approvals are known', () => {
  it('Mary (Nails category) is approved for gel only → NOT qualified for acrylic', () => {
    const d = day([tech('mary', { approvedServiceIds: ['gel'] })]);
    expect(constraintContext(d, 'mary', ['gel']).techSkills).toEqual({ gel: true });
    expect(constraintContext(d, 'mary', ['acrylic']).techSkills).toEqual({ acrylic: false });
  });
  it('an add-on rides on a main service in the same request; an add-on alone is checked exactly', () => {
    const d = day([tech('mary', { approvedServiceIds: ['gel'] })]);
    expect(constraintContext(d, 'mary', ['gel', 'art']).techSkills).toEqual({ gel: true, art: true });
    expect(constraintContext(d, 'mary', ['art']).techSkills).toEqual({ art: false });
  });
  it('control: without approvals (in-memory / a legacy unmapped technician) the category rule stands', () => {
    const d = day([tech('old')]);
    expect(constraintContext(d, 'old', ['acrylic']).techSkills).toEqual({ acrylic: true });
  });
});

describe('§24 (Kevin, Oct 27 2026): a technician with NO services set up (the database answered: approvals empty)', () => {
  it('is qualified through the workforce category fallback — the same one function booking and the queue ask', () => {
    const d = day([tech('nia', { approvedServiceIds: [], skills: [] })]);
    expect(constraintContext(d, 'nia', ['acrylic']).techSkills).toEqual({ acrylic: true });
    expect(constraintContext(d, 'nia', ['gel', 'art']).techSkills).toEqual({ gel: true, art: true });
  });
  it('a configured technician stays strictly exact (Mary, gel only, is not qualified for acrylic)', () => {
    const d = day([tech('mary', { approvedServiceIds: ['gel'] })]);
    expect(constraintContext(d, 'mary', ['acrylic']).techSkills).toEqual({ acrylic: false });
  });
});
