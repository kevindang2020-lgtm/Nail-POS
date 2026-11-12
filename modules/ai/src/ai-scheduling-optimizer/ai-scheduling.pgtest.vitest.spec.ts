// ai-scheduling.pgtest — BUILD_PLAN Phase 7, agent A: the optimizer's store and day reader against the REAL migrated
// schema (PGlite with every migration). Pins: conditional status updates (version + status in the WHERE), tenant
// isolation on every read / write (two tenants), branch-exact listing (no null-branch leak), unique idempotency keys,
// conditional settings writes, the outbox event riding the state change's transaction, and the reader's inputs
// (per-technician shifts with a dated override, lunch + blocked breaks, approved time off, manual locks, learned
// durations, service profiles, real branch membership).
import { capacityHeatmap } from './ai-scheduling-capacity';
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyBookingRepository } from '@aipowersalon/booking';
import { KyselySchedStore } from './ai-scheduling.kysely.repository';
import { BookingServiceReadAdapter } from './ai-scheduling.booking-read.adapter';
import { OutboxSchedEvents } from './ai-scheduling.events';
import type { RecInsert } from './ai-scheduling.store';
import type { SchedCtx } from './ai-scheduling.ports';

const id = (n: number) => `d8d8d8d8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), T_OTHER = id(2), B = id(3), B2 = id(4), CAT = id(5), S1 = id(6), TA = id(7), TB = id(8), AP1 = id(9), AP2 = id(10), U = id(11);
const DATE = '2026-10-09';   // a Friday (dow 5), EDT (UTC−4)
let pg: any; let db: any; let store: KyselySchedStore; let reader: BookingServiceReadAdapter;
const ctx = (o: Partial<SchedCtx> = {}): SchedCtx => ({ tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: [], ...o });

const rec = (o: Partial<RecInsert> = {}): RecInsert => ({
  branchId: B, runId: null, type: 'move_appointment', status: 'review_required',
  currentState: { appointmentId: AP1, date: DATE, startTime: '09:00', endTime: '09:45', technicianId: TA, status: 'booked', version: 1, customerId: null },
  proposedState: { kind: 'reschedule', appointmentId: AP1, date: DATE, startTime: '10:00', endTime: '10:45', technicianId: TA },
  affectedAppointmentIds: [AP1], affectedTechnicianIds: [TA], violations: [],
  simulation: { before: { idleMin: 10, waitMin: 0, utilizationPct: 20, gapCount: 1, latenessRiskPct: 0 }, after: { idleMin: 0, waitMin: 0, utilizationPct: 20, gapCount: 0, latenessRiskPct: 0 }, deltas: { idleSavedMin: 10, waitSavedMin: 0, utilizationGainPct: 0, gapsRemoved: 1, latenessReducedPct: 0 }, improved: true },
  softObjectivesImproved: ['idleSavedMin'], expectedBenefit: ['saves ~10 min'], possibleDownside: [], confidence: 0.5, dataQuality: 'partial',
  touchesConfirmedAppointment: false, requiresCustomerApproval: false,
  versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 0 }, expiresAt: '2026-10-09T00:00:00.000Z', automated: false, ...o,
});

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  const ex = (s: string) => pg.exec(s);
  await ex(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Sched P7 LLC','Sched P7','sched-p7a','SCHP7A','active'), ('${T_OTHER}','Other LLC','Other','sched-p7b','SCHP7B','active') ON CONFLICT DO NOTHING;`);
  await ex(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}','${T}','Main','active'), ('${B2}','${T}','Second','active');`);
  await ex(`INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}','${T}','${B}','Manicure');`);
  await ex(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${S1}','${T}','${B}','${CAT}','Gel Manicure',45,4500,'active');`);
  await ex(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${TA}','${T}','${B}','Ann','A','Ann A','active',true), ('${TB}','${T}','${B}','Bo','B','Bo B','active',true);`);
  await ex(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}','${B}','${TA}','${S1}'), ('${T}','${B}','${TB}','${S1}');`);
  await ex(`INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) VALUES ('${T}','${B}','${TA}',5,'09:00','17:00','12:00','13:00',true);`);
  await ex(`INSERT INTO technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) VALUES ('${T}','${B}','${TB}','${DATE}','${DATE}T14:00:00Z','${DATE}T18:00:00Z','scheduled');`);
  await ex(`INSERT INTO technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) VALUES ('${T}','${B}','${TB}','${DATE}','11:00','11:30','training');`);
  await ex(`INSERT INTO technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) VALUES ('${T}',NULL,'${TA}','${DATE}T19:00:00Z','${DATE}T21:00:00Z','approved'), ('${T}',NULL,'${TA}','${DATE}T13:00:00Z','${DATE}T14:00:00Z','pending');`);
  const svc = JSON.stringify([{ serviceId: S1, serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }]);
  await ex(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, deposit_status, services, version, source) VALUES
    ('${AP1}','${T}','${B}','${TA}','Guest One','${DATE}','09:00','09:45',45,'booked','not_required','${svc}',3,'online'),
    ('${AP2}','${T}','${B}','${TA}','Guest Two','${DATE}','14:00','14:45',45,'confirmed','paid','${svc}',1,'manual');`);
  await ex(`INSERT INTO appointment_schedule_locks (tenant_id, branch_id, appointment_id, reason) VALUES ('${T}','${B}','${AP2}','VIP');`);
  await ex(`INSERT INTO service_duration_recommendations (tenant_id, branch_id, service_id, technician_id, action, current_min, suggested_min, status) VALUES ('${T}','${B}','${S1}','${TA}','increase',45,50,'approved'), ('${T}','${B}','${S1}',NULL,'increase',45,60,'review_required');`);
  await ex(`INSERT INTO service_scheduling_profiles (tenant_id, service_id, setup_min, cleanup_min, max_group_size) VALUES ('${T}','${S1}',5,10,2);`);
  store = new KyselySchedStore(db);
  reader = new BookingServiceReadAdapter(new KyselyBookingRepository(db, new OutboxWriter()), db);
}, 120_000);

describe('day reader on the real schema', () => {
  it('per-technician shifts (weekly row ∩ store hours; a dated technician_shifts row overrides), breaks, time off', async () => {
    const day = await reader.loadDay(ctx(), B, DATE);
    const ta = day.techs.find((t) => t.technicianId === TA)!, tb = day.techs.find((t) => t.technicianId === TB)!;
    expect(ta.shifts).toEqual([{ start: 540, end: 1020 }]);
    expect(ta.breaks).toContainEqual({ start: 720, end: 780 });              // lunch
    expect(ta.timeOff).toEqual([{ start: 900, end: 1020 }]);                // approved only (the pending row is ignored)
    expect(tb.shifts).toEqual([{ start: 600, end: 840 }]);                  // 14:00Z–18:00Z = 10:00–14:00 EDT
    expect(tb.breaks).toContainEqual({ start: 660, end: 690 });              // blocked time
    expect(ta.branchIds).toEqual([B]);
    expect(ta.skills).toContain('Manicure');
    // B-82 (Oct 23 2026): the EXACT approvals are loaded, so the constraint gate decides by service, not category
    expect(ta.approvedServiceIds).toEqual([S1]);
    expect(tb.approvedServiceIds).toEqual([S1]);
  });
  it('appointments with version / deposit / services / manual lock; learned durations; service profiles', async () => {
    const day = await reader.loadDay(ctx(), B, DATE);
    const a1 = day.appts.find((a) => a.id === AP1)!, a2 = day.appts.find((a) => a.id === AP2)!;
    expect(a1).toMatchObject({ startMin: 540, endMin: 585, version: 3, serviceIds: [S1], manualLock: false, source: 'online' });
    expect(a2).toMatchObject({ manualLock: true, depositStatus: 'paid' });
    expect(day.durationByTechService[`${TA}:${S1}`]).toBe(50);
    expect(day.durationByService[S1]).toBeUndefined();                       // not approved → not used
    expect(day.services[S1]).toMatchObject({ durationMin: 45, setupMin: 5, cleanupMin: 10, maxGroupSize: 2, categoryName: 'Manicure' });
    expect(day.branchHours).toEqual({ start: 540, end: 1140 });
  });
  it('Capacity Risk Heatmap (extras 07) reads the same day: staffed = shifts − lunch / blocked / approved time off; booked; qualified by approvals', async () => {
    const h = capacityHeatmap(await reader.loadDay(ctx(), B, DATE));
    const by = Object.fromEntries(h.hours.map((x) => [x.hour, x]));
    expect(h.hours[0].hour).toBe('09:00'); expect(h.hours.at(-1)!.hour).toBe('18:00');           // the branch's hours 09–19
    expect(by['09:00']).toMatchObject({ techsOnShift: 1, staffedMin: 60, bookedMin: 45, utilizationPct: 75, risk: 'ok' });
    expect(by['09:00'].skills).toEqual([{ category: 'Manicure', demandMin: 45, techsNeeded: 1, qualifiedOnShift: 1, short: false }]);
    expect(by['11:00']).toMatchObject({ techsOnShift: 2, staffedMin: 90 });                         // Bo's 11:00–11:30 training
    expect(by['12:00']).toMatchObject({ techsOnShift: 1, staffedMin: 60 });                         // Ann's lunch
    expect(by['14:00']).toMatchObject({ techsOnShift: 1, staffedMin: 60, bookedMin: 45 });          // Bo's dated shift ended at 14:00
    expect(by['15:00']).toMatchObject({ staffedMin: 0, bookedMin: 0, risk: 'closed' });             // Ann's approved time off
    expect(h.totals).toMatchObject({ bookedMin: 90, overHours: 0, unstaffedHours: 0 });
  });
  it('appointment() is tenant-scoped', async () => {
    expect(await reader.appointment(ctx(), AP2)).toMatchObject({ id: AP2, branchId: B, startTime: '14:00', manualLock: true, version: 1 });
    expect(await reader.appointment(ctx({ tenantId: T_OTHER }), AP1)).toBeNull();
    expect(await reader.technicianExists(ctx({ tenantId: T_OTHER }), TA)).toBe(false);
  });
});

describe('store: conditional updates + tenant isolation', () => {
  it('casRec only moves when version AND status still match, and bumps version', async () => {
    const r = await store.insertRec(T, rec());
    expect(r).toMatchObject({ status: 'review_required', version: 1, applyAttempt: 0, affectedTechnicianIds: [TA] });
    expect(await store.casRec(T, r.id, 2, ['review_required'], { status: 'accepted' })).toBeNull();
    expect(await store.casRec(T, r.id, 1, ['accepted'], { status: 'applied' })).toBeNull();
    const u = await store.casRec(T, r.id, 1, ['review_required'], { status: 'accepted', decidedByUserId: U, decidedAt: '2026-10-08T10:00:00Z' });
    expect(u).toMatchObject({ status: 'accepted', version: 2, decidedByUserId: U });
    expect(await store.casRec(T, r.id, 1, ['review_required'], { status: 'rejected' })).toBeNull();     // the loser of a race
  });
  it('another tenant can neither read nor change the row', async () => {
    const r = await store.insertRec(T, rec());
    expect(await store.getRec(T_OTHER, r.id)).toBeNull();
    expect(await store.casRec(T_OTHER, r.id, 1, ['review_required'], { status: 'rejected' })).toBeNull();
    expect((await store.getRec(T, r.id))!.status).toBe('review_required');
    expect((await store.listRecs(T_OTHER, {})).total).toBe(0);
  });
  it('branch listing is exact (no salon-wide NULL-branch leak); jsonb technician / appointment / date filters', async () => {
    await store.insertRec(T, rec({ branchId: null }));
    await store.insertRec(T, rec({ branchId: B2, affectedTechnicianIds: [TB] }));
    const atB = await store.listRecs(T, { branchId: B, limit: 200 });
    expect(atB.items.every((x) => x.branchId === B)).toBe(true);
    expect((await store.listRecs(T, { technicianId: TB })).items.every((x) => x.affectedTechnicianIds.includes(TB))).toBe(true);
    expect((await store.listRecs(T, { technicianId: TB })).total).toBe(1);
    expect((await store.listRecs(T, { appointmentId: AP1, date: DATE })).total).toBeGreaterThan(0);
    expect((await store.listRecs(T, { date: '2026-01-01' })).total).toBe(0);
  });
  it('decisions + impacts + expiry selection', async () => {
    const r = await store.insertRec(T, rec({ expiresAt: '2026-10-08T00:00:00.000Z' }));
    await store.insertDecision(T, { recommendationId: r.id, action: 'start_review', actorUserId: U, reason: null, before: { status: 'review_required' }, after: { status: 'review_in_progress' } });
    expect((await store.listDecisions(T, r.id))[0]).toMatchObject({ action: 'start_review', after: { status: 'review_in_progress' } });
    expect(await store.listDecisions(T_OTHER, r.id)).toEqual([]);
    await store.insertImpact(T, r.id, r.simulation!);
    expect((await store.dueForExpiry(T, '2026-10-08T12:00:00.000Z', ['review_required'], 50)).map((x) => x.id)).toContain(r.id);
    expect(await store.dueForExpiry(T_OTHER, '2026-10-08T12:00:00.000Z', ['review_required'], 50)).toEqual([]);
  });
  it('application keys are unique (the second claim loses) and tenant-scoped on read', async () => {
    const r = await store.insertRec(T, rec());
    const key = `${T}:${r.id}:apply:1`;
    expect(await store.claimApplication(T, { key, recommendationId: r.id, appointmentId: AP1, attempt: 1, userId: U, scheduleVersion: 3 })).toBe(true);
    expect(await store.claimApplication(T, { key, recommendationId: r.id, appointmentId: AP1, attempt: 1, userId: U, scheduleVersion: 3 })).toBe(false);
    await store.finishApplication(T, key, { status: 'applied', appliedVia: 'booking_service.reschedule', externalRef: AP1, errorCode: null });
    expect(await store.findApplication(T, key)).toMatchObject({ status: 'applied', attempt: 1 });
    expect(await store.findApplication(T_OTHER, key)).toBeNull();
    await store.markApplicationRolledBack(T, key);
    expect((await store.findApplication(T, key))!.status).toBe('rolled_back');
  });
  it('runs are idempotent on (tenant, key); gaps / conflicts round-trip; a later run resolves open conflicts', async () => {
    const v = { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 0 };
    const run = await store.insertRun(T, { branchId: B, scope: 'branch_day', date: DATE, technicianId: null, trigger: 'job', idempotencyKey: 'job:1', requestedByUserId: null, versions: v, correlationId: null });
    expect(run).toBeTruthy();
    expect(await store.insertRun(T, { branchId: B, scope: 'branch_day', date: DATE, technicianId: null, trigger: 'job', idempotencyKey: 'job:1', requestedByUserId: null, versions: v, correlationId: null })).toBeNull();
    expect(await store.insertRun(T_OTHER, { branchId: null, scope: 'branch_day', date: DATE, technicianId: null, trigger: 'job', idempotencyKey: 'job:1', requestedByUserId: null, versions: v, correlationId: null })).toBeTruthy();
    await store.insertGaps(T, run!, B, DATE, [{ technicianId: TA, startMin: 585, endMin: 720, durationMin: 135, cause: 'between_appointments', servicesThatFit: [S1], confidence: 0.9 }]);
    await store.insertConflicts(T, run!, B, DATE, [{ type: 'DOUBLE_BOOK', severity: 'critical', appointmentIds: [AP1, AP2], technicianId: TA, message: 'x' }]);
    await store.finishRun(T, run!, { status: 'completed', metrics: { idleMin: 1, waitMin: 0, utilizationPct: 2, gapCount: 1, latenessRiskPct: 0 }, recommendationCount: 0, gapCount: 1, conflictCount: 1, latencyMs: 5, errorCode: null });
    expect(await store.listGaps(T, run!)).toEqual([expect.objectContaining({ startTime: '09:45', endTime: '12:00', durationMin: 135, servicesThatFit: [S1] })]);
    expect((await store.latestCompletedRun(T, B, DATE))?.id).toBe(run);
    expect(await store.listGaps(T_OTHER, run!)).toEqual([]);
    await store.resolveOpenConflicts(T, B, DATE);
    expect((await store.listConflicts(T, run!))[0].resolved).toBe(true);
  });
  it('settings layers are written conditionally (0 = new) and versioned', async () => {
    const l1 = await store.writeLayer(T, { level: 'tenant', branchId: null, expectedVersion: 0, enabled: true, killSwitch: null, config: { minLeadTimeMin: 30 }, userId: U });
    expect(l1).toMatchObject({ version: 1, config: { minLeadTimeMin: 30 } });
    expect(await store.writeLayer(T, { level: 'tenant', branchId: null, expectedVersion: 0, enabled: false, killSwitch: null, config: null, userId: U })).toBeNull();
    expect(await store.writeLayer(T, { level: 'tenant', branchId: null, expectedVersion: 5, enabled: false, killSwitch: null, config: null, userId: U })).toBeNull();
    const l2 = await store.writeLayer(T, { level: 'tenant', branchId: null, expectedVersion: 1, enabled: true, killSwitch: true, config: { minLeadTimeMin: 30 }, userId: U });
    expect(l2).toMatchObject({ version: 2, killSwitch: true });
    const b1 = await store.writeLayer(T, { level: 'branch', branchId: B, expectedVersion: 0, enabled: false, killSwitch: null, config: null, userId: U });
    expect(b1).toMatchObject({ level: 'branch', branchId: B, version: 1 });
    await store.insertRuleVersion(T, l2!, U);
    expect((await store.listRuleVersions(T, 10))[0]).toMatchObject({ version: 2, killSwitch: true });
    expect(await store.layers(T_OTHER)).toEqual([]);
  });
  it('time off, locks (upsert) and service profiles (upsert) are tenant-scoped', async () => {
    const off = await store.insertTimeOff(T, { technicianId: TB, branchId: B, startsAt: '2026-10-10T13:00:00Z', endsAt: '2026-10-10T15:00:00Z', reason: 'dentist', userId: U });
    expect(await store.cancelTimeOff(T_OTHER, off.id)).toBe(false);
    expect(await store.cancelTimeOff(T, off.id)).toBe(true);
    expect(await store.cancelTimeOff(T, off.id)).toBe(false);
    await store.putLock(T, { appointmentId: AP1, branchId: B, reason: 'a', userId: U });
    expect((await store.putLock(T, { appointmentId: AP1, branchId: B, reason: 'b', userId: U })).reason).toBe('b');
    expect(await store.deleteLock(T_OTHER, AP1)).toBe(false);
    expect(await store.deleteLock(T, AP1)).toBe(true);
    expect(await store.putServiceProfile(T, { serviceId: S1, setupMin: 0, cleanupMin: 15, maxGroupSize: null }, U)).toEqual({ serviceId: S1, setupMin: 0, cleanupMin: 15, maxGroupSize: null });
    expect(await store.listServiceProfiles(T_OTHER)).toEqual([]);
  });
});

describe('the outbox event rides the state change’s transaction', () => {
  it('rolled back → no event; committed → one event', async () => {
    const events = new OutboxSchedEvents(db, new OutboxWriter());
    const r = await store.insertRec(T, rec());
    const count = async () => Number((await pg.query(`select count(*)::int as n from outbox_events where tenant_id = $1 and aggregate_id = $2`, [T, r.id])).rows[0].n);
    await expect(store.tx(async (s, trx) => {
      await s.casRec(T, r.id, 1, ['review_required'], { status: 'rejected' });
      await events.emit(ctx(), 'schedule.recommendation_decided', { type: 'schedule_recommendation', id: r.id, version: 2 }, { recommendationId: r.id, status: 'rejected' }, trx);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await count()).toBe(0);
    expect((await store.getRec(T, r.id))!.status).toBe('review_required');
    await store.tx(async (s, trx) => {
      await s.casRec(T, r.id, 1, ['review_required'], { status: 'rejected' });
      await events.emit(ctx(), 'schedule.recommendation_decided', { type: 'schedule_recommendation', id: r.id, version: 2 }, { recommendationId: r.id, status: 'rejected' }, trx);
    });
    expect(await count()).toBe(1);
  });
});
