// customer-queue-alternates.vitest.spec.ts — BUILD_PLAN Phase 6 round 2: GET customer/queue adds the requested
// technician (busy or not) and, when busy, the alternates — from the queue module, for the customer's OWN visit only.
import { describe, it, expect } from 'vitest';
import { CustomerController } from './customer.controller';

const req = { ctx: { tenantId: 't', branchId: null, userId: 'u', role: 'CUSTOMER', permissions: [] } };
const base = { inQueue: true, queueItemId: 'q1', position: 2, totalWaiting: 4, estimatedWaitMinMinutes: 10, estimatedWaitMaxMinutes: 15, status: 'waiting' };
const svc = (st: any) => ({ getQueue: async () => st }) as any;

describe('GET customer/queue', () => {
  it('adds requestedTechnician + alternates from the queue for the visit it found', async () => {
    const asked: string[] = [];
    const queue = { customerQueueExtras: async (_c: any, id: string) => { asked.push(id); return { requestedTechnician: { technicianId: 'tb', name: 'Bea', busy: true, availableInMinutes: 40 }, alternates: [{ technicianId: 'ta', name: 'Ava', availableInMinutes: 0 }] }; } } as any;
    const r = await new CustomerController(svc(base), {} as any, null, queue).queue(req);
    expect(asked).toEqual(['q1']);
    expect(r).toEqual({ ...base, requestedTechnician: { technicianId: 'tb', name: 'Bea', busy: true, availableInMinutes: 40 }, alternates: [{ technicianId: 'ta', name: 'Ava', availableInMinutes: 0 }] });
  });
  it('not in the queue → unchanged; a queue failure → null / [] and the position still shows', async () => {
    expect(await new CustomerController(svc({ inQueue: false }), {} as any, null, {} as any).queue(req)).toEqual({ inQueue: false });
    const broken = { customerQueueExtras: async () => { throw new Error('down'); } } as any;
    expect(await new CustomerController(svc(base), {} as any, null, broken).queue(req)).toEqual({ ...base, requestedTechnician: null, alternates: [] });
  });
});
