// shift-override.pgtest — F4 (Finish the Five, 30 Oct 2026) against the REAL migrated schema (incl. 719), with the guide's
// acceptance examples: only Friday 2026-11-06 changes (every other Friday and the weekly row stay as they were); a day
// off with bookings is a conflict review, never a deletion; a 13:00–13:30 lunch keeps 13:15 out of Booking availability;
// two managers on the same date → the second gets 409; a 20:00–02:00 overnight shift owns the next morning and converts
// to UTC correctly; every save writes its history, audit row and the outbox event for realtime.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyBookingRepository, pbTechDayWindows, pbComputeAvailabilityInWindows, effectiveDaySchedule, addLocalDays } from '@aipowersalon/booking';
import { ShiftOverrideRepository } from './shift-override.repository';
import { LiveScheduleScreenRepository } from './live-schedule-screen.repository';

const P = 'fa800000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), U = id('e1'), U2 = id('e2');
const MIA = id('c1'), LEO = id('c2');
const mgr = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.technicians.view', 'pos.technicians.schedule.edit'] };
const mgr2 = { ...mgr, userId: U2 };
const viewer = { ...mgr, permissions: ['pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: id('e9'), role: 'MANAGER', permissions: ['pos.technicians.view', 'pos.technicians.schedule.edit'] };
const FRI = '2026-11-06', NEXT_FRI = '2026-11-13';
// The acceptance examples are dated (Friday 2026-11-06 …): pin the wall clock to Monday 2026-11-02 so "a past date cannot be
// edited" stays true to the example instead of failing once the real date passes it (only Date is faked — timers stay real
// for the database). Fixed Nov 7 2026: the suite turned red the day after the example Friday.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-11-02T14:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });
let pg: any; let db: any; let repo: ShiftOverrideRepository;
// the stand-in has no query builder, so OutboxWriter's insert cannot run here: the events written inside the save
// transaction are captured instead (the projection mapping is covered by the realtime-projection spec)
const events: any[] = [];
class CapturingOutbox extends OutboxWriter { async write(_trx: unknown, e: any) { events.push(e); } }
const bctx = () => ({ tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: [] }) as never;
/** what Booking's ONE schedule reader returns for that date: the overrides it loads (raw SQL, as in production) laid over
 *  the weekly row by the same pure function techSchedules uses (its weekly read is a query-builder call the stand-in lacks) */
async function bookingDay(tech: string, date: string) {
  const ov = await new KyselyBookingRepository(db as never).shiftOverrides(bctx(), [date, addLocalDays(date, -1)]);
  const base = (await repo.editor(mgr, { technicianId: tech, date })).baseline;
  return effectiveDaySchedule(base as never, ov.get(`${tech}|${date}`) ?? null, ov.get(`${tech}|${addLocalDays(date, -1)}`) ?? null);
}
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const appt = (tech: string, date: string, s: string, e: string, status = 'booked') =>
  q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source) values ($1,$2,$3,'Guest','[]'::jsonb,$4,$5,$6,60,$7,'walk_in') returning id`, [T, B, tech, date, s, e, status]).then((r: any) => String(r.rows[0].id));

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','so-a','SOA001','active'), ($2,'Other LLC','Other','so-b','SOB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Uptown','active','America/New_York'), ($4,$5,'Elsewhere','active','America/New_York')`, [B, T, B2, BX, T2]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$3,$4,'Kim Manager','kim@example.test','MANAGER','active'), ($2,$3,$4,'Lee Manager','lee@example.test','MANAGER','active')`, [U, U2, T, B]);
  for (const [tid, nm] of [[MIA, 'Mia Tran'], [LEO, 'Leo Park']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, T, B, nm]);
  // weekly template: every Friday 09:00–19:00 (no lunch); every day for Leo 09:00–19:00
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,5,'09:00','19:00',true)`, [T, B, MIA]);
  for (let d = 0; d < 7; d++) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','19:00',true)`, [T, B, LEO, d]);
  db = kyselyFor(pg); repo = new ShiftOverrideRepository(db as never, new CapturingOutbox());
}, 180_000);

const weekly = async () => (await q(`select technician_id, day_of_week, start_time::text, end_time::text, is_working, version, updated_at from technician_schedules where tenant_id = $1 order by technician_id, day_of_week`, [T])).rows;

describe('Edit Shift for Selected Date (F4)', () => {
  it('only Friday 2026-11-06 becomes 10:00–18:00; the next Friday and the weekly template are unchanged', async () => {
    const before = await weekly();
    const ed = await repo.editor(mgr, { technicianId: MIA, date: FRI });
    expect(ed.override).toBeNull(); expect(ed.baseline).toMatchObject({ isWorking: true, startTime: '09:00', endTime: '19:00' });
    const saved = await repo.save(mgr, { technicianId: MIA, localDate: FRI, overrideType: 'CUSTOM_SHIFT', startLocalTime: '10:00', endLocalTime: '18:00', reason: 'Dentist in the morning' }, 'req-1');
    expect(saved).toMatchObject({ saved: true, version: 1 });
    expect(saved.override).toMatchObject({ overrideType: 'CUSTOM_SHIFT', startLocalTime: '10:00', endLocalTime: '18:00', version: 1 });
    expect(saved.effective).toMatchObject({ isWorking: true, startTime: '10:00', endTime: '18:00' });
    expect(saved.baseline).toMatchObject({ startTime: '09:00', endTime: '19:00' });
    expect((await repo.editor(mgr, { technicianId: MIA, date: NEXT_FRI })).override).toBeNull();
    expect(await weekly()).toEqual(before);
    // the ONE schedule reader Booking uses sees the override on that date only
    expect(await bookingDay(MIA, FRI)).toMatchObject({ isWorking: true, shifts: [{ startTime: '10:00', endTime: '18:00' }] });
    expect(await bookingDay(MIA, NEXT_FRI)).toMatchObject({ startTime: '09:00', endTime: '19:00' });
    // history, audit, outbox (→ technician_schedule_updated)
    expect((await q(`select action, reason from technician_shift_override_events where tenant_id = $1 and technician_id = $2`, [T, MIA])).rows).toEqual([{ action: 'SAVED', reason: 'Dentist in the morning' }]);
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'technician.shift_override.saved'`, [T])).rows[0].n).toBe(1);
    expect(events).toHaveLength(1); expect(events[0].eventType).toBe('technician.shift_override_changed');
    expect(events[0]).toMatchObject({ tenantId: T, branchId: B, aggregateType: 'technician_shift_override', aggregateId: MIA, payload: { technicianId: MIA, date: FRI, version: 1 } });
  });
  it('Mark Off with bookings → 409 conflict review listing the booking; the booking is never touched; acknowledged → saved', async () => {
    const a = await appt(LEO, '2026-11-09', '11:00', '12:00');
    const p = await repo.preview(mgr, { technicianId: LEO, localDate: '2026-11-09', overrideType: 'DAY_OFF' });
    expect(p.conflicts).toEqual([expect.objectContaining({ kind: 'OUTSIDE_SHIFT', appointmentId: a, startTime: '11:00', endTime: '12:00', blocking: true })]);
    await expect(repo.save(mgr, { technicianId: LEO, localDate: '2026-11-09', overrideType: 'DAY_OFF' }, 'r')).rejects.toMatchObject({ status: 409 });
    expect(Number((await q(`select count(*) from technician_shift_overrides where technician_id = $1`, [LEO])).rows[0].count)).toBe(0);
    await repo.save(mgr, { technicianId: LEO, localDate: '2026-11-09', overrideType: 'DAY_OFF', acknowledgeConflicts: true, reason: 'Family event' }, 'r2');
    expect((await q(`select status, start_time, end_time from pos_tech_appointments where id = $1`, [a])).rows[0]).toEqual({ status: 'booked', start_time: '11:00', end_time: '12:00' });
    const h = (await q(`select after_json from technician_shift_override_events where technician_id = $1`, [LEO])).rows[0].after_json;
    expect(h.acknowledgedConflicts).toEqual([expect.objectContaining({ kind: 'OUTSIDE_SHIFT', appointmentId: a })]);
  });
  it('a 13:00–13:30 lunch: a booking at 13:15 is a conflict, and 13:15 is never offered as an opening', async () => {
    const a = await appt(LEO, '2026-11-10', '13:15', '13:45');
    const body = { technicianId: LEO, localDate: '2026-11-10', overrideType: 'CUSTOM_SHIFT' as const, startLocalTime: '09:00', endLocalTime: '19:00', breaks: [{ type: 'lunch', startLocalTime: '13:00', endLocalTime: '13:30' }] };
    expect((await repo.preview(mgr, body)).conflicts).toEqual([expect.objectContaining({ kind: 'BREAK_OVERLAP', appointmentId: a })]);
    await repo.save(mgr, { ...body, acknowledgeConflicts: true }, 'r3');
    const day = await bookingDay(LEO, '2026-11-10');
    const slots = pbComputeAvailabilityInWindows(pbTechDayWindows('08:00', '20:00', day ?? null, []), 15, 15, 0, []);
    expect(slots).toContain('12:45'); expect(slots).not.toContain('13:00'); expect(slots).not.toContain('13:15'); expect(slots).toContain('13:30');
  });
  it('two managers edit the same date: the second save is rejected (409) and nothing is overwritten', async () => {
    const ed = await repo.editor(mgr, { technicianId: MIA, date: FRI }); const v = ed.override!.version;
    await repo.save(mgr, { technicianId: MIA, localDate: FRI, overrideType: 'CUSTOM_SHIFT', startLocalTime: '11:00', endLocalTime: '18:00', expectedVersion: v }, 'a');
    await expect(repo.save(mgr2, { technicianId: MIA, localDate: FRI, overrideType: 'CUSTOM_SHIFT', startLocalTime: '12:00', endLocalTime: '17:00', expectedVersion: v }, 'b')).rejects.toMatchObject({ status: 409 });
    await expect(repo.save(mgr2, { technicianId: MIA, localDate: FRI, overrideType: 'CUSTOM_SHIFT', startLocalTime: '12:00', endLocalTime: '17:00' }, 'c')).rejects.toMatchObject({ status: 409 });
    expect((await repo.editor(mgr, { technicianId: MIA, date: FRI })).override).toMatchObject({ startLocalTime: '11:00', version: v + 1 });
  });
  it('a 20:00–02:00 overnight shift owns the next morning, with a correct UTC conversion (incl. the DST night)', async () => {
    const s = await repo.save(mgr, { technicianId: LEO, localDate: '2026-11-11', overrideType: 'CUSTOM_SHIFT', startLocalTime: '20:00', endLocalTime: '02:00', endsNextDay: true }, 'r4');
    expect(s.override).toMatchObject({ endsNextDay: true });
    expect((await bookingDay(LEO, '2026-11-11'))!.shifts).toEqual([{ startTime: '20:00', endTime: '24:00' }]);
    expect((await bookingDay(LEO, '2026-11-12'))!.shifts).toEqual([{ startTime: '00:00', endTime: '02:00' }, { startTime: '09:00', endTime: '19:00' }]);
    const p = await repo.preview(mgr, { technicianId: LEO, localDate: '2026-11-11', overrideType: 'CUSTOM_SHIFT', startLocalTime: '20:00', endLocalTime: '02:00', endsNextDay: true });
    expect(p.instants).toEqual({ startsAtUtc: '2026-11-12T01:00:00.000Z', endsAtUtc: '2026-11-12T07:00:00.000Z', actualMinutes: 360, wallMinutes: 360 });
    await expect(repo.preview(mgr, { technicianId: LEO, localDate: '2026-11-11', overrideType: 'CUSTOM_SHIFT', startLocalTime: '20:00', endLocalTime: '02:00' })).rejects.toMatchObject({ status: 422 });
    // the clocks go back on 2026-11-01 in New York: 00:00–04:00 on the wall is five real hours (that date is in the past, so the pure helper is used)
    const { shiftInstants } = await import('./shift-override');
    expect(shiftInstants('2026-11-01', { start: 0, end: 240 }, 'America/New_York', '2026-11-02')).toMatchObject({ actualMinutes: 300, wallMinutes: 240 });
  });
  it('Restore Recurring removes the override (history keeps it); the Live Schedule KPIs use the effective day', async () => {
    const ed = await repo.editor(mgr, { technicianId: LEO, date: '2026-11-09' });
    const r = await repo.save(mgr, { technicianId: LEO, localDate: '2026-11-09', overrideType: 'RESTORE_BASELINE', expectedVersion: ed.override!.version }, 'r5');
    expect(r.override).toBeNull(); expect(r.effective).toMatchObject({ startTime: '09:00', endTime: '19:00' });
    expect(r.history.map((h: any) => h.action)).toEqual(['RESTORED_BASELINE', 'SAVED']);
    const live = new LiveScheduleScreenRepository(db as never);
    expect((await live.kpis(mgr as never, { date: FRI })).kpis.scheduledMinutes).toBe(600 + 420);   // Leo 09–19 (template) + Mia 11–18 (override)
    expect((await live.kpis(mgr as never, { date: '2026-11-10' })).kpis.scheduledMinutes).toBe(570);   // Leo 09–19 less the 30-minute lunch
  });
  it('permissions, validation, cross-branch overlap and tenant isolation', async () => {
    await expect(repo.save(viewer, { technicianId: MIA, localDate: '2026-11-20', overrideType: 'DAY_OFF' }, 'x')).rejects.toMatchObject({ status: 403 });
    await expect(repo.save(mgr, { technicianId: MIA, localDate: '2026-10-01', overrideType: 'DAY_OFF' }, 'x')).rejects.toMatchObject({ status: 422 });
    await expect(repo.preview(mgr, { technicianId: MIA, localDate: '2026-11-20', overrideType: 'CUSTOM_SHIFT', startLocalTime: '10:00', endLocalTime: '18:00', breaks: [{ type: 'lunch', startLocalTime: '19:00', endLocalTime: '19:30' }] })).rejects.toMatchObject({ status: 422 });
    await repo.save({ ...mgr, branchId: B2 }, { technicianId: MIA, localDate: '2026-11-20', overrideType: 'CUSTOM_SHIFT', startLocalTime: '09:00', endLocalTime: '13:00' }, 'x');
    await expect(repo.save(mgr, { technicianId: MIA, localDate: '2026-11-20', overrideType: 'CUSTOM_SHIFT', startLocalTime: '12:00', endLocalTime: '18:00', acknowledgeConflicts: true }, 'x')).rejects.toMatchObject({ status: 409 });
    await expect(repo.editor(other, { technicianId: MIA, date: FRI })).rejects.toMatchObject({ status: 404 });
    await expect(repo.save(other, { technicianId: MIA, localDate: FRI, overrideType: 'DAY_OFF' }, 'x')).rejects.toMatchObject({ status: 404 });
  });
});
