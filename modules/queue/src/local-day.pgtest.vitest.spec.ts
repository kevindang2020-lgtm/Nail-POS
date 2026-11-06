// local-day.pgtest — "today" on the POS and Tech App screens is the BRANCH's day, not the database's UTC day (Oct 6 2026).
//
// The clock is fixed at 9:30 pm on Monday Oct 5 in New York (01:30 UTC on Oct 6). In UTC it is already Tuesday, so every
// figure that counted from `date_trunc('day', now())` (or the server's toISOString date) showed an empty "tomorrow" from
// 8 pm on. Each test seeds one row from this New York day (10 am) and one from the day before (11 pm Sunday, which is
// Monday in UTC) and expects exactly the first — so a UTC day (no rows) and a too-wide window (both rows) both fail.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyServiceDoneRepository } from './service-done/service-done.kysely.repository';
import { KyselyServingRepository } from './serving/serving.kysely.repository';
import { KyselyTechQueueRepository } from './tech-queue/tech-queue.kysely.repository';
import { KyselyTechRepository, requestedLine } from './tech/tech.kysely.repository';
import { KyselyLiveScheduleRepository } from './live-technician-schedule/live-technician-schedule.kysely.repository';
import { LiveTechnicianScheduleService } from './live-technician-schedule/live-technician-schedule.service';

const T = 'ddddeeee-0000-4000-8000-000000000001';
const B = 'ddddeeee-0000-4000-8000-000000000002';
const B_LA = 'ddddeeee-0000-4000-8000-000000000003';
const TECH = 'ddddeeee-0000-4000-8000-000000000005';
const CUST = 'ddddeeee-0000-4000-8000-000000000006';
const TODAY_TK = 'ddddeeee-0000-4000-8000-000000000010';
const YDAY_TK = 'ddddeeee-0000-4000-8000-000000000011';
const QT = 'ddddeeee-0000-4000-8000-000000000020';
const NOW = Date.parse('2026-10-06T01:30:00Z');          // 9:30 pm Mon Oct 5 in New York; already Tue Oct 6 in UTC
const TEN_AM = '2026-10-05T14:00:00Z';                    // 10:00 am Mon, New York — today
const ELEVEN_PM_SUN = '2026-10-05T03:00:00Z';             // 11:00 pm Sun, New York — yesterday (but "Oct 5" in UTC)
const ctx = { tenantId: T, branchId: B, userId: 'u1', role: 'OWNER', permissions: ['*'] } as never;
let db: any; let pg: any;
const clocked = <R extends { now: () => number }>(r: R): R => { r.now = () => NOW; return r; };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Local Day LLC','Local Day','local-day','LDAY01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'West','active','America/Los_Angeles')`, [B, T, B_LA]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Mia','Chen','Mia Chen','active')`, [TECH, T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Day','Guest','Day Guest')`, [CUST, T, B]);
  // two paid, rated, finished tickets: one this New York day, one last night
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, serving_started_at, service_done_at, ready_checkout_at, paid_at, tip_cents, subtotal_cents, satisfaction_rating)
           values ($1,$3,$4,$8,'paid',$5, $6::timestamptz - interval '45 minutes', $6, $6, $6, 500, 4500, 4),
                  ($2,$3,$4,$8,'paid',$5, $7::timestamptz - interval '45 minutes', $7, $7, $7, 700, 9900, 1)`, [TODAY_TK, YDAY_TK, T, B, TECH, TEN_AM, ELEVEN_PM_SUN, CUST]);
  // Mia's shift today (the branch's date, Oct 5; clocked in 9 am, out 5 pm New York) and her appointments: one today, one tomorrow (which is "today" in UTC)
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-10-05','2026-10-05T13:00:00Z','2026-10-05T21:00:00Z','scheduled')`, [T, B, TECH]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
           values ($1,$2,$3,'Monday Guest',false,'manual','["Gel Manicure"]','2026-10-05','10:00','10:45',45,'confirmed','not_required'),
                  ($1,$2,$3,'Tuesday Guest',false,'manual','["Pedicure"]','2026-10-06','10:00','11:00',60,'confirmed','not_required')`, [T, B, TECH]);
  // a queue offer built from the queue's own line shape (estimatedDurationMinutes, a front-desk price change)
  await q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, customer_name, requested_services, status, assigned_technician_id, assigned_at)
           values ($1,$2,$3,'Queue Guest',$4::jsonb,'assigned',$5, now())`,
    [QT, T, B, JSON.stringify([{ serviceId: 'svc-1', serviceName: 'Gel Manicure', estimatedDurationMinutes: 45, priceCents: 4500, priceOverrideCents: 4000, overrideReason: 'loyal guest' }, { serviceId: 'svc-2', serviceName: 'Nail Art', estimatedDurationMinutes: 15, priceCents: 1000, isAddon: true, parentServiceId: 'svc-1' }]), TECH]);
});

describe('Service Done and Serving count the branch\'s day', () => {
  it('tips captured today: the 10 am ticket only — not 0 (UTC "tomorrow"), not 1200 (last night too)', async () => {
    const r = await clocked(new KyselyServiceDoneRepository(db)).query(ctx, {} as never);
    expect(r.kpis.tipsCapturedCents).toBe(500);
    expect(r.kpis.customerSatisfactionAvg).toBe(4);
  });
  it('turnaround is measured over today\'s tickets', async () => {
    const r = await clocked(new KyselyServiceDoneRepository(db)).query(ctx, {} as never);
    expect(r.kpis.averageTurnaroundSeconds).toBe(0);          // ready the moment it was done — and the row was found
    const sat = await clocked(new KyselyServingRepository(db)).query(ctx, {} as never);
    expect(sat.kpis.customerSatisfactionAvg).toBe(4);
  });
});

describe('the POS Tech Queue counts the branch\'s day and hours', () => {
  it('labor revenue and turn time today: the 10 am ticket only; the scheduled shift is the branch\'s date', async () => {
    const r: any = await clocked(new KyselyTechQueueRepository(db)).query(ctx, {} as never);
    expect(r.kpis.laborRevenueTodayCents).toBe(4500);
    expect(r.kpis.avgTurnTimeMinutes).toBe(45);
    expect(r.kpis.scheduledTechnicians).toBe(1);
    expect(r.kpis.utilizationTodayPercent).toBeGreaterThan(0); // 45 of 480 scheduled minutes — 0 when the shift was missed
  });
  it('the utilization trend runs 9 am → 4 pm New York time, the shift\'s own hours, with the 10 am service in the 9 o\'clock hour', async () => {
    const r: any = await clocked(new KyselyTechQueueRepository(db)).query(ctx, {} as never);
    const trend = (r.analytics?.utilizationTrend ?? r.utilizationTrend ?? r.analytics?.utilization ?? []) as { hour: number; percent?: number }[];
    expect(trend.map((p) => p.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe('the Tech App counts the branch\'s day', () => {
  it('today\'s schedule at 9:30 pm is still Monday\'s — not Tuesday\'s (the UTC date)', async () => {
    const rows = await new KyselyTechRepository(db).todaySchedule(ctx, TECH, NOW);
    expect(rows.map((a: any) => a.customerName)).toEqual(['Monday Guest']);
  });
  it('the LA branch at the same instant (6:30 pm Monday) is on Monday too', async () => {
    const rows = await new KyselyTechRepository(db).todaySchedule({ ...(ctx as any), branchId: B_LA }, TECH, NOW);
    expect(rows.map((a: any) => a.customerName)).toEqual(['Monday Guest']);   // a technician's day lists all their appointments
  });
  it('the dashboard\'s next appointment is Monday\'s', async () => {
    const d: any = await new KyselyTechRepository(db).dashboardRaw(ctx, TECH, NOW);
    expect(d.nextAppointment?.customerName).toBe('Monday Guest');
  });
  it('a queue offer shows the queue line\'s minutes and the front desk\'s price (was 0 minutes and the list price)', async () => {
    const t: any = await new KyselyTechRepository(db).getTicket(ctx, QT);
    expect(t.services.map((s: any) => [s.name, s.durationMinutes, s.priceCents])).toEqual([['Gel Manicure', 45, 4000], ['Nail Art', 15, 1000]]);
    expect(t.durationMinutes).toBe(60);
    expect(t.totalCents).toBe(5000);
  });
  it('older rows still read (durationMinutes / duration, price)', () => {
    expect(requestedLine({ durationMinutes: 30, priceCents: 2500 })).toEqual({ durationMinutes: 30, priceCents: 2500 });
    expect(requestedLine({ duration: 20, price: 1500 })).toEqual({ durationMinutes: 20, priceCents: 1500 });
    expect(requestedLine({ estimatedDurationMinutes: 0, priceOverrideCents: 0, priceCents: 900 })).toEqual({ durationMinutes: 0, priceCents: 0 });
    expect(requestedLine(null)).toEqual({ durationMinutes: 0, priceCents: 0 });
  });
});

describe('the live technician schedule opens on the branch\'s day and clock', () => {
  it('Main: Monday, 9:30 pm; West (Los Angeles): Monday, 6:30 pm', async () => {
    const r = clocked(new KyselyLiveScheduleRepository(db));
    expect(await r.today(ctx)).toBe('2026-10-05');
    expect(await r.nowMinutes(ctx)).toBe(21 * 60 + 30);
    expect(await r.nowMinutes({ ...(ctx as any), branchId: B_LA })).toBe(18 * 60 + 30);
  });
  it('the board for "today" lists Monday\'s appointment', async () => {
    const r = clocked(new KyselyLiveScheduleRepository(db));
    const st: any = await r.state(ctx, {} as never);
    const names = JSON.stringify(st);
    expect(names).toContain('Monday Guest');
    expect(names).not.toContain('Tuesday Guest');
  });
  it('200-technician §2 remainder: one page-state read loads the salon day ONCE (board, KPIs and filters share it); a later read loads again', async () => {
    const r: any = clocked(new KyselyLiveScheduleRepository(db));
    let loads = 0; const orig = r.loadDay.bind(r); r.loadDay = (...a: unknown[]) => { loads++; return orig(...a); };
    const svc = new LiveTechnicianScheduleService(r);
    const owner = { ...(ctx as any), permissions: ['pos.technicians.view'] };
    const page: any = await svc.pageState(owner, { lanePage: 1, lanePageSize: 12 } as never);
    expect(loads).toBe(1);
    expect(page.kpis).toBeTruthy(); expect(page.schedule.technicians.length).toBeGreaterThan(0); expect(page.filters.technicians.length).toBeGreaterThan(0);
    await svc.pageState(owner, {} as never);
    expect(loads).toBe(2);   // nothing is cached after a read settles — a write in between is always seen
  });
});
