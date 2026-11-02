// team-extra.mjs — the Team screens part of the catalog harness (Oct 30 2026): Technicians (and the screens that follow).
// Seeds the photo's people — Vishal verma (active, on shift, available, one 5★ review), Kevin Dang and CD T6805 (active,
// off today) — beside the harness's Anna / Bao / Chi, plus enough technicians to page the directory, live workforce
// states, published shifts, a pending time-off, a certification and status events. Fixtures only.
import { TechniciansScreenController } from '../../modules/workforce/src/team-screens/technicians-screen.controller.ts';
import { TechniciansScreenRepository } from '../../modules/workforce/src/team-screens/technicians-screen.repository.ts';
import { TechAppointmentsScreenController } from '../../modules/workforce/src/team-screens/tech-appointments-screen.controller.ts';
import { TechAppointmentsScreenRepository } from '../../modules/workforce/src/team-screens/tech-appointments-screen.repository.ts';
import { LiveScheduleScreenController } from '../../modules/workforce/src/team-screens/live-schedule-screen.controller.ts';
import { LiveScheduleScreenRepository } from '../../modules/workforce/src/team-screens/live-schedule-screen.repository.ts';
import { TechQueueScreenController } from '../../modules/workforce/src/team-screens/tech-queue-screen.controller.ts';
import { TechQueueScreenRepository } from '../../modules/workforce/src/team-screens/tech-queue-screen.repository.ts';
import { TechQueueController } from '../../modules/queue/src/tech-queue/tech-queue.controller.ts';
import { TechQueueService } from '../../modules/queue/src/tech-queue/tech-queue.service.ts';
import { InMemoryTechQueueRepository } from '../../modules/queue/src/tech-queue/tech-queue.repository.ts';
import { CommissionScreenController } from '../../modules/workforce/src/team-screens/commission-screen.controller.ts';
import { CommissionScreenRepository } from '../../modules/workforce/src/team-screens/commission-screen.repository.ts';
import { TeamPerformanceScreenController } from '../../modules/workforce/src/team-screens/team-performance-screen.controller.ts';
import { TeamPerformanceScreenRepository } from '../../modules/workforce/src/team-screens/team-performance-screen.repository.ts';
import { CommissionReviewController } from '../../modules/workforce/src/team-screens/commission-review.controller.ts';
import { CommissionReviewRepository } from '../../modules/workforce/src/team-screens/commission-review.repository.ts';
import { ShiftOverrideController } from '../../modules/workforce/src/team-screens/shift-override.controller.ts';
import { ShiftOverrideRepository } from '../../modules/workforce/src/team-screens/shift-override.repository.ts';
import { TeamMembersScreenController } from '../../modules/workforce/src/team-screens/team-members-screen.controller.ts';
import { TeamMembersScreenRepository } from '../../modules/workforce/src/team-screens/team-members-screen.repository.ts';
import { TeamDataAlertsController } from '../../modules/workforce/src/team-screens/team-data-alerts.controller.ts';
import { TeamDataAlertsRepository } from '../../modules/workforce/src/team-screens/team-data-alerts.repository.ts';
import { TeamMembersLookupController } from '../../modules/workforce/src/team-screens/team-members-lookup.controller.ts';
import { TeamMembersLookupRepository } from '../../modules/workforce/src/team-screens/team-members-lookup.repository.ts';
import { TechAppointmentsController } from '../../modules/appointments/src/tech-appointments/tech-appointments.controller.ts';
import { TechAppointmentsService } from '../../modules/appointments/src/tech-appointments/tech-appointments.service.ts';
import { InMemoryTechApptRepository } from '../../modules/appointments/src/tech-appointments/tech-appointments.repository.ts';
import { LiveTechnicianScheduleController } from '../../modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts';
import { LiveTechnicianScheduleService } from '../../modules/queue/src/live-technician-schedule/live-technician-schedule.service.ts';
import { InMemoryLiveScheduleRepository } from '../../modules/queue/src/live-technician-schedule/live-technician-schedule.repository.ts';
import { TeamOnboardingController } from '../../modules/workforce/src/team-staff/team-onboarding.controller.ts';
import { TeamBirthdaysController } from '../../modules/workforce/src/team-staff/team-birthdays.controller.ts';
import { TeamTrainingController } from '../../modules/workforce/src/team-staff/team-training.controller.ts';
import { TeamOnboardingRepository } from '../../modules/workforce/src/team-staff/team-onboarding.repository.ts';
import { TeamBirthdaysRepository } from '../../modules/workforce/src/team-staff/team-birthdays.repository.ts';
import { TeamTrainingRepository } from '../../modules/workforce/src/team-staff/team-training.repository.ts';
import { PILOT, OTHER, BRANCH, BRANCH_O, OWNER_USER, TECH, id } from './seed.mjs';
// round 2 (TM-06): the invitation is never really sent from the harness — a fake delivery that says "not connected"
const noSend = { async deliver() { return { deliveryStatus: 'not_connected', manualToken: 'harness-manual-token' }; } };

export const TEAM = { vishal: id('e1970000', 11), kevin: id('e1970000', 12), cd: id('e1970000', 13) };
export async function teamSeed(pg) {
  const q = (s, p = []) => pg.query(s, p);
  const tech = (tid, f, l, ph, days, role = 'Technician') => q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status, is_active, role_label, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',true,$10, now() - make_interval(days => $11))`, [tid, PILOT, BRANCH, f, l, `${f} ${l}`, '+1' + ph, `(${ph.slice(0, 3)}) ${ph.slice(3, 6)}-${ph.slice(6)}`, `${f.toLowerCase()}.${l.toLowerCase()}@pilot.test`, role, days]);
  await tech(TEAM.vishal, 'Vishal', 'verma', '8565557001', 3); await tech(TEAM.kevin, 'Kevin', 'Dang', '8565557002', 2); await tech(TEAM.cd, 'CD', 'T6805', '8565557003', 1);
  const NAMES = ['Lan Vo', 'Mia Ho', 'Tom Bui', 'Ivy Ngo', 'Kim Do', 'Rosa Lam', 'Jen Ly', 'Hoa Ta', 'Vy Mai'];
  for (let i = 0; i < NAMES.length; i++) { const [f, l] = NAMES[i].split(' '); await tech(id('e1970000', 20 + i), f, l, `85655571${String(10 + i)}`, 40 + i, i === 2 ? 'Receptionist' : 'Technician'); }
  const ws = (tid, clock, shift, queue) => q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state) values ($1,$2,$3,'ACTIVE',$4,$5,$6,'IDLE')
    on conflict do nothing`, [PILOT, BRANCH, tid, clock, shift, queue]);
  await ws(TEAM.vishal, 'CLOCKED_IN', 'ON_SHIFT', 'AVAILABLE'); await ws(TEAM.kevin, 'CLOCKED_OUT', 'OFF_SHIFT', 'OFF_SHIFT'); await ws(TEAM.cd, 'CLOCKED_OUT', 'OFF_SHIFT', 'OFF_SHIFT');
  await ws(TECH.anna, 'CLOCKED_IN', 'ON_SHIFT', 'SERVING'); await ws(TECH.bao, 'ON_BREAK', 'ON_SHIFT', 'BREAK'); await ws(TECH.chi, 'CLOCKED_OUT', 'OFF_SHIFT', 'OFF_SHIFT');
  const today = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`)).rows[0].d;
  for (const [tid, s, e] of [[TEAM.vishal, '09:00', '17:00'], [TECH.anna, '09:00', '18:00'], [TECH.bao, '10:00', '19:00'], [TEAM.kevin, '12:00', '20:00']])
    await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, ($4 || ' ' || $5)::timestamp at time zone 'America/New_York', ($4 || ' ' || $6)::timestamp at time zone 'America/New_York', 'scheduled')`, [PILOT, BRANCH, tid, today, s, e]);
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment) values ($1,$2,$3,5,'Beautiful work'), ($1,$2,$4,5,'Great'), ($1,$2,$4,4,'Good'), ($1,$2,$5,4,'Nice')`, [PILOT, BRANCH, TEAM.vishal, TECH.anna, TECH.bao]);
  await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status, reason) values ($1,$2,$3, now() + interval '5 days', now() + interval '6 days', 'pending', 'Family event')`, [PILOT, BRANCH, TEAM.kevin]);
  await q(`insert into technician_certifications (tenant_id, technician_id, name, issuer, issued_at, expires_at, verification_status) values ($1,$2,'Gel Certification','OPI', current_date - 300, current_date + 20, 'VERIFIED'), ($1,$3,'State Nail License','NJ Board', current_date - 900, current_date + 400, 'UNVERIFIED')`, [PILOT, TEAM.vishal, TECH.anna]);
  await q(`insert into technician_status_events (tenant_id, branch_id, technician_id, old_status, new_status, reason, changed_by_user_id, created_at) values ($1,$2,$3,'inactive','active','Back from leave',$4, now() - interval '2 days')`, [PILOT, BRANCH, TEAM.kevin, OWNER_USER]);
  // appointments today in the ONE ledger (Booking's): Kevin 10:00 online + a manager-approved overbooking at 10:30, Vishal
  // 10:00 arrived, Anna in service, CD cancelled + no-show, and one tomorrow
  const ap = (aid, tid, d, s0, e, mins, status, source, cust, phone, over = false) => q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status, overbook_ok, overbook_reason, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::date,$10,$11,$12,$13,$14,$15, now() - make_interval(mins => $16))`, [aid, PILOT, BRANCH, tid, cust, phone, source, JSON.stringify([{ name: 'Gel Manicure' }]), d, s0, e, mins, status, over, over ? 'manager approved' : null, mins]);
  const tomorrow = (await q(`select to_char(((now() at time zone 'America/New_York')::date + 1), 'YYYY-MM-DD') as d`)).rows[0].d;
  await ap(id('e2970000', 1), TEAM.kevin, today, '10:00', '10:45', 45, 'confirmed', 'online', 'Mai Le', '+18565551201');
  await ap(id('e2970000', 2), TEAM.kevin, today, '10:30', '11:15', 45, 'confirmed', 'manual', 'Tina Vo', '+18565551202', true);
  await ap(id('e2970000', 3), TEAM.vishal, today, '10:00', '10:50', 50, 'arrived', 'walk_in', 'Mai Le', '+18565551201');
  await ap(id('e2970000', 4), TECH.anna, today, '09:30', '10:15', 45, 'in_service', 'phone', 'Kim Do', '+18565551204');
  await ap(id('e2970000', 5), TEAM.cd, today, '13:00', '13:45', 45, 'cancelled', 'customer_app', 'Ana Ho', '+18565551203');
  await ap(id('e2970000', 6), TEAM.cd, today, '14:00', '14:45', 45, 'no_show', 'manual', 'Lan Nguyen', '+18565551205');
  await ap(id('e2970000', 7), TEAM.vishal, tomorrow, '11:00', '11:45', 45, 'booked', 'google', 'Rosa Tran', '+18565551206');
  await q(`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, actor_type, actor_id, source) values ($1,$2,$3,'rescheduled','start_time','09:30','10:30','staff',$4,'pos'), ($1,$2,$5,'cancelled','status','confirmed','cancelled','staff',$4,'pos')`,
    [PILOT, BRANCH, id('e2970000', 2), OWNER_USER, id('e2970000', 5)]);
  const dow = (await q(`select extract(dow from (now() at time zone 'America/New_York')::date)::int as w`)).rows[0].w;
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00','12:00','12:30',true)`, [PILOT, BRANCH, TEAM.cd, dow]);
  // Team Management (30 Oct 2026): CD's time-clock punch today at 10:30 against her 09:00 weekly start — the data-accuracy check's
  // attendance case (90 min, beyond the 15-minute tolerance). A fixture punch; nothing else reads it as a schedule.
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, ($4 || ' 10:30')::timestamp at time zone 'America/New_York', ($4 || ' 11:30')::timestamp at time zone 'America/New_York', 'completed')`, [PILOT, BRANCH, TEAM.cd, today]);
  await q(`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason, created_by_user_id) values ($1,$2,$3,$4::date,'15:00','16:00','training',$5)`, [PILOT, BRANCH, TEAM.cd, today, OWNER_USER]);
  // Tech Queue tickets in the ONE ticket table: 3 live (Vishal assigned 20 min ago, Kevin waiting acceptance, CD in service)
  // and closed ones — service done today (one with an unpaid checkout ticket), cancelled, and an expired one from 3 days ago
  const tqt = (n, tech, status, cust, phone, ago, started = null, closedAgo = null) => q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, customer_name, customer_phone, source, requested_services, priority, status, assigned_technician_id, assigned_at, started_at, created_at, updated_at)
    values ($1,$2,$3,$4,$5,'walk_in',$6::jsonb,'normal',$7,$8, now() - make_interval(mins => $9), case when $10::int is null then null else now() - make_interval(mins => $10::int) end, now() - make_interval(mins => $9 + 1), now() - make_interval(mins => coalesce($11::int, 0)))`,
    [id('e3970000', n), PILOT, BRANCH, cust, phone, JSON.stringify([{ serviceName: 'Gel Manicure', estimatedDurationMinutes: 45 }]), status, tech, ago, started, closedAgo]);
  await tqt(1, TEAM.vishal, 'assigned', 'Mai Le', '+18565551201', 20); await tqt(2, TEAM.kevin, 'waiting_for_acceptance', 'Tina Vo', '+18565551202', 6); await tqt(3, TEAM.cd, 'in_service', 'Kim Do', '+18565551204', 40, 30);
  for (let i = 0; i < 12; i++) await tqt(10 + i, [TEAM.vishal, TEAM.kevin, TEAM.cd][i % 3], 'service_done', ['Ana Ho', 'Lan Nguyen', 'Rosa Tran', 'Hoa Ly'][i % 4], '+1856555130' + (i % 10), 300 - i * 15, 290 - i * 15, 240 - i * 15);
  await tqt(30, TEAM.kevin, 'cancelled', 'Vy Pham', '+18565551240', 90, null, 60); await tqt(31, TEAM.vishal, 'expired', 'Jen Bui', '+18565551241', 60 * 24 * 3, null, 60 * 24 * 3 - 15);
  // Commission: the photo's month — Vishal 27 paid lines ($1,831 / $238.80 / tips $323), CD T6805 1 line ($50 / $20 / $10)
  const CU0 = (await q(`select id from customers where tenant_id = $1 order by created_at limit 1`, [PILOT])).rows[0]?.id;
  let cn = 0;
  const cline = async (tech, gross, earned, tip, rate, tipOnTicket = tip) => { cn++; const tk = id('e4970000', cn);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, tip_cents) values ($1,$2,$3,$4,'paid',$5, now() - make_interval(hours => $6), $7)`, [tk, PILOT, BRANCH, CU0, 'C-' + (3000 + cn), 1 + (cn % 20), tipOnTicket]);
    await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, snapshot_at)
      values ($1,$2,$3,$4,$5,'v1',$6,$6,'percent',$7,$8,$9, now() - make_interval(hours => $10))`, [PILOT, BRANCH, tk, id('e5970000', cn), tech, gross, rate, earned, tip, 1 + (cn % 20)]);
    if (tip) await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,$5)`, [PILOT, BRANCH, tk, tech, tip]); };
  if (CU0) { await cline(TEAM.vishal, 6800, 885, 1200, 13, 1700); for (let i = 0; i < 25; i++) await cline(TEAM.vishal, 6800, 885, 1200, 13); await cline(TEAM.vishal, 6300, 870, 1100, 13); await cline(TEAM.cd, 5000, 2000, 1000, 40); }
  // Team Management round 2A (30 Oct 2026): TM-01 — customer Hanh Pham (856-555-9901): a paid MULTI-TECHNICIAN ticket H-9001
  // (Vishal primary + a line, Kevin a line, CD the helper) and an appointment tomorrow with Lan Vo; the other salon has its own
  // Hanh Pham with the same phone (never resolves here). TM-04 — Vishal / Kevin / Lan mapped to Gel Manicure (c7970000-…-1);
  // Vishal is booked tomorrow 11:00–11:45 (seeded above), so a preferred 11:15 conflicts.
  const GEL = id('c7970000', 1); const HANH = id('e6970000', 1); const LAN = id('e1970000', 20);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Hanh','Pham','Hanh Pham','+18565559901','(856) 555-9901'), ($4,$5,$6,'Hanh','Pham','Hanh Pham','+18565559901','(856) 555-9901')`,
    [HANH, PILOT, BRANCH, id('e6970000', 9), OTHER, BRANCH_O]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, payment_status, primary_technician_id, helper_technician_id) values ($1,$2,$3,$4,'paid','H-9001', now() - interval '3 days','paid',$5,$6)`, [id('e6970000', 2), PILOT, BRANCH, HANH, TEAM.vishal, TEAM.cd]);
  for (const [n, t] of [[3, TEAM.vishal], [4, TEAM.kevin]]) await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind)
    values ($1,$2,$3,$4,$5,$6,'Gel Manicure',5500,45,5500,'service')`, [id('e6970000', n), PILOT, BRANCH, id('e6970000', 2), GEL, t]);
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, duration_minutes, status) values ($1,$2,$3,$4,$5,'Hanh Pham','+18565559901','phone','[{"name":"Gel Manicure"}]'::jsonb,$6::date,'15:00','15:45',45,'booked')`,
    [id('e6970000', 5), PILOT, BRANCH, LAN, HANH, tomorrow]);
  for (const t of [TEAM.vishal, TEAM.kevin, LAN]) await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4) on conflict do nothing`, [PILOT, BRANCH, t, GEL]);
  return { team: 6 + NAMES.length, appointments: 7 };
}
// harness-only, said so: the existing Tech Appointments state and the Live Schedule run on their in-memory adapters (the test
// database's Kysely stand-in has no query builder); the rebuilt screens' own read models run on the real SQL.
const fixtureTenant = (svc) => new Proxy(svc, { get: (o, k) => (typeof o[k] === 'function' ? (ctx, ...a) => o[k].call(o, ctx && typeof ctx === 'object' ? { ...ctx, tenantId: 'luxe001', branchId: 'br_main' } : ctx, ...a) : o[k]) });
export const teamRoutes = (db, routesOf) => [
  ...routesOf('modules/workforce/src/team-screens/technicians-screen.controller.ts', '/pos/technicians-screen', new TechniciansScreenController(new TechniciansScreenRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/tech-appointments-screen.controller.ts', '/pos/tech-appointments-screen', new TechAppointmentsScreenController(new TechAppointmentsScreenRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/live-schedule-screen.controller.ts', '/pos/live-schedule-screen', new LiveScheduleScreenController(new LiveScheduleScreenRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/tech-queue-screen.controller.ts', '/pos/tech-queue-screen', new TechQueueScreenController(new TechQueueScreenRepository(db))),
  ...routesOf('modules/queue/src/tech-queue/tech-queue.controller.ts', '/pos/tech-queue', new TechQueueController(fixtureTenant(new TechQueueService(new InMemoryTechQueueRepository())))),
  ...routesOf('modules/workforce/src/team-screens/commission-screen.controller.ts', '/pos/commission-screen', new CommissionScreenController(new CommissionScreenRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/team-performance-screen.controller.ts', '/pos/team-performance-screen', new TeamPerformanceScreenController(new TeamPerformanceScreenRepository(db))),
  // Finish the Five (Oct 30 2026): the persisted review (F1/F2) and the date shift editor (F4) on the REAL SQL. The stand-in
  // has no query builder, so the date editor runs without the outbox writer here (the save → event path is pgtested).
  ...routesOf('modules/workforce/src/team-screens/commission-review.controller.ts', '/pos/commission-discrepancies', new CommissionReviewController(new CommissionReviewRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/shift-override.controller.ts', '/pos/shift-overrides', new ShiftOverrideController(new ShiftOverrideRepository(db, null))),
  // Team Management (/tenant/team/members, 30 Oct 2026): the user-keyed read model, the profile tabs, the audited CSV and the
  // Data Accuracy Alerts — all on the REAL SQL
  ...routesOf('modules/workforce/src/team-screens/team-members-screen.controller.ts', '/pos/team-members-screen', new TeamMembersScreenController(new TeamMembersScreenRepository(db))),
  ...routesOf('modules/workforce/src/team-screens/team-data-alerts.controller.ts', '/pos/team-data-alerts', new TeamDataAlertsController(new TeamDataAlertsRepository(db))),
  // Team Management round 2 (TM-06 / TM-08 / TM-09, migration 727): onboarding (fake invite delivery), birthdays, training — REAL SQL
  ...routesOf('modules/workforce/src/team-staff/team-onboarding.controller.ts', '/pos/team-onboarding', new TeamOnboardingController(new TeamOnboardingRepository(db, noSend))),
  ...routesOf('modules/workforce/src/team-staff/team-birthdays.controller.ts', '/pos/team-birthdays', new TeamBirthdaysController(new TeamBirthdaysRepository(db))),
  ...routesOf('modules/workforce/src/team-staff/team-training.controller.ts', '/pos/team-training', new TeamTrainingController(new TeamTrainingRepository(db))),
  // round 2A: customer-linked staff search (TM-01) and the preferred-technician check (TM-04) on the REAL SQL
  ...routesOf('modules/workforce/src/team-screens/team-members-lookup.controller.ts', '/pos/team-members-screen', new TeamMembersLookupController(new TeamMembersLookupRepository(db))),
  harnessTechnicianCreate(db),
  ...routesOf('modules/appointments/src/tech-appointments/tech-appointments.controller.ts', '/pos/tech-appointments', new TechAppointmentsController(new TechAppointmentsService(new InMemoryTechApptRepository()))),
  // the in-memory Live Schedule carries its demo team only for its own fixture tenant: the harness reads that board (said so)
  ...routesOf('modules/queue/src/live-technician-schedule/live-technician-schedule.controller.ts', '/pos/technicians', new LiveTechnicianScheduleController(fixtureTenant(new LiveTechnicianScheduleService(new InMemoryLiveScheduleRepository())))),
];

// HARNESS-ONLY, said so (TM-03): the real technician create (TechniciansService) needs the Kysely query builder the stand-in
// lacks, so POST /pos/technicians here is a fixture that inserts the row with raw SQL and honours the Idempotency-Key exactly as
// the API's @Idempotent() interceptor does (same key → the first answer replayed, no second row). Only the round-trip back
// to Team Management (?created=<id>, page 1, highlight) is what the E2E proves; the real create is pgtested elsewhere.
function harnessTechnicianCreate(db) {
  const seen = new Map();
  const fn = async (req, body, key) => {
    const ctx = req.ctx; const k = key ? `${ctx.tenantId}:${ctx.userId}:${key}` : null;
    if (k && seen.has(k)) return seen.get(k);
    const first = String(body?.firstName ?? '').trim(), last = String(body?.lastName ?? '').trim();
    if (!first || !last) throw Object.assign(new Error('First and last name are required'), { status: 400 });
    const { sql } = await import('kysely');
    const row = (await sql`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values (${ctx.tenantId}, ${ctx.branchId}, ${first}, ${last}, ${first + ' ' + last}, 'active', true, 'Technician') returning id`.execute(db)).rows[0];
    const out = { technicianId: String(row.id), tenantId: ctx.tenantId, firstName: first, lastName: last, displayName: `${first} ${last}`, status: 'active' };
    if (k) seen.set(k, out);
    return out;
  };
  return { verb: 'POST', re: /^\/pos\/technicians$/, keys: [], perm: 'pos.technicians.create', method: 'harnessCreate', params: ['req', 'body', 'header:idempotency-key'], fn };
}
