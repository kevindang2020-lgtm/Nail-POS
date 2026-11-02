// ai-queue-assignment-plan-controller.vitest.spec.ts — the plan routes (contract §5): permissions, and a stale plan's
// 409 naming the guest / line.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { QueueAssignmentController } from './ai-queue-assignment.controller';
import { QueueAssignmentStaleError } from './ai-queue-assignment.dto';

const perm = (h: string) => Reflect.getMetadata('perm', (QueueAssignmentController.prototype as any)[h]);
const req = { ctx: { tenantId: 't', branchId: '22222222-2222-4222-8222-222222222222', userId: 'u', role: 'FRONT_DESK', permissions: [] }, headers: {} };

describe('AI queue plan routes', () => {
  it('plan reads need ai_queue_assignment.recommend; the decision needs ai_queue_assignment.assign', () => {
    expect(perm('planVisit')).toBe('ai_queue_assignment.recommend');
    expect(perm('planParty')).toBe('ai_queue_assignment.recommend');
    expect(perm('decidePlan')).toBe('ai_queue_assignment.assign');
  });
  it('a stale plan → 409 VERSION_CONFLICT with queueItemId + serviceId; the body is passed through', async () => {
    let body: any = null;
    const ctl = new QueueAssignmentController({ decidePlan: async (_c: any, _id: string, b: any) => { body = b; throw new QueueAssignmentStaleError('tech-x', undefined, { queueItemId: 'q1', serviceId: 's2' }); } } as any, {} as any);
    const err: any = await ctl.decidePlan(req, 'rec-1', { decision: 'adjusted', lines: [{ queueItemId: 'q1', serviceId: 's2', technicianId: 'tm' }], idempotencyKey: 'k' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'VERSION_CONFLICT', currentTechnicianId: 'tech-x', queueItemId: 'q1', serviceId: 's2' });
    expect(body).toMatchObject({ decision: 'adjusted', idempotencyKey: 'k', lines: [{ queueItemId: 'q1', serviceId: 's2', technicianId: 'tm' }] });
  });
});
