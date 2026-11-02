// ai-scheduling-automation.vitest.spec — BUILD_PLAN Phase 7 (agent B): every UNSAFE case stays manual. Automation runs only
// for an internal, reversible, allow-listed, confident action with every switch off — and is recorded as automated.
import { describe, it, expect, vi } from 'vitest';
import type { SchedRecommendation, SchedRunDetail } from '@aipowersalon/api-contracts/tenant';
import { SchedAutomationRunner, automationVerdict, SAFE_ACTION_FOR } from './ai-scheduling-automation';
import { resolveSettings, PLATFORM_DEFAULTS } from './ai-scheduling-settings';

const T = '33333333-0000-4000-8000-000000000001';
const ctx = { tenantId: T, branchId: '33333333-0000-4000-8000-000000000002', userId: 'system:jobs', role: 'SYSTEM', permissions: [], actor: 'system' as const };
const rec = (over: Partial<SchedRecommendation> = {}): SchedRecommendation => ({
  id: '33333333-0000-4000-8000-0000000000a1', branchId: ctx.branchId, runId: 'run', type: 'open_availability', status: 'review_required',
  currentState: null, proposedState: null, affectedAppointmentIds: [], affectedTechnicianIds: [], hardConstraintsChecked: true, violations: [], simulation: null,
  expectedBenefit: [], possibleDownside: [], confidence: 0.95, dataQuality: 'good', touchesConfirmedAppointment: false, requiresCustomerApproval: false,
  versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 1 }, version: 2, applyAttempt: 0, automated: false, expiresAt: null,
  explanation: null, explanationSource: null, proposal: null, decidedByUserId: null, decidedAt: null, appliedAt: null, createdAt: '', updatedAt: '', ...over,
});
const allowAll = () => resolveSettings({ tenant: { level: 'tenant', branch_id: null, enabled: true, kill_switch: false, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot', 'close_unavailable_tech', 'recalc_estimated_end', 'update_internal_capacity', 'apply_preapproved_gap_rule', 'add_internal_warning'], confidenceThreshold: 0.85 } } });
const detail = (recs: SchedRecommendation[]): SchedRunDetail => ({ run: { id: 'run', branchId: ctx.branchId } as any, gaps: [], conflicts: [], recommendations: recs });
const appt = { appointmentId: 'a', date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: 't', status: 'booked', version: 1, customerId: null };

describe('automationVerdict — unsafe stays manual', () => {
  const r = allowAll();
  it('a safe internal allow-listed confident action is automated', () => {
    expect(automationVerdict(r, rec())).toMatchObject({ automated: true, action: 'open_empty_slot' });
  });
  it('touches a confirmed appointment → manual', () => expect(automationVerdict(r, rec({ touchesConfirmedAppointment: true })).automated).toBe(false));
  it('touches a customer → manual', () => expect(automationVerdict(r, rec({ requiresCustomerApproval: true })).reason).toBe('customer_facing_requires_review'));
  it('a customer on the current appointment → manual', () => expect(automationVerdict(r, rec({ currentState: { ...appt, customerId: 'c' } })).automated).toBe(false));
  it('moves an appointment (proposed state) → manual even when allow-listed', () => expect(automationVerdict(r, rec({ proposedState: { kind: 'reschedule', appointmentId: 'a', date: 'd', startTime: '1', endTime: '2', technicianId: null } })).reason).toBe('moves_an_appointment_requires_review'));
  it('affects an appointment id → manual', () => expect(automationVerdict(r, rec({ affectedAppointmentIds: ['a'] })).automated).toBe(false));
  it('a current appointment with no customer → still manual', () => expect(automationVerdict(r, rec({ currentState: appt })).automated).toBe(false));
  it('a type with no safe action (move_appointment, change_technician, resolve_overbooking …) → manual', () => {
    for (const type of ['move_appointment', 'change_technician', 'offer_alternate_time', 'resolve_overbooking', 'add_buffer', 'move_break', 'preserve_schedule'] as const) {
      expect(SAFE_ACTION_FOR[type]).toBeUndefined();
      expect(automationVerdict(r, rec({ type })).reason).toBe('not_a_safe_action');
    }
  });
  it('below the confidence threshold → manual', () => expect(automationVerdict(r, rec({ confidence: 0.84 })).reason).toBe('not_permitted_by_settings'));
  it('action not on the salon allowlist → manual', () => {
    const narrow = resolveSettings({ tenant: { level: 'tenant', branch_id: null, enabled: true, kill_switch: false, config: { automationEnabled: true, allowedAutoActions: ['close_unavailable_tech'] } } });
    expect(automationVerdict(narrow, rec()).automated).toBe(false);
    expect(automationVerdict(narrow, rec({ type: 'close_availability' })).automated).toBe(true);
  });
  it('not open any more (accepted / applied) → manual', () => expect(automationVerdict(r, rec({ status: 'accepted' })).reason).toBe('not_open'));
  it('defaults (automation off) → manual', () => expect(automationVerdict(resolveSettings({ platform: PLATFORM_DEFAULTS }), rec()).automated).toBe(false));
});

describe('SchedAutomationRunner', () => {
  const make = (resolved: any, gate = { blocked: false, by: null as string | null }) => {
    const engine: any = { effectiveConfig: vi.fn(async () => resolved) };
    const applier = { markAutomated: vi.fn(async () => true) };
    const events = { emit: vi.fn(async () => undefined) };
    return { engine, applier, events, runner: new SchedAutomationRunner(engine, applier, { automationBlocked: async () => gate }, events) };
  };
  it('applies the safe one, records it automated, leaves the unsafe one, emits CHANGE_APPLIED {automated}', async () => {
    const m = make(allowAll());
    const safe = rec(), unsafe = rec({ id: '33333333-0000-4000-8000-0000000000a2', type: 'move_appointment' });
    const v = await m.runner.evaluate(ctx, detail([safe, unsafe]));
    expect(v.map((x) => x.automated)).toEqual([true, false]);
    expect(m.applier.markAutomated).toHaveBeenCalledTimes(1);
    expect(m.applier.markAutomated.mock.calls[0][0]).toMatchObject({ actor: 'automation', branchId: ctx.branchId });
    expect(m.applier.markAutomated.mock.calls[0][2]).toBe('open_empty_slot');
    expect(m.events.emit).toHaveBeenCalledWith(expect.anything(), 'schedule.change_applied', expect.objectContaining({ id: safe.id }), expect.objectContaining({ automated: true, status: 'applied' }));
    expect(m.engine.effectiveConfig.mock.calls[0][0].branchId).toBe(ctx.branchId);
  });
  it('platform switch (optimizer or AI auto-actions) → nothing runs, settings not even read', async () => {
    const m = make(allowAll(), { blocked: true, by: 'ai_auto_actions_disabled' });
    const v = await m.runner.evaluate(ctx, detail([rec()]));
    expect(v[0]).toMatchObject({ automated: false, reason: 'platform_blocked:ai_auto_actions_disabled' });
    expect(m.engine.effectiveConfig).not.toHaveBeenCalled();
    expect(m.applier.markAutomated).not.toHaveBeenCalled();
  });
  it('salon / location kill switch → nothing runs', async () => {
    const killed = resolveSettings({ tenant: { level: 'tenant', branch_id: null, enabled: true, kill_switch: false, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot'] } }, branch: { level: 'branch', branch_id: 'b', enabled: true, kill_switch: true, config: null } });
    const m = make(killed);
    expect((await m.runner.evaluate(ctx, detail([rec()])))[0].reason).toBe('kill_switch');
    expect(m.applier.markAutomated).not.toHaveBeenCalled();
  });
  it('the engine reporting platformKilled → nothing runs', async () => {
    const m = make({ ...allowAll(), platformKilled: true });
    expect((await m.runner.evaluate(ctx, detail([rec()])))[0].reason).toContain('platform_blocked');
    expect(m.applier.markAutomated).not.toHaveBeenCalled();
  });
  it('a recommendation that changed meanwhile (CAS lost) is not reported automated and emits nothing', async () => {
    const m = make(allowAll()); m.applier.markAutomated.mockResolvedValueOnce(false);
    expect((await m.runner.evaluate(ctx, detail([rec()])))[0]).toMatchObject({ automated: false, reason: 'changed_meanwhile' });
    expect(m.events.emit).not.toHaveBeenCalled();
  });
  it('a settings error keeps everything manual and never throws into the run', async () => {
    const m = make(allowAll()); m.engine.effectiveConfig.mockRejectedValueOnce(new Error('db'));
    await expect(m.runner.afterRun(ctx, detail([rec()]))).resolves.toBeUndefined();
    expect(m.runner.last[0].reason).toBe('automation_error');
  });
});
