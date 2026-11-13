// tech-appointments-slot-guard.pgtest — merge Oct 12 2026 (other-chat booking concurrency, Smooth Refresh spec §7–§16) on the
// REAL schema (PGlite, all migrations, btree_gist loaded so 426/482's EXCLUDE constraint actually exists).
//
// The Technician Appointments screen writes the SAME pos_tech_appointments table as the Booking board and the customer app,
// and until this merge it had NO lock, no in-transaction re-check and swallowed the database's refusal (a move that lost
// reported success). Pinned here: create / move / reassign / service-change refuse an overlap with a typed conflict and leave
// the row untouched; an allowed overbook is written FLAGGED (overbook_ok + reason + who) and cleared on a clean move; a stale
// expectedVersion is refused (VERSION_CONFLICT); the constraint itself refuses an unflagged overlap and exempts a flagged one.
// True multi-connection contention is proven on real Postgres (tech-appointments-race.postgres-race.vitest.spec.ts).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechApptRepository } from './tech-appointments.kysely.repository';
import { AppointmentSlotConflict, AppointmentVersionConflict } from '../appointments/appointment-slot-guard';
import type { TAItem } from './tech-appointments.repository';

const T = 'a7400000-0000-4000-8000-000000000001';
const B = 'a7400000-0000-4000-8000-000000000002';
const TECH1 = 'a7400000-0000-4000-8000-0000000000a1';
const TECH2 = 'a7400000-0000-4000-8000-0000000000a2';
const DATE = '2999-05-01';
const ctx = { tenantId: T, branchId: B, userId: 'a7400000-0000-4000-8000-0000000000e1', role: 'MANAGER', permissions: [] as string[] };
const svc = (min: number) => [{ serviceId: 'svc_x', serviceName: 'Gel Manicure', durationMinutes: min, priceCents: 4500 } as any];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

let pg: any; let repo: KyselyTechApptRepository;
const rowOf = async (id: string) => (await pg.query(`select technician_id, start_time, end_time, version, overbook_ok, overbook_reason, overbook_by_user_id from pos_tech_appointments where id = $1`, [id])).rows[0] as any;
async function mk(tech: string, start: number, dur: number, opts?: any): Promise<string> {
  const item: TAItem = { appointmentId: 'x', technicianId: tech, customerName: 'Walk In', isVip: false, services: svc(dur), source: 'manual', date: DATE, startTime: hhmm(start), endTime: hhmm(start + dur), status: 'booked', depositStatus: 'not_required', notes: '', createdAt: '', updatedAt: '' };
  return (await repo.create(ctx as any, item, { bufferMinutes: 0, ...(opts || {}) })).appointmentId;
}

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Slot Salon', 'Slot Salon', 'slot-salon-ta', 'SLOTTA', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${TECH1}', '${T}', '${B}', 'Mia', 'Chen', 'Mia Chen', 'active', true), ('${TECH2}', '${T}', '${B}', 'Leo', 'Park', 'Leo Park', 'active', true);
  `);
  repo = new KyselyTechApptRepository(kyselyFor(pg) as any);
}, 180_000);

describe('tech-appointments slot guard (create / move / reassign / service change) on the real schema', () => {
  it('the exclusion constraint exists: an unflagged overlapping INSERT is refused by the database itself; a FLAGGED row is exempt', async () => {
    await mk(TECH1, 8 * 60, 60);
    await expect(pg.query(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status) values ($1,$2,$3,'Raw',false,'manual','[]',$4,'08:30','09:30',60,'booked','not_required')`, [T, B, TECH1, DATE]))
      .rejects.toThrow(/no_overlap|exclusion/i);
    await pg.query(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status, overbook_ok, overbook_reason) values ($1,$2,$3,'Raw',false,'manual','[]',$4,'08:30','09:30',60,'booked','not_required',true,'manager_override')`, [T, B, TECH1, DATE]);
  });

  it('create: an overlapping create is refused with AppointmentSlotConflict; with an allowed overbook the row is written FLAGGED (who + why)', async () => {
    await mk(TECH1, 10 * 60, 60);
    await expect(mk(TECH1, 10 * 60 + 30, 60)).rejects.toBeInstanceOf(AppointmentSlotConflict);
    const id = await mk(TECH1, 10 * 60 + 30, 60, { allowOverbook: true, overbookReason: 'manager_override' });
    const r = await rowOf(id);
    expect(r.overbook_ok).toBe(true); expect(r.overbook_reason).toBe('manager_override'); expect(String(r.overbook_by_user_id)).toBe(ctx.userId);
  });

  it('reschedule onto a taken slot throws (no silent success) and leaves the row exactly where it was; an overbook move is flagged, a clean move clears the flag', async () => {
    await mk(TECH1, 12 * 60, 60);
    const moving = await mk(TECH1, 14 * 60, 60);
    const before = await rowOf(moving);
    await expect(repo.reschedule(ctx as any, moving, undefined, '12:30', undefined, { bufferMinutes: 0 })).rejects.toBeInstanceOf(AppointmentSlotConflict);
    const after = await rowOf(moving);
    expect(after.start_time).toBe('14:00'); expect(Number(after.version)).toBe(Number(before.version));
    await repo.reschedule(ctx as any, moving, undefined, '12:30', undefined, { bufferMinutes: 0, allowOverbook: true, overbookReason: 'manager_override' });
    expect((await rowOf(moving)).overbook_ok).toBe(true);
    await repo.reschedule(ctx as any, moving, undefined, '15:00', undefined, { bufferMinutes: 0 });
    const cleared = await rowOf(moving);
    expect(cleared.start_time).toBe('15:00'); expect(cleared.overbook_ok).toBe(false); expect(cleared.overbook_reason).toBeNull();
  });

  it('reassigning to a technician who is busy at that time is refused (it was unchecked and the refusal swallowed)', async () => {
    await mk(TECH1, 16 * 60, 60);
    const other = await mk(TECH2, 16 * 60, 60);
    await expect(repo.assign(ctx as any, other, TECH1, { bufferMinutes: 0 })).rejects.toBeInstanceOf(AppointmentSlotConflict);
    expect((await rowOf(other)).technician_id).toBe(TECH2);
    expect(await repo.assign(ctx as any, other, TECH1, { bufferMinutes: 0, allowOverbook: true, overbookReason: 'manager_override' })).toBe(true);
    const r = await rowOf(other); expect(r.technician_id).toBe(TECH1); expect(r.overbook_ok).toBe(true);
  });

  it('a service change that lengthens the appointment into the next booking is refused; the salon buffer counts', async () => {
    const first = await mk(TECH2, 9 * 60, 30);
    await mk(TECH2, 10 * 60, 30);
    await expect(repo.update(ctx as any, first, { services: svc(120) } as any, { bufferMinutes: 0 })).rejects.toBeInstanceOf(AppointmentSlotConflict);
    expect((await rowOf(first)).end_time).toBe('09:30');
    await expect(repo.update(ctx as any, first, { services: svc(50) } as any, { bufferMinutes: 15 })).rejects.toBeInstanceOf(AppointmentSlotConflict);   // 09:50 + 15 buffer > 10:00
    expect(await repo.update(ctx as any, first, { services: svc(45) } as any, { bufferMinutes: 0 })).toBe(true);
    expect((await rowOf(first)).end_time).toBe('09:45');
  });

  it('optimistic concurrency: the trigger bumps the version on a real change; a stale expectedVersion is refused (VERSION_CONFLICT) and writes nothing', async () => {
    const id = await mk(TECH2, 18 * 60, 30);
    const v1 = Number((await rowOf(id)).version);
    await repo.update(ctx as any, id, { notes: 'first edit' } as any, { expectedVersion: v1 });
    expect(Number((await rowOf(id)).version)).toBe(v1 + 1);
    let err: any; try { await repo.update(ctx as any, id, { notes: 'stale device edit' } as any, { expectedVersion: v1 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AppointmentVersionConflict); expect(err.currentVersion).toBe(v1 + 1);
    expect((await pg.query(`select notes from pos_tech_appointments where id = $1`, [id])).rows[0].notes).toBe('first edit');
    await expect(repo.reschedule(ctx as any, id, undefined, '18:30', undefined, { bufferMinutes: 0, expectedVersion: v1 })).rejects.toBeInstanceOf(AppointmentVersionConflict);
    expect((await rowOf(id)).start_time).toBe('18:00');
    expect((await repo.detail(ctx as any, id))?.version).toBe(v1 + 1);   // the DTO carries it for the client
  });
  it('TECH APPOINTMENTS 10 (round 10): a cancel with its reason writes the status change and the reason in ONE change-log statement (same time), so History Diff can show it', async () => {
    const id = await mk(TECH2, 15 * 60, 30);
    expect(await repo.setStatus(ctx as any, id, 'cancelled', '  Customer called — flu  ')).toBe(true);
    const rows = (await pg.query(`select change_type, field, old_value, new_value, created_at from appointment_change_log where tenant_id = $1 and appointment_id = $2 and change_type = 'status_changed' order by field`, [T, id])).rows as any[];
    expect(rows.map((r) => [r.field, r.old_value, r.new_value])).toEqual([['reason', null, 'Customer called — flu'], ['status', 'booked', 'cancelled']]);
    expect(String(rows[0].created_at)).toBe(String(rows[1].created_at));
    const id2 = await mk(TECH2, 16 * 60, 30);
    await repo.setStatus(ctx as any, id2, 'no_show');            // no reason given → no reason row
    expect((await pg.query(`select count(*)::int as n from appointment_change_log where appointment_id = $1 and field = 'reason'`, [id2])).rows[0].n).toBe(0);
  });
  it('TECH APPOINTMENTS 03 (round 10): each technician card says WHY it reads as it does — the latest recorded status and when, or that none was recorded; the appointment being served', async () => {
    await pg.query(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values ($1,$2,$3,'on_break', now() - interval '2 hours'), ($1,$2,$3,'in_service', now() - interval '5 minutes')`, [T, B, TECH1]);
    const serving = await mk(TECH1, 20 * 60, 30);
    await pg.query(`update pos_tech_appointments set status = 'in_service' where id = $1`, [serving]);
    const st: any = await repo.query(ctx as any, { date: DATE } as any);
    const mia = st.technicians.find((x: any) => x.technicianId === TECH1), leo = st.technicians.find((x: any) => x.technicianId === TECH2);
    expect(mia.workingStatus).toBe('in_service');                                  // the LATEST status, not the older break
    expect(mia.statusWhy).toMatchObject({ source: 'technician_status', recorded: 'in_service', servingAppointmentId: serving });
    expect(new Date(mia.statusWhy.since).getTime()).toBeGreaterThan(Date.now() - 10 * 60_000);
    expect(leo.workingStatus).toBe('available');
    expect(leo.statusWhy).toMatchObject({ source: 'not_recorded', since: null, recorded: null, servingAppointmentId: null });
  });
});
