// tech-queue-transition-guard.vitest.spec.ts — the accept and move-to-serving transitions used to check the status
// gate in JS and then write UNCONDITIONALLY, so a ticket declined/cancelled (or already serving) in the check→write
// window could be resurrected. These pin the fix: the repo write itself refuses an illegal transition (returns false)
// and never changes the row.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTechQueueRepository } from './tech-queue.repository';

const ctx: any = { tenantId: 'luxe001', branchId: 'b1', userId: 'u1', role: 'TECHNICIAN', permissions: [] };
let repo: InMemoryTechQueueRepository;
const statusOf = async (id: string) => (await repo.ticket(ctx, id))!.status;

beforeEach(() => { repo = new InMemoryTechQueueRepository(); });

describe('accept — atomic precondition', () => {
  it('accepts from a pending state (assigned)', async () => {
    expect(await repo.accept(ctx, 'tq_6005', true)).toBe(true); // tq_6005 seeded 'assigned'
    expect(await statusOf('tq_6005')).toBe('ready_to_start');
  });
  it('REFUSES to resurrect a declined ticket', async () => {
    await repo.setStatus(ctx, 'tq_6005', 'declined');
    expect(await repo.accept(ctx, 'tq_6005', true)).toBe(false);
    expect(await statusOf('tq_6005')).toBe('declined'); // unchanged — not resurrected to accepted
  });
  it('REFUSES to re-accept an already in_service ticket', async () => {
    expect(await repo.accept(ctx, 'tq_6006', true)).toBe(false); // tq_6006 seeded 'in_service'
    expect(await statusOf('tq_6006')).toBe('in_service');
  });
});

describe('startServing — atomic precondition', () => {
  it('starts from an accepted state', async () => {
    expect(await repo.startServing(ctx, 'tq_6002')).toBe(true); // tq_6002 seeded 'accepted'
    expect(await statusOf('tq_6002')).toBe('in_service');
  });
  it('REFUSES to resurrect a cancelled ticket into service', async () => {
    await repo.setStatus(ctx, 'tq_6002', 'cancelled');
    expect(await repo.startServing(ctx, 'tq_6002')).toBe(false);
    expect(await statusOf('tq_6002')).toBe('cancelled');
  });
  it('REFUSES to resurrect a declined ticket into service', async () => {
    await repo.setStatus(ctx, 'tq_6002', 'declined');
    expect(await repo.startServing(ctx, 'tq_6002')).toBe(false);
    expect(await statusOf('tq_6002')).toBe('declined');
  });
  it('REFUSES to double-start an in_service ticket', async () => {
    expect(await repo.startServing(ctx, 'tq_6006')).toBe(false); // already in_service
    expect(await statusOf('tq_6006')).toBe('in_service');
  });
});
