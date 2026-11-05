import { describe, it, expect } from 'vitest';
import { CheckInService } from './check-in.service';
import { InMemoryCheckInRepository, type CheckInContext } from './check-in.repository';
import type { DuplicateInput } from '@aipowersalon/reports';

const PERMS = ['pos.check_in.view', 'pos.check_in.walk_in', 'pos.check_in.appointment', 'pos.check_in.create_customer', 'pos.customers.view', 'pos.customers.create', 'pos.check_in.move_to_queue', 'pos.queue.create', 'pos.tech_queue.create'];
const owner = (over: Partial<CheckInContext> = {}): CheckInContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

function stubRecorder() {
  const dupes: DuplicateInput[] = [];
  return { dupes, recordFailedEvent: async () => {}, recordHandoff: async () => {}, recordUnmatched: async () => {}, recordDuplicateCandidate: async (i: DuplicateInput) => { dupes.push(i); } };
}

describe('check-in duplicate detection emits monitor candidates (§29)', () => {
  it('records a duplicate candidate on walk-in idempotency replay', async () => {
    const rec = stubRecorder();
    const svc = new CheckInService(new InMemoryCheckInRepository(), rec);
    const body = { customerName: 'Dup Test', customerPhone: '+18565550199', serviceIds: ['svc_mani'], idempotencyKey: 'idem-xyz' } as any;
    const first = await svc.walkIn(owner(), body);
    expect(rec.dupes.length).toBe(0); // first check-in is not a duplicate
    const second = await svc.walkIn(owner(), body); // same idempotency key → replay
    expect(second.checkInId).toBe(first.checkInId); // idempotent: same record returned
    expect(rec.dupes.length).toBe(1);
    expect(rec.dupes[0]).toMatchObject({ tenantId: 'luxe001', branchId: 'br_cherryhill', checkInMethod: 'walk_in', reviewState: 'pending' });
    expect(rec.dupes[0].matchReasons).toContain('idempotency_replay');
  });

  it('does not record a duplicate for a distinct walk-in', async () => {
    const rec = stubRecorder();
    const svc = new CheckInService(new InMemoryCheckInRepository(), rec);
    await svc.walkIn(owner(), { customerName: 'Solo A', customerPhone: '+18565550111', serviceIds: ['svc_mani'], idempotencyKey: 'k-a' } as any);
    await svc.walkIn(owner(), { customerName: 'Solo B', customerPhone: '+18565550222', serviceIds: ['svc_mani'], idempotencyKey: 'k-b' } as any);
    expect(rec.dupes.length).toBe(0);
  });

  it('is safe when no recorder is wired (optional dependency)', async () => {
    const svc = new CheckInService(new InMemoryCheckInRepository());
    const body = { customerName: 'NoRec', customerPhone: '+18565550333', serviceIds: ['svc_mani'], idempotencyKey: 'k-nr' } as any;
    const first = await svc.walkIn(owner(), body);
    const second = await svc.walkIn(owner(), body);
    expect(second.checkInId).toBe(first.checkInId); // still idempotent, no crash
  });
});
