// ai-scheduling.service.vitest.spec — BUILD_PLAN Phase 7, agent A: the engine end to end over in-memory fakes. Each block
// pins a foundation bug from the Oct 6 audit (every accept answered 409; status writes were unconditional; generate
// trusted the client's simulation / "touches confirmed" and never ran the gate; apply took the target from the request;
// PUT settings ignored its body; runs were never written) and the behaviour that replaced it.
import { describe, it, expect, beforeEach } from 'vitest';
import type { SchedRecommendation, SchedRunDetail } from '@aipowersalon/api-contracts/tenant';
import { AiSchedulingService, type AiSchedulingDeps, type SchedCtx } from './ai-scheduling.service';
import { InMemorySchedStore } from './ai-scheduling.memory.repository';
import { InMemorySchedEvents } from './ai-scheduling.events';
import type { SchedDayReader, SchedApptRecord } from './ai-scheduling.data-adapter';
import type { DayData } from './ai-scheduling-day';
import { hhmm, toMin } from './ai-scheduling-day';
import { applyKey } from './ai-scheduling-application';

const T = 'a7a7a7a7-0000-4000-8000-000000000001', B = 'a7a7a7a7-0000-4000-8000-000000000002', B2 = 'a7a7a7a7-0000-4000-8000-000000000003';
const U = 'a7a7a7a7-0000-4000-8000-0000000000aa';
const T1 = 'a7a7a7a7-0000-4000-8000-0000000000c1', T2 = 'a7a7a7a7-0000-4000-8000-0000000000c2';
const A1 = 'a7a7a7a7-0000-4000-8000-0000000000e1', A2 = 'a7a7a7a7-0000-4000-8000-0000000000e2', A3 = 'a7a7a7a7-0000-4000-8000-0000000000e3';
const DATE = '2026-10-09', TODAY = '2026-10-08';
const OWNER_PERMS = ['ai_scheduling.view', 'ai_scheduling.generate', 'ai_scheduling.review', 'ai_scheduling.approve', 'ai_scheduling.apply', 'ai_scheduling.configure', 'ai_scheduling.export', 'technicians.edit'];
const owner = (o: Partial<SchedCtx> = {}): SchedCtx => ({ tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: OWNER_PERMS, actor: 'user', ...o });

type Appt = SchedApptRecord;
const mk = (o: Partial<Appt> & { id: string }): Appt => ({
  branchId: B, technicianId: T1, customerId: null, status: 'booked', source: 'manual', date: DATE, startTime: '09:00', endTime: '09:45', startMin: 540, endMin: 585,
  version: 1, depositStatus: 'not_required', serviceIds: ['mani'], manualLock: false, ...o,
});

function world() {
  const appts: Appt[] = [];
  const bookingCalls: any[] = [];
  let bookingFail: Error | null = null;
  const proposals: any[] = [];
  const usage: string[] = [];
  const afterRuns: SchedRunDetail[] = [];
  let platformKilled = false;
  const day = (date: string): DayData => ({
    date, branchId: B, timeZone: 'America/New_York', branchHours: { start: 540, end: 1080 }, bufferMin: 0, slotIntervalMin: 15,
    techs: [
      { technicianId: T1, name: 'Ann', available: true, branchIds: [B], skills: ['Manicure'], shifts: [{ start: 540, end: 1020 }], breaks: [{ start: 720, end: 780 }], timeOff: [] },
      { technicianId: T2, name: 'Bo', available: true, branchIds: [B], skills: ['Manicure'], shifts: [{ start: 540, end: 1020 }], breaks: [], timeOff: [] },
    ],
    services: { mani: { serviceId: 'mani', name: 'Manicure', categoryName: 'Manicure', durationMin: 45, setupMin: 0, cleanupMin: 0, maxGroupSize: null } },
    durationByTechService: {}, durationByService: {},
    appts: appts.filter((a) => a.date === date && a.branchId === B).map((a) => ({ ...a })), holds: [], nowMin: date === TODAY ? 600 : null, isPast: date < TODAY,
  });
  const reader: SchedDayReader = {
    async clock() { return { today: TODAY, nowMinute: 600, timeZone: 'America/New_York' }; },
    async loadDay(_c, _b, date) { return day(date); },
    async appointment(_c, id) { const a = appts.find((x) => x.id === id); return a ? { ...a } : null; },
    async technicianIdForUser(c) { return c.technicianId ?? null; },
    async technicianExists(_c, id) { return id === T1 || id === T2; },
    async serviceExists(_c, id) { return id === 'mani'; },
  };
  const store = new InMemorySchedStore();
  const events = new InMemorySchedEvents();
  const deps: AiSchedulingDeps = {
    store, reader, events,
    forecast: { async getBusyHours() { return { available: false, version: null }; } },
    booking: {
      async reschedule(ctx, id, body) {
        bookingCalls.push({ ctx, id, body });
        if (bookingFail) throw bookingFail;
        const a = appts.find((x) => x.id === id)!;
        if (body.expectedVersion != null && body.expectedVersion !== a.version) throw Object.assign(new Error('changed'), { name: 'ConflictError', code: 'VERSION_CONFLICT' });
        const dur = a.endMin - a.startMin;
        Object.assign(a, { date: body.date ?? a.date, startTime: body.startTime, startMin: toMin(body.startTime), endMin: toMin(body.startTime) + dur, endTime: hhmm(toMin(body.startTime) + dur), technicianId: body.technicianId ?? a.technicianId, version: a.version + 1 });
        return { appointmentId: id, version: a.version };
      },
    },
    holds: {
      async acquire(req) { return { holdId: 'a7a7a7a7-0000-4000-8000-0000000000f1', expiresAt: (req as any).startsAt + 600_000 }; },
      async release() { /* */ },
    },
    audit: { async record() { /* */ } },
    proposals: {
      async open(_c, rec) { proposals.push(['open', rec.id]); return { id: 'p1', status: 'customer_notified' } as any; },
      async resend(_c, id) { proposals.push(['resend', id]); return { id: 'p1' } as any; },
      async recordStaffDecision(_c, id, approved) { proposals.push(['staff', id, approved]); return { id: 'p1' } as any; },
      async withdraw(_c, id, reason) { proposals.push(['withdraw', id, reason]); },
      async markApplied(_c, id) { proposals.push(['applied', id]); },
      async summaries() { return {}; },
    },
    explanations: { async explain(_c, rec) { return { text: 'because ' + rec.expectedBenefit.join(', '), source: 'llm' }; } },
    usage: { async record(_c, action) { usage.push(action); } },
    platform: { async isKilled() { return platformKilled; } },
    automation: { async afterRun(_c, d) { afterRuns.push(d); } },
    now: () => Date.parse('2026-10-08T14:00:00Z'),
  };
  const svc = new AiSchedulingService(deps);
  return { svc, appts, store, events, bookingCalls, proposals, usage, afterRuns, deps,
    failBooking: (e: Error | null) => { bookingFail = e; }, killPlatform: (k: boolean) => { platformKilled = k; } };
}

let w: ReturnType<typeof world>;
beforeEach(() => { w = world(); });

/** A1 09:00–09:45 and A2 at 11:00 on T1: a 75-minute hole between them. */
function seedHole() {
  w.appts.push(mk({ id: A1 }), mk({ id: A2, startTime: '11:00', endTime: '11:45', startMin: 660, endMin: 705 }));
}

describe('1 · review entry: stored review_required; accept / reject / return work from there (every accept used to answer 409)', () => {
  it('generate stores review_required with a submit_for_review decision; accept records start_review then accept', async () => {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    expect(rec.status).toBe('review_required');
    expect(rec.version).toBe(1);
    const accepted = await w.svc.decide(owner(), rec.id, 'accept', { expectedVersion: 1 });
    expect(accepted.status).toBe('accepted');
    expect(accepted.version).toBe(2);
    const d = await w.store.listDecisions(T, rec.id);
    expect(d.map((x) => x.action)).toEqual(['submit_for_review', 'start_review', 'accept']);
    expect(d[1].before).toEqual({ status: 'review_required', version: 1 });
    expect(d[2].after).toEqual({ status: 'accepted', version: 2 });
  });
  it('reject and return work from review_required; a returned one can be re-reviewed', async () => {
    seedHole();
    const r1 = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    expect((await w.svc.decide(owner(), r1.id, 'return', { expectedVersion: 1, reason: 'wait for Ann' })).status).toBe('needs_revision');
    expect((await w.svc.decide(owner(), r1.id, 'accept', { expectedVersion: 2 })).status).toBe('accepted');
    const r2 = await w.svc.generate(owner(), { appointmentId: A1, target: { startTime: '10:00' } });
    expect((await w.svc.decide(owner(), r2.id, 'reject', { expectedVersion: 1, reason: 'no' })).status).toBe('rejected');
    await expect(w.svc.decide(owner(), r2.id, 'accept', { expectedVersion: 2 })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('2 · conditional status updates', () => {
  it('a stale expectedVersion → 409 VERSION_CONFLICT and nothing changes; a missing one → 400', async () => {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    await expect(w.svc.decide(owner(), rec.id, 'accept', { expectedVersion: 7 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await expect(w.svc.decide(owner(), rec.id, 'accept', {} as any)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await w.svc.get(owner(), rec.id)).status).toBe('review_required');
    expect(await w.store.casRec(T, rec.id, 1, ['accepted'], { status: 'applied' })).toBeNull();   // wrong from-status
    expect(await w.store.casRec(T, rec.id, 2, ['review_required'], { status: 'accepted' })).toBeNull();   // wrong version
  });
});

describe('3 · generate: server-side target, gate, simulation, touches-confirmed, versions, expiry', () => {
  it('omitted target → the engine picks the best feasible move (fills the hole), simulated server-side', async () => {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, afterMetrics: { idleMin: -999 } } as any);
    expect(rec.proposedState).toMatchObject({ appointmentId: A2, date: DATE, startTime: '09:45', technicianId: T1, kind: 'reschedule' });
    expect(rec.currentState).toMatchObject({ appointmentId: A2, startTime: '11:00', version: 1, technicianId: T1 });
    expect(rec.simulation!.before.idleMin).toBe(75);
    expect(rec.simulation!.after.idleMin).toBe(0);
    expect(rec.expectedBenefit.join(' ')).toContain('75');
    expect(rec.type).toBe('move_appointment');
    expect(rec.violations).toEqual([]);
    expect(rec.explanation).toContain('because');
    expect(rec.explanationSource).toBe('llm');
    expect(w.usage).toContain('recommendation');
    expect(w.events.events.map((e) => e.type)).toContain('schedule.recommendation_generated');
    expect(Date.parse(rec.expiresAt!) - Date.parse('2026-10-08T14:00:00Z')).toBe(30 * 60_000);
  });
  it('a target that breaks a hard rule → 422 with violations, nothing stored', async () => {
    seedHole();
    await expect(w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '12:00' } })).rejects.toMatchObject({ code: 'HARD_CONSTRAINT_VIOLATION', status: 422, extra: { violations: expect.arrayContaining([expect.objectContaining({ code: 'BREAK_CONFLICT' })]) } });
    await expect(w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:30' } })).rejects.toMatchObject({ code: 'HARD_CONSTRAINT_VIOLATION' });
    expect((await w.store.listRecs(T, {})).total).toBe(0);
  });
  it('locked appointments (arrived, deposit paid, manual lock) → 409 LOCKED_APPOINTMENT', async () => {
    w.appts.push(mk({ id: A1, status: 'arrived' }), mk({ id: A2, startTime: '11:00', startMin: 660, endMin: 705, depositStatus: 'paid' }), mk({ id: A3, startTime: '14:00', startMin: 840, endMin: 885, manualLock: true }));
    for (const id of [A1, A2, A3]) await expect(w.svc.generate(owner(), { appointmentId: id, target: { startTime: '15:00' } })).rejects.toMatchObject({ code: 'LOCKED_APPOINTMENT', status: 409 });
  });
  it('touchesConfirmedAppointment is derived on the server (customer + time change), never taken from the body', async () => {
    w.appts.push(mk({ id: A1, customerId: 'cust-1' }));
    const moved = await w.svc.generate(owner(), { appointmentId: A1, target: { startTime: '10:00' }, touchesConfirmedAppointment: false } as any);
    expect(moved.touchesConfirmedAppointment).toBe(true);
    // a move with no simulated benefit becomes preserve_schedule — nothing for the customer to approve
    expect(moved.type).toBe('preserve_schedule');
    expect(moved.requiresCustomerApproval).toBe(false);
    const techOnly = await w.svc.generate(owner(), { appointmentId: A1, target: { technicianId: T2 } });
    expect(techOnly.touchesConfirmedAppointment).toBe(false);   // staff-assigned technician, same time
    expect(techOnly.type === 'change_technician' || techOnly.type === 'preserve_schedule').toBe(true);
    expect(techOnly.proposedState!.kind).toBe('assign_technician');
  });
  it('configVersion is the real settings row version; TTL follows recommendationTtlMin', async () => {
    seedHole();
    await w.svc.updateSettings(owner(), { level: 'tenant', expectedVersion: 0, config: { recommendationTtlMin: 90 } });
    await w.svc.updateSettings(owner(), { level: 'tenant', expectedVersion: 1, enabled: true });
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    expect(rec.versions.configVersion).toBe(2);
    expect(Date.parse(rec.expiresAt!) - Date.parse('2026-10-08T14:00:00Z')).toBe(90 * 60_000);
  });
  it('a newer recommendation for the same appointment supersedes the un-reviewed one', async () => {
    seedHole();
    const r1 = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '10:00' } });
    expect((await w.svc.get(owner(), r1.id)).status).toBe('superseded');
  });
  it('generation is refused (403 MODULE_DISABLED) when the location turns it off or the platform switch is on', async () => {
    seedHole();
    w.killPlatform(true);
    await expect(w.svc.generate(owner(), { appointmentId: A2 })).rejects.toMatchObject({ code: 'MODULE_DISABLED', status: 403 });
    w.killPlatform(false);
    await w.svc.updateSettings(owner(), { level: 'branch', expectedVersion: 0, enabled: false });
    await expect(w.svc.generate(owner(), { appointmentId: A2 })).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
  it('an appointment at another branch is invisible to a branch session', async () => {
    w.appts.push(mk({ id: A1, branchId: B2 }));
    await expect(w.svc.generate(owner(), { appointmentId: A1, target: { startTime: '10:00' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('4 · customer approval', () => {
  it('accept on a customer-touching change → customer_approval_required + proposal opened + 24 h expiry; customerDecided approves', async () => {
    w.appts.push(mk({ id: A1 }), mk({ id: A2, customerId: 'cust-1', startTime: '11:00', startMin: 660, endMin: 705 }));
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    expect(rec.requiresCustomerApproval).toBe(true);
    const acc = await w.svc.decide(owner(), rec.id, 'accept', { expectedVersion: 1 });
    expect(acc.status).toBe('customer_approval_required');
    expect(w.proposals).toContainEqual(['open', rec.id]);
    expect(Date.parse(acc.expiresAt!) - Date.parse('2026-10-08T14:00:00Z')).toBe(24 * 3_600_000);
    expect(w.events.events.map((e) => e.type)).toContain('schedule.customer_approval_requested');
    await expect(w.svc.apply(owner(), rec.id, { expectedVersion: acc.version })).rejects.toMatchObject({ code: 'CUSTOMER_APPROVAL_REQUIRED' });
    const sys: SchedCtx = { tenantId: T, branchId: null, userId: 'system:proposals', role: 'SYSTEM', permissions: [], actor: 'system' };
    const ok = await w.svc.customerDecided(sys, rec.id, true);
    expect(ok.status).toBe('customer_approved');
    expect(w.events.events.find((e) => e.type === 'schedule.customer_decided')?.payload).toMatchObject({ approved: true, status: 'customer_approved' });
    await expect(w.svc.customerDecided(sys, rec.id, false)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('staff record a phone decision through the proposal port, then the engine', async () => {
    w.appts.push(mk({ id: A1 }), mk({ id: A2, customerId: 'cust-1', startTime: '11:00', startMin: 660, endMin: 705 }));
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    const acc = await w.svc.decide(owner(), rec.id, 'accept', { expectedVersion: 1 });
    const out = await w.svc.recordCustomerDecision(owner(), rec.id, { approved: false, expectedVersion: acc.version });
    expect(out.status).toBe('rejected');
    expect(w.proposals).toContainEqual(['staff', rec.id, false]);
  });
});

describe('5 · apply / retry / rollback through booking.service', () => {
  async function accepted() {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    return w.svc.decide(owner(), rec.id, 'accept', { expectedVersion: 1 });
  }
  it('uses the STORED proposed change + snapshot version + reason; records the application; event; idempotent replay', async () => {
    const rec = await accepted();
    const out = await w.svc.apply(owner(), rec.id, { expectedVersion: rec.version, startTime: '16:00' } as any);
    expect(out.application).toMatchObject({ status: 'applied', attempt: 1 });
    expect(out.recommendation.status).toBe('applied');
    expect(out.recommendation.appliedAt).not.toBeNull();
    expect(w.bookingCalls).toHaveLength(1);
    expect(w.bookingCalls[0].body).toMatchObject({ startTime: '09:45', date: DATE, technicianId: T1, expectedVersion: 1, reason: 'ai_scheduling_optimizer', notifyCustomer: false });
    expect(w.appts.find((a) => a.id === A2)!.startTime).toBe('09:45');
    expect((await w.store.findApplication(T, applyKey(T, rec.id, 1)))?.status).toBe('applied');
    expect(w.events.events.map((e) => e.type)).toContain('schedule.change_applied');
    const again = await w.svc.apply(owner(), rec.id, { expectedVersion: rec.version });   // same attempt → recorded result
    expect(again.application.status).toBe('applied');
    expect(w.bookingCalls).toHaveLength(1);
  });
  it('refuses anything not accepted / customer-approved', async () => {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    await expect(w.svc.apply(owner(), rec.id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(w.bookingCalls).toHaveLength(0);
  });
  it('the appointment moved since the recommendation → 409 STALE_SCHEDULE, row stale, status unchanged, no booking call', async () => {
    const rec = await accepted();
    Object.assign(w.appts.find((a) => a.id === A2)!, { version: 2 });
    await expect(w.svc.apply(owner(), rec.id, { expectedVersion: rec.version })).rejects.toMatchObject({ code: 'STALE_SCHEDULE', status: 409 });
    expect(w.bookingCalls).toHaveLength(0);
    expect((await w.svc.get(owner(), rec.id)).status).toBe('accepted');
    expect((await w.store.findApplication(T, applyKey(T, rec.id, 1)))?.status).toBe('stale');
    expect(w.events.events.find((e) => e.type === 'schedule.change_failed')?.payload).toMatchObject({ reason: 'stale' });
  });
  it('a booking refusal → application_failed with its code; retry is a NEW key (attempt 2) and succeeds', async () => {
    const rec = await accepted();
    w.failBooking(Object.assign(new Error('double-booked'), { name: 'ConflictError', code: 'APPOINTMENT_CONFLICT' }));
    await expect(w.svc.apply(owner(), rec.id, { expectedVersion: rec.version })).rejects.toMatchObject({ code: 'APPLICATION_FAILED', extra: { errorCode: 'APPOINTMENT_CONFLICT' } });
    const failed = await w.svc.get(owner(), rec.id);
    expect(failed.status).toBe('application_failed');
    w.failBooking(null);
    const out = await w.svc.retry(owner(), rec.id, { expectedVersion: failed.version });
    expect(out.application).toMatchObject({ status: 'applied', attempt: 2 });
    expect((await w.store.findApplication(T, applyKey(T, rec.id, 1)))?.status).toBe('failed');
    expect((await w.store.findApplication(T, applyKey(T, rec.id, 2)))?.status).toBe('applied');
    expect(w.bookingCalls).toHaveLength(2);
  });
  it('rollback reschedules back to the snapshot with the CURRENT version and marks the application', async () => {
    const rec = await accepted();
    const applied = (await w.svc.apply(owner(), rec.id, { expectedVersion: rec.version })).recommendation;
    const back = await w.svc.rollback(owner(), rec.id, { expectedVersion: applied.version });
    expect(back.recommendation.status).toBe('rolled_back');
    expect(w.bookingCalls[1].body).toMatchObject({ startTime: '11:00', date: DATE, technicianId: T1, expectedVersion: 2 });
    expect(w.appts.find((a) => a.id === A2)!.startTime).toBe('11:00');
    expect((await w.store.findApplication(T, applyKey(T, rec.id, 1)))?.status).toBe('rolled_back');
    expect(w.events.events.map((e) => e.type)).toContain('schedule.change_rolled_back');
  });
  it('expired recommendations cannot be applied; the sweep expires them and withdraws proposals', async () => {
    const rec = await accepted();
    w.deps.now = () => Date.parse('2026-10-08T15:00:00Z');
    await expect(w.svc.apply(owner(), rec.id, { expectedVersion: rec.version })).rejects.toMatchObject({ code: 'RECOMMENDATION_EXPIRED' });
    const sys: SchedCtx = { tenantId: T, branchId: null, userId: 'system:sweep', role: 'SYSTEM', permissions: [], actor: 'system' };
    expect(await w.svc.expireDue(sys, Date.parse('2026-10-08T15:00:00Z'))).toBe(1);
    expect((await w.svc.get(owner(), rec.id)).status).toBe('expired');
    expect(w.events.events.map((e) => e.type)).toContain('schedule.recommendation_expired');
  });
});

describe('6 · settings', () => {
  it('PUT writes conditionally, versions, records rule versions; kill switch → AUTOMATION_DISABLED; disabled wins downward', async () => {
    const v1 = await w.svc.updateSettings(owner(), { level: 'tenant', expectedVersion: 0, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot', 'nuke' as any], minLeadTimeMin: -3 } });
    expect(v1.tenant).toMatchObject({ version: 1, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot'], minLeadTimeMin: 0 } });
    expect(v1.effective.automationAllowed).toBe(true);
    await expect(w.svc.updateSettings(owner(), { level: 'tenant', expectedVersion: 0, enabled: false })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const v2 = await w.svc.updateSettings(owner(), { level: 'branch', expectedVersion: 0, killSwitch: true });
    expect(v2.effective).toMatchObject({ killed: true, automationAllowed: false });
    expect(w.events.events.filter((e) => e.type === 'schedule.automation_disabled')).toHaveLength(1);
    expect((await w.svc.settingsVersions(owner())).map((v) => v.version)).toEqual([1, 1]);
    w.killPlatform(true);
    expect((await w.svc.getSettings(owner())).effective.platformKilled).toBe(true);
  });
  it('configure is required; setTenantKillSwitch works for a system ctx', async () => {
    await expect(w.svc.updateSettings(owner({ permissions: ['ai_scheduling.view'] }), { level: 'tenant', expectedVersion: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sys: SchedCtx = { tenantId: T, branchId: null, userId: 'system:super_admin', role: 'SYSTEM', permissions: [], actor: 'system' };
    const out = await w.svc.setTenantKillSwitch(sys, true, 'abuse review');
    expect(out.tenant?.killSwitch).toBe(true);
    expect(w.events.events.find((e) => e.type === 'schedule.automation_disabled')?.payload).toMatchObject({ scope: 'tenant', killed: true });
  });
});

describe('8 · findOptions', () => {
  it('full option payload, limit, holds; usage metered', async () => {
    seedHole();
    const r = await w.svc.findOptions(owner(), { date: DATE, serviceIds: ['mani'], preferredTime: '09:45', limit: 3, hold: { channel: 'ai_receptionist' } });
    expect(r.options).toHaveLength(3);
    expect(r.options[0]).toMatchObject({ technicianId: expect.any(String), date: DATE, startTime: expect.any(String), blocks: [expect.objectContaining({ serviceId: 'mani' })], fallback: false });
    expect(r.options[0]).not.toHaveProperty('spanStartMin');
    expect(r.hold).toMatchObject({ optionId: r.options[0].id });
    expect(w.usage).toContain('options');
    await expect(w.svc.findOptions(owner(), { date: '2026-10-01', serviceIds: ['mani'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(w.svc.findOptions(owner({ permissions: [] }), { date: DATE, serviceIds: ['mani'] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await w.svc.findOptions(owner(), { date: DATE, serviceIds: ['mani'], limit: 99 })).options.length).toBeLessThanOrEqual(20);
  });
  it('Round 2 H: placing / releasing a hold is a WRITE behind the booking-desk key pos.booking.create (or ai_scheduling.generate)', async () => {
    seedHole();
    const desk = owner({ role: 'FRONT_DESK', permissions: ['ai_scheduling.view', 'pos.booking.create'] });
    const r = await w.svc.findOptions(desk, { date: DATE, serviceIds: ['mani'], hold: { channel: 'reception_copilot' } });
    expect(r.hold).toMatchObject({ optionId: r.options[0].id });
    await expect(w.svc.releaseHold(desk, 'a7a7a7a7-0000-4000-8000-0000000000f1')).resolves.toEqual({ released: true });
    const viewer = owner({ role: 'FRONT_DESK', permissions: ['ai_scheduling.view', 'pos.booking.view'] });
    expect((await w.svc.findOptions(viewer, { date: DATE, serviceIds: ['mani'] })).hold).toBeNull();          // reading stays a read
    await expect(w.svc.findOptions(viewer, { date: DATE, serviceIds: ['mani'], hold: { channel: 'reception_copilot' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(w.svc.releaseHold(viewer, 'a7a7a7a7-0000-4000-8000-0000000000f1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('9 · runs', () => {
  it('a branch-day run stores gaps (lunch is not a gap), conflicts, one recommendation per move, completes, hands off to automation; idempotent', async () => {
    seedHole();
    w.appts.push(mk({ id: A3, technicianId: T2, startTime: '09:00', startMin: 540, endMin: 600 }), mk({ id: 'a7a7a7a7-0000-4000-8000-0000000000e4', technicianId: T2, startTime: '09:30', startMin: 570, endMin: 615 }));
    const d = await w.svc.runDay(owner(), { scope: 'branch_day', date: DATE, idempotencyKey: 'k1' });
    expect(d.run).toMatchObject({ status: 'completed', date: DATE, trigger: 'manual', scope: 'branch_day' });
    expect(d.gaps.length).toBeGreaterThan(0);
    expect(d.gaps.some((g) => g.technicianId === T1 && g.startTime === '12:00')).toBe(false);
    expect(d.conflicts.map((c) => c.type)).toContain('DOUBLE_BOOK');
    expect(d.recommendations.length).toBe(d.run.recommendationCount);
    expect(d.recommendations.some((r) => r.proposedState?.appointmentId === A2 && r.runId === d.run.id)).toBe(true);
    expect(w.afterRuns).toHaveLength(1);
    expect(w.usage).toContain('optimization_run');
    expect(w.events.events.find((e) => e.type === 'schedule.optimization_run_completed')?.payload).toMatchObject({ runId: d.run.id, status: 'completed' });
    const again = await w.svc.runDay(owner(), { scope: 'branch_day', date: DATE, idempotencyKey: 'k1' });
    expect(again.run.id).toBe(d.run.id);
    // a second run resolves the first run's open conflicts
    const d2 = await w.svc.runDay(owner(), { scope: 'branch_day', date: DATE });
    expect((await w.svc.getRun(owner(), d.run.id)).conflicts.every((c) => c.resolved)).toBe(true);
    const cal = await w.svc.calendar(owner(), DATE);
    expect(cal.conflicts.length).toBe(d2.conflicts.length);
    expect(Object.keys(cal.appointments)).toContain(A2);
  });
});

describe('10 · visibility', () => {
  it('branch sessions see only their branch; a technician (view_own) only recommendations that touch them', async () => {
    seedHole();
    const rec = await w.svc.generate(owner(), { appointmentId: A2, target: { startTime: '09:45' } });
    expect((await w.svc.list(owner())).total).toBe(1);
    expect((await w.svc.list(owner({ branchId: B2 }))).total).toBe(0);
    const tech = (id: string): SchedCtx => ({ tenantId: T, branchId: B, userId: U, role: 'TECHNICIAN', permissions: ['ai_scheduling.view_own'], technicianId: id });
    expect((await w.svc.list(tech(T1))).items.map((r: SchedRecommendation) => r.id)).toEqual([rec.id]);
    expect((await w.svc.list(tech(T2))).total).toBe(0);
    await expect(w.svc.get(tech(T2), rec.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(w.svc.list({ ...tech(T1), permissions: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(w.svc.get({ ...owner(), tenantId: 'a7a7a7a7-0000-4000-8000-0000000000ff' }, rec.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('time off / locks / service profiles are validated and permission-gated', async () => {
    seedHole();
    const off = await w.svc.createTimeOff(owner(), { technicianId: T1, startsAt: '2026-10-09T13:00:00Z', endsAt: '2026-10-09T17:00:00Z' });
    expect(off.status).toBe('approved');
    await expect(w.svc.createTimeOff(owner(), { technicianId: T1, startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T13:00:00Z' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(w.svc.createTimeOff(owner({ permissions: ['ai_scheduling.view'] }), { technicianId: T1, startsAt: '2026-10-09T13:00:00Z', endsAt: '2026-10-09T17:00:00Z' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await w.svc.deleteTimeOff(owner(), off.id)).cancelled).toBe(true);
    await w.svc.putLock(owner(), A1, { reason: 'VIP asked' });
    expect((await w.svc.listLocks(owner())).map((l) => l.appointmentId)).toEqual([A1]);
    await expect(w.svc.putServiceProfile(owner(), 'mani', { setupMin: 500 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await w.svc.putServiceProfile(owner(), 'mani', { setupMin: 5, cleanupMin: 10, maxGroupSize: 3 })).toEqual({ serviceId: 'mani', setupMin: 5, cleanupMin: 10, maxGroupSize: 3 });
  });
});
