// go-check-in-alternates.vitest.spec.ts — BUILD_PLAN Phase 6 round 2: at the kiosk (no customer session) the guest
// sees whether the technician they asked for is busy and may accept another one. The queue decides (QueueService); the
// kiosk only proves the queue item was checked in by THIS session (its token), never another kiosk's guest.
import { describe, it, expect, beforeEach } from 'vitest';
import { GoCheckInService, GoCheckInError } from './go-check-in.service';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { sha256Hex, newToken } from './go-check-in.dto';
import { QueueAssignmentConflict } from '../queue/queue.dto';

function stubCheckIn() {
  let seq = 0;
  return {
    async walkIn(_ctx: any, body: any) { return { checkInId: 'ci_' + ++seq, customerId: 'cust_' + seq, customerName: body.customerName, quotedWaitMinutes: 5 }; },
    async moveToQueue(_ctx: any, id: string) { return { moved: true, duplicate: false, queueItemId: 'q_' + id, idempotencyKey: 'k' }; },
  };
}
function stubQueue() {
  const calls: any[] = [];
  return {
    calls, takenFor: new Set<string>(),
    async alternatesForItem(ctx: any, queueItemId: string) {
      calls.push({ m: 'alternates', queueItemId, tenantId: ctx.tenantId, branchId: ctx.branchId });
      return { requestedTechnician: { technicianId: 't_busy', name: 'Bea', busy: true, availableInMinutes: 40 }, alternates: [{ technicianId: 't_free', name: 'Ava', availableInMinutes: 0 }] };
    },
    async acceptAlternateForItem(ctx: any, queueItemId: string, technicianId: string, source: string) {
      calls.push({ m: 'accept', queueItemId, technicianId, source, tenantId: ctx.tenantId, role: ctx.role });
      if ((this as any).takenFor.has(technicianId)) throw new QueueAssignmentConflict(null, 1, 'That technician was just taken — please choose another, or keep waiting.');
      return { ok: true, queueItemId, requestedTechnicianId: technicianId, requestedTechnicianName: 'Ava', technicianName: 'Ava', version: 2 };
    },
  };
}

let repo: InMemoryGoCheckInRepository; let queue: ReturnType<typeof stubQueue>; let svc: GoCheckInService;
beforeEach(async () => {
  repo = new InMemoryGoCheckInRepository(); queue = stubQueue();
  svc = new GoCheckInService(repo as any, stubCheckIn() as any, undefined, undefined, undefined, undefined, queue as any);
  const dev = await repo.createDevice({ tenantId: 'T', branchId: 'B', deviceName: 'Kiosk', checkinSlug: 'k' });
  await repo.setDeviceToken('T', dev.id, sha256Hex(newToken()));
  await repo.upsertSettings('T', { enabled: true, serviceSelectionEnabled: false });
});

describe('the kiosk check-in result says who is busy and who else could take the guest', () => {
  it('walk-in: queueItemId, requestedTechnician, alternates', async () => {
    const s = await svc.startSession('k');
    const r: any = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Rita Ray' });
    expect(r).toMatchObject({ status: 'checked_in', queueItemId: 'q_ci_1',
      requestedTechnician: { technicianId: 't_busy', name: 'Bea', busy: true, availableInMinutes: 40 }, alternates: [{ technicianId: 't_free', name: 'Ava', availableInMinutes: 0 }] });
    expect(queue.calls[0]).toMatchObject({ m: 'alternates', queueItemId: 'q_ci_1', tenantId: 'T', branchId: 'B' });
  });
  it('without the queue wired the result still checks the guest in (requested null, no alternates)', async () => {
    const plain = new GoCheckInService(repo as any, stubCheckIn() as any);
    const s = await plain.startSession('k');
    const r: any = await plain.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Rita Ray' });
    expect(r).toMatchObject({ status: 'checked_in', queueItemId: 'q_ci_1', requestedTechnician: null, alternates: [] });
  });
});

describe('POST go-check-in/session/:id/accept-alternate', () => {
  it("accepts for the session's own guest, source kiosk → { technicianName }", async () => {
    const s = await svc.startSession('k');
    const r: any = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Rita Ray' });
    expect(await svc.acceptAlternate(s.sessionId, s.sessionToken, { queueItemId: r.queueItemId, technicianId: 't_free' })).toEqual({ ok: true, technicianName: 'Ava' });
    expect(queue.calls.at(-1)).toMatchObject({ m: 'accept', queueItemId: r.queueItemId, technicianId: 't_free', source: 'kiosk', tenantId: 'T', role: 'KIOSK' });
  });
  it("another session's guest is refused (404) and never reaches the queue", async () => {
    const a = await svc.startSession('k'); const b = await svc.startSession('k');
    const r: any = await svc.checkInWalkIn(a.sessionId, a.sessionToken, { customerName: 'Rita Ray' });
    const e = await svc.acceptAlternate(b.sessionId, b.sessionToken, { queueItemId: r.queueItemId, technicianId: 't_free' }).catch((x) => x);
    expect(e).toBeInstanceOf(GoCheckInError); expect(e.status).toBe(404);
    expect(queue.calls.filter((c) => c.m === 'accept')).toHaveLength(0);
  });
  it('a bad token is refused before anything else', async () => {
    const s = await svc.startSession('k');
    await expect(svc.acceptAlternate(s.sessionId, 'wrong', { queueItemId: 'q_x', technicianId: 't_free' })).rejects.toBeInstanceOf(GoCheckInError);
  });
  it('the technician was taken meanwhile → 409', async () => {
    const s = await svc.startSession('k');
    const r: any = await svc.checkInWalkIn(s.sessionId, s.sessionToken, { customerName: 'Rita Ray' });
    queue.takenFor.add('t_free');
    const e = await svc.acceptAlternate(s.sessionId, s.sessionToken, { queueItemId: r.queueItemId, technicianId: 't_free' }).catch((x) => x);
    expect(e).toBeInstanceOf(GoCheckInError); expect(e.status).toBe(409); expect(e.code).toBe('technician_taken');
  });
});
