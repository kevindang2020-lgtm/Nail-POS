// weekly-off-skills.pgtest — Technician Profile & Team Management guide (Nov 5 2026, G3, migration 816) on the REAL
// schema: the guide's §16 acceptance scenarios for repeating weekly days off and the Skills Catalog.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { weeklyOffTechs, weeklyOffOn, loadWeeklyOffRules, addLocalDays } from '@aipowersalon/booking';
import { WeeklyDaysOffRepository } from './weekly-days-off.repository';
import { SkillsCatalogRepository } from './skills-catalog.repository';
import { ShiftOverrideRepository } from './shift-override.repository';

const P = 'fa816000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), U2 = id('e2');
const MIA = id('c1'), LEO = id('c2');
const S1 = id('d1'), S2 = id('d2'), S3 = id('d3'), CAT = id('f1');
const mgr = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.technicians.view', 'pos.technicians.schedule.edit', 'pos.technicians.skills.edit'] };
const viewer = { ...mgr, userId: U2, permissions: ['pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: id('e9'), role: 'MANAGER', permissions: mgr.permissions };
// The pattern starts on the first Monday strictly after today (the service's "today" is the real salon day — fixed Nov 2026
// dates went stale on Nov 10 2026). Every other date is an offset from that Monday, keeping its weekday.
const ymdPlus = (base: string, days: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const MON = (() => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 2); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const TUE = ymdPlus(MON, 1), WED = ymdPlus(MON, 2), FRI = ymdPlus(MON, 4), NEXT_MON = ymdPlus(MON, 7);
const BEFORE = ymdPlus(MON, -7), CHANGE = ymdPlus(MON, 23), CHANGE_EVE = ymdPlus(MON, 22), LATER_MON = ymdPlus(MON, 28), PAST = ymdPlus(MON, -40);
const END_WED = ymdPlus(MON, 58), BEFORE_END_WED = ymdPlus(MON, 51), EARLY = ymdPlus(MON, -8);
let pg: any; let db: any; let wo: WeeklyDaysOffRepository; let sk: SkillsCatalogRepository; let so: ShiftOverrideRepository;
const events: any[] = [];
class CapturingOutbox extends OutboxWriter { async write(_trx: unknown, e: any) { events.push(e); } }
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.response?.code ?? e?.getResponse?.()?.code ?? e?.message; } }
const appt = (tech: string, date: string, services: unknown[] = []) =>
  q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source) values ($1,$2,$3,'Guest',$4::jsonb,$5,'10:00','11:00',60,'booked','walk_in') returning id`, [T, B, tech, JSON.stringify(services), date]).then((r: any) => String(r.rows[0].id));

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','g3-a','G3A001','active'), ($2,'Other LLC','Other','g3-b','G3B001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$3,$4,'Kim Manager','kim@g3.test','MANAGER','active'), ($2,$3,$4,'Lee Viewer','lee@g3.test','MANAGER','active')`, [U, U2, T, B]);
  for (const [tid, nm] of [[MIA, 'Mia Tran'], [LEO, 'Leo Park']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, T, B, nm]);
  for (let d = 0; d < 7; d++) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','19:00',true)`, [T, B, MIA, d]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order, status) values ($1,$2,$3,'Nails',1,'active')`, [CAT, T, B]);
  for (const [sid, nm] of [[S1, 'Gel Extensions Full Set'], [S2, 'Gel Fill'], [S3, 'Pedicure']])
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order)
      values ($1,$2,$3,$4,$5,60,5000,'percent',40,true,true,true,'active',1)`, [sid, T, B, CAT, nm]);
  db = kyselyFor(pg); wo = new WeeklyDaysOffRepository(db as never, new CapturingOutbox()); sk = new SkillsCatalogRepository(db as never); so = new ShiftOverrideRepository(db as never);
}, 180_000);

describe('repeating weekly days off (§7, §16)', () => {
  let booked = '';
  it('Monday + Tuesday every week: a booking on a new off day is a conflict to review, never cancelled', async () => {
    booked = await appt(MIA, NEXT_MON);
    const pv = await wo.preview(mgr, { technicianId: MIA, weekdays: [2, 1], effectiveFrom: MON, reason: 'School pickup' });
    expect(pv).toMatchObject({ weekdays: [1, 2], weekdayNames: ['Monday', 'Tuesday'], effectiveFrom: MON, effectiveTo: null, blocking: true });
    expect(pv.conflicts.map((c: any) => c.appointmentId)).toEqual([booked]);
    expect(pv.after.filter((d: any) => d.off).map((d: any) => d.name)).toEqual(['Monday', 'Tuesday']);
    expect(await code(wo.save(mgr, { technicianId: MIA, weekdays: [1, 2], effectiveFrom: MON }, 'r1'))).toBe('SCHEDULE_CONFLICT');
    expect((await q(`select count(*)::int n from technician_weekly_off_rules where tenant_id = $1`, [T])).rows[0].n).toBe(0);
    const saved: any = await wo.save(mgr, { technicianId: MIA, weekdays: [1, 2], effectiveFrom: MON, reason: 'School pickup', acknowledgeConflicts: true, expectedVersion: 0 }, 'r2');
    expect(saved).toMatchObject({ saved: true, version: 1 });
    expect((await q(`select status from pos_tech_appointments where id = $1`, [booked])).rows[0].status).toBe('booked');   // kept
    expect(events.at(-1)).toMatchObject({ eventType: 'technician.shift_override_changed', payload: { technicianId: MIA, overrideType: 'WEEKLY_OFF' } });
  });
  it('every future Monday and Tuesday is off in the one schedule reader; Wednesday and the weekly template are unchanged', async () => {
    for (const d of [MON, TUE, NEXT_MON, addLocalDays(TUE, 7), addLocalDays(MON, 364)]) expect((await weeklyOffTechs(db, T, B, d)).has(MIA)).toBe(true);
    expect((await weeklyOffTechs(db, T, B, WED)).has(MIA)).toBe(false);
    expect((await weeklyOffTechs(db, T, B, BEFORE)).has(MIA)).toBe(false);   // before the start: unchanged
    expect((await q(`select count(*)::int n from technician_schedules where tenant_id = $1 and technician_id = $2 and is_working`, [T, MIA])).rows[0].n).toBe(7);
    // the Live Schedule's date editor shows the recurring baseline as off on Monday, working on Wednesday
    expect((await so.editor(mgr, { technicianId: MIA, date: MON })).baseline).toMatchObject({ isWorking: false });
    expect((await so.editor(mgr, { technicianId: MIA, date: WED })).baseline).toMatchObject({ isWorking: true, startTime: '09:00' });
    const l = await wo.list(mgr, { technicianId: MIA, month: '2026-11' });
    expect(l.calendar.find((c: any) => c.date === MON)!.state).toBe('off_weekly_rule');
    expect(l.calendar.find((c: any) => c.date === WED)!.state).toBe('working');
  });
  it('a one-date working override wins for that Monday only; the next Monday stays off', async () => {
    await so.save(mgr, { technicianId: MIA, localDate: MON, overrideType: 'CUSTOM_SHIFT', startLocalTime: '10:00', endLocalTime: '16:00', reason: 'Covering a coworker' }, 'r3');
    expect((await so.editor(mgr, { technicianId: MIA, date: MON })).effective).toMatchObject({ isWorking: true, startTime: '10:00' });
    expect((await so.editor(mgr, { technicianId: MIA, date: NEXT_MON })).effective).toMatchObject({ isWorking: false });
    expect((await wo.list(mgr, { technicianId: MIA, month: '2026-11' })).calendar.find((c: any) => c.date === MON)!.state).toBe('working_override');
  });
  it('a one-time extra day off (Friday) leaves the weekly rule untouched', async () => {
    await so.save(mgr, { technicianId: MIA, localDate: FRI, overrideType: 'DAY_OFF', reason: 'Appointment' }, 'r4');
    const rules = await loadWeeklyOffRules(db, T, B, MON, ymdPlus(MON, 60), [MIA]);
    expect(rules).toHaveLength(1); expect(rules[0].weekdays).toEqual([1, 2]);
  });
  it('changing the pattern next month keeps history: the old rule ends the day before, the new one starts on its date', async () => {
    const cur = await wo.list(mgr, { technicianId: MIA });
    expect(await code(wo.save(mgr, { technicianId: MIA, weekdays: [3], effectiveFrom: CHANGE, expectedVersion: 0 }, 'r5'))).toBe('VERSION_CONFLICT');
    await wo.save(mgr, { technicianId: MIA, weekdays: [3], effectiveFrom: CHANGE, expectedVersion: cur.version, reason: 'New class day' }, 'r6');
    const rules = (await q(`select weekdays::text, to_char(effective_from,'YYYY-MM-DD') f, to_char(effective_to,'YYYY-MM-DD') t, status from technician_weekly_off_rules where tenant_id = $1 order by effective_from`, [T])).rows;
    expect(rules).toEqual([{ weekdays: '{1,2}', f: MON, t: CHANGE_EVE, status: 'ACTIVE' }, { weekdays: '{3}', f: CHANGE, t: null, status: 'ACTIVE' }]);
    expect((await weeklyOffTechs(db, T, B, NEXT_MON)).has(MIA)).toBe(true);           // November Mondays still off
    expect((await weeklyOffTechs(db, T, B, LATER_MON)).has(MIA)).toBe(false);      // December Monday works
    expect((await weeklyOffTechs(db, T, B, CHANGE)).has(MIA)).toBe(true);       // December Wednesdays off
    expect((await q(`select action from technician_weekly_off_events where tenant_id = $1 order by created_at, id`, [T])).rows.map((r: any) => r.action)).toEqual(['CREATED', 'SUPERSEDED', 'CREATED']);
    expect(await code(q(`delete from technician_weekly_off_events where tenant_id = $1`, [T]))).toMatch(/append-only/);
  });
  it('Remove Recurrence from a date; past dates are never edited; viewers and other salons cannot change it', async () => {
    const l = await wo.list(mgr, { technicianId: MIA });
    const dec = l.rules.find((r: any) => r.effectiveFrom === CHANGE)!;
    expect(await code(wo.end(viewer, { technicianId: MIA, ruleId: dec.id, endFrom: END_WED }, 'r7'))).toBe('FORBIDDEN');
    expect(await code(wo.save(mgr, { technicianId: MIA, weekdays: [4], effectiveFrom: PAST }, 'r8'))).toBe('WEEKLY_OFF_INVALID');
    expect(await code(wo.list(other, { technicianId: MIA }))).toBe('TECHNICIAN_NOT_FOUND');
    await wo.end(mgr, { technicianId: MIA, ruleId: dec.id, endFrom: END_WED, reason: 'Class finished' }, 'r9');
    expect((await weeklyOffTechs(db, T, B, BEFORE_END_WED)).has(MIA)).toBe(true);
    expect((await weeklyOffTechs(db, T, B, END_WED)).has(MIA)).toBe(false);
  });
  it('pure precedence helper: a branch rule does not leak to another branch', () => {
    const r = [{ id: 'x', technicianId: 't', branchId: 'b1', weekdays: [1], effectiveFrom: EARLY, effectiveTo: null }];
    expect(weeklyOffOn(r, 't', MON, 'b1')).toBeTruthy(); expect(weeklyOffOn(r, 't', MON, 'b2')).toBeNull(); expect(weeklyOffOn(r, 't', WED, 'b1')).toBeNull();
  });
});

describe('Skills Catalog and assignments (§8, §16)', () => {
  let gel = '';
  it('create "Gel Extensions" once (linked to existing services, no new service or price); a duplicate name is refused', async () => {
    const before = (await q(`select count(*)::int n from services where tenant_id = $1`, [T])).rows[0].n;
    gel = (await sk.save(mgr, { name: 'Gel Extensions', category: 'Nails', serviceIds: [S1, S2] }, 'k1')).id;
    expect(await code(sk.save(mgr, { name: 'gel extensions' }, 'k2'))).toBe('SKILL_EXISTS');
    expect((await q(`select count(*)::int n from services where tenant_id = $1`, [T])).rows[0].n).toBe(before);
    await sk.save(mgr, { name: 'Pedicure Spa', category: 'Feet', serviceIds: [S3] }, 'k3');
    const l = await sk.list(mgr, { q: 'fill' });   // finds the skill by a linked service name
    expect(l.items.map((i: any) => i.name)).toEqual(['Gel Extensions']);
    expect((await sk.list(mgr, {})).items.map((i: any) => i.name)).toEqual(['Pedicure Spa', 'Gel Extensions']);   // newest first
    expect(await code(sk.save(viewer, { name: 'Head Spa' }, 'k4'))).toBe('FORBIDDEN');
    expect((await sk.list(other, {})).totalItems).toBe(0);
  });
  it('assigning grants the linked services in the one eligibility table (once); a manager grant is left alone', async () => {
    await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary, granted_via) values ($1,$2,$3,$4,false,'manager')`, [T, B, LEO, S2]);
    const r: any = await sk.assign(mgr, { technicianId: LEO, skillIds: [gel], proficiency: 'ADVANCED' }, 'k5');
    expect(r).toMatchObject({ assigned: ['Gel Extensions'], servicesGranted: 1 });
    expect((await q(`select service_id, granted_via from technician_services where tenant_id = $1 and technician_id = $2 order by granted_via`, [T, LEO])).rows)
      .toEqual([{ service_id: S2, granted_via: 'manager' }, { service_id: S1, granted_via: 'skill:' + gel }]);
    expect((await sk.assign(mgr, { technicianId: LEO, skillIds: [gel] }, 'k6') as any).already).toEqual(['Gel Extensions']);
    const t = await sk.technicianSkills(mgr, LEO);
    expect(t.items).toHaveLength(1); expect(t.items[0]).toMatchObject({ status: 'APPROVED', proficiency: 'ADVANCED' });
  });
  it('removing a skill used by a future booking warns first, keeps the booking and history, removes only what the skill granted', async () => {
    const b = await appt(LEO, NEXT_MON, [{ serviceId: S1, serviceName: 'Gel Extensions Full Set' }]);
    const a = (await sk.technicianSkills(mgr, LEO)).items[0];
    const pv = await sk.revokePreview(mgr, LEO, a.id);
    expect(pv.servicesRemoved.map((s: any) => s.id)).toEqual([S1]); expect(pv.futureBookings.map((x: any) => x.appointmentId)).toEqual([b]);
    expect(await code(sk.revoke(mgr, { technicianId: LEO, assignmentId: a.id, reason: 'Retraining' }, 'k7'))).toBe('SCHEDULE_CONFLICT');
    await sk.revoke(mgr, { technicianId: LEO, assignmentId: a.id, reason: 'Retraining', acknowledgeBookings: true }, 'k8');
    expect((await q(`select service_id from technician_services where tenant_id = $1 and technician_id = $2`, [T, LEO])).rows).toEqual([{ service_id: S2 }]);   // manager grant stays
    expect((await q(`select status from pos_tech_appointments where id = $1`, [b])).rows[0].status).toBe('booked');
    expect((await sk.technicianSkills(mgr, LEO)).items[0]).toMatchObject({ status: 'REVOKED', revokeReason: 'Retraining' });
  });
  it('an archived skill cannot be assigned but stays in history; it can be assigned again after restore', async () => {
    await sk.archive(mgr, gel, { archived: true }, 'k9');
    expect(await code(sk.assign(mgr, { technicianId: LEO, skillIds: [gel] }, 'k10'))).toBe('SKILL_INACTIVE');
    expect((await sk.list(mgr, { status: 'archived' })).items.map((i: any) => i.name)).toEqual(['Gel Extensions']);
    await sk.archive(mgr, gel, { archived: false }, 'k11');
    expect((await sk.assign(mgr, { technicianId: LEO, skillIds: [gel] }, 'k12') as any).assigned).toEqual(['Gel Extensions']);
  });
});
