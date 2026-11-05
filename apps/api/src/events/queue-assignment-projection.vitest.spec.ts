// queue-assignment-projection.vitest.spec — BUILD_PLAN Phase 6, §343: the AI queue layer has ONE direct-emission site
// (ai-queue-assignment.adapters.ts, branch-scoped). A SALON-WIDE change (no branch: the tenant kill switch, salon-level
// settings, the Super Admin's salon kill) is delivered only by this projection, to the owner's room; a branch-scoped
// one maps to nothing here (the AI layer already pushed it — no double delivery).
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = 'a6a6a6a6-0000-4000-8000-000000000001', B = 'a6a6a6a6-0000-4000-8000-000000000002';
function project(e: any) {
  const sent: any[] = [];
  const c = new RealtimeProjectionConsumer({
    toTenant: (ctx: any, ev: string) => sent.push(['tenant', ctx.branchId, ev]),
    toOwner: (t: string, ev: string, pl: any) => sent.push(['owner', t, ev, pl?.scope ?? null]),
  } as any);
  return c.handle(e).then(() => sent);
}

describe('queue-assignment salon-wide changes reach the owner through the projection', () => {
  it('both events are consumed by the projection', () => {
    const c = new RealtimeProjectionConsumer(null);
    expect(c.eventTypes).toEqual(expect.arrayContaining([DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED, DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED]));
  });
  it('salon-level settings change (no branch) → the owner room, once', async () => {
    const sent = await project({ eventType: DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED, tenantId: T, branchId: null, aggregateId: T, payload: { scope: 'salon', version: 4, change: 'platform_unkill' } });
    expect(sent).toEqual([['owner', T, EVENTS.queueAssignmentSettingsChanged, 'salon']]);
  });
  it('the salon kill switch (no branch) → the owner room, once', async () => {
    const sent = await project({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, tenantId: T, branchId: null, aggregateId: T, payload: { scope: 'salon', reason: 'review' } });
    expect(sent).toEqual([['owner', T, EVENTS.queueAutoAssignmentKilled, 'salon']]);
  });
  it('a branch-scoped change is NOT re-sent here (the AI layer pushed it already)', async () => {
    expect(await project({ eventType: DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED, tenantId: T, branchId: B, aggregateId: B, payload: { scope: 'branch', version: 2 } })).toEqual([]);
    expect(await project({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, tenantId: T, branchId: B, aggregateId: B, payload: { scope: 'branch' } })).toEqual([]);
  });
});
