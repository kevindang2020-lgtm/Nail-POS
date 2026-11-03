// scheduling-center.pgtest — AI Scheduling Optimizer guide (Nov 2 2026; migration 772) on the REAL migrated schema.
// SU = counters · RQ = recommendation queue (search, groups, dates, pages, stale, scope, customer visibility) · HI = history ·
// HL = Check Scheduling System (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SchedulingCenter, SchedulingCenterError, type ScEffective } from './scheduling-center';

const id = (n: number) => `77720000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5);
const OWNER = id(10), TECH = id(30), TECH2 = id(31), TECH_X = id(32);
const A1 = id(40), A2 = id(41), A3 = id(42), AX = id(43);
let pg: any; let db: any; let sc: SchedulingCenter;
let eff: ScEffective | Error = { enabled: true, killed: false, platformKilled: false, automationAllowed: false };
let ent: { allowed: boolean; reason: string; subscriptionStatus: string } = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
let customers = true; let readable = true;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['ai_scheduling.view'], ...o });
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof SchedulingCenterError ? e.code : (e as Error).message; } }
let n = 100;
async function rec(o: { t?: string; b?: string; appt?: string; tech?: string; to?: string; status?: string; ver?: number; date?: string; daysAgo?: number; expiresIn?: string | null; auto?: boolean; customer?: boolean; confirmed?: boolean; decidedBy?: string | null } = {}) {
  const R = id(++n);
  const cur = { appointmentId: o.appt ?? A1, date: o.date ?? '2026-11-03', startTime: '10:00', endTime: '11:00', technicianId: o.tech ?? TECH, status: 'booked', version: o.ver ?? 1, customerId: null };
  const prop = { kind: 'reschedule', appointmentId: o.appt ?? A1, date: o.date ?? '2026-11-03', startTime: '13:00', endTime: '14:00', technicianId: o.to ?? TECH2 };
  await q(`insert into schedule_optimization_recommendations (id, tenant_id, branch_id, type, status, current_state, proposed_state, affected_appointment_ids, affected_technician_ids, confidence,
      created_at, expires_at, automated, requires_customer_approval, touches_confirmed_appointment, decided_by_user_id)
    values ($1,$2,$3,'move_appointment',$4,$5,$6,$7,$8,0.8, now() - ($9 || ' days')::interval, ${o.expiresIn === undefined ? 'null' : o.expiresIn === null ? 'null' : `now() + interval '${o.expiresIn}'`}, $10, $11, $12, $13)`,
  [R, o.t ?? T, o.b ?? B, o.status ?? 'review_required', JSON.stringify(cur), JSON.stringify(prop), JSON.stringify([o.appt ?? A1]), JSON.stringify([o.tech ?? TECH, o.to ?? TECH2]), String(o.daysAgo ?? 0),
    !!o.auto, !!o.customer, !!o.confirmed, o.decidedBy ?? null]);
  return R;
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  sc = new SchedulingCenter(db, {
    effective: async () => { if (eff instanceof Error) throw eff; return eff; },
    entitlement: async () => ent, switchReadable: async () => readable, canSeeCustomers: () => customers,
  });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','sc-772','SC772','active'), ($2,'X','Other','sc-772x','SC772X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'North','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@sc.test','active','OWNER')`, [OWNER, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$4,$5,'Amy','A','Amy Tran',true), ($2,$4,$5,'Bea','B','Bea Ngo',true), ($3,$6,$7,'Cy','C','Cy X',true)`, [TECH, TECH2, TECH_X, T, B, X, BX]);
  await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, appt_date, start_time, end_time, duration_minutes, status, services, version) values
      ($1,$5,$6,$8,'Linh Pham','(856) 555-0142',current_date,'10:00','11:00',60,'booked','[{"name":"Gel Manicure"}]',1),
      ($2,$5,$6,$8,'Mai Do','8565550199',current_date,'12:00','13:00',60,'booked','[{"name":"Pedicure"}]',3),
      ($3,$5,$7,$8,'North Guest',null,current_date,'09:00','10:00',60,'booked','[]',1),
      ($4,$9,$10,$11,'Other Salon','8565550142',current_date,'10:00','11:00',60,'booked','[]',1)`, [A1, A2, A3, AX, T, B, B2, TECH, X, BX, TECH_X]);
});

describe('Scheduling optimizer — counters', () => {
  it('SU-01 nothing yet: counters are 0 with their definitions; no evaluation is shown as "never", not as now', async () => {
    const s: any = await sc.summary(ctx());
    expect(s.counters).toEqual({ openRecommendations: 0, awaitingCustomer: 0, automation: 'off', module: 'enabled' });
    expect(s.lastEvaluation).toBeNull();
    expect(s.definitions.openRecommendations).toBe('waiting_on_staff_not_expired');
  });
  it('SU-02 Open counts every staff-waiting state (not only review_required), never an expired one; Awaiting customer needs a live proposal', async () => {
    await rec({ status: 'review_required' });
    await rec({ status: 'accepted', appt: A2, ver: 3 });
    await rec({ status: 'needs_revision' });
    await rec({ status: 'review_required', expiresIn: '-1 hour' });            // past expiry, not swept yet
    const C1 = await rec({ status: 'customer_approval_required', customer: true });
    await rec({ status: 'customer_approval_required', customer: true });        // no proposal sent → not awaiting a customer
    await q(`insert into schedule_change_proposals (tenant_id, branch_id, recommendation_id, appointment_id, status) values ($1,$2,$3,$4,'customer_notified')`, [T, B, C1, A1]);
    await rec({ status: 'review_required', b: B2, appt: A3 });                  // another branch
    await rec({ t: X, b: BX, appt: AX, tech: TECH_X, to: TECH_X });            // another salon
    const s: any = await sc.summary(ctx());
    expect(s.counters.openRecommendations).toBe(3);
    expect(s.counters.awaitingCustomer).toBe(1);
    expect(s.more.pastExpiry).toBe(1);
    const all: any = await sc.summary(ctx({ branchId: null }));                 // a salon-wide session sees both branches
    expect(all.counters.openRecommendations).toBe(4);
  });
  it('SU-03 Automatic optimization and Module are the EFFECTIVE state, split into parts; an unreadable setting is "unknown", never "Off"', async () => {
    eff = { enabled: true, killed: true, platformKilled: false, automationAllowed: false };
    expect((await sc.summary(ctx()) as any).counters).toMatchObject({ automation: 'emergency_stopped', module: 'emergency_stopped' });
    eff = { enabled: true, killed: false, platformKilled: false, automationAllowed: true };
    ent = { allowed: false, reason: 'trial_expired', subscriptionStatus: 'trialing' };
    const s: any = await sc.summary(ctx());
    expect(s.counters).toMatchObject({ automation: 'on', module: 'subscription_restricted' });
    expect(s.moduleParts.subscription).toEqual({ allowed: false, reason: 'trial_expired', status: 'trialing' });
    eff = new Error('db');
    expect((await sc.summary(ctx()) as any).counters).toMatchObject({ automation: 'unknown', module: 'unknown' });
    eff = { enabled: true, killed: false, platformKilled: false, automationAllowed: false }; ent = { allowed: true, reason: 'ok', subscriptionStatus: 'active' };
  });
  it('SU-04 last evaluation is the last COMPLETED run (the worker\'s time), and open conflicts are counted', async () => {
    const RUN = id(900);
    await q(`insert into schedule_optimization_runs (id, tenant_id, branch_id, scope, status, completed_at, run_date, run_trigger, gap_count, conflict_count, started_at)
      values ($1,$2,$3,'branch_day','completed', now() - interval '2 hours', current_date, 'job', 2, 1, now() - interval '2 hours'),
             ($4,$2,$3,'branch_day','failed', null, current_date, 'manual', 0, 0, now() - interval '5 minutes')`, [RUN, T, B, id(901)]);
    await q(`insert into schedule_conflicts (tenant_id, branch_id, type, severity, run_id, conflict_date) values ($1,$2,'double_booking','critical',$3,current_date)`, [T, B, RUN]);
    const s: any = await sc.summary(ctx());
    expect(s.lastEvaluation.runId).toBe(RUN);
    expect(s.moduleParts.lastRun.status).toBe('failed');
    expect(s.more.openConflicts).toBe(1);
    expect(s.more.gaps).toBe(2);
  });
});

describe('Scheduling optimizer — recommendation queue', () => {
  it('RQ-01 newest first with total and numbered pages; the session branch only; another salon never', async () => {
    const r: any = await sc.recommendations(ctx(), { pageSize: '10' });
    expect(r.total).toBe(6);
    expect(r.items.every((x: any) => x.branch === 'Main')).toBe(true);
    const times = r.items.map((x: any) => x.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const p2: any = await sc.recommendations(ctx(), { pageSize: '10', page: '2' });
    expect(p2.items).toHaveLength(0);
    expect(p2.page).toBe(2);
    expect((await sc.recommendations(ctx(), { pageSize: '7' }) as any).pageSize).toBe(25);   // only 10 / 25 / 50 / 100
  });
  it('RQ-02 groups: open excludes expired; customer; stale = the appointment moved since the suggestion', async () => {
    expect((await sc.recommendations(ctx(), { group: 'open' }) as any).total).toBe(3);
    expect((await sc.recommendations(ctx(), { group: 'customer' }) as any).total).toBe(2);
    await q(`update pos_tech_appointments set version = 2 where id = $1`, [A1]);
    const st: any = await sc.recommendations(ctx(), { group: 'stale' });
    expect(st.total).toBe(5);                                                     // every live A1 row; the A2 row still matches version 3
    expect(st.items.every((x: any) => x.stale)).toBe(true);
    await q(`update pos_tech_appointments set version = 1 where id = $1`, [A1]);
    expect((await sc.recommendations(ctx(), { group: 'stale' }) as any).total).toBe(0);
  });
  it('RQ-03 search: technician, service, appointment id, recommendation id prefix; customer name / phone only with customers.view', async () => {
    expect((await sc.recommendations(ctx(), { q: 'Bea' }) as any).total).toBe(6);           // the proposed technician
    expect((await sc.recommendations(ctx(), { q: 'pedicure' }) as any).total).toBe(1);
    expect((await sc.recommendations(ctx(), { q: A2 }) as any).total).toBe(1);
    const one: any = (await sc.recommendations(ctx(), { q: 'pedicure' }) as any).items[0];
    expect((await sc.recommendations(ctx(), { q: one.id.slice(0, 13) }) as any).items.map((x: any) => x.id)).toContain(one.id);
    expect((await sc.recommendations(ctx(), { q: 'Mai Do' }) as any).total).toBe(1);
    const ph: any = await sc.recommendations(ctx(), { q: '555-0142' });
    expect(ph.total).toBe(5);                                                     // A1's phone; the other salon's same number never
    expect(ph.items[0].customer).toBe('Linh Pham');
    expect(ph.items[0].customerPhoneLast4).toBe('0142');
    customers = false;
    const hidden: any = await sc.recommendations(ctx(), { q: 'Mai Do' });
    expect(hidden.total).toBe(0);
    expect((await sc.recommendations(ctx(), {}) as any).items.every((x: any) => x.customer === null && x.customerPhoneLast4 === null)).toBe(true);
    customers = true;
  });
  it('RQ-04 dates: which date the filter means; presets in the salon zone; From after To is refused', async () => {
    await rec({ status: 'rejected', daysAgo: 40, date: '2026-09-20' });
    expect((await sc.recommendations(ctx(), { preset: 'last_30' }) as any).total).toBe(6);
    expect((await sc.recommendations(ctx(), {}) as any).total).toBe(7);
    expect((await sc.recommendations(ctx(), { dateField: 'appointment', from: '2026-09-01', to: '2026-09-30' }) as any).total).toBe(1);
    expect(await code(sc.recommendations(ctx(), { from: '2026-10-05', to: '2026-10-01' }))).toBe('SC_INVALID_PERIOD');
    expect(await code(sc.recommendations(ctx(), { preset: 'custom', from: 'x' }))).toBe('SC_INVALID_PERIOD');
  });
});

describe('Scheduling optimizer — history', () => {
  it('HI-01 append-only trail: generated + each decision edge, classified staff / customer / apply, newest first, actor named', async () => {
    const R = (await sc.recommendations(ctx(), { q: 'pedicure' }) as any).items[0].id;
    await q(`insert into schedule_recommendation_decisions (tenant_id, recommendation_id, action, actor_user_id, reason, after_snapshot, created_at) values
      ($1,$2,'start_review',$3,null,'{"status":"review_in_progress"}', now() + interval '1 second'),
      ($1,$2,'accept',$3,'fits the gap','{"status":"accepted"}', now() + interval '2 seconds'),
      ($1,$2,'customer_approve',null,null,'{"status":"customer_approved"}', now() + interval '3 seconds'),
      ($1,$2,'apply_fail',$3,'STALE_SCHEDULE','{"status":"application_failed"}', now() + interval '4 seconds')`, [T, R, OWNER]);
    const h: any = await sc.history(ctx(), {});
    expect(h.items.slice(0, 4).map((x: any) => [x.kind, x.action])).toEqual([['apply', 'apply_fail'], ['customer', 'customer_approve'], ['staff', 'accept'], ['staff', 'start_review']]);
    expect(h.items[2]).toMatchObject({ actor: 'Owner Kim', reason: 'fits the gap', outcome: 'accepted' });
    expect(h.items[1].actor).toBe('customer');
    expect((await sc.history(ctx(), { kind: 'generated' }) as any).total).toBe(7);
    expect((await sc.history(ctx(), { q: 'owner kim' }) as any).total).toBe(3);
    expect((await sc.history(ctx(), { q: R.slice(0, 8) }) as any).total).toBeGreaterThanOrEqual(5);
    expect((await sc.history(ctx({ branchId: B2 }), { kind: 'staff' }) as any).total).toBe(0);   // another branch's trail is not here
  });
});

describe('Scheduling optimizer — Check Scheduling System', () => {
  it('HL-01 read-only evidence; the core rules FAIL when broken; reused within 30 s; nothing else written', async () => {
    const before = (await q(`select count(*)::int as n from schedule_optimization_recommendations`))[0].n;
    // an applied change with no staff decision and no customer approval, applied automatically to a confirmed booking
    await rec({ status: 'applied', customer: true, confirmed: true, auto: false });
    await rec({ status: 'applied', auto: true, confirmed: true, decidedBy: OWNER });
    readable = false;
    const r: any = await sc.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(r.overall).toBe('FAILED');
    expect(by.apply_needs_staff_decision.state).toBe('FAILED');
    expect(by.apply_needs_customer_approval.state).toBe('FAILED');
    expect(by.no_silent_confirmed_change.state).toBe('FAILED');
    expect(by.platform_switch_readable.state).toBe('FAILED');
    expect(by.expiry_sweep.state).toBe('WARNING');
    expect(by.open_conflicts.state).toBe('WARNING');
    expect(by.applied_has_booking_record.state).toBe('WARNING');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.booking_source.state).toBe('PASSED');
    expect(by.subscription.state).toBe('PASSED');
    expect(r.checks[0].state).toBe('FAILED');                                     // failures first
    const again: any = await sc.check(ctx());
    expect(again.reused).toBe(true);
    expect(again.id).toBe(r.id);
    expect((await q(`select count(*)::int as n from schedule_optimization_recommendations`))[0].n).toBe(before + 2);   // only the seeded rows
    expect((await q(`select count(*)::int as n from scheduling_optimizer_health_runs where tenant_id = $1`, [T]))[0].n).toBe(1);
    readable = true;
  });
  it('HL-02 tenant isolation FAILS when a suggestion points at another salon\'s appointment', async () => {
    await q(`delete from scheduling_optimizer_health_runs`);
    await rec({ appt: AX });
    const r: any = await sc.check(ctx());
    expect(r.checks.find((c: any) => c.key === 'tenant_isolation')).toMatchObject({ state: 'FAILED', count: 1 });
  });
});
