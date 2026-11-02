// live-schedule-screen.pgtest — the Live Technician Schedule read model (Oct 30 2026) against the REAL schema: the six KPIs
// for one salon day (planned vs attendance; live counts only for today; utilization N/A with nothing scheduled), the one
// search over technicians AND appointments, the activity history newest first, and a weekly-shift change's impact.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { LiveScheduleScreenRepository } from './live-schedule-screen.repository';

const P = 'fa7b0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1');
const VISHAL = id('c1'), KEVIN = id('c2'), CD = id('c3'), OTHER = id('c9'), GEL = id('d1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['customers.view', 'technicians.view'] };
let pg: any; let repo: LiveScheduleScreenRepository; let today = ''; let dow = 0;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','ls-a','LSA001','active'), ($2,'Other LLC','Other','ls-b','LSB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  const r = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d, extract(dow from (now() at time zone 'America/New_York')::date)::int as w`)).rows[0]; today = r.d; dow = r.w;
  for (const [tid, n, tenant, br, ph] of [[VISHAL, 'Vishal verma', T, B, '+18565550001'], [KEVIN, 'Kevin Dang', T, B, '+18565550002'], [CD, 'CD T6805', T, B, '+18565550003'], [OTHER, 'Vishal Other', T2, BX, '+18565550001']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, phone_display) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician',$5)`, [tid, tenant, br, n, ph]);
  await q(`insert into users (id, email, full_name, role, status) values ($1, 'owner@pilot.test', 'Owner One', 'OWNER', 'active')`, [U]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,5500,'active')`, [GEL, T, B, id('d9')]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, VISHAL, GEL]);
  // Vishal: weekly 09:00–17:00 with a 12:00–12:30 lunch → 450 planned minutes; Kevin: a published 10:00–14:00 shift (240); CD: none
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00','12:00','12:30',true)`, [T, B, VISHAL, dow]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, ($4::date + time '10:00') at time zone 'America/New_York', ($4::date + time '14:00') at time zone 'America/New_York', 'scheduled')`, [T, B, KEVIN, today]);
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status) values ($1,$2,$3,'active','CLOCKED_IN','ON_SHIFT','AVAILABLE'), ($1,$2,$4,'active','ON_BREAK','ON_SHIFT','BREAK')`, [T, B, VISHAL, KEVIN]);
  const ap = (aid: string, tid: string, d: string, s: string, e: string, mins: number, status: string, cust: string, phone: string) =>
    q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status) values ($1,$2,$3,$4,$5,$6,'manual',$7::jsonb,$8::date,$9,$10,$11,$12)`,
      [aid, T, B, tid, cust, phone, JSON.stringify([{ serviceId: GEL, name: 'Gel Manicure' }]), d, s, e, mins, status]);
  await ap(id('f1'), VISHAL, today, '10:00', '10:50', 50, 'confirmed', 'Mai Le', '+18565551234');
  await ap(id('f2'), VISHAL, today, '13:00', '13:45', 45, 'completed', 'Ana Ho', '+18565553333');
  await ap(id('f3'), KEVIN, today, '11:00', '11:45', 45, 'cancelled', 'Kim Do', '+18565554444');
  // next week, the same weekday: one inside the lunch, one late
  const nw = (await q(`select to_char($1::date + 7, 'YYYY-MM-DD') as d`, [today])).rows[0].d;
  await ap(id('f4'), VISHAL, nw, '12:00', '12:45', 45, 'confirmed', 'Tina Vo', '+18565552222');
  await ap(id('f5'), VISHAL, nw, '16:00', '16:45', 45, 'confirmed', 'Lan Ng', '+18565556666');
  await q(`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, actor_type, actor_id, source, created_at) values ($1,$2,$3,'rescheduled','start_time','09:30','10:00','staff',$4,'pos', now() - interval '2 hours')`, [T, B, id('f1'), U]);
  await q(`insert into technician_status_events (tenant_id, branch_id, technician_id, old_status, new_status, reason, created_at) values ($1,$2,$3,'available','on_break','lunch', now() - interval '1 hour')`, [T, B, KEVIN]);
  await q(`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason, created_at) values ($1,$2,$3,$4::date,'15:00','16:00','training', now() - interval '30 minutes')`, [T, B, CD, today]);
  repo = new LiveScheduleScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Live Technician Schedule', () => {
  it('the six KPIs for today: planned working vs attendance, real booked minutes, utilization over scheduled minutes', async () => {
    const r = await repo.kpis(ctx, { date: today });
    expect(r.when).toBe('today');
    expect(r.kpis).toMatchObject({ workingToday: 2, clockedIn: 2, availableNow: 1, inService: 0, onBreak: 1, bookedMinutes: 95, appointments: 2, scheduledMinutes: 690, utilizationPercent: 14, utilizationBasis: 'forecast' });
  });
  it('a past day never advertises live counts; nothing scheduled = utilization N/A', async () => {
    const r = await repo.kpis(ctx, { date: '2020-01-01' });
    expect(r.when).toBe('past');
    expect(r.kpis).toMatchObject({ availableNow: null, inService: null, onBreak: null, clockedIn: null, bookedMinutes: 0, utilizationPercent: null, utilizationBasis: 'booked' });
  });
  it('one search: technicians by name or phone, appointments by customer phone in any format — never another salon', async () => {
    const t = await repo.search(ctx, { q: 'vishal' });
    expect(t.technicians.items.map((x) => x.name)).toEqual(['Vishal verma']);
    const a = await repo.search(ctx, { q: '(856) 555-1234' });
    expect(a.appointments.items.map((x) => [x.customer, x.technician])).toEqual([['Mai Le', 'Vishal verma']]);
    expect((await repo.search(ctx, { q: 'x' })).technicians.totalItems).toBe(0);
  });
  it('activity is newest first across booking, status and blocked time', async () => {
    const h = await repo.activity(ctx, { preset: 'today' });
    expect(h.items.map((x) => x.kind)).toEqual(['schedule', 'blocked', 'status', 'booking']);   // Vishal's weekly hours were just written
    expect(h.items[3]).toMatchObject({ action: 'rescheduled', oldValue: '09:30', newValue: '10:00', technician: 'Vishal verma', actor: 'Owner One' });
    expect((await repo.activity(ctx, { preset: 'today', kind: 'status' })).totalItems).toBe(1);
    expect((await repo.activity(ctx, { preset: 'today', q: 'training' })).items.map((x) => x.technician)).toEqual(['CD T6805']);
  });
  it('a weekly-shift change shows the appointments it would leave outside the shift or in lunch, before it is saved', async () => {
    const late = await repo.shiftImpact(ctx, { technicianId: VISHAL, dow, working: true, start: '09:00', end: '16:00', lunchStart: '12:00', lunchEnd: '12:30' });
    expect(late.items.map((x) => [x.start, x.reason])).toEqual([['12:00', 'lunch'], ['16:00', 'outside_shift']]);
    const off = await repo.shiftImpact(ctx, { technicianId: VISHAL, dow, working: false });
    expect(off.items.every((x) => x.reason === 'day_off')).toBe(true); expect(off.affected).toBeGreaterThanOrEqual(3);
    await expect(repo.shiftImpact(ctx, { technicianId: OTHER, dow, working: false })).rejects.toBeTruthy();
  });
});
