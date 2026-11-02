// malformed-input-4xx.vitest.spec — Security Deep Scan §163 run 3 (Oct 27 2026): the five AI routes the local injection
// pass found answering 5xx on malformed input now answer 4xx with a code (docs/security/SECURITY_TEST_REPORT.md §4).
// Each case drives the real controller (and the real service where the fix lives there) with the hostile value the pass sent.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AiGovernanceController } from './ai-governance/ai-governance.controller';
import { AiGovernanceService } from './ai-governance/ai-governance.service';
import { InMemoryAiGovernanceRepo } from './ai-governance/ai-governance.repository';
import { MoneyProtectionController } from './ai-money-protection/ai-money-protection.controller';
import { InvestigationService } from './ai-money-protection/ai-money-protection-investigations.service';
import { InMemoryInvestigationRepository } from './ai-money-protection/ai-money-protection-investigations.repository';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection/ai-money-protection.repository';
import { AiReviewReputationController } from './ai-review-reputation/ai-review-reputation.controller';
import { AiReviewReputationService } from './ai-review-reputation/ai-review-reputation.service';
import { EscalationService } from './ai-review-reputation/ai-review-reputation-escalation.service';
import { CallIntelligenceController } from './call-intelligence/call-intelligence.controller';
import { CallIntelligenceService } from './call-intelligence/call-intelligence.service';
import { InMemoryCallIntelRepo } from './call-intelligence/call-intelligence.repository';

const HOSTILE = "' OR '1'='1";
const T = '11111111-1111-4111-8111-111111111111';
const req = (permissions: string[]) => ({ ctx: { tenantId: T, branchId: null, userId: 'u1', role: 'OWNER', permissions } });
async function outcome(p: unknown): Promise<{ status: number; body: any }> {
  try { await p; return { status: 200, body: null }; } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    const x = e as { status?: number; expose?: boolean; code?: string };
    if (x?.expose === true && typeof x.status === 'number') return { status: x.status, body: { code: x.code } };   // the platform filter's exposed-error convention
    return { status: 500, body: String((e as Error)?.message) };
  }
}

describe('§163 run 3 — AI routes answer 4xx on malformed input', () => {
  it('PATCH /tenant/ai/control-modes/:assistantKey — an unknown assistant is 404 RESOURCE_NOT_FOUND, a bad mode 400, no key 403', async () => {
    const ctl = new AiGovernanceController(new AiGovernanceService(new InMemoryAiGovernanceRepo(), () => ['ai_booking_assistant']));
    const owner = req(['ai.control.manage']);
    expect(await outcome(ctl.set(owner, HOSTILE, { mode: 'disabled' }))).toMatchObject({ status: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
    expect(await outcome(ctl.set(owner, 'ai_booking_assistant', { mode: HOSTILE }))).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(await outcome(ctl.set(req([]), 'ai_booking_assistant', { mode: 'disabled' }))).toMatchObject({ status: 403, body: { code: 'PERMISSION_DENIED' } });
    expect((await outcome(ctl.set(owner, 'ai_booking_assistant', { mode: 'disabled' }))).status).toBe(200);   // the good call still works
  });

  it('POST /pos/ai-money-protection/investigations — a severity outside the CHECK vocabulary is 400 before any insert', async () => {
    const inv = new InvestigationService(new InMemoryInvestigationRepository(), new InMemoryMoneyProtectionRepository());
    const ctl = new MoneyProtectionController({} as any, inv, {} as any);
    const r = req(['ai_money_protection.view', 'ai_money_protection.investigate']);
    expect((await outcome(ctl.createInvestigation(r, { title: 'Review', severity: HOSTILE }))).status).toBe(400);
    expect((await outcome(ctl.createInvestigation(r, { title: 'Review', severity: 'HIGH' }))).status).toBe(200);
  });

  it('POST /pos/ai-review-reputation/sync — a source outside the vocabulary is 400 VALIDATION_ERROR (not a 502)', async () => {
    const ctl = new AiReviewReputationController(new AiReviewReputationService({} as any, {} as any, {} as any, {} as any, {} as any, new Map()));
    const r = req(['pos.ai_review_reputation.manage']);
    expect(await outcome(ctl.sync(r, { source: HOSTILE }))).toMatchObject({ status: 400, body: { error: 'VALIDATION_ERROR' } });
    expect((await outcome(ctl.sync(r, { source: 'google' }))).status).toBe(502);   // a real source with no adapter here: the honest 502
  });

  it('POST /pos/ai-review-reputation/:id/recovery — an unknown action type is 400; an error outside the taxonomy reaches the platform filter unwrapped', async () => {
    const recorded: string[] = [];
    const esc = new EscalationService({} as any, {} as any, { record: async (_c: any, _id: string, t: string) => { recorded.push(t); return { id: 'r1', status: 'recommended' as const }; } } as any, {} as any);
    const svc: any = Object.create(AiReviewReputationService.prototype); svc.escalation = esc;
    const ctl = new AiReviewReputationController(svc);
    const r = req(['pos.ai_review_reputation.manage']);
    expect(await outcome(ctl.recordRecovery(r, T, { type: HOSTILE }))).toMatchObject({ status: 400, body: { error: 'VALIDATION_ERROR' } });
    expect(recorded).toEqual([]);
    expect((await outcome(ctl.recordRecovery(r, T, { type: 'manager_call' }))).status).toBe(200);
    // the Kysely store's unknown review → REVIEW_NOT_FOUND (404) through the same wrapper
    svc.escalation = { recordRecoveryAction: async () => { throw new Error('REVIEW_NOT_FOUND'); } };
    expect((await outcome(ctl.recordRecovery(r, T, { type: 'manager_call' }))).status).toBe(404);
    // a database data exception (malformed id) is passed through as-is — the platform filter answers it 400 INVALID_INPUT
    const dbErr = Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    svc.escalation = { recordRecoveryAction: async () => { throw dbErr; } };
    await expect(ctl.recordRecovery(r, HOSTILE, { type: 'manager_call' })).rejects.toBe(dbErr);
  });

  it('POST /tenant/ai/call-intelligence/events — unknown status / direction / outcome / date are 400 VALIDATION_FAILED, never reaching the state machine', async () => {
    const ctl = new CallIntelligenceController(new CallIntelligenceService(new InMemoryCallIntelRepo()));
    const r = req(['ai.use']);
    for (const bad of [{ providerCallId: 'CA1', status: HOSTILE }, { providerCallId: 'CA1', status: 'missed', direction: HOSTILE }, { providerCallId: 'CA1', status: 'missed', outcome: HOSTILE }, { providerCallId: 'CA1', status: 'missed', startedAt: HOSTILE }, { status: 'missed' }]) {
      expect(await outcome(ctl.ingest(r, bad)), JSON.stringify(bad)).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    }
    expect((await outcome(ctl.ingest(r, { providerCallId: 'CA1', status: 'missed' }))).status).toBe(200);
  });
});
