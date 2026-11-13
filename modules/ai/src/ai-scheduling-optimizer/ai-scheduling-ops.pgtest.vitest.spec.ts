// ai-scheduling-ops.pgtest — BUILD_PLAN Phase 7 (agent B): the operations half's SQL against the real migrated schema
// (528 included): proposals (one live per recommendation, CAS, the customer's own rows only), usage, insights (supersede,
// CAS decisions, history samples, coverage inputs), the automation applier (only open + appointment-free rows), the owner
// / technician / export reads, and TENANT ISOLATION — a second salon's rows never appear, and a cross-tenant id never
// matches.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { KyselyProposalStore, ScheduleProposalService } from './ai-scheduling-proposals';
import { KyselyUsageStore, SchedUsageService } from './ai-scheduling-usage';
import { KyselyInsightStore, SchedInsightService, dayInsights, hourlyCoverage, categoryCoverage } from './ai-scheduling-insights';
import { KyselyAutomationApplier } from './ai-scheduling-automation';
import { KyselyOwnerSummaryRead } from './ai-scheduling-owner';
import { KyselyTechChangeRead } from './ai-scheduling-tech';
import { KyselyExportRead } from './ai-scheduling-export';
import { KyselyPlatformFlagsReader } from './ai-scheduling-ops.platform-switch';
import { dispatchSchedJobs, SCHED_JOB } from './ai-scheduling-jobs';
import { schedSystemCtx } from './ai-scheduling-ops.common';

const id = (n: number) => `77777777-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), T2 = id(3), B2 = id(4);
const USER = id(10), USER2 = id(11), CUST = id(20), CUST2 = id(21), TECH = id(30), TECH2 = id(31), TECH_T2 = id(32);
const APPT = id(40), APPT_T2 = id(41), REC = id(50), REC2 = id(51), REC_T2 = id(52), REC_AUTO = id(53), SVC = id(60), CAT = id(61);
let pg: any; let db: any;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];

async function seedRec(recId: string, tenantId: string, branchId: string, over: Record<string, unknown> = {}) {
  const o: any = { type: 'move_appointment', status: 'customer_approval_required', current: { appointmentId: APPT, date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: TECH, customerId: CUST, status: 'booked', version: 1 },
    proposed: { kind: 'reschedule', appointmentId: APPT, date: '2026-10-20', startTime: '13:00', endTime: '14:00', technicianId: TECH2 }, affectedAppts: [APPT], affectedTechs: [TECH, TECH2], ...over };
  await q(`insert into schedule_optimization_recommendations (id, tenant_id, branch_id, type, status, current_state, proposed_state, affected_appointment_ids, affected_technician_ids, confidence)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0.9)`, [recId, tenantId, branchId, o.type, o.status, o.current ? JSON.stringify(o.current) : null, o.proposed ? JSON.stringify(o.proposed) : null, JSON.stringify(o.affectedAppts), JSON.stringify(o.affectedTechs)]);
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  for (const [t, code] of [[T, 'OPSB1'], [T2, 'OPSB2']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', 'Salon ${code}', 'Salon ${code}', 'salon-${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York'), ('${B2}', '${T2}', 'Other', 'active', 'America/New_York')`);
  await pg.exec(`INSERT INTO users (id, tenant_id, role, email) VALUES ('${USER}', '${T}', 'CUSTOMER', 'c1@x.test'), ('${USER2}', '${T2}', 'CUSTOMER', 'c2@x.test')`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id, normalized_phone) VALUES
      ('${CUST}', '${T}', '${B}', 'Ann', 'Lee', 'Ann Lee', '${USER}', '+18565550100'), ('${CUST2}', '${T2}', '${B2}', 'Bo', 'Kim', 'Bo Kim', '${USER2}', '+18565550101')`);
  await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, user_id, is_active) VALUES
      ('${TECH}', '${T}', '${B}', 'Amy', 'A', 'Amy A', null, true), ('${TECH2}', '${T}', '${B}', 'Bea', 'B', 'Bea B', null, true), ('${TECH_T2}', '${T2}', '${B2}', 'Cy', 'C', 'Cy C', null, true)`);
  await pg.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services) VALUES
      ('${APPT}', '${T}', '${B}', '${TECH}', '${CUST}', 'Ann Lee', '2026-10-20', '10:00', '11:00', 60, 'booked', '[{"name":"Gel Manicure"}]'),
      ('${APPT_T2}', '${T2}', '${B2}', '${TECH_T2}', '${CUST2}', 'Bo Kim', '2026-10-20', '10:00', '11:00', 60, 'booked', '[]')`);
  await seedRec(REC, T, B); await seedRec(REC2, T, B); await seedRec(REC_T2, T2, B2, { current: { appointmentId: APPT_T2, date: '2026-10-20', startTime: '10:00', technicianId: TECH_T2, customerId: CUST2 }, proposed: { appointmentId: APPT_T2, date: '2026-10-20', startTime: '12:00', technicianId: TECH_T2 }, affectedTechs: [TECH_T2] });
});

const rec = (recId: string): SchedRecommendation => ({
  id: recId, branchId: B, runId: null, type: 'move_appointment', status: 'customer_approval_required',
  currentState: { appointmentId: APPT, date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: TECH, status: 'booked', version: 1, customerId: CUST },
  proposedState: { kind: 'reschedule', appointmentId: APPT, date: '2026-10-20', startTime: '13:00', endTime: '14:00', technicianId: TECH2 },
  affectedAppointmentIds: [APPT], affectedTechnicianIds: [TECH, TECH2], hardConstraintsChecked: true, violations: [], simulation: null, expectedBenefit: [], possibleDownside: [],
  confidence: 0.9, dataQuality: 'good', touchesConfirmedAppointment: true, requiresCustomerApproval: true, versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 1 },
  version: 1, applyAttempt: 0, automated: false, expiresAt: null, explanation: null, explanationSource: null, proposal: null, decidedByUserId: null, decidedAt: null, appliedAt: null, createdAt: '', updatedAt: '',
});
const staff = { tenantId: T, branchId: B, userId: id(90), role: 'MANAGER', permissions: ['ai_scheduling.view'], actor: 'user' as const };

describe('proposals (Kysely)', () => {
  const sent: any[] = [];
  const engine: any = { effectiveConfig: async () => ({ config: { proposalTtlHours: 24 } }), customerDecided: async () => ({}), get: async () => ({ recommendation: rec(REC) }) };
  const svc = () => new ScheduleProposalService(new KyselyProposalStore(db), engine, { sendSms: async (r: any) => { sent.push(r); return { sent: true, status: 'sent' }; } }, null);

  it('open: one live row per recommendation (unique index), wall clock stored as instants in the branch zone, customer texted', async () => {
    const s = await svc().open(staff, rec(REC));
    expect(s).toMatchObject({ status: 'customer_notified', originalDate: '2026-10-20', originalStartTime: '10:00', proposedStartTime: '13:00', customerId: CUST });
    const rows = await q(`select * from schedule_change_proposals where tenant_id = $1 and recommendation_id = $2`, [T, REC]);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].original_start).toISOString()).toBe('2026-10-20T14:00:00.000Z');
    expect(rows[0]).toMatchObject({ original_preserved: true, notification_attempts: 1, version: 2, customer_id: CUST });
    expect(sent[0]).toMatchObject({ to: '+18565550100', tenantId: T });
    await svc().open(staff, rec(REC));
    expect(await q(`select count(*)::int n from schedule_change_proposals where recommendation_id = $1`, [REC])).toEqual([{ n: 1 }]);
    // a direct second insert is refused by the partial unique index → the store answers null
    expect(await new KyselyProposalStore(db).insert({ tenantId: T, branchId: B, recommendationId: REC, appointmentId: APPT, customerId: CUST, status: 'proposed', proposedStart: null, proposedEnd: null, proposedTechnicianId: null, originalStart: null, originalTechnicianId: null, expiresAt: null })).toBeNull();
  });
  it('the customer sees only their own; another salon\'s customer cannot see or decide it', async () => {
    const mine = await svc().listForCustomer({ tenantId: T, userId: USER });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({ salonName: 'Salon OPSB1', branchName: 'Main', services: ['Gel Manicure'], original: { technicianName: 'Amy' }, proposed: { technicianName: 'Bea' } });
    await expect(svc().listForCustomer({ tenantId: T, userId: USER2 })).rejects.toMatchObject({ code: 'FORBIDDEN' });   // USER2 has no customer in T
    expect((await svc().listForCustomer({ tenantId: T2, userId: USER2 })).items).toEqual([]);
    await expect(svc().customerDecide({ tenantId: T2, userId: USER2 }, mine.items[0].id, true, mine.items[0].version)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('CAS: a stale version changes nothing; the right one decides once', async () => {
    const p = (await svc().listForCustomer({ tenantId: T, userId: USER })).items[0];
    await expect(svc().customerDecide({ tenantId: T, userId: USER }, p.id, true, p.version - 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const d = await svc().customerDecide({ tenantId: T, userId: USER }, p.id, true, p.version);
    expect(d.status).toBe('customer_approved');
    const row = (await q(`select * from schedule_change_proposals where id = $1`, [p.id]))[0];
    expect(row).toMatchObject({ status: 'customer_approved', decision_channel: 'customer_web', version: p.version + 1 });
    await expect(svc().customerDecide({ tenantId: T, userId: USER }, p.id, false, p.version + 1)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await svc().markApplied(staff, REC);
    expect((await q(`select status from schedule_change_proposals where id = $1`, [p.id]))[0].status).toBe('applied');
  });
  it('expireLive only touches the tenant\'s own live rows past their TTL', async () => {
    const store = new KyselyProposalStore(db);
    await svc().open(staff, rec(REC2));
    await q(`update schedule_change_proposals set expires_at = now() - interval '1 minute' where recommendation_id = $1`, [REC2]);
    expect(await store.expireLive(T2, new Date().toISOString())).toEqual([]);
    expect((await store.expireLive(T, new Date().toISOString())).map((p) => p.recommendationId)).toEqual([REC2]);
    expect(await store.live(T, REC2)).toBeNull();
    expect(await store.get(T2, (await store.latestByRec(T, [REC2]))[0].id)).toBeNull();     // never across tenants
  });
  it('tenant scope holds even for a forged row: another salon\'s proposal naming this customer, another salon\'s appointment', async () => {
    const store = new KyselyProposalStore(db);
    await q(`insert into schedule_change_proposals (tenant_id, branch_id, recommendation_id, appointment_id, customer_id, status) values ($1,$2,$3,$4,$5,'proposed')`, [T2, B2, REC_T2, APPT_T2, CUST]);
    expect((await store.forCustomer(T, CUST)).every((p) => p.tenantId === T)).toBe(true);
    expect((await store.contact(T, null, APPT_T2, [TECH_T2]))).toMatchObject({ phone: null, services: [], technicianNames: {} });
    await q(`delete from schedule_change_proposals where tenant_id = $1`, [T2]);
  });
});

describe('usage + platform flags (Kysely)', () => {
  it('writes ai_usage_logs under the package and summarises per tenant', async () => {
    const u = new SchedUsageService(new KyselyUsageStore(db));
    await u.record(staff, 'optimization_run');
    await u.record(staff, 'explanation', { model: 'm' });
    await u.record({ ...staff, tenantId: T2 }, 'explanation');
    const rows = await q(`select action, usage_amount, package_code, usage_unit from ai_usage_logs where tenant_id = $1 order by action`, [T]);
    expect(rows).toEqual([{ action: 'explanation', usage_amount: 0, package_code: 'ai_scheduling_optimizer', usage_unit: 'runs' }, { action: 'optimization_run', usage_amount: 1, package_code: 'ai_scheduling_optimizer', usage_unit: 'runs' }]);
    const s = await u.summary({ ...staff, permissions: ['ai_scheduling.view'] }, {});
    expect(s.explanations).toBe(1);
  });
  it('reads the platform switches', async () => {
    expect(await new KyselyPlatformFlagsReader(db).read()).toEqual({ optimizerKilled: false, autoActionsDisabled: false });
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type, version) values ('ai.scheduling_optimizer_disabled', 'kill_switches', 'true'::jsonb, 'boolean', 1)`);
    expect((await new KyselyPlatformFlagsReader(db).read()).optimizerKilled).toBe(true);
    await q(`delete from platform_settings where setting_key = 'ai.scheduling_optimizer_disabled'`);
  });
});

describe('insights (Kysely)', () => {
  it('duration: history from completed service lines → stats + a suggestion; a re-run does not duplicate; approve CAS + supersede', async () => {
    await pg.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails') ON CONFLICT DO NOTHING`).catch(() => undefined);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel',30,4000)`, [SVC, T, B, CAT]);
    const ticket = id(70);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id) values ($1,$2,$3,$4)`, [ticket, T, B, CUST]);
    for (let i = 0; i < 12; i++) {
      await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, started_at, completed_at)
               values ($1,$2,$3,$4,$5,'Gel',4000,30,4000, now() - interval '2 days', now() - interval '2 days' + interval '50 minutes')`, [T, B, ticket, SVC, TECH]);
    }
    const svc = new SchedInsightService(new KyselyInsightStore(db), null);
    const sys = schedSystemCtx(T, null, 'test', ['ai_scheduling.view']);
    expect(await svc.generateDurations(sys)).toEqual({ keys: 2, suggestions: 2 });
    expect(await svc.generateDurations(sys)).toEqual({ keys: 2, suggestions: 0 });                 // same suggestion → not duplicated
    expect(await q(`select count(*)::int n from service_duration_statistics where tenant_id = $1`, [T])).toEqual([{ n: 2 }]);
    const mgr = { ...staff, permissions: ['ai_scheduling.view', 'ai_scheduling.approve'] };
    const list = await svc.list(mgr, { kind: 'duration' });
    expect(list.items).toHaveLength(2);
    expect(list.items.every((i: any) => i.suggestedMin === 50 && i.currentMin === 30 && i.sampleSize === 12)).toBe(true);
    // Service Duration Confidence (extras 06): each suggestion carries the observed spread of ITS key (all 50 min → steady)
    expect(list.items.map((i: any) => i.observed)).toEqual([0, 1].map(() => ({ sampleSize: 12, medianMin: 50, p25Min: 50, p75Min: 50, p90Min: 50, stddevMin: 0, variability: 'steady', spreadPct: 0 })));
    expect((await svc.list({ ...mgr, tenantId: T2, branchId: B2 }, {})).items).toEqual([]);
    const one = list.items[0];
    await expect(svc.decide(mgr, 'duration', one.id, true, { expectedVersion: one.version + 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(svc.decide({ ...mgr, tenantId: T2, branchId: B2 }, 'duration', one.id, true, { expectedVersion: one.version })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const ok = await svc.decide(mgr, 'duration', one.id, true, { expectedVersion: one.version });
    expect(ok).toMatchObject({ status: 'approved', version: one.version + 1 });
    // the engine now uses 50 for that key → the next run suggests nothing new for it
    const cur = await new KyselyInsightStore(db).currentDurations(T);
    expect(cur.approved).toHaveLength(1);
  });
  it('coverage inputs: scheduled minutes minus lunch, booked minutes, unscheduled technicians', async () => {
    const dow = new Date('2026-10-20T00:00:00Z').getUTCDay();
    await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00','12:00','12:30',true)`, [T, B, TECH, dow]);
    const d = await new KyselyInsightStore(db).dayInputs(T, B, '2026-10-20');
    expect(d).toMatchObject({ capacityMin: 450, confirmedMin: 60, unscheduledTechnicianIds: [TECH2] });
    expect((await new KyselyInsightStore(db).dayInputs(T2, B, '2026-10-20')).capacityMin).toBe(0);   // never another salon's schedule
    const s = new KyselyInsightStore(db);
    const first = await s.upsertStaffing(T, { branchId: B, date: '2026-10-21', state: 'understaffed', missingMinutes: 90, missingSkills: [], action: 'x', confidence: 0.8 });
    expect(first).toBeTruthy();
    expect(await s.upsertStaffing(T, { branchId: B, date: '2026-10-21', state: 'understaffed', missingMinutes: 90, missingSkills: [], action: 'x', confidence: 0.8 })).toBeNull();
    await s.upsertStaffing(T, { branchId: B, date: '2026-10-21', state: 'severely_understaffed', missingMinutes: 200, missingSkills: [], action: 'y', confidence: 0.8 });
    expect((await q(`select status from staffing_coverage_recommendations where id = $1`, [first]))[0].status).toBe('superseded');
    expect(await s.upsertAvailability(T, { branchId: B, date: '2026-10-21', direction: 'open', technicianId: TECH2, reason: 'r', confidence: 0.7 })).toBeTruthy();
  });
});

describe('automation applier (Kysely)', () => {
  it('only an open, appointment-free row at the expected version becomes applied + automated, with a decision row', async () => {
    await seedRec(REC_AUTO, T, B, { type: 'open_availability', status: 'review_required', current: null, proposed: null, affectedAppts: [], affectedTechs: [] });
    const a = new KyselyAutomationApplier(db);
    const r = { ...rec(REC_AUTO), status: 'review_required' as const, version: 1 };
    expect(await a.markAutomated({ ...staff, tenantId: T2 }, r, 'open_empty_slot')).toBe(false);     // another tenant: no match
    expect(await a.markAutomated(staff, { ...r, version: 9 }, 'open_empty_slot')).toBe(false);     // stale version
    expect(await a.markAutomated(staff, rec(REC2), 'open_empty_slot')).toBe(false);                // not open
    const REC_MOVE = id(54);
    await seedRec(REC_MOVE, T, B, { type: 'open_availability', status: 'review_required' });
    expect(await a.markAutomated(staff, { ...rec(REC_MOVE), status: 'review_required', version: 1 }, 'open_empty_slot')).toBe(false);   // moves an appointment: never, whatever the caller says
    expect((await q(`select status from schedule_optimization_recommendations where id = $1`, [REC_MOVE]))[0].status).toBe('review_required');
    expect(await a.markAutomated(staff, r, 'open_empty_slot')).toBe(true);
    expect((await q(`select status, automated, version from schedule_optimization_recommendations where id = $1`, [REC_AUTO]))[0]).toEqual({ status: 'applied', automated: true, version: 2 });
    expect(await q(`select action, actor_user_id from schedule_recommendation_decisions where recommendation_id = $1`, [REC_AUTO])).toEqual([{ action: 'auto_applied', actor_user_id: null }]);
    expect(await a.markAutomated(staff, r, 'open_empty_slot')).toBe(false);                         // already applied
  });
});

describe('owner / technician / export reads (Kysely)', () => {
  it('owner: one row per active location of THIS salon with open / applied / automated / proposals', async () => {
    const rows = await new KyselyOwnerSummaryRead(db).branches(T, new Date(Date.now() - 7 * 86400_000).toISOString());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ branchId: B, name: 'Main', automated: 1, applied: 1, utilizationPct: null, lastRunAt: null });
    expect(rows[0].openRecommendations).toBeGreaterThanOrEqual(1);
  });
  it('technician: only changes touching them, on the date, first name only; another salon never', async () => {
    await q(`update technicians set user_id = $1 where id = $2`, [USER, TECH2]);
    const read = new KyselyTechChangeRead(db);
    expect(await read.technicianFor(T, USER)).toBe(TECH2);
    expect(await read.technicianFor(T2, USER)).toBeNull();
    const ch = await read.changes(T, TECH2, '2026-10-20');
    expect(ch.map((c) => c.id).sort()).toEqual([REC, REC2, id(54)].sort());   // id(54): the review_required move seeded by the applier test
    expect(ch[0].customerFirstName).toBe('Ann');
    expect(await read.changes(T, TECH2, '2026-10-21')).toEqual([]);
    expect(await read.changes(T2, TECH2, '2026-10-20')).toEqual([]);
  });
  it('export: tenant (and location) scoped rows', async () => {
    const r = new KyselyExportRead(db);
    const from = new Date(Date.now() - 86400_000).toISOString(), to = new Date(Date.now() + 86400_000).toISOString();
    const mine = await r.rows('recommendations', T, B, from, to, 100);
    expect(mine.rows.map((x) => x[0])).not.toContain(REC_T2);
    expect(mine.rows.length).toBeGreaterThanOrEqual(3);
    expect((await r.rows('recommendations', T, B2, from, to, 100)).rows).toEqual([]);
    const ins = await r.rows('insights', T, null, from, to, 100);
    expect(ins.rows.map((x) => x[0])).toEqual(expect.arrayContaining(['duration', 'staffing', 'availability']));
    expect((await r.rows('runs', T, null, from, to, 100)).header[0]).toBe('run_id');
  });
});

describe('job dispatch (Kysely)', () => {
  it('enqueues a daily scan per location of an ENTITLED, enabled salon only; once per day; expiry per salon with due rows', async () => {
    await q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status) values ($1, 'ai_scheduling_optimizer', 'active')`, [T]);
    await q(`update schedule_optimization_recommendations set expires_at = now() - interval '1 minute' where id = $1`, [REC_T2]);
    const now = Date.now();
    const r1 = await dispatchSchedJobs(db, now);
    expect(r1).toMatchObject({ scans: 1, insights: 1, platformKilled: false });
    expect(r1.sweeps).toBe(1);
    const jobs = await q(`select job_type, tenant_id, payload from jobs where job_type like 'ai.scheduling.%' order by job_type`);
    expect(jobs.filter((j) => j.job_type === SCHED_JOB.branchScan)).toEqual([{ job_type: SCHED_JOB.branchScan, tenant_id: T, payload: { branchId: B } }]);
    expect(jobs.filter((j) => j.job_type === SCHED_JOB.expirySweep).map((j) => j.tenant_id)).toEqual([T2]);
    expect(await dispatchSchedJobs(db, now)).toMatchObject({ scans: 0, insights: 0, sweeps: 0 });
    // switched off at salon level → no scan
    await q(`insert into tenant_scheduling_ai_settings (tenant_id, level, enabled) values ($1, 'tenant', false)`, [T]);
    expect((await dispatchSchedJobs(db, now + 86400_000)).scans).toBe(0);
  });
});

// extras 200-Technician 06 — Technician Skill Coverage: a service booked for a day that no SCHEDULED, active technician is
// approved for (technician_services) becomes a staffing suggestion for review even when total hours are enough — named on
// the suggestion, no hours action invented, nothing assigned or changed; another salon's data never counts.
describe('skill coverage (extras 200-Technician 06)', () => {
  it('a booked service nobody on the schedule may do is a reviewable gap; covered services are not; a re-run does not duplicate', async () => {
    const SVC_X = id(62), APPT_X = id(42), DATE = '2026-10-22';
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Acrylic Full Set',60,6000)`, [SVC_X, T, B, CAT]);
    await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4), ($1,$2,$5,$6)`, [T, B, TECH, SVC, TECH2, SVC_X]);   // only Bea does acrylic — and she is not scheduled
    await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','19:00',true)`, [T, B, TECH, new Date(DATE + 'T00:00:00Z').getUTCDay()]);
    await q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services) values ($1,$2,$3,$4,$5,'Ann Lee',$6,'10:00','11:30',90,'booked',$7::jsonb)`,
      [APPT_X, T, B, TECH, CUST, DATE, JSON.stringify([{ serviceId: SVC, serviceName: 'Gel' }, { serviceId: SVC_X, serviceName: 'Acrylic Full Set' }])]);
    const s = new KyselyInsightStore(db);
    const d = await s.dayInputs(T, B, DATE);
    expect([...d.bookedServices!].sort()).toEqual(['Acrylic Full Set', 'Gel']);
    expect(d.coveredServices).toEqual(['Gel']);
    const out = dayInsights(d);
    expect(d.capacityMin).toBeGreaterThan(d.confirmedMin);                 // hours are enough…
    expect(out.staffing).toMatchObject({ missingSkills: ['Acrylic Full Set'], missingMinutes: 0 });   // …but acrylic has nobody
    const before = (await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, TECH2]))[0].n;
    const first = await s.upsertStaffing(T, { branchId: B, date: DATE, state: out.staffing!.state, missingMinutes: 0, missingSkills: out.staffing!.missingSkills, action: null, confidence: out.staffing!.confidence });
    expect(first).toBeTruthy();
    expect(await s.upsertStaffing(T, { branchId: B, date: DATE, state: out.staffing!.state, missingMinutes: 0, missingSkills: ['Acrylic Full Set'], action: null, confidence: 0.5 })).toBeNull();
    const row = (await q(`select missing_skills, recommended_action, status from staffing_coverage_recommendations where id = $1`, [first]))[0];
    expect(row).toMatchObject({ missing_skills: ['Acrylic Full Set'], recommended_action: null, status: 'review_required' });
    expect((await q(`select count(*)::int n from pos_tech_appointments where tenant_id = $1 and technician_id = $2`, [T, TECH2]))[0].n).toBe(before);   // nothing assigned
    // once Amy is approved for acrylic too, the day is covered
    await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, TECH, SVC_X]);
    const d2 = await s.dayInputs(T, B, DATE);
    expect([...d2.coveredServices!].sort()).toEqual(['Acrylic Full Set', 'Gel']); expect(dayInsights(d2).staffing).toBeNull();
    expect((await s.dayInputs(T2, B2, DATE)).bookedServices).toEqual([]);   // another salon never sees these bookings
  });
});

describe('round 10 — AI Scheduling Optimizer 05 · 11: coverage by hour and by service category', () => {
  it('pure: per hour = booked minutes in the hour vs scheduled minutes (lunch removed), same rule as the day; per category = qualified technicians only', () => {
    const shifts = [{ technicianId: 'a', startMin: 540, endMin: 720, lunchStartMin: 600, lunchEndMin: 630 }, { technicianId: 'b', startMin: 600, endMin: 720, lunchStartMin: null, lunchEndMin: null }];
    const bookings = [{ startMin: 540, endMin: 600, services: [{ serviceId: 'gel', minutes: 60 }] }, { startMin: 600, endMin: 720, services: [{ serviceId: 'gel', minutes: 60 }, { serviceId: 'lash', minutes: 60 }] }, { startMin: 600, endMin: 660, services: [{ serviceId: 'lash', minutes: 60 }] }];
    const h = hourlyCoverage(shifts, bookings);
    expect(h.map((x) => [x.hour, x.demandMinutes, x.capacityMinutes, x.state])).toEqual([[9, 60, 60, 'slightly_understaffed'], [10, 120, 90, 'severely_understaffed'], [11, 60, 120, 'adequately_staffed']]);
    const c = categoryCoverage(shifts, bookings, { gel: 'Nails', lash: 'Lashes' }, { gel: ['a', 'b'], lash: ['b'] });
    expect(c).toEqual([
      { category: 'Lashes', demandMinutes: 120, capacityMinutes: 120, qualifiedTechnicians: 1, state: 'slightly_understaffed', missingMinutes: 0 },
      { category: 'Nails', demandMinutes: 120, capacityMinutes: 270, qualifiedTechnicians: 2, state: 'adequately_staffed', missingMinutes: 0 }]);
    expect(hourlyCoverage([], [])).toEqual([]);
  });
  it('real schema: an open staffing insight in the list carries its hour and category coverage; another salon sees none', async () => {
    const day = '2026-10-27', dow = new Date(day + 'T00:00:00Z').getUTCDay();
    const LASH = id(70), LCAT = id(71);
    await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Lashes') on conflict do nothing`, [LCAT, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Lash fill',60,6000) on conflict do nothing`, [LASH, T, B, LCAT]);
    await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'09:00','11:00',true)`, [T, B, TECH2, dow]);
    await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$4,$2,$3) on conflict do nothing`, [T, TECH2, LASH, B]);
    const T3 = id(72), T4 = id(73), T5 = id(74);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values ($1,$4,$5,'Cat','C','Cat C',true), ($2,$4,$5,'Dee','D','Dee D',true), ($3,$4,$5,'Eve','E','Eve E',true)`, [T3, T4, T5, T, B]);
    await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services) values
      ($1,$2,$3,$5,'Ann Lee',$6,'09:00','10:00',60,'booked',$7), ($1,$2,$4,$5,'Ann Lee',$6,'09:30','10:30',60,'booked',$7), ($1,$2,$8,$5,'Ann Lee',$6,'10:00','11:00',60,'booked',$7)`,
      [T, B, T3, T4, CUST, day, JSON.stringify([{ serviceId: LASH, name: 'Lash fill' }]), id(74)]);
    const store = new KyselyInsightStore(db);
    const inputs = await store.coverageInputs(T, B, day);
    expect(inputs.categoryOf[LASH]).toBe('Lashes');
    await store.upsertStaffing(T, { branchId: B, date: day, state: 'understaffed', missingMinutes: 60, missingSkills: [], action: 'x', confidence: 0.8 });
    const svc = new SchedInsightService(store, null);
    const mgr = { ...staff, permissions: ['ai_scheduling.view'] };
    const it: any = (await svc.list(mgr, { kind: 'staffing' })).items.find((x: any) => x.date === day && x.status === 'review_required');
    expect(it.coverage.basis).toBe('confirmed_bookings_only');
    // Amy works 09–17 (lunch 12:00–12:30, from the test above) and Bea 09–11: hours 9 and 10 have 120 scheduled minutes each
    expect(it.coverage.byHour.slice(0, 4).map((x: any) => [x.hour, x.demandMinutes, x.capacityMinutes])).toEqual([[9, 90, 120], [10, 90, 120], [11, 0, 60], [12, 0, 30]]);
    expect(it.coverage.byCategory).toEqual([{ category: 'Lashes', demandMinutes: 180, capacityMinutes: 120, qualifiedTechnicians: 1, state: 'severely_understaffed', missingMinutes: 60 }]);
    expect((await svc.list({ ...mgr, tenantId: T2, branchId: B2 }, { kind: 'staffing' })).items).toEqual([]);
  });
});
