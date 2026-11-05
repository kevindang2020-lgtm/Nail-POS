// queue-multitech.controller.vitest.spec.ts — the two multi-technician routes (contract §5): their permission, and the
// 409 body naming the stale guest / line (registry code VERSION_CONFLICT) so the screen can say which service moved.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueAssignmentConflict } from './queue.dto';

const perm = (h: string) => Reflect.getMetadata('perm', (QueueController.prototype as any)[h]);
const req = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'FRONT_DESK', permissions: [] } };

describe('queue multi-technician routes', () => {
  it('POST plans/assign needs pos.queue.assign_technician; POST groups/:id/move-to-tech-queue needs pos.queue.move_to_tech_queue', () => {
    expect(perm('assignPlan')).toBe('pos.queue.assign_technician');
    expect(perm('moveGroup')).toBe('pos.queue.move_to_tech_queue');
  });
  it('a stale line → 409 { code: VERSION_CONFLICT, queueItemId, serviceId, currentTechnicianId, currentVersion }', async () => {
    const ctl = new QueueController({ assignPlan: async () => { throw new QueueAssignmentConflict('tech-x', 3, undefined, { queueItemId: 'q1', serviceId: 's2' }); } } as any);
    const err: any = await ctl.assignPlan(req, {}).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'VERSION_CONFLICT', queueItemId: 'q1', serviceId: 's2', currentTechnicianId: 'tech-x', currentVersion: 3 });
  });
  it('"Start party" passes the group id through', async () => {
    let seen = '';
    const ctl = new QueueController({ moveGroupToTechQueue: async (_c: any, id: string) => { seen = id; return { moved: [] }; } } as any);
    expect(await ctl.moveGroup(req, 'g-1')).toEqual({ moved: [] });
    expect(seen).toBe('g-1');
  });
});
