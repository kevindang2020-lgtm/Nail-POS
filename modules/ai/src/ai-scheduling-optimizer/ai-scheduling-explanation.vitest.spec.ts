// ai-scheduling-explanation.vitest.spec — BUILD_PLAN Phase 7 (agent B): the LLM only WORDS a computed result. The model
// sees computed facts only (no customer / technician identity); any failure, the platform kill switch or an empty answer →
// the deterministic template; every explanation is metered. Also the usage port's billing rule.
import { describe, it, expect, vi } from 'vitest';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { SchedExplanationService, explanationFacts, templateExplanation, platformExplainAdapter, sanitizeExplanation } from './ai-scheduling-explanation';
import { SchedUsageService, InMemoryUsageStore, usageRow } from './ai-scheduling-usage';

const T = '22222222-0000-4000-8000-000000000001';
const CUST = '22222222-0000-4000-8000-0000000000c1';
const TECH = '22222222-0000-4000-8000-0000000000e1';
const ctx = { tenantId: T, branchId: null, userId: '22222222-0000-4000-8000-0000000000f1', role: 'MANAGER', permissions: ['ai_scheduling.view'] };
const rec = (over: Partial<SchedRecommendation> = {}): SchedRecommendation => ({
  id: '22222222-0000-4000-8000-0000000000a1', branchId: null, runId: null, type: 'move_appointment', status: 'review_required',
  currentState: { appointmentId: '22222222-0000-4000-8000-0000000000b1', date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: TECH, status: 'booked', version: 1, customerId: CUST },
  proposedState: { kind: 'reschedule', appointmentId: '22222222-0000-4000-8000-0000000000b1', date: '2026-10-20', startTime: '13:00', endTime: '14:00', technicianId: TECH },
  affectedAppointmentIds: [], affectedTechnicianIds: [TECH], hardConstraintsChecked: true, violations: [], simulation: null,
  expectedBenefit: ['closes a 60-minute gap'], possibleDownside: ['later finish'], confidence: 0.82, dataQuality: 'good',
  touchesConfirmedAppointment: true, requiresCustomerApproval: true, versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 1 },
  version: 1, applyAttempt: 0, automated: false, expiresAt: null, explanation: null, explanationSource: null, proposal: null, decidedByUserId: null, decidedAt: null, appliedAt: null,
  createdAt: '', updatedAt: '', ...over,
});

describe('facts + template', () => {
  it('facts carry no identities (no customer id, appointment id, technician id)', () => {
    const json = JSON.stringify(explanationFacts(rec()));
    expect(json).not.toContain(CUST);
    expect(json).not.toContain(TECH);
    expect(json).not.toContain('0000000000b1');
    expect(explanationFacts(rec()).technicianChanges).toBe(false);
    expect(explanationFacts(rec({ proposedState: { ...rec().proposedState!, technicianId: null } })).technicianChanges).toBe(true);
  });
  it('template states the move, why, the trade-off and the customer approval', () => {
    const t = templateExplanation(rec());
    expect(t).toContain('Move the appointment from 10:00 to 13:00');
    expect(t).toContain('Why: closes a 60-minute gap');
    expect(t).toContain('Trade-off: later finish');
    expect(t).toContain('customer must approve');
    expect(t).toContain('Confidence 82%');
    expect(templateExplanation(rec({ expectedBenefit: [] }))).toContain('No measurable improvement');
  });
  it('sanitize strips control characters and caps length', () => {
    expect(sanitizeExplanation('a\u0000\nb   c')).toBe('a b c');
    expect(sanitizeExplanation('x'.repeat(900))).toHaveLength(600);
  });
});

describe('SchedExplanationService', () => {
  const usage = () => { const store = new InMemoryUsageStore(); return { store, svc: new SchedUsageService(store) }; };
  it('LLM answer → source llm, facts only, metered with the model', async () => {
    const u = usage();
    const llm = { explain: vi.fn(async () => ({ text: 'Moving it closes the gap.', model: 'm-1', costMicroUsd: 12 })) };
    const out = await new SchedExplanationService(llm, u.svc, { isKilled: async () => false }).explain(ctx, rec());
    expect(out).toEqual({ text: 'Moving it closes the gap.', source: 'llm', language: 'en' });   // §120: no language from the model → English
    expect(llm.explain.mock.calls[0][0].facts).toEqual(explanationFacts(rec()));
    expect(u.store.rows[0]).toMatchObject({ action: 'explanation', modelName: 'm-1', usageAmount: 0, costMicroUsd: 0, status: 'success' });
  });
  it('LLM error / empty answer / no platform → template', async () => {
    const u = usage();
    const boom = { explain: vi.fn(async () => { throw new Error('AI_ACCESS_DENIED'); }) };
    expect((await new SchedExplanationService(boom, u.svc, null).explain(ctx, rec())).source).toBe('template');
    expect(u.store.rows[0].status).toBe('failed');
    const empty = { explain: vi.fn(async () => ({ text: '   ', model: 'm', costMicroUsd: 0 })) };
    expect((await new SchedExplanationService(empty, u.svc, null).explain(ctx, rec())).source).toBe('template');
    expect((await new SchedExplanationService(null, u.svc, null).explain(ctx, rec())).text).toBe(templateExplanation(rec()));
  });
  it('platform kill switch → template WITHOUT calling the model', async () => {
    const u = usage();
    const llm = { explain: vi.fn(async () => ({ text: 'x', model: 'm', costMicroUsd: 1 })) };
    const out = await new SchedExplanationService(llm, u.svc, { isKilled: async () => true }).explain(ctx, rec());
    expect(out.source).toBe('template');
    expect(llm.explain).not.toHaveBeenCalled();
  });
  it('the platform adapter calls the registered task with the facts only', async () => {
    const platform = { execute: vi.fn(async () => ({ data: { explanation: 'E.', benefit: 'less idle', tradeoff: null }, provenance: { model: 'm' }, usage: { costMicroUsd: 5 } })) };
    const r = await platformExplainAdapter(platform).explain({ tenantId: T, branchId: null, userId: null, facts: explanationFacts(rec()) });
    expect(platform.execute.mock.calls[0][0]).toMatchObject({ taskKey: 'schedule.explain_suggestion', tenantId: T, variables: { suggestion_json: explanationFacts(rec()) } });
    expect(r).toEqual({ text: 'E. Benefit: less idle.', model: 'm', costMicroUsd: 5, language: 'en' });
  });
});

describe('usage', () => {
  it('only an optimization run is billed (1 run); options / recommendations / explanations are recorded at 0', () => {
    expect(usageRow(ctx, 'optimization_run').usageAmount).toBe(1);
    expect(usageRow(ctx, 'optimization_run', { status: 'error' }).usageAmount).toBe(0);
    expect(usageRow(ctx, 'options', { amount: 5 }).usageAmount).toBe(0);
    expect(usageRow(ctx, 'recommendation').usageAmount).toBe(0);
    expect(usageRow({ ...ctx, userId: 'system:jobs' }, 'options').userId).toBeNull();
  });
  it('record never throws; summary validates the range and needs view', async () => {
    const svc = new SchedUsageService({ insert: async () => { throw new Error('db down'); }, summary: async () => ({ runs: 1, recommendations: 2, applied: 0, explanations: 0, llmCostMicroUsd: 0 }) }, () => new Date('2026-10-08T12:00:00Z'));
    await expect(svc.record(ctx, 'options')).resolves.toBeUndefined();
    expect(await svc.summary(ctx, {})).toMatchObject({ from: '2026-09-09', to: '2026-10-08', runs: 1 });
    await expect(svc.summary(ctx, { from: '2026-10-09', to: '2026-10-01' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.summary({ ...ctx, permissions: [] }, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
