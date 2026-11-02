// team-members-screen.pgtest — Team Management read model (30 Oct 2026) against the REAL migrated schema: the eight KPI
// definitions (Active Today = scheduled or clocked in, not "account active"; services = paid service lines only; commission
// EARNED vs PAID kept apart; open positions not configured), unique role counts (a manager who is also a technician is ONE
// member), the cross-tenant technician join fixed (a user's technician is THIS salon's), branch scope, server search beyond
// page 1 (name · phone only with the contact permission · service · appointment id), newest first, the profile tabs'
// permission gates and the audited CSV export.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TeamMembersScreenRepository } from './team-members-screen.repository';

const P = 'fa810000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9');
const OWNER = id('e1'), MGR = id('e2'), DESK = id('e3'), ANNA_U = id('e4'), LAN_U = id('e5'), FAR_U = id('e6'), T2_U = id('e7');
const ANNA = id('c1'), LAN = id('c2'), KEVIN = id('c3'), SUE = id('c4'), GONE = id('c5'), FAR_T = id('c6'), T2_TECH = id('c9');
const GEL = id('d1'), APPT = id('f9');
const all = ['pos.technicians.view', 'technicians.edit', 'technicians.view_pay', 'payroll.view', 'roles.view', 'reports.export', 'pos.technicians.schedule.edit', 'customers.view'];
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: all };
const desk = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: ['pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: T2_U, role: 'MANAGER', permissions: all };
let pg: any; let repo: TeamMembersScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tm-a','TMA001','active'), ($2,'Other LLC','Other','tm-b','TMB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Second','active','America/New_York'), ($4,$5,'Elsewhere','active','America/New_York')`, [B, T, B2, BX, T2]);
  const user = (uid: string, tenant: string, br: string | null, name: string, role: string, daysAgo: number, phone: string | null = null) =>
    q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status, normalized_phone, created_at) values ($1,$2,$3,$4,$5,$6,'active',$7, now() - make_interval(days => $8))`,
      [uid, tenant, br, name, name.split(' ')[0].toLowerCase() + '@pilot.test', role, phone, daysAgo]);
  await user(OWNER, T, null, 'Pat Owner', 'OWNER', 90); await user(MGR, T, B, 'Mai Manager', 'MANAGER', 80); await user(DESK, T, B, 'Vy Desk', 'FRONT_DESK', 70);
  await user(ANNA_U, T, B, 'Anna Lee', 'TECHNICIAN', 60); await user(LAN_U, T, B, 'Lan Vo', 'MANAGER', 50); await user(FAR_U, T, B2, 'Far Away', 'FRONT_DESK', 40); await user(T2_U, T2, BX, 'Other Boss', 'MANAGER', 30);
  const tech = (tid: string, tenant: string, br: string, name: string, uid: string | null, label: string, daysAgo: number, phone: string, archived = false) =>
    q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone, phone_display, created_at, archived_at)
      values ($1,$2,$3,$4,$5,'x',$5,$6,true,$7,$8,$8, now() - make_interval(days => $9), $10)`, [tid, tenant, br, uid, name, archived ? 'archived' : 'active', label, phone, daysAgo, archived ? new Date().toISOString() : null]);
  await tech(ANNA, T, B, 'Anna Lee', ANNA_U, 'Technician', 60, '+18565557001'); await tech(LAN, T, B, 'Lan Vo', LAN_U, 'Technician', 50, '+18565557002');
  await tech(KEVIN, T, B, 'Kevin Dang', null, 'Technician', 1, '+18565557003'); await tech(SUE, T, B, 'Sue Park', null, 'Hair Stylist', 5, '+18565557004');
  await tech(GONE, T, B, 'Gone Tech', null, 'Technician', 100, '+18565557005', true); await tech(FAR_T, T, B2, 'Far Tech', null, 'Technician', 10, '+18565557006');
  // the cross-tenant bug: ANOTHER salon's technician row that points at Anna's user id — it must never be joined
  await tech(T2_TECH, T2, BX, 'Other Salon Tech', ANNA_U, 'Technician', 0, '+18565557009');
  const today = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d, extract(dow from (now() at time zone 'America/New_York')::date)::int as w`)).rows[0];
  // Anna: clocked in, on shift, available — no schedule today. Kevin: weekly template today. Lan: a published shift today. Sue: weekly + a DAY_OFF override.
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state) values ($1,$2,$3,'ACTIVE','CLOCKED_IN','ON_SHIFT','AVAILABLE','IDLE')`, [T, B, ANNA]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, now() - interval '2 hours', null, 'active')`, [T, B, ANNA, today.d]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, ($4 || ' 10:00')::timestamp at time zone 'America/New_York', ($4 || ' 18:00')::timestamp at time zone 'America/New_York', 'scheduled')`, [T, B, LAN, today.d]);
  for (const t of [KEVIN, SUE]) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00',true)`, [T, B, t, today.w]);
  await q(`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type) values ($1,$2,$3,$4::date,'America/New_York','DAY_OFF')`, [T, B, SUE, today.d]);
  // services: 2 paid service lines + 1 add-on + 1 removed line + 1 on a voided ticket — only 2 count
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Le','Ana Le')`, [id('e8'), T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,4000,'active')`, [GEL, T, B, id('d9')]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, ANNA, GEL]);
  const ticket = (n: string, status: string) => q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, payment_status) values ($1,$2,$3,$4,'paid',$5, now() - interval '1 hour', $6)`, [id('f' + n), T, B, id('e8'), 'T-' + n, status]);
  await ticket('1', 'paid'); await ticket('2', 'voided');
  const line = (n: string, tk: string, kind: string, addOn: boolean, removed: boolean, cents: number) => q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind, is_add_on, removed_at)
    values ($1,$2,$3,$4,$5,$6,'Gel Manicure',$7,45,$7,$8,$9,$10)`, [id('9' + n), T, B, id('f' + tk), GEL, ANNA, cents, kind, addOn, removed ? new Date().toISOString() : null]);
  await line('1', '1', 'service', false, false, 4000); await line('2', '1', 'service', false, false, 4000); await line('3', '1', 'add_on', true, false, 1000); await line('4', '1', 'service', false, true, 4000); await line('5', '2', 'service', false, false, 4000);
  await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, snapshot_at)
    values ($1,$2,$3,$4,$5,'1.0.0',4000,4000,'percent',25,1000,300, now() - interval '1 hour'), ($1,$2,$3,$6,$5,'1.0.0',4000,4000,'percent',12.5,500,0, now() - interval '1 hour')`, [T, B, id('f1'), id('91'), ANNA, id('92')]);
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,$3,'This week',$4::date - 6,$4::date,'paid')`, [id('70'), T, B, today.d]);
  await q(`insert into payroll_payouts (tenant_id, branch_id, period_id, technician_id, amount_cents, method, status, paid_at) values ($1,$2,$4,$3,700,'cash','paid', now() - interval '30 minutes')`, [T, B, ANNA, id('70')]);
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment) values ($1,$2,$3,5,'Great'), ($1,$2,$3,4,'Good')`, [T, B, ANNA]);
  await q(`insert into reviews (tenant_id, branch_id, technician_id, rating, comment, is_hidden_by_manager) values ($1,$2,$3,1,'hidden',true)`, [T, B, ANNA]);
  await q(`insert into technician_skill_change_requests (tenant_id, branch_id, technician_id, service_id, request_type, status) values ($1,$2,$3,$4,'add','submitted')`, [T, B, KEVIN, GEL]);
  await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) values ($1,$2,$3, now() + interval '3 days', now() + interval '4 days', 'pending')`, [T, B, KEVIN]);
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values ($1,$2,$3,$4,'Mai Le','[{"name":"Gel Manicure"}]'::jsonb, $5::date + 1, '11:00','11:45',45,'booked')`, [APPT, T, B, KEVIN, today.d]);
  repo = new TeamMembersScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Team Management read model', () => {
  it('the eight KPIs carry their documented definitions (branch B scope)', async () => {
    const d: any = await repo.dashboard(mgr, { preset: 'month' });
    expect(d.errors).toEqual([]);
    const k = d.kpis;
    // Pat (all branches) · Mai · Vy · Anna · Lan · Kevin · Sue — not the archived tech, not branch Second, not the other salon
    expect(k.totalMembers).toBe(7);
    expect(k.onShiftNow).toBe(1);
    expect(k.scheduledToday).toBe(2);           // Kevin (weekly) + Lan (published); Sue's date override says Off
    expect(k.activeToday).toBe(3);              // + Anna, clocked in without a schedule
    expect(k.servicesCompleted).toBe(2);        // no add-on, no removed line, no voided ticket
    expect(k.avgRating).toBe(4.5); expect(k.ratingCount).toBe(2);
    expect(k.commissionEarnedCents).toBe(1500); expect(k.commissionPaidCents).toBe(700);
    expect(k.pendingApprovals).toBe(2); expect(k.openPositions).toBeNull(); expect(k.openPositionsReason).toBe('not_configured');
    expect(d.training).toEqual({ configured: false }); expect(d.birthdays).toEqual({ recorded: false });
    expect(d.bands.unrated).toBe(3); // Lan, Kevin, Sue: providers without a verified review in the period
  });
  it('front desk sees counts but no money', async () => {
    const d: any = await repo.dashboard(desk, { preset: 'month' });
    expect(d.kpis.commissionEarnedCents).toBeNull(); expect(d.kpis.commissionPaidCents).toBeNull(); expect(d.productivity.revenueCents).toBeNull();
    expect(d.kpis.servicesCompleted).toBe(2);
  });
  it('role tabs count unique members — a manager who is also a technician is one member, under both tabs', async () => {
    const r: any = await repo.directory(mgr, { pageSize: 50 });
    const tabs = Object.fromEntries(r.tabs.map((t: any) => [t.id, t.count]));
    expect(tabs).toEqual({ all: 7, stylists: 1, nail_technicians: 3, receptionists: 1, assistants: 0, managers: 3 });
    expect(r.totalItems).toBe(7);
    const lan = r.items.filter((x: any) => x.name === 'Lan Vo'); expect(lan.length).toBe(1); expect(lan[0].roles).toEqual(['manager', 'nail_technician']);
    expect(lan[0].department).toBe('management'); expect(lan[0].departmentDerived).toBe(true);
    const nails: any = await repo.directory(mgr, { tab: 'nail_technicians', pageSize: 50 });
    expect(nails.items.map((x: any) => x.name).sort()).toEqual(['Anna Lee', 'Kevin Dang', 'Lan Vo']);
  });
  it('the technician join carries the tenant: Anna is THIS salon\'s technician, never the other salon\'s row', async () => {
    const r: any = await repo.directory(mgr, { q: 'anna' });
    expect(r.items.length).toBe(1); expect(r.items[0].technicianId).toBe(ANNA); expect(r.items[0].memberId).toBe(ANNA_U);
    expect(r.items[0].servicesCompleted).toBe(2); expect(r.items[0].commissionEarnedCents).toBe(1500);
  });
  it('newest first (created_at DESC, id DESC) and numbered pages; search reaches beyond page 1', async () => {
    const p1: any = await repo.directory(mgr, { pageSize: 3 }); const p3: any = await repo.directory(mgr, { pageSize: 3, page: 3 });
    expect(p1.items.map((x: any) => x.name)).toEqual(['Kevin Dang', 'Sue Park', 'Lan Vo']);
    expect(p1.totalPages).toBe(3); expect(p3.items.map((x: any) => x.name)).toEqual(['Pat Owner']);
    const s: any = await repo.directory(mgr, { q: 'pat', pageSize: 3 }); expect(s.items.map((x: any) => x.name)).toEqual(['Pat Owner']);
  });
  it('search: phone in any format only with the contact permission; a mapped service; a linked appointment id; the employee code', async () => {
    for (const ph of ['8565557003', '(856) 555-7003', '+1 856 555 7003']) { const r: any = await repo.directory(mgr, { q: ph }); expect(r.items.map((x: any) => x.name)).toEqual(['Kevin Dang']); expect(r.items[0].matchedVia).toBe('phone'); }
    const masked: any = await repo.directory(desk, { q: '8565557003' }); expect(masked.totalItems).toBe(0);
    const anyRow: any = await repo.directory(desk, { q: 'kevin' }); expect(anyRow.items[0].phone).toBe('••• 7003'); expect(anyRow.items[0].email).toBeNull();
    const gel: any = await repo.directory(mgr, { q: 'gel' }); expect(gel.items.map((x: any) => x.name)).toEqual(['Anna Lee']); expect(gel.items[0].matchedVia).toBe('service');
    const ap: any = await repo.directory(mgr, { q: APPT }); expect(ap.items.map((x: any) => x.name)).toEqual(['Kevin Dang']); expect(ap.items[0].matchedVia).toBe('appointment');
    const code: any = await repo.directory(mgr, { q: 'EMP-' + KEVIN.slice(-8).toUpperCase() }); expect(code.items.map((x: any) => x.name)).toEqual(['Kevin Dang']); expect(code.items[0].code).toBe('EMP-' + KEVIN.slice(-8).toUpperCase());
  });
  it('filters: live status, shift, department, More Filters (missing mapping, no login), account', async () => {
    expect((await repo.directory(mgr, { status: 'available' }) as any).items.map((x: any) => x.name)).toEqual(['Anna Lee']);
    expect((await repo.directory(mgr, { shift: 'scheduled' }) as any).items.map((x: any) => x.name).sort()).toEqual(['Kevin Dang', 'Lan Vo']);
    expect((await repo.directory(mgr, { shift: 'day_off' }) as any).items.map((x: any) => x.name)).toEqual(['Sue Park']);
    expect((await repo.directory(mgr, { shift: 'unscheduled' }) as any).items.map((x: any) => x.name).sort()).toEqual(['Anna Lee', 'Sue Park']);
    expect((await repo.directory(mgr, { shift: 'clocked_in' }) as any).items.map((x: any) => x.name)).toEqual(['Anna Lee']);
    expect((await repo.directory(mgr, { department: 'front_desk' }) as any).items.map((x: any) => x.name)).toEqual(['Vy Desk']);
    expect((await repo.directory(mgr, { extra: 'no_login' }) as any).items.map((x: any) => x.name).sort()).toEqual(['Kevin Dang', 'Sue Park']);
    expect((await repo.directory(mgr, { extra: 'missing_mapping' }) as any).items.map((x: any) => x.name).sort()).toEqual(['Kevin Dang', 'Lan Vo', 'Sue Park']);
    expect((await repo.directory(mgr, { account: 'archived' }) as any).items.map((x: any) => x.name)).toEqual(['Gone Tech']);
    const sh: any = (await repo.directory(mgr, { q: 'sue' })).items[0]; expect(sh.shiftSource).toBe('override_off'); expect(sh.shift).toBeNull();
  });
  it('tenant isolation and branch scope', async () => {
    const o: any = await repo.directory(other, { pageSize: 50 });
    expect(o.items.map((x: any) => x.name).sort()).toEqual(['Other Boss', 'Other Salon Tech']);
    await expect(repo.profile(other, ANNA_U)).rejects.toMatchObject({ status: 404 });
    await expect(repo.profile(mgr, FAR_U)).rejects.toMatchObject({ status: 404 });   // another branch's front desk
    const wide: any = await repo.directory({ ...mgr, branchId: '' }, { pageSize: 50 }); expect(wide.totalItems).toBe(9);   // no branch: Far Away + Far Tech too
  });
  it('profile tabs: lazy, by id, permission-gated', async () => {
    const p: any = await repo.profile(mgr, ANNA_U); expect(p.technicianId).toBe(ANNA); expect(p.can.pay).toBe(true);
    expect((await repo.profile(mgr, KEVIN) as any).memberId).toBe(KEVIN);
    await expect(repo.earnings(desk, ANNA_U, {})).rejects.toMatchObject({ status: 403 });
    const e: any = await repo.earnings(mgr, ANNA_U, { preset: 'month' }); expect(e.earnedCents).toBe(1500); expect(e.tipsCents).toBe(300); expect(e.paidCents).toBe(700); expect(e.payableCents).toBe(1800);
    await expect(repo.accessTab(desk, ANNA_U)).rejects.toMatchObject({ status: 403 });
    expect((await repo.accessTab(mgr, LAN_U) as any).roles).toEqual(['manager', 'nail_technician']);
    expect((await repo.schedule(mgr, DESK) as any).provider).toBe(false);
    const sc: any = await repo.schedule(mgr, SUE); expect(sc.overrides[0].type).toBe('DAY_OFF'); expect(sc.todayShift.source).toBe('override_off');
    const at: any = await repo.attendance(mgr, ANNA_U, { preset: 'today' }); expect(at.totalItems).toBe(1); expect(at.items[0].exception).toBe('unscheduled');
    const sk: any = await repo.skills(mgr, ANNA_U); expect(sk.services.map((s: any) => s.name)).toEqual(['Gel Manicure']);
    const wk: any = await repo.work(mgr, KEVIN, { scope: 'upcoming' }); expect(wk.items.map((a: any) => a.id)).toEqual([APPT]);
    const pf: any = await repo.performance(mgr, ANNA_U, { preset: 'month' }); expect(pf.allTime).toEqual({ rating: 4.5, count: 2 }); expect(pf.scale).toBe('0-5');
    const h: any = await repo.history(mgr, ANNA_U, {}); expect(h.page).toBe(1);
  });
  it('the CSV export is audited (requested → succeeded) and fails closed without the export permission', async () => {
    const out = await repo.exportCsv(mgr, { lang: 'en' }, 'req-tm-1');
    const [head, ...rows] = out.csv.replace(/^﻿/, '').split('\r\n');
    expect(head.startsWith('Employee ID,Name,Roles,Department (derived)')).toBe(true); expect(rows.length).toBe(7); expect(out.csv).not.toContain('Other Salon Tech');
    const a = (await q(`select action from audit_events where request_id = 'req-tm-1' order by occurred_at, action`)).rows.map((x: any) => x.action);
    expect(a).toEqual(['report.export.requested', 'report.export.succeeded']);
    await expect(repo.exportCsv(desk, {}, 'req-tm-2')).rejects.toMatchObject({ status: 403 });
    expect((await q(`select action from audit_events where request_id = 'req-tm-2'`)).rows.map((x: any) => x.action)).toEqual(['report.export.denied']);
  });
});
