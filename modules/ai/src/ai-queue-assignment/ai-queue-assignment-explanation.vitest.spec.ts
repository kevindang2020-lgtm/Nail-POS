// ai-queue-assignment-explanation.vitest.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { deterministicExplanation, explanationPromptData, sanitize } from './ai-queue-assignment-explanation';
import { QueueExplanationService } from './ai-queue-assignment-explanation.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { QueueAssignmentValidationError, type QueueAssignmentContext, type RecommendationEnvelope } from './ai-queue-assignment.dto';

const ctx = (t = 'A'): QueueAssignmentContext => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai_queue_assignment.view'] });
const env = (o: Partial<RecommendationEnvelope> = {}): RecommendationEnvelope => ({
  queueEntryId: 'q1', recommended: { technicianId: 't1', name: 'Kim', eligible: true, matchScore: 90, reasons: ['Requested by guest', 'Next up in rotation'], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 30 },
  alternates: [{ technicianId: 't2', name: 'Lee', eligible: true, matchScore: 70, reasons: [], warnings: [], estimatedStartInMinutes: 5, estimatedCompletionInMinutes: 35 }],
  confidence: 0.82, conflicts: [], warnings: [], requiredAction: 'assignable', ruleVersion: 'qa-rule-1', recoVersion: 'qa-reco-1', generatedAt: '', ...o,
});

describe('pure explanation', () => {
  it('deterministic explanation names the tech + reasons + confidence', () => {
    const t = deterministicExplanation(env());
    expect(t).toMatch(/Suggested: Kim/);
    // BUILD_PLAN Phase 6 (audit, explanations): the spec forbids presenting a suggestion as "the best match".
    expect(t).not.toMatch(/best match/i);
    expect(t).toMatch(/Requested by guest/);
    expect(t).toMatch(/Confidence 82%/);
  });
  it('deterministic explanation handles no recommendation', () => {
    expect(deterministicExplanation(env({ recommended: null, conflicts: ['all techs on break'] }))).toMatch(/No technician could be recommended: all techs on break/);
  });
  it('prompt data carries no customer PII (tech names + reasons only)', () => {
    const d = explanationPromptData(env());
    expect(Object.keys(d)).toEqual(['recommendedTechnician', 'reasons', 'warnings', 'confidencePercent', 'alternates', 'requiredAction']);
    expect(d.recommendedTechnician).toBe('Kim');
  });
  it('sanitize strips control chars + bounds length', () => {
    expect(sanitize('hello\n\nworld\u0000!')).toBe('hello world !');
    expect(sanitize('x'.repeat(1000)).length).toBe(400);
  });
});

describe('QueueExplanationService', () => {
  async function seed() {
    const repo = new InMemoryQueueAssignmentRepository();
    const saved = await repo.saveRecommendation(ctx(), env());
    return { repo, id: saved.id };
  }

  it('falls back to deterministic text when no gateway', async () => {
    const { repo, id } = await seed();
    const svc = new QueueExplanationService(repo, undefined, new InMemoryQueueAssignmentEntitlement(() => true));
    const r = await svc.explain(ctx(), id);
    expect(r.source).toBe('fallback');
    expect(r.explanation).toMatch(/Suggested: Kim/);
  });

  // Constitution 10 Phase 23: the fake is now the platform port, which returns the VALIDATED
  // queue.explanation.v1 shape rather than raw provider text. The service composes explanation + key factor.
  it('uses the platform when available + sanitizes its output', async () => {
    const { repo, id } = await seed();
    const ai: any = { explain: vi.fn().mockResolvedValue({ explanation: 'Kim is free now and was requested.\n\n', keyFactor: 'shortest wait' }) };
    const svc = new QueueExplanationService(repo, ai, new InMemoryQueueAssignmentEntitlement(() => true));
    const r = await svc.explain(ctx(), id);
    expect(r.source).toBe('ai');
    expect(r.explanation).toBe('Kim is free now and was requested. (shortest wait)');
    expect(ai.explain).toHaveBeenCalled();
    // §45: the platform receives the COMPUTED recommendation, never a request to choose a technician.
    expect(Object.keys(ai.explain.mock.calls[0][0])).toEqual(['tenantId', 'userId', 'recommendation']);
  });

  it('falls back gracefully when the platform throws (outage, unentitled, or invalid output)', async () => {
    const { repo, id } = await seed();
    const gateway: any = { explain: vi.fn().mockRejectedValue(new Error('platform unavailable')) };
    const svc = new QueueExplanationService(repo, gateway, new InMemoryQueueAssignmentEntitlement(() => true));
    const r = await svc.explain(ctx(), id);
    expect(r.source).toBe('fallback');
    expect(r.explanation).toMatch(/Suggested: Kim/);
  });

  it('404s an unknown recommendation', async () => {
    const { repo } = await seed();
    const svc = new QueueExplanationService(repo, undefined, new InMemoryQueueAssignmentEntitlement(() => true));
    await expect(svc.explain(ctx(), 'nope')).rejects.toBeInstanceOf(QueueAssignmentValidationError);
  });
});
