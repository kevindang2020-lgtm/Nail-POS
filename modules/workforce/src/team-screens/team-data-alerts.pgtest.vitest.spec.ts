// team-data-alerts.pgtest — Team Management Data Accuracy Alerts (30 Oct 2026, migration 722) against the REAL schema:
// every detector finds its data-backed case and nothing else (approved time off, a DAY_OFF override and an approved date
// override are NOT attendance alerts; a login and its own technician record are not "duplicates"; a ledger within $1.00 of
// its payout is fine); a rescan dedupes on the fingerprint and never reopens a decision; the review workflow keeps its
// state machine, expectedVersion (409), reasons, append-only history and audit; permission (403, audited) and tenant (404)
// boundaries hold; and NOTHING the alerts point at is changed.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TeamDataAlertsRepository } from './team-data-alerts.repository';

const P = 'fa820000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9');
const MGR = id('e2'), DESK = id('e3'), ANNA_U = id('e4'), OLD_U = id('e6'), T2_U = id('e7');
const ANNA = id('c1'), LAN = id('c2'), KEVIN = id('c3'), SUE = id('c4'), MIA = id('c5'), OLDLINK = id('c6'), T2_TECH = id('c9'), GEL = id('d1');
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['pos.technicians.view', 'technicians.edit', 'roles.view', 'roles.manage', 'payroll.view', 'payroll.manage'] };
const viewer = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: ['pos.technicians.view', 'roles.view'] };
const desk = { tenantId: T, branchId: B, userId: DESK, role: 'FRONT_DESK', permissions: ['pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: T2_U, role: 'MANAGER', permissions: mgr.permissions };
let pg: any; let repo: TeamDataAlertsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const snapshot = async () => (await q(`select (select count(*) from payroll_payouts)::int as payouts, (select coalesce(sum(amount_cents),0) from payroll_payouts)::bigint as paid,
  (select count(*) from ticket_compensation_snapshots)::int as snaps, (select count(*) from technician_services)::int as maps, (select count(*) from technician_shifts)::int as punches,
  (select count(*) from technician_shift_overrides)::int as overrides, (select string_agg(shift_status || clock_status, ',' order by technician_id) from technician_workforce_state)::text as live,
  (select string_agg(coalesce(user_id::text, '-') || status, ',' order by id) from technicians)::text as links, (select string_agg(status, ',' order by id) from users)::text as users`)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','da-a','DAA001','active'), ($2,'Other LLC','Other','da-b','DAB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  for (const [uid, tenant, name, role, status] of [[MGR, T, 'Mai Manager', 'MANAGER', 'active'], [DESK, T, 'Vy Desk', 'FRONT_DESK', 'active'], [ANNA_U, T, 'Anna Lee', 'TECHNICIAN', 'active'],
    [OLD_U, T, 'Old User', 'TECHNICIAN', 'inactive'], [T2_U, T2, 'Other Boss', 'MANAGER', 'active']])
    await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$2,$3,$4,$5,$6,$7)`, [uid, tenant, tenant === T ? B : BX, name, name.split(' ')[0].toLowerCase() + '@pilot.test', role, status]);
  const tech = (tid: string, tenant: string, name: string, uid: string | null, phone: string, email: string | null = null) =>
    q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone, email) values ($1,$2,$3,$4,$5,'x',$5,'active',true,'Technician',$6,$7)`,
      [tid, tenant, tenant === T ? B : BX, uid, name, phone, email]);
  await tech(ANNA, T, 'Anna Lee', ANNA_U, '+18565557001', 'anna@pilot.test');   // same e-mail as her login: one member, never a duplicate
  await tech(LAN, T, 'Lan Vo', null, '+18565557002'); await tech(KEVIN, T, 'Kevin Dang', null, '+18565557003'); await tech(SUE, T, 'Sue Park', null, '(856) 555-7003');   // Sue shares Kevin's phone
  await tech(MIA, T, 'Mia Tran', null, '+18565557005'); await tech(OLDLINK, T, 'Old Link', OLD_U, '+18565557006');
  await tech(T2_TECH, T2, 'Other Salon Tech', ANNA_U, '+18565557009');   // another salon's row pointing at THIS salon's login
  const d = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as t, to_char((now() at time zone 'America/New_York')::date - 1, 'YYYY-MM-DD') as y,
    extract(dow from (now() at time zone 'America/New_York')::date - 1)::int as yw`)).rows[0];
  // 1 · Anna: on shift, clocked in, no shift today
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state) values ($1,$2,$3,'ACTIVE','CLOCKED_IN','ON_SHIFT','AVAILABLE','IDLE')`, [T, B, ANNA]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, status) values ($1,$2,$3,$4::date, now() - interval '1 hour', 'active')`, [T, B, ANNA, d.t]);
  // 4 · yesterday: Kevin weekly 09:00, clocked in 10:30 (late 90 min) · Sue weekly 09:00 + approved time off + punch · Lan DAY_OFF override + punch · Mia override 11:00 (weekly 09:00) + punch 11:05
  for (const t of [KEVIN, SUE, LAN, MIA]) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00',true)`, [T, B, t, d.yw]);
  const punch = (t: string, hm: string) => q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date, ($4 || ' ' || $5)::timestamp at time zone 'America/New_York', ($4 || ' 17:00')::timestamp at time zone 'America/New_York', 'completed')`, [T, B, t, d.y, hm]);
  await punch(KEVIN, '10:30'); await punch(SUE, '11:00'); await punch(LAN, '12:00'); await punch(MIA, '11:05');
  await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) values ($1,$2,$3, ($4 || ' 00:00')::timestamp at time zone 'America/New_York', ($4 || ' 23:59')::timestamp at time zone 'America/New_York', 'approved')`, [T, B, SUE, d.y]);
  await q(`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type) values ($1,$2,$3,$4::date,'America/New_York','DAY_OFF')`, [T, B, LAN, d.y]);
  await q(`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type, start_local_time, end_local_time) values ($1,$2,$3,$4::date,'America/New_York','CUSTOM_SHIFT','11:00','17:00')`, [T, B, MIA, d.y]);
  // 2 · Kevin performed (paid) and is booked for Gel Manicure with no mapping; Anna is mapped
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,4000,'active')`, [GEL, T, B, id('d9')]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, ANNA, GEL]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Le','Ana Le')`, [id('e8'), T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at) values ($1,$2,$3,$4,'paid','T-1', now() - interval '2 hours')`, [id('f1'), T, B, id('e8')]);
  for (const [n, t] of [['1', KEVIN], ['2', ANNA]]) await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
    values ($1,$2,$3,$4,$5,$6,'Gel Manicure',4000,45,4000)`, [id('9' + n), T, B, id('f1'), GEL, t]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status) values ($1,$2,$3,'Mai Le','[{"name":"Gel Manicure"}]'::jsonb, $4::date + 1, '11:00','11:45',45,'booked')`, [T, B, KEVIN, d.t]);
  // 3 · a PAID payroll period: Anna's ledger 1,000 + 300 tips vs 700 paid (mismatch); Lan's 500 vs 520 paid (within $1.00? no — 20¢ over: fine)
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,$3,'Last week',$4::date - 6,$4::date,'paid')`, [id('70'), T, B, d.t]);
  await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, snapshot_at)
    values ($1,$2,$3,$4,$5,'1.0.0',4000,4000,'percent',25,1000,300, now() - interval '2 hours'), ($1,$2,$3,$6,$7,'1.0.0',4000,4000,'percent',12.5,500,0, now() - interval '2 hours')`, [T, B, id('f1'), id('92'), ANNA, id('91'), LAN]);
  await q(`insert into payroll_payouts (tenant_id, branch_id, period_id, technician_id, amount_cents, method, status, paid_at) values ($1,$2,$3,$4,700,'cash','paid', now()), ($1,$2,$3,$5,520,'cash','paid', now())`, [T, B, id('70'), ANNA, LAN]);
  repo = new TeamDataAlertsRepository(kyselyFor(pg) as never);
}, 180_000);

let found: any[] = [];
describe('Team Management data accuracy alerts', () => {
  it('Run Check finds every data-backed case and nothing else — and changes nothing it points at', async () => {
    const before = await snapshot();
    const r: any = await repo.runCheck(mgr, 'req-da-1');
    expect(r.byType).toEqual({ SHIFT_STATUS_MISMATCH: 1, MISSING_SERVICE_MAPPING: 1, COMMISSION_PAID_MISMATCH: 1, ATTENDANCE_DISAGREEMENT: 1, DUPLICATE_CONTACT: 1, STALE_USER_LINK: 1 });
    expect(r.detected).toBe(6); expect(r.alreadyKnown).toBe(0);
    found = (await repo.list(mgr, { status: 'all', pageSize: 20 }) as any).items;
    const by = (t: string) => found.find((x) => x.type === t);
    expect(by('SHIFT_STATUS_MISMATCH').technicianId).toBe(ANNA);
    expect(by('ATTENDANCE_DISAGREEMENT')).toMatchObject({ technicianId: KEVIN }); expect(by('ATTENDANCE_DISAGREEMENT').evidence).toMatchObject({ plannedStart: '09:00', clockIn: '10:30', deltaMinutes: 90, plannedSource: 'weekly' });
    expect(by('MISSING_SERVICE_MAPPING')).toMatchObject({ technicianId: KEVIN, severity: 'medium' }); expect(by('MISSING_SERVICE_MAPPING').evidence.via).toBe('booking');
    expect(by('COMMISSION_PAID_MISMATCH').technicianId).toBe(ANNA); expect(by('COMMISSION_PAID_MISMATCH').evidence).toMatchObject({ expectedCents: 1300, paidCents: 700, differenceCents: -600 });
    expect(by('DUPLICATE_CONTACT').evidence.value).toBe('••• 7003'); expect(by('DUPLICATE_CONTACT').evidence.members.map((m: any) => m.name).sort()).toEqual(['Kevin Dang', 'Sue Park']);
    expect(JSON.stringify(by('DUPLICATE_CONTACT'))).not.toContain('5557003');
    expect(by('STALE_USER_LINK')).toMatchObject({ technicianId: OLDLINK }); expect(by('STALE_USER_LINK').evidence.userStatus).toBe('inactive');
    expect(await snapshot()).toEqual(before);
    const audit = (await q(`select action from audit_events where request_id = 'req-da-1'`)).rows.map((x: any) => x.action); expect(audit).toEqual(['team.data_alert.scan']);
  });
  it('a rescan dedupes on the fingerprint', async () => {
    const r: any = await repo.runCheck(mgr, 'req-da-2'); expect(r.detected).toBe(0); expect(r.alreadyKnown).toBe(6);
    expect((await q(`select count(*)::int as n from team_data_alerts where tenant_id = $1`, [T])).rows[0].n).toBe(6);
    expect((await repo.list(mgr, {}) as any).lastRun.status).toBe('succeeded');
  });
  it('workflow: assign → investigate → resolve, with versions, reasons, append-only events and audit; a rescan never reopens', async () => {
    const a = found.find((x) => x.type === 'ATTENDANCE_DISAGREEMENT');
    let d: any = await repo.act(mgr, a.id, 'assign', { assigneeUserId: MGR, expectedVersion: 1 }, 'req-da-3'); expect(d).toMatchObject({ status: 'ASSIGNED', version: 2 });
    await expect(repo.act(mgr, a.id, 'investigate', { expectedVersion: 1 }, 'req-da-4')).rejects.toMatchObject({ status: 409 });
    d = await repo.act(mgr, a.id, 'investigate', { expectedVersion: 2, note: 'Checking the clock' }, 'req-da-5'); expect(d.status).toBe('INVESTIGATING');
    await expect(repo.act(mgr, a.id, 'resolve', { expectedVersion: 3, note: 'no' }, 'req-da-6')).rejects.toMatchObject({ status: 422 });
    await expect(repo.act(mgr, a.id, 'reopen', { expectedVersion: 3, reason: 'Not resolved yet' }, 'req-da-7')).rejects.toMatchObject({ status: 422 });
    d = await repo.act(mgr, a.id, 'resolve', { expectedVersion: 3, note: 'Kevin had a doctor visit; manager knew' }, 'req-da-8');
    expect(d).toMatchObject({ status: 'RESOLVED', version: 4, resolutionNote: 'Kevin had a doctor visit; manager knew' }); expect(d.actions).toEqual(['note', 'reopen']);
    expect(d.history.items.map((h: any) => h.type)).toEqual(['RESOLVED', 'INVESTIGATION_STARTED', 'ASSIGNED', 'DETECTED']);
    await repo.runCheck(mgr, 'req-da-9'); expect((await repo.detail(mgr, a.id) as any).status).toBe('RESOLVED');
    d = await repo.act(mgr, a.id, 'reopen', { expectedVersion: 4, reason: 'It happened again' }, 'req-da-10'); expect(d.status).toBe('OPEN'); expect(d.resolutionNote).toBe('Kevin had a doctor visit; manager knew');
    const dm: any = await repo.act(mgr, found.find((x) => x.type === 'DUPLICATE_CONTACT').id, 'dismiss', { expectedVersion: 1, reason: 'Sisters share a family phone' }, 'req-da-11'); expect(dm.status).toBe('DISMISSED');
    const au = (await q(`select action from audit_events where request_id in ('req-da-3','req-da-5','req-da-8','req-da-10','req-da-11') order by occurred_at`)).rows.map((x: any) => x.action);
    expect(au).toEqual(['team.data_alert.assign', 'team.data_alert.investigate', 'team.data_alert.resolve', 'team.data_alert.reopen', 'team.data_alert.dismiss']);
    await expect(q(`update team_data_alert_events set reason = 'x' where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
    await expect(q(`delete from team_data_alert_events where tenant_id = $1`, [T])).rejects.toThrow(/append-only/);
    await expect(q(`delete from team_data_alerts where tenant_id = $1`, [T])).rejects.toThrow(/never deleted/);
  });
  it('permissions: front desk cannot list, run or act (the denied action is audited); amounts hidden without pay permission', async () => {
    await expect(repo.list(desk, {})).rejects.toMatchObject({ status: 403 });
    await expect(repo.runCheck(desk, 'req-da-12')).rejects.toMatchObject({ status: 403 });
    const a = found.find((x) => x.type === 'STALE_USER_LINK');
    await expect(repo.act(desk, a.id, 'resolve', { expectedVersion: 1, note: 'trying it' }, 'req-da-13')).rejects.toMatchObject({ status: 403 });
    expect((await q(`select action, status from audit_events where request_id = 'req-da-13'`)).rows).toEqual([{ action: 'team.data_alert.resolve.denied', status: 'denied' }]);
    const c: any = (await repo.list(viewer, { type: 'COMMISSION_PAID_MISMATCH' })).items[0];
    expect(c.amountsHidden).toBe(true); expect(c.evidence.paidCents).toBeNull(); expect(c.evidence.expectedCents).toBeNull();
    await expect(repo.act(viewer, a.id, 'note', { expectedVersion: 1, note: 'x' }, 'req-da-14')).rejects.toMatchObject({ status: 403 });
  });
  it('tenant isolation: the other salon sees only its own alert and gets 404 for ours', async () => {
    const r: any = await repo.runCheck(other, 'req-da-15'); expect(r.byType).toEqual({ STALE_USER_LINK: 1 });
    const l: any = await repo.list(other, { status: 'all' }); expect(l.items.map((x: any) => x.technicianId)).toEqual([T2_TECH]); expect(l.items[0].evidence.notInThisSalon).toBe(true);
    await expect(repo.detail(other, found[0].id)).rejects.toMatchObject({ status: 404 });
    await expect(repo.act(other, found[0].id, 'note', { expectedVersion: 1, note: 'hello' }, 'req-da-16')).rejects.toMatchObject({ status: 404 });
  });
});
