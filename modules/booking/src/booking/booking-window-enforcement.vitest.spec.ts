// booking-window-enforcement.vitest.spec.ts — proves the SERVICE enforces technician windows on create and
// reschedule (schedule, lunch, blocked time), with managerOverride as the audited escape hatch. Uses the in-memory
// repository subclassed to supply a schedule (10:00–16:00, lunch 12:00–13:00) and a blocked 14:00–15:00.
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import type { PBTechDaySchedule } from './booking.dto';
import { BookingService, ForbiddenError, ValidationError } from './booking.service';

class ScheduledRepo extends InMemoryBookingRepository {
  async techSchedules(): Promise<Record<string, PBTechDaySchedule>> {
    return { tech_mia: { isWorking: true, startTime: '10:00', endTime: '16:00', lunchStartTime: '12:00', lunchEndTime: '13:00' } };
  }
  async blockedTimes(): Promise<Record<string, { startTime: string; endTime: string; reason: string }[]>> {
    return { tech_mia: [{ startTime: '14:00', endTime: '15:00', reason: 'training' }] };
  }
}

// Smooth Refresh spec §71/§72: a "manager override" is an AUTHORIZED override — the caller must hold booking.override
// (owner/manager in rbac). Until Sep 30 2026 the flag was an ungated client checkbox.
const ctx = { tenantId: 'luxe001', branchId: 'br', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule', 'booking.override'] };
const frontDesk = { ...ctx, role: 'FRONT_DESK', userId: 'u2', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule'] };
const base = { customerName: 'Ava', serviceIds: ['svc_mani'], date: '2026-06-08', source: 'manual' as const };

describe('window enforcement (create)', () => {
  let svc: BookingService;
  beforeEach(() => { svc = new BookingService(new ScheduledRepo()); });

  it('rejects a booking before the technician starts', async () => {
    await expect(svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '09:00' })).rejects.toThrow(ValidationError);
  });
  it('rejects a booking across the lunch break', async () => {
    await expect(svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '11:45' })).rejects.toThrow(/working hours/);
  });
  it('rejects a booking inside blocked time', async () => {
    await expect(svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '14:15' })).rejects.toThrow(/working hours/);
  });
  it('accepts a booking inside the working window', async () => {
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '10:30' });
    expect(row.startTime).toBe('10:30');
  });
  it('managerOverride books outside the window (audited path)', async () => {
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '09:00', managerOverride: true });
    expect(row.startTime).toBe('09:00');
  });
  it('spec §71/§72: managerOverride WITHOUT booking.override is refused (front desk cannot bypass working hours)', async () => {
    // Re-pinned (merge Oct 12 2026, R1): the request is refused OUTRIGHT (403 — "a manager override is required"), not
    // silently downgraded to the working-hours refusal; either way the front desk never bypasses the window.
    await expect(svc.create(frontDesk as any, { ...base, technicianId: 'tech_mia', startTime: '11:45', managerOverride: true } as any))
      .rejects.toThrow(/manager override \(pos\.booking\.override_conflict\) is required|working hours|store hours/);
    await expect(svc.create(frontDesk as any, { ...base, technicianId: 'tech_mia', startTime: '11:45', managerOverride: true } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Phase 15: an "unassigned" booking was never storable (pos_tech_appointments.technician_id is NOT NULL — only this
  // in-memory repository accepted it). A booking with no technician is now "first available": the engine assigns one,
  // and the working windows still decide — Mia (starts 10:00) is never chosen for 09:15.
  it('a first-available booking (no technician) is assigned someone whose window covers the time — never Mia at 09:15', async () => {
    const row = await svc.create(ctx, { ...base, startTime: '09:15' });
    expect(row.technicianId).toBeTruthy();
    expect(row.technicianId).not.toBe('tech_mia');
  });
});

// Wave 3 (Oct 13 2026), spec §69 + §72: an EDIT that lengthens the visit is held to the same windows as a create — an
// add-on that runs the 15:15 manicure (45 min → 15:15–16:00) into a 100-minute visit ends at 16:55, past Mia's 16:00.
describe('window enforcement (edit that lengthens the visit)', () => {
  let svc: BookingService;
  beforeEach(() => { svc = new BookingService(new ScheduledRepo()); });
  it('§72: lengthening past the end of the shift is refused without an authorised override; inside the window it is saved', async () => {
    const row = await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '15:15' });
    await expect(svc.update(ctx, row.appointmentId, { serviceIds: ['svc_mani', 'svc_pedi'] } as any)).rejects.toThrow(/working hours/);
    await expect(svc.update(frontDesk as any, row.appointmentId, { serviceIds: ['svc_mani', 'svc_pedi'], managerOverride: true } as any)).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await svc.update(ctx, row.appointmentId, { serviceIds: ['svc_mani', 'svc_pedi'], managerOverride: true } as any);
    expect(ok.endTime).toBe('16:55');
    const early = await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '10:00' });
    expect((await svc.update(ctx, early.appointmentId, { serviceIds: ['svc_mani', 'svc_pedi'] } as any)).endTime).toBe('11:40');
  });
});

describe('window enforcement (reschedule)', () => {
  let svc: BookingService; let aid: string;
  beforeEach(async () => {
    svc = new BookingService(new ScheduledRepo());
    aid = (await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '10:30' })).appointmentId;
  });
  it('rejects a move into the lunch break', async () => {
    await expect(svc.reschedule(ctx, aid, { startTime: '12:15' })).rejects.toThrow(/working hours/);
  });
  it('rejects a move into blocked time', async () => {
    await expect(svc.reschedule(ctx, aid, { startTime: '14:00' })).rejects.toThrow(/working hours/);
  });
  it('accepts a valid move and persists the new time', async () => {
    const row = await svc.reschedule(ctx, aid, { startTime: '15:15' });
    expect(row.startTime).toBe('15:15');
  });
  it('managerOverride moves outside the window', async () => {
    const row = await svc.reschedule(ctx, aid, { startTime: '09:00', managerOverride: true });
    expect(row.startTime).toBe('09:00');
  });
});

describe('window enforcement survives pg Date-object dates (regression)', () => {
  class DateObjRepo extends ScheduledRepo {
    async booking(ctx: any, id: string) {
      const b = await super.booking(ctx, id);
      return b ? ({ ...b, date: new Date(b.date + 'T00:00:00Z') } as any) : b;
    }
  }
  it('a move into lunch is still rejected when the stored date is a Date object', async () => {
    const svc = new BookingService(new DateObjRepo());
    const aid = (await svc.create(ctx, { ...base, technicianId: 'tech_mia', startTime: '10:30' })).appointmentId;
    await expect(svc.reschedule(ctx, aid, { startTime: '12:15' })).rejects.toThrow(/working hours/);
  });
});
