// ai-queue-assignment-analytics.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { computeDecisionAnalytics, type DecisionLike } from './ai-queue-assignment-analytics';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const dec = (o: Partial<DecisionLike>): DecisionLike => ({ decision: 'accepted', chosenTechnicianId: 't1', reason: null, createdAt: '2026-07-08T10:00:00Z', ...o });

describe('computeDecisionAnalytics', () => {
  it('counts by type + computes rates', () => {
    const a = computeDecisionAnalytics([
      dec({ decision: 'accepted' }), dec({ decision: 'accepted' }),
      dec({ decision: 'overridden', chosenTechnicianId: 't2' }),
      dec({ decision: 'rejected', reason: 'guest requested someone else', chosenTechnicianId: null }),
    ]);
    expect(a.total).toBe(4);
    expect(a.accepted).toBe(2); expect(a.overridden).toBe(1); expect(a.rejected).toBe(1);
    expect(a.acceptanceRate).toBe(0.5); expect(a.overrideRate).toBe(0.25); expect(a.rejectionRate).toBe(0.25);
    expect(a.topRejectionReasons[0]).toEqual({ reason: 'guest requested someone else', count: 1 });
    expect(a.byChosenTechnician.find((t) => t.technicianId === 't1')?.count).toBe(2);
  });
  it('rates are null (not fabricated) when there is no data', () => {
    const a = computeDecisionAnalytics([]);
    expect(a.total).toBe(0);
    expect(a.acceptanceRate).toBeNull();
    expect(a.overrideRate).toBeNull();
  });
  it('groups by day', () => {
    const a = computeDecisionAnalytics([dec({ createdAt: '2026-07-07T09:00:00Z' }), dec({ createdAt: '2026-07-08T09:00:00Z' }), dec({ createdAt: '2026-07-08T11:00:00Z' })]);
    expect(a.byDay).toEqual([{ date: '2026-07-07', total: 1, accepted: 1, overridden: 0 }, { date: '2026-07-08', total: 2, accepted: 2, overridden: 0 }]);
  });
});

describe('service — decision history + analytics', () => {
  const ctx = (t = 'A'): QueueAssignmentContext => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.assign', 'ai_queue_assignment.override'] });
  function make() {
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: { entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null }, candidates: [{ technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false }] } });
    return new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true));
  }

  it('history + analytics reflect recorded decisions, tenant-isolated', async () => {
    const svc = make();
    const env = await svc.recommend(ctx('A'), 'q1');
    await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted', chosenTechnicianId: 't1' });
    const env2 = await svc.recommend(ctx('A'), 'q1');
    await svc.decide(ctx('A'), env2.recommendationId, { decision: 'overridden', chosenTechnicianId: 't9' });

    const history = await svc.decisionHistory(ctx('A'), {});
    expect(history.length).toBe(2);
    const analytics = await svc.decisionAnalytics(ctx('A'), {});
    expect(analytics.total).toBe(2);
    expect(analytics.acceptanceRate).toBe(0.5);
    expect(analytics.overrideRate).toBe(0.5);
    // tenant B sees nothing
    expect((await svc.decisionHistory(ctx('B'), {})).length).toBe(0);
    expect((await svc.decisionAnalytics(ctx('B'), {})).total).toBe(0);
  });
});
