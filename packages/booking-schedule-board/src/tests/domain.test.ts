import { describe, expect, it } from 'vitest';
import {
  availableDurationAt,
  buildDayContext,
  computeAvailability,
  computeGaps,
  enumerateStarts,
  requiredDuration,
  slotFits,
} from '../domain/availability';
import { evaluateEligibility, failureToErrorCode } from '../domain/eligibility';
import { bestMatches, collapseOpenings, findOpenings, type BestMatchDiagnostics, type SearchContext } from '../domain/openings';
import { pageInfo, pageOfIndex } from '../domain/paging';
import type { Appointment, ScheduleSegment, Service, Technician } from '../domain/scheduleTypes';
import { formatClock, formatRange, minuteOfDay, toISO, tzOffsetMinutes, weekDates } from '../domain/time';

const TZ = 'America/New_York';
const DATE = '2026-05-06';
const T = 'tenant-1';
const B = 'branch-1';
const iso = (m: number) => toISO(DATE, m, TZ);

const gel: Service = { id: 'svc-gel', tenantId: T, name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, active: true };
const acrylic: Service = { id: 'svc-acr', tenantId: T, name: 'Acrylic Full Set', durationMinutes: 60, priceCents: 6500, active: true };
const pedi: Service = { id: 'svc-ped', tenantId: T, name: 'Pedicure', durationMinutes: 45, priceCents: 5000, active: true };

function tech(id: string, serviceIds: string[], extra: Partial<Technician> = {}): Technician {
  return { id, tenantId: T, branchId: B, displayName: id, active: true, workingState: 'working', serviceIds, sortOrder: 0, ...extra };
}
function working(techId: string, s: number, e: number): ScheduleSegment {
  return { id: `w-${techId}-${s}`, tenantId: T, branchId: B, technicianId: techId, startAt: iso(s), endAt: iso(e), type: 'working' };
}
function seg(techId: string, type: ScheduleSegment['type'], s: number, e: number): ScheduleSegment {
  return { id: `${type}-${techId}-${s}`, tenantId: T, branchId: B, technicianId: techId, startAt: iso(s), endAt: iso(e), type };
}
function appt(techId: string, s: number, dur: number, extra: Partial<Appointment> = {}): Appointment {
  return {
    id: `a-${techId}-${s}`, tenantId: T, branchId: B, customerName: 'C', technicianId: techId,
    items: [{ serviceId: gel.id, name: gel.name, durationMinutes: dur, priceCents: 1 }],
    startAt: iso(s), endAt: iso(s + dur), status: 'confirmed', source: 'pos', requestedTechnician: false, protected: false, version: 1, ...extra,
  };
}
const hours = { openAt: '09:00', closeAt: '20:00' };

describe('time helpers', () => {
  it('round-trips local minutes through ISO with the correct offset', () => {
    expect(iso(9 * 60)).toBe('2026-05-06T09:00:00-04:00');
    expect(minuteOfDay(iso(9 * 60 + 15), DATE, TZ)).toBe(555);
    expect(tzOffsetMinutes(TZ, new Date('2026-01-15T12:00:00Z'))).toBe(-300);
  });
  it('formats clocks and ranges', () => {
    expect(formatClock(9 * 60)).toBe('9:00 AM');
    expect(formatClock(12 * 60 + 15)).toBe('12:15 PM');
    expect(formatRange(9 * 60, 10 * 60)).toBe('9:00 – 10:00 AM');
    expect(formatRange(11 * 60, 12 * 60)).toBe('11:00 AM – 12:00 PM');
  });
  it('builds Monday-first weeks', () => {
    expect(weekDates('2026-05-06')[0]).toBe('2026-05-04');
    expect(weekDates('2026-05-06')[6]).toBe('2026-05-10');
  });
});

describe('availability engine', () => {
  const t = tech('t1', [gel.id]);
  it('computes gaps = working ∩ branch hours − busy, snapped to the 15-min grid', () => {
    const gaps = computeAvailability({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 8 * 60, 18 * 60), seg('t1', 'lunch', 12 * 60, 12 * 60 + 30)],
      appointments: [appt('t1', 10 * 60, 45), appt('t1', 14 * 60 + 5, 40)],
    });
    expect(gaps.map((g) => [minuteOfDay(g.startAt, DATE, TZ), g.durationMinutes])).toEqual([
      [540, 60],   // 9:00–10:00 (branch opens at 9, not 8)
      [645, 75],   // 10:45–12:00
      [750, 90],   // 12:30–14:00 (14:05 appt → floor to 14:00)
      [885, 195],  // 14:45 (14:05+40 → ceil) → 18:00
    ]);
  });
  it('treats a technician without a working segment, on time off, or inactive as fully unavailable', () => {
    const base = { date: DATE, timezone: TZ, branchHours: hours, appointments: [], segments: [working('t1', 9 * 60, 17 * 60)] };
    expect(computeAvailability({ ...base, technician: t, segments: [] })).toEqual([]);
    expect(computeAvailability({ ...base, technician: { ...t, workingState: 'time_off' } })).toEqual([]);
    expect(computeAvailability({ ...base, technician: { ...t, active: false } })).toEqual([]);
    expect(computeAvailability({ ...base, technician: t, segments: [...base.segments, seg('t1', 'time_off', 0, 1440)] })).toEqual([]);
  });
  it('fits a 45-min service into a 45-min opening and rejects 60 (acceptance #1/#2)', () => {
    const ctx = buildDayContext({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 9 * 60, 17 * 60)],
      appointments: [appt('t1', 9 * 60, 60), appt('t1', 10 * 60 + 45, 60)],
    });
    expect(slotFits(ctx, 10 * 60, 45).fits).toBe(true);
    expect(slotFits(ctx, 10 * 60, 60)).toMatchObject({ fits: false, failure: 'OVERLAP' });
    expect(availableDurationAt(ctx, 10 * 60)).toBe(45);
  });
  it('enforces appointment protection: start + duration <= next protected commitment (acceptance #5)', () => {
    const ctx = buildDayContext({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 9 * 60, 17 * 60)],
      appointments: [appt('t1', 15 * 60, 60, { protected: true })],
    });
    expect(slotFits(ctx, 14 * 60 + 15, 60)).toMatchObject({ fits: false, failure: 'PROTECTED', conflictId: 'a-t1-900' });
    expect(slotFits(ctx, 14 * 60, 60).fits).toBe(true);
    expect(availableDurationAt(ctx, 14 * 60 + 15)).toBe(45);
  });
  it('honours a protection buffer', () => {
    const ctx = buildDayContext({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 9 * 60, 17 * 60)],
      appointments: [appt('t1', 15 * 60, 60, { protected: true, protectionBufferMinutes: 15 })],
    });
    expect(slotFits(ctx, 14 * 60, 60).fits).toBe(false);
    expect(slotFits(ctx, 13 * 60 + 45, 60).fits).toBe(true);
  });
  it('rejects lunch / break / blocked / off-grid / outside shift with distinct reasons', () => {
    const ctx = buildDayContext({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 9 * 60, 17 * 60), seg('t1', 'lunch', 12 * 60, 12 * 60 + 30), seg('t1', 'break', 15 * 60, 15 * 60 + 15), seg('t1', 'blocked', 16 * 60, 17 * 60)],
      appointments: [],
    });
    expect(slotFits(ctx, 11 * 60 + 45, 30).failure).toBe('LUNCH');
    expect(slotFits(ctx, 14 * 60 + 45, 30).failure).toBe('BREAK');
    expect(slotFits(ctx, 16 * 60, 15).failure).toBe('BLOCKED');
    expect(slotFits(ctx, 9 * 60 + 5, 15).failure).toBe('OFF_GRID');
    expect(slotFits(ctx, 8 * 60, 15).failure).toBe('NOT_WORKING');
    expect(slotFits(ctx, 16 * 60 + 45, 30).failure).toBe('NOT_WORKING'); // runs past 17:00
  });
  it('enumerates every grid start where the full duration fits', () => {
    const ctx = buildDayContext({
      technician: t, date: DATE, timezone: TZ, branchHours: hours,
      segments: [working('t1', 9 * 60, 11 * 60)], appointments: [appt('t1', 9 * 60 + 45, 30)],
    });
    expect(enumerateStarts(ctx, 45)).toEqual([540, 615]); // 10:30 would run past 11:00
    expect(computeGaps(ctx)).toEqual([{ start: 540, end: 585 }, { start: 615, end: 660 }]);
  });
  it('sums multi-service duration with time-changing add-ons', () => {
    expect(requiredDuration([{ durationMinutes: 45, addOns: [{ durationMinutes: 15 }] }, { durationMinutes: 60 }])).toBe(120);
  });
});

describe('eligibility', () => {
  const base = { tenantId: T, branchId: B, date: DATE, timezone: TZ, branchHours: hours, appointments: [] as Appointment[] };
  it('uses the exact technician→service relationship (acceptance #6)', () => {
    const t = tech('t1', [gel.id]);
    const r = evaluateEligibility({ ...base, technician: t, services: [acrylic], durationMinutes: 60, segments: [working('t1', 9 * 60, 17 * 60)], startMinute: 9 * 60 });
    expect(r).toMatchObject({ eligible: false, failures: ['SERVICE_INELIGIBLE'] });
    expect(failureToErrorCode(r.failures)).toBe('TECHNICIAN_SERVICE_INELIGIBLE');
    expect(evaluateEligibility({ ...base, technician: t, services: [gel], durationMinutes: 45, segments: [working('t1', 9 * 60, 17 * 60)], startMinute: 9 * 60 }).eligible).toBe(true);
  });
  it('fails tenant / branch / inactive / requested-other / duration', () => {
    const other = tech('t2', [gel.id], { tenantId: 'tenant-2', branchId: 'branch-9', active: false });
    const r = evaluateEligibility({ ...base, technician: other, services: [gel], durationMinutes: 50, segments: [], requestedTechnicianId: 't1' });
    expect(r.failures).toEqual(expect.arrayContaining(['TENANT_MISMATCH', 'BRANCH_MISMATCH', 'INACTIVE', 'REQUESTED_OTHER_TECHNICIAN', 'INVALID_DURATION', 'NOT_WORKING']));
    expect(failureToErrorCode(r.failures)).toBe('PERMISSION_DENIED');
  });
  it('applies the lead-time policy', () => {
    const t = tech('t1', [gel.id]);
    const r = evaluateEligibility({ ...base, technician: t, services: [gel], durationMinutes: 45, segments: [working('t1', 9 * 60, 17 * 60)], startMinute: 9 * 60, nowMinute: 8 * 60 + 50, policy: { minLeadMinutes: 30 } });
    expect(r.failures).toEqual(['POLICY_LEAD_TIME']);
  });
});

describe('Find an Opening & Best Matches', () => {
  const t1 = tech('t1', [gel.id, pedi.id]);
  const t2 = tech('t2', [gel.id, acrylic.id, pedi.id]);
  const t3 = tech('t3', [acrylic.id]);
  const ctx: SearchContext = {
    tenantId: T, branchId: B, date: DATE, timezone: TZ, branchHours: hours,
    technicians: [t1, t2, t3],
    segments: [working('t1', 9 * 60, 12 * 60), working('t2', 9 * 60, 12 * 60), working('t3', 9 * 60, 12 * 60)],
    appointments: [appt('t1', 9 * 60, 60), appt('t2', 9 * 60, 120)],
  };
  it('returns only full-duration, eligible openings, backend-style (not a grid scan)', () => {
    const res = collapseOpenings(findOpenings(ctx, { services: [gel] }));
    expect(res.map((r) => [r.technicianId, minuteOfDay(r.startAt, DATE, TZ), r.gapDurationMinutes])).toEqual([
      ['t1', 600, 120],
      ['t2', 660, 60],
    ]);
    expect(findOpenings(ctx, { services: [gel], technicianId: 't3' })).toEqual([]); // t3 not qualified
    expect(findOpenings(ctx, { services: [gel], window: { start: 11 * 60, end: 12 * 60 } }).map((r) => r.technicianId)).toEqual(['t1', 't2', 't1', 't2']);
  });
  it('ranks only eligible technicians, honouring requested technician and Fair Turn', () => {
    const diag: BestMatchDiagnostics = { ineligible: [] };
    const m = bestMatches(ctx, { services: [gel], preferredStartMinute: 9 * 60, fairTurnOrder: { t2: 0, t1: 1 } }, diag);
    expect(m.map((x) => x.technicianId)).toEqual(['t1', 't2']);
    expect(diag.ineligible).toEqual([{ technicianId: 't3', technicianName: 't3', failures: ['SERVICE_INELIGIBLE'] }]);
    const requested = bestMatches(ctx, { services: [gel], preferredStartMinute: 9 * 60, requestedTechnicianId: 't2' });
    expect(requested.map((x) => x.technicianId)).toEqual(['t2']);
    expect(requested[0].reasons).toContain('Requested by customer');
  });
  it('never offers a technician with no full-duration opening left', () => {
    const full: SearchContext = { ...ctx, appointments: [appt('t1', 9 * 60, 180), appt('t2', 9 * 60, 180)] };
    expect(bestMatches(full, { services: [gel] })).toEqual([]);
  });
});

describe('technician paging (spec §9)', () => {
  it('24 → 2 pages, 25 → 3 pages, 200 → 17 pages', () => {
    expect(pageInfo(24, 12, 0)).toMatchObject({ pageCount: 2, startIndex: 0, endIndex: 12, label: 'Technicians 1–12 of 24', nextLabel: 'Next 12', hasPrevious: false, hasNext: true });
    expect(pageInfo(24, 12, 1)).toMatchObject({ startIndex: 12, endIndex: 24, label: 'Technicians 13–24 of 24', hasNext: false });
    expect(pageInfo(25, 12, 2)).toMatchObject({ pageCount: 3, startIndex: 24, endIndex: 25, label: 'Technicians 25–25 of 25' });
    expect(pageInfo(25, 12, 1).nextLabel).toBe('Next 1');
    expect(pageInfo(200, 12, 16)).toMatchObject({ pageCount: 17, startIndex: 192, endIndex: 200 });
    expect(pageInfo(200, 12, 99).pageIndex).toBe(16); // clamped
    expect(pageInfo(0, 12, 0)).toMatchObject({ pageCount: 1, label: 'No technicians' });
    expect(pageOfIndex(13, 12)).toBe(1);
  });
});
