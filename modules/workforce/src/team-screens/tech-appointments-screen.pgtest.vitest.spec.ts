// tech-appointments-screen.pgtest — the Tech Appointments read model (Oct 30 2026) against the REAL schema: the nine KPIs
// for one salon day, the conflict rule (same technician overlap or time off — never two technicians on one service), the
// one search, the week board and the conflict explanation.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechAppointmentsScreenRepository } from './tech-appointments-screen.repository';

const P = 'fa7a0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const VISHAL = id('c1'), KEVIN = id('c2'), CD = id('c3'), GEL = id('d1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['customers.view'] };
let pg: any; let repo: TechAppointmentsScreenRepository; let today = '';
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','ta-a','TAA001','active'), ($2,'Other LLC','Other','ta-b','TAB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  today = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`)).rows[0].d;
  for (const [tid, n, tenant, br] of [[VISHAL, 'Vishal verma', T, B], [KEVIN, 'Kevin Dang', T, B], [CD, 'CD T6805', T, B], [id('c9'), 'Other Tech', T2, BX]])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, tenant, br, n]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,5500,'active')`, [GEL, T, B, id('d9')]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, KEVIN, GEL]);
  await q(`update technicians set service_eligibility_mode = 'exact' where tenant_id = $1`, [T]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3, extract(dow from $4::date)::int, '09:00', '17:00', '12:00', '12:30', true)`, [T, B, KEVIN, today]);
  const ap = (aid: string, tid: string, s: string, e: string, mins: number, status: string, source: string, cust: string, phone: string, tenant = T, br = B, over = false) =>
    q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status, overbook_ok, overbook_reason) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::date,$10,$11,$12,$13,$14,$15)`,
      [aid, tenant, br, tid, cust, phone, source, JSON.stringify([{ serviceId: GEL, name: 'Gel Manicure' }]), today, s, e, mins, status, over, over ? 'manager approved' : null]);
  await ap(id('f1'), KEVIN, '10:00', '10:45', 45, 'confirmed', 'online', 'Mai Le', '+18565551234');
  await ap(id('f2'), KEVIN, '10:30', '11:15', 45, 'confirmed', 'manual', 'Tina Vo', '+18565552222', T, B, true);   // a manager-approved overbooking      // overlaps f1 on Kevin → both conflicts
  await ap(id('f3'), VISHAL, '10:00', '10:45', 45, 'arrived', 'walk_in', 'Mai Le', '+18565551234');        // same time, another technician → no conflict
  await ap(id('f4'), CD, '13:00', '13:45', 45, 'cancelled', 'customer_app', 'Ana Ho', '+18565553333');
  await ap(id('f5'), CD, '14:00', '14:45', 45, 'no_show', 'phone', 'Kim Do', '+18565554444');
  await ap(id('f6'), id('c9'), '10:00', '10:45', 45, 'confirmed', 'manual', 'Mai Other', '+18565551234', T2, BX);
  await q(`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, actor_type, source) values ($1,$2,$3,'rescheduled','start_time','09:30','10:30','staff','pos')`, [T, B, id('f2')]);
  repo = new TechAppointmentsScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Tech Appointments', () => {
  it('the nine KPIs for the selected day; conflicts are same-technician overlaps only', async () => {
    const k = (await repo.kpis(ctx, { date: today })).kpis;
    expect(k).toEqual({ today: 5, booked: 2, checkedIn: 1, inService: 0, completed: 0, cancelled: 1, noShows: 1, online: 2, conflicts: 2 });
    expect((await repo.kpis(ctx, { date: '2020-01-01' })).kpis.today).toBe(0);
  });
  it('one search: phone in any format, technician, service; start-time order; never another salon', async () => {
    for (const ph of ['8565551234', '(856) 555-1234', '+1 856 555 1234']) {
      const r = await repo.list(ctx, { q: ph });
      expect(r.items.map((x) => [x.customer, x.technician, x.matchedVia])).toEqual([['Mai Le', 'Kevin Dang', 'phone'], ['Mai Le', 'Vishal verma', 'phone']]);
    }
    expect((await repo.list(ctx, { q: 'kevin' })).totalItems).toBe(2);
    expect((await repo.list(ctx, { status: 'conflict' })).items.map((x) => x.start)).toEqual(['10:00', '10:30']);
    expect((await repo.list(ctx, { source: 'online' })).totalItems).toBe(2);
    const n = await repo.list(ctx, { sort: 'newest', page: 1, pageSize: 2 });
    expect(n.totalPages).toBe(3); expect(n.items[0]!.phone).toBe('••• 4444');
  });
  it('the week board counts booked appointments per technician per day (cancelled / no-show excluded)', async () => {
    const w = await repo.week(ctx, { start: today });
    expect(w.days).toHaveLength(7);
    const kev = w.technicians.find((t) => t.name === 'Kevin Dang')!; const cd = w.technicians.find((t) => t.name === 'CD T6805')!;
    expect(kev.days.find((d) => d.date === today)).toEqual({ date: today, appointments: 2, bookedMinutes: 90 });
    expect(cd.days.find((d) => d.date === today)!.appointments).toBe(0);
  });
  it('the conflict warning explains every cause', async () => {
    const c = await repo.conflicts(ctx, { technicianId: KEVIN, date: today, start: '10:15', minutes: 45, serviceIds: GEL });
    expect(c.ok).toBe(false); expect(c.reasons.filter((r) => r.kind === 'overlap').map((r) => r.from)).toEqual(['10:00', '10:30']);
    const lunch = await repo.conflicts(ctx, { technicianId: KEVIN, date: today, start: '12:00', minutes: 45 });
    expect(lunch.reasons.map((r) => r.kind)).toEqual(['break']);
    const late = await repo.conflicts(ctx, { technicianId: KEVIN, date: today, start: '16:45', minutes: 45 });
    expect(late.reasons.map((r) => [r.kind, r.from, r.to])).toEqual([['outside_shift', '09:00', '17:00']]);
    const v = await repo.conflicts(ctx, { technicianId: VISHAL, date: today, start: '15:00', minutes: 45, serviceIds: GEL });
    expect(v.reasons.map((r) => r.kind)).toEqual(['no_shift', 'not_qualified']);
    expect((await repo.conflicts(ctx, { technicianId: KEVIN, date: today, start: '14:00', minutes: 45, serviceIds: GEL })).ok).toBe(true);
  });
  it('recent booking changes, newest first', async () => {
    const h = await repo.history(ctx, { preset: 'today' });
    expect(h.items.map((x) => [x.changeType, x.oldValue, x.newValue, x.technician])).toEqual([['rescheduled', '09:30', '10:30', 'Kevin Dang']]);
  });
  it('TECH APPOINTMENTS 08: online bookings waiting on the SMS code are listed as pending (not booked, not in the KPIs); each appointment says how its phone was proven', async () => {
    const hold = (hid: string, startLocal: string, tech: string | null, over: { status?: string; released?: boolean; expiresIn?: string; tenant?: string; br?: string } = {}) =>
      q(`insert into booking_holds (id, tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel, released_at)
         values ($1,$2,$3,$4, ($5::date + $6::time) at time zone 'America/New_York', ($5::date + $6::time + interval '20 minutes') at time zone 'America/New_York', now() + $7::interval, $8, $9, 'online', $10)`,
        [hid, over.tenant ?? T, over.br ?? B, tech, today, startLocal, over.expiresIn ?? '10 minutes', over.status ?? 'held', hid.replace(/ab(\d)$/, 'ac$1'), over.released ? new Date().toISOString() : null]);
    const sess = (hid: string, status: string, tenant = T, br = B) => q(`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, booking_hold_id, phone_hash, phone_mask, channel, status, expires_at, last_sent_at)
         values ($1,$2,$3,$4,$6,'•••• 7788','online',$5, now() + interval '10 minutes', now())`, [tenant, br, hid.replace(/ab(\d)$/, 'ac$1'), hid, status, 'h-' + hid]);
    await hold(id('ab1'), '15:00', KEVIN); await sess(id('ab1'), 'sent');             // waiting on the code → listed
    await hold(id('ab2'), '15:30', null); await sess(id('ab2'), 'locked');            // too many wrong codes → listed (staff may override)
    await hold(id('ab3'), '16:00', KEVIN); await sess(id('ab3'), 'verified');         // proven → not pending
    await hold(id('ab4'), '16:30', KEVIN, { released: true }); await sess(id('ab4'), 'sent');   // abandoned → not pending
    await hold(id('ab5'), '17:00', KEVIN, { expiresIn: '-1 minutes' }); await sess(id('ab5'), 'sent');   // hold expired → not pending
    await hold(id('ab6'), '17:30', KEVIN);                                           // a slot hold with no SMS step → not pending
    await hold(id('ab7'), '15:00', id('c9'), { tenant: T2, br: BX }); await sess(id('ab7'), 'sent', T2, BX);   // another salon
    const r = await repo.kpis(ctx, { date: today });
    expect(r.pendingVerification.items.map((x) => [x.start, x.technician, x.verification, x.phone])).toEqual([['15:00', 'Kevin Dang', 'sent', '•••• 7788'], ['15:30', null, 'locked', '•••• 7788']]);
    expect(r.pendingVerification.count).toBe(2);
    expect(r.kpis.today).toBe(5);   // never counted as appointments
    expect((await repo.kpis({ ...ctx, permissions: [] }, { date: today })).pendingVerification.items[0]!.phone).toBeNull();
    expect((await repo.kpis(ctx, { date: '2020-01-01' })).pendingVerification.count).toBe(0);
    await q(`update pos_tech_appointments set phone_verification = 'staff_override' where id = $1`, [id('f1')]);
    const items = (await repo.list(ctx, { q: 'Mai Le' })).items;
    expect(items.map((x) => [x.technician, x.phoneVerification])).toEqual([['Kevin Dang', 'staff_override'], ['Vishal verma', null]]);
  });
});
