// ai-scheduling-proposals.vitest.spec — BUILD_PLAN Phase 7 (agent B): customer approval of a schedule change, with an
// in-memory store and a fake engine. One live proposal per recommendation; the customer's text is customer-safe (no
// metrics) and links to /appointments/proposals; only the proposal's own customer may decide; exactly one decision wins;
// the engine hears the decision through a SYSTEM context; staff-recorded decisions do NOT call the engine (it does that).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { ScheduleProposalService, InMemoryProposalStore, proposalText, customerReason, effectiveStatus, clampTtlHours, localToIso, isoToLocal } from './ai-scheduling-proposals';

const T = '11111111-0000-4000-8000-000000000001';
const B = '11111111-0000-4000-8000-000000000002';
const REC = '11111111-0000-4000-8000-0000000000a1';
const APPT = '11111111-0000-4000-8000-0000000000b1';
const CUST = '11111111-0000-4000-8000-0000000000c1';
const USER = '11111111-0000-4000-8000-0000000000d1';
const OTHER_USER = '11111111-0000-4000-8000-0000000000d2';
const TECH_A = '11111111-0000-4000-8000-0000000000e1';
const TECH_B = '11111111-0000-4000-8000-0000000000e2';
const staff = { tenantId: T, branchId: B, userId: '11111111-0000-4000-8000-0000000000f1', role: 'MANAGER', permissions: ['ai_scheduling.review'], actor: 'user' as const };

function rec(over: Partial<SchedRecommendation> = {}): SchedRecommendation {
  return {
    id: REC, branchId: B, runId: null, type: 'move_appointment', status: 'customer_approval_required',
    currentState: { appointmentId: APPT, date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: TECH_A, status: 'confirmed', version: 3, customerId: CUST },
    proposedState: { kind: 'reschedule', appointmentId: APPT, date: '2026-10-20', startTime: '13:30', endTime: '14:30', technicianId: TECH_B },
    affectedAppointmentIds: [APPT], affectedTechnicianIds: [TECH_A, TECH_B], hardConstraintsChecked: true, violations: [],
    simulation: { before: { idleMin: 90, waitMin: 10, utilizationPct: 61, gapCount: 3, latenessRiskPct: 4 }, after: { idleMin: 30, waitMin: 5, utilizationPct: 77, gapCount: 1, latenessRiskPct: 2 }, deltas: { idleSavedMin: 60, waitSavedMin: 5, utilizationGainPct: 16, gapsRemoved: 2, latenessReducedPct: 2 }, improved: true },
    expectedBenefit: ['Saves 60 idle minutes', 'Utilization +16%'], possibleDownside: [], confidence: 0.9, dataQuality: 'good',
    touchesConfirmedAppointment: true, requiresCustomerApproval: true, versions: { forecastVersion: null, ruleVersion: 'r1', engineVersion: 'e1', configVersion: 1 },
    version: 4, applyAttempt: 0, automated: false, expiresAt: null, explanation: null, explanationSource: null, proposal: null,
    decidedByUserId: null, decidedAt: null, appliedAt: null, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', ...over,
  };
}

let store: InMemoryProposalStore; let engine: any; let messenger: any; let staffN: any; let now: number; let svc: ScheduleProposalService;
beforeEach(() => {
  store = new InMemoryProposalStore();
  store.customers.push({ tenantId: T, userId: USER, customerId: CUST });
  store.contacts[APPT] = { phone: '+18565550100', salonName: 'Glow Nails', branchName: 'Glow Nails Cherry Hill', services: ['Gel Manicure'], technicianNames: { [TECH_A]: 'Amy', [TECH_B]: 'Bea' } };
  now = Date.parse('2026-10-08T12:00:00Z');
  engine = { effectiveConfig: vi.fn(async () => ({ config: { proposalTtlHours: 24 } })), customerDecided: vi.fn(async () => ({})), get: vi.fn(async () => rec()) };
  messenger = { sendSms: vi.fn(async () => ({ sent: true, status: 'sent' })) };
  staffN = { customerDecided: vi.fn(async () => undefined) };
  svc = new ScheduleProposalService(store, engine, messenger, staffN, () => now, { PUBLIC_CUSTOMER_BASE_URL: 'https://app.example.test/' } as any);
});

describe('open', () => {
  it('creates ONE live proposal, keeps the original, texts the customer and marks it notified', async () => {
    const s = await svc.open(staff, rec());
    expect(s.status).toBe('customer_notified');
    expect(s).toMatchObject({ customerId: CUST, originalDate: '2026-10-20', originalStartTime: '10:00', proposedStartTime: '13:30', proposedTechnicianId: TECH_B, originalTechnicianId: TECH_A });
    expect(s.expiresAt).toBe(new Date(now + 24 * 3600_000).toISOString());
    expect(messenger.sendSms).toHaveBeenCalledTimes(1);
    const sms = messenger.sendSms.mock.calls[0][0];
    expect(sms).toMatchObject({ tenantId: T, branchId: B, to: '+18565550100', purpose: 'notification', customerId: CUST });
    expect(sms.body).toContain('https://app.example.test/appointments/proposals');
    expect(sms.body).toContain('original time stays booked');
    expect(sms.body).toContain('with Bea');
    // customer-safe: none of the internal numbers or benefit strings
    expect(sms.body).not.toMatch(/idle|utilization|60|%/i);
    expect(store.rows[0].notificationAttempts).toBe(1);
  });
  it('is idempotent per recommendation (second open returns the live one, no second text)', async () => {
    const a = await svc.open(staff, rec());
    const b = await svc.open(staff, rec());
    expect(b.id).toBe(a.id);
    expect(store.rows).toHaveLength(1);
    expect(messenger.sendSms).toHaveBeenCalledTimes(1);
  });
  it('a failed text leaves it proposed with the attempt counted', async () => {
    messenger.sendSms.mockResolvedValueOnce({ sent: false, status: 'blocked', reason: 'opted_out' });
    const s = await svc.open(staff, rec());
    expect(s.status).toBe('proposed');
    expect(store.rows[0].notificationAttempts).toBe(1);
  });
  it('refuses a recommendation with no customer or no change', async () => {
    await expect(svc.open(staff, rec({ currentState: { ...rec().currentState!, customerId: null } }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(svc.open(staff, rec({ proposedState: null }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('TTL comes from the settings, clamped 1–168 h; a settings failure falls back to 24 h', async () => {
    engine.effectiveConfig.mockResolvedValueOnce({ config: { proposalTtlHours: 9999 } });
    expect((await svc.open(staff, rec())).expiresAt).toBe(new Date(now + 168 * 3600_000).toISOString());
    expect(clampTtlHours(0)).toBe(1); expect(clampTtlHours('x')).toBe(24);
  });
});

describe('the customer decides', () => {
  const me = { tenantId: T, userId: USER };
  it('approve → customer_approved, engine told through a SYSTEM context, managers told', async () => {
    const s = await svc.open(staff, rec());
    const p = (await svc.listForCustomer(me)).items[0];
    expect(p).toMatchObject({ id: s.id, salonName: 'Glow Nails', services: ['Gel Manicure'], original: { date: '2026-10-20', startTime: '10:00', technicianName: 'Amy' }, proposed: { startTime: '13:30', technicianName: 'Bea' }, status: 'customer_notified' });
    expect(p.reason).toBe(customerReason('move_appointment'));
    const out = await svc.customerDecide(me, s.id, true, p.version);
    expect(out.status).toBe('customer_approved');
    expect(engine.customerDecided).toHaveBeenCalledTimes(1);
    const [ctx, recId, approved] = engine.customerDecided.mock.calls[0];
    expect(recId).toBe(REC); expect(approved).toBe(true);
    expect(ctx).toMatchObject({ tenantId: T, actor: 'system', role: 'SYSTEM' });
    expect(store.rows[0]).toMatchObject({ decisionChannel: 'customer_web', decidedByUserId: null });
    expect(staffN.customerDecided).toHaveBeenCalledWith(expect.objectContaining({ id: s.id }), true, true);
  });
  it('reject → customer_rejected; engine told approved=false', async () => {
    const s = await svc.open(staff, rec());
    const out = await svc.customerDecide(me, s.id, false, 2);
    expect(out.status).toBe('customer_rejected');
    expect(engine.customerDecided.mock.calls[0][2]).toBe(false);
  });
  it('another customer gets 404 (never confirms the proposal exists)', async () => {
    store.customers.push({ tenantId: T, userId: OTHER_USER, customerId: '11111111-0000-4000-8000-0000000000c9' });
    const s = await svc.open(staff, rec());
    await expect(svc.customerDecide({ tenantId: T, userId: OTHER_USER }, s.id, true, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await svc.listForCustomer({ tenantId: T, userId: OTHER_USER })).items).toEqual([]);
  });
  it('a session with no linked customer is refused', async () => {
    await expect(svc.listForCustomer({ tenantId: T, userId: '11111111-0000-4000-8000-0000000000dd' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('stale version → VERSION_CONFLICT; already answered → INVALID_STATE; engine called once', async () => {
    const s = await svc.open(staff, rec());
    await expect(svc.customerDecide(me, s.id, true, 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await svc.customerDecide(me, s.id, true, 2);
    await expect(svc.customerDecide(me, s.id, false, 3)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(engine.customerDecided).toHaveBeenCalledTimes(1);
  });
  it('past the TTL it reads expired and cannot be approved', async () => {
    const s = await svc.open(staff, rec());
    now += 25 * 3600_000;
    expect((await svc.listForCustomer(me)).items[0].status).toBe('expired');
    await expect(svc.customerDecide(me, s.id, true, 2)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await svc.expireDue(T)).toBe(1);
    expect(store.rows[0].status).toBe('expired');
  });
  it('an engine failure keeps the answer and flags the managers', async () => {
    engine.customerDecided.mockRejectedValueOnce(new Error('INVALID_STATE'));
    const s = await svc.open(staff, rec());
    expect((await svc.customerDecide(me, s.id, true, 2)).status).toBe('customer_approved');
    expect(staffN.customerDecided).toHaveBeenCalledWith(expect.anything(), true, false);
  });
});

describe('staff side', () => {
  it('recordStaffDecision records staff_recorded + the user, and does NOT call the engine (the engine does)', async () => {
    await svc.open(staff, rec());
    const s = await svc.recordStaffDecision(staff, REC, true);
    expect(s.status).toBe('customer_approved');
    expect(s.decisionChannel).toBe('staff_recorded');
    expect(store.rows[0].decidedByUserId).toBe(staff.userId);
    expect(engine.customerDecided).not.toHaveBeenCalled();
    await expect(svc.recordStaffDecision(staff, REC, false)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('withdraw / markApplied / summaries', async () => {
    await svc.open(staff, rec());
    await svc.withdraw(staff, REC, 'superseded');
    expect(store.rows[0].status).toBe('withdrawn');
    await svc.open(staff, rec());
    await svc.recordStaffDecision(staff, REC, true);
    await svc.markApplied(staff, REC);
    expect(store.rows[1].status).toBe('applied');
    const sum = await svc.summaries(staff, [REC, 'not-a-uuid']);
    expect(Object.keys(sum)).toEqual([REC]);
    expect(sum[REC].status).toBe('applied');
  });
  it('withdraw for expiry marks expired', async () => {
    await svc.open(staff, rec());
    await svc.withdraw(staff, REC, 'expired');
    expect(store.rows[0].status).toBe('expired');
  });
  it('resend re-texts a live proposal; with none live it reopens only while the rec waits for the customer', async () => {
    await svc.open(staff, rec());
    await svc.resend(staff, REC);
    expect(messenger.sendSms).toHaveBeenCalledTimes(2);
    expect(store.rows[0].notificationAttempts).toBe(2);
    await svc.withdraw(staff, REC, 'superseded');
    engine.get.mockResolvedValueOnce({ recommendation: rec({ status: 'accepted' }) });
    await expect(svc.resend(staff, REC)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    engine.get.mockResolvedValueOnce({ recommendation: rec() });
    expect((await svc.resend(staff, REC)).status).toBe('customer_notified');
  });
});

describe('pure helpers', () => {
  it('local wall clock ↔ instant round-trips in the branch zone (DST-aware)', () => {
    const i = localToIso('2026-10-20', '10:00', 'America/New_York')!;
    expect(i).toBe('2026-10-20T14:00:00.000Z');
    expect(isoToLocal(i, 'America/New_York')).toEqual({ date: '2026-10-20', startTime: '10:00' });
    expect(localToIso('nope', '10:00', 'UTC')).toBeNull();
  });
  it('proposal text omits the technician when it does not change', () => {
    const t = proposalText({ salonName: 'S', original: { date: 'd', startTime: '10:00' }, proposed: { date: 'd', startTime: '11:00' }, technicianName: 'Bea', technicianChanges: false, link: 'L' });
    expect(t).not.toContain('Bea');
  });
  it("the proposal text is English for every customer — a customer marked Vietnamese too (Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans)", () => {
    const base = { salonName: 'Luxe', original: { date: '2026-10-30', startTime: '10:00' }, proposed: { date: '2026-10-30', startTime: '11:00' }, technicianName: 'Bea', technicianChanges: true, link: 'L' };
    expect(proposalText({ ...base, language: 'vi' })).toBe(proposalText(base));
    expect(proposalText({ ...base, language: null })).toBe(proposalText(base));
    expect(proposalText(base)).toMatch(/^Luxe: we'd like to move your appointment on 2026-10-30 at 10:00 to 2026-10-30 at 11:00 with Bea\./);
  });
  it('effectiveStatus only expires LIVE proposals', () => {
    expect(effectiveStatus({ status: 'customer_approved', expiresAt: '2000-01-01T00:00:00Z' })).toBe('customer_approved');
    expect(effectiveStatus({ status: 'proposed', expiresAt: '2000-01-01T00:00:00Z' })).toBe('expired');
  });
});
