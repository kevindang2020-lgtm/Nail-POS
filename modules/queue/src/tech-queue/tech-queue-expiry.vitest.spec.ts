import { describe, it, expect } from 'vitest';
import { offerIsExpired, DEFAULT_TQ_SETTINGS } from './tech-queue.dto';
import { InMemoryTechQueueRepository, type TechQueueContext } from './tech-queue.repository';
import { TechQueueService } from './tech-queue.service';

const ctx: TechQueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'OWNER', permissions: ['pos.tech_queue.view', 'pos.tech_queue.accept'] };
const SEC = 1000;

describe('offerIsExpired (server-authoritative §12)', () => {
  const base = { status: 'assigned' as const, acceptedAtMs: null, deadlineMs: 1000 };
  it('expires a pending, unaccepted, past-deadline offer', () => {
    expect(offerIsExpired(base, 2000)).toBe(true);
  });
  it('does not expire before the deadline', () => {
    expect(offerIsExpired(base, 500)).toBe(false);
  });
  it('never expires an accepted offer', () => {
    expect(offerIsExpired({ ...base, acceptedAtMs: 900 }, 9999)).toBe(false);
  });
  it('never expires when there is no deadline (acceptance not required)', () => {
    expect(offerIsExpired({ ...base, deadlineMs: null }, 9999)).toBe(false);
  });
  it('only a pending offer status can expire', () => {
    for (const s of ['accepted', 'ready_to_start', 'in_service', 'cancelled', 'declined', 'expired'] as const) {
      expect(offerIsExpired({ ...base, status: s }, 9999)).toBe(false);
    }
    expect(offerIsExpired({ ...base, status: 'waiting_for_acceptance' }, 9999)).toBe(true);
  });
  it('default timeout is a positive number of seconds', () => {
    expect(DEFAULT_TQ_SETTINGS.acceptanceTimeoutSeconds).toBeGreaterThan(0);
  });
});

describe('TechQueueService.expireDueOffers (in-memory sweep)', () => {
  it('sweeps only past-deadline unaccepted offers to expired; leaves others alone', async () => {
    const repo = new InMemoryTechQueueRepository();
    const svc = new TechQueueService(repo);
    const now = Date.now();

    // tq_6005 is a pending 'assigned' offer; tq_6001 is 'waiting_for_acceptance'; tq_6002 is already 'accepted'.
    const offered = await repo.ticket(ctx, 'tq_6005'); // pending
    const waiting = await repo.ticket(ctx, 'tq_6001'); // pending
    const accepted = await repo.ticket(ctx, 'tq_6002'); // accepted
    offered!.deadlineMs = now - 5 * SEC;   // past → should expire
    waiting!.deadlineMs = now + 60 * SEC;  // future → should NOT expire
    accepted!.deadlineMs = now - 60 * SEC; // past, but accepted → should NOT expire

    const res = await svc.expireDueOffers(now);
    expect(res.expired).toBe(1);
    expect(res.offers.map((o) => o.id)).toEqual(['tq_6005']);
    expect((await repo.ticket(ctx, 'tq_6005'))!.status).toBe('expired');
    expect((await repo.ticket(ctx, 'tq_6001'))!.status).toBe('waiting_for_acceptance');
    expect((await repo.ticket(ctx, 'tq_6002'))!.status).toBe('accepted');

    // idempotent: a second sweep finds nothing left to expire
    expect((await svc.expireDueOffers(now)).expired).toBe(0);
  });
});
