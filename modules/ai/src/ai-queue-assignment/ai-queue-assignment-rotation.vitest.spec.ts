// ai-queue-assignment-rotation.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { computeRotation } from './ai-queue-assignment-rotation';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { QueueAssignmentValidationError, QueueAssignmentForbiddenError, type QueueAssignmentContext } from './ai-queue-assignment.dto';

const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.manage_rules'];
const ctx = (t = 'A', perms = PERMS): QueueAssignmentContext => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });

describe('computeRotation', () => {
  const cands = [
    { technicianId: 't1', assignedMinutes: 120, activeAssignments: 2, availableInMinutes: 30, fixedRotationIndex: 1 },
    { technicianId: 't2', assignedMinutes: 30, activeAssignments: 1, availableInMinutes: 5, fixedRotationIndex: 0 },
    { technicianId: 't3', assignedMinutes: 60, activeAssignments: 0, availableInMinutes: 60, fixedRotationIndex: 2 },
  ];
  it('least_minutes ranks fewest assigned minutes first', () => {
    const r = computeRotation('least_minutes', cands);
    expect(r.t2).toBe(0); expect(r.t3).toBe(1); expect(r.t1).toBe(2);
  });
  it('least_customers ranks fewest active first', () => {
    const r = computeRotation('least_customers', cands);
    expect(r.t3).toBe(0); // 0 active
  });
  it('first_available ranks soonest-free first', () => {
    const r = computeRotation('first_available', cands);
    expect(r.t2).toBe(0); // 5 min
  });
  it('fixed_order follows the tech-queue rotation position', () => {
    const r = computeRotation('fixed_order', cands);
    expect(r.t2).toBe(0); expect(r.t1).toBe(1); expect(r.t3).toBe(2);
  });
  it('hybrid blends minutes + customer count', () => {
    const r = computeRotation('hybrid', cands);
    expect(r.t2).toBe(0); // 30 + 20 = 50, lowest
  });
});

describe('service — the queue\'s workload signals + rotation', () => {
  async function make(policy = 'least_minutes') {
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: {
      entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null },
      candidates: [
        // the signals come with QueueService.assignmentInputs (round 2: the tech-queue workload adapter is gone)
        { technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, assignedMinutes: 200 },
        { technicianId: 't2', name: 'Lee', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, assignedMinutes: 20 },
        { technicianId: 't3', name: 'Ana', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, assignedMinutes: 0, onBreak: true }, // on break → ineligible
      ],
    } });
    const settings = new InMemoryQueueAssignmentSettings();
    await settings.update({ tenantId: 'A', branchId: 'b1' }, { rotationPolicy: policy as any }, { userId: 'u1' });
    const svc = new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), undefined, { settings });
    return svc;
  }

  it('excludes the on-break tech and prefers the least-loaded eligible one', async () => {
    const svc = await make('least_minutes');
    const env = await svc.recommend(ctx(), 'q1');
    // t3 on break → not eligible; between t1 (200 min) and t2 (20 min), least_minutes → t2 top rotation
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.alternates.find((a) => a.technicianId === 't3')).toBeUndefined();
    // the real assigned-minutes reason shows up
    expect(env.recommended?.reasons.join(' ')).toMatch(/assigned min|rotation/i);
  });

  it('rotation policy get/set is permissioned + validated', async () => {
    const svc = await make();
    // BUILD_PLAN Phase 6, audit bug 7: a JSON object (the POS screen's res.json() threw on the bare string)
    // RE-PINNED Oct 13 2026 (FLOW T1): a legacy scoring policy IS its fairness mode — least_minutes reads as workload_balanced,
    // fixed_order as manual_order (the fixed order kept). One Fair Turn Engine, no second ranking authority.
    expect(await svc.getRotationPolicy(ctx())).toEqual({ policy: 'workload_balanced', fixedOrder: [] });
    await expect(svc.setRotationPolicy(ctx('A', ['ai_queue_assignment.view']), { policy: 'hybrid' })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    await expect(svc.setRotationPolicy(ctx(), { policy: 'bogus' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(svc.setRotationPolicy(ctx(), { policy: 'fixed_order', fixedOrder: 'x' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    expect(await svc.setRotationPolicy(ctx(), { policy: 'fixed_order', fixedOrder: ['t2', 't1'] })).toEqual({ policy: 'manual_order', fixedOrder: ['t2', 't1'] });
    expect(await svc.getRotationPolicy(ctx())).toEqual({ policy: 'manual_order', fixedOrder: ['t2', 't1'] });
  });
});
