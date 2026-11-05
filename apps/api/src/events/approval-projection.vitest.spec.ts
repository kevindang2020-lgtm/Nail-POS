// approval-projection.vitest.spec — BUILD_PLAN Phase 9 (agent D): approval.* domain events reach the Approvals screens
// (POS + Owner App) ONLY through this projection, as approval_updated { approvalId, kind, status } to the salon's owner room,
// its branch-less room and the request's branch room — never another salon, never the request's reason / payload / amount.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS, rooms } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer, projectToClient } from './consumers/realtime-projection.consumer';

const id = (n: number) => `a9a9a9a9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SALON = id(1), BR = id(2), APR = id(3), OTHER = id(4);
const ev = (eventType: string, over: Record<string, unknown> = {}) => ({ eventType, tenantId: SALON, branchId: BR, aggregateId: APR, payload: {}, ...over }) as any;

describe('approval.* → realtime projection', () => {
  it('the consumer subscribes to all three approval events', () => {
    const types = new RealtimeProjectionConsumer(null).eventTypes as string[];
    for (const t of [DOMAIN_EVENTS.APPROVAL_REQUESTED, DOMAIN_EVENTS.APPROVAL_DECIDED, DOMAIN_EVENTS.APPROVAL_EXECUTED]) expect(types).toContain(t);
  });
  it('each maps to approval_updated with ids + kind + status only', () => {
    for (const [t, status] of [[DOMAIN_EVENTS.APPROVAL_REQUESTED, 'pending'], [DOMAIN_EVENTS.APPROVAL_DECIDED, 'rejected'], [DOMAIN_EVENTS.APPROVAL_EXECUTED, 'executed']] as const) {
      expect(projectToClient(ev(t, { payload: { approvalId: APR, kind: 'refund', status, reason: 'secret', amountCents: 9_999, ok: true } })))
        .toEqual([{ event: EVENTS.approvalUpdated, payload: { approvalId: APR, kind: 'refund', status }, scope: 'salon', branchIds: [BR] }]);
    }
  });
  it('reaches the owner room, the branch-less room and the request\'s branch — nothing in another salon', async () => {
    const sent: { room: string; event: string }[] = [];
    const rt: any = {
      toTenant: (ctx: any, event: string) => sent.push({ room: rooms.tenantBranch(ctx.tenantId, ctx.branchId), event }),
      toOwner: (t: string, event: string) => sent.push({ room: rooms.ownerTenant(t), event }),
    };
    await new RealtimeProjectionConsumer(rt).handle(ev(DOMAIN_EVENTS.APPROVAL_DECIDED, { payload: { approvalId: APR, kind: 'refund', status: 'approved' } }));
    expect(sent.map((s) => s.room).sort()).toEqual([rooms.ownerTenant(SALON), rooms.tenantBranch(SALON, ''), rooms.tenantBranch(SALON, BR)].sort());
    expect(sent.every((s) => s.event === EVENTS.approvalUpdated)).toBe(true);
    expect(sent.some((s) => s.room.includes(OTHER))).toBe(false);
  });
});
