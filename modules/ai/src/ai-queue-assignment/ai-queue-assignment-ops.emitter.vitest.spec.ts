// ai-queue-assignment-ops.emitter.vitest.spec — BUILD_PLAN Phase 6, §343: the ops layer (alerts, settings, the Super
// Admin kill) has no direct-emission site of its own. A branch-scoped change goes through the AI layer's ONE emitter
// under its registry name; a salon-wide change (no branch) is left to the domain event + realtime projection.
import { describe, it, expect } from 'vitest';
import { RealtimeOpsEmitter } from './ai-queue-assignment-ops.notifications';
import { RealtimeAssignmentEmitter } from './ai-queue-assignment.adapters';
import { EVENTS } from '@aipowersalon/realtime-contracts';

const T = 't-1', B = 'b-1';
function rig() {
  const sent: any[] = [];
  const bus = { toTenant: (ctx: any, ev: string, pl: any) => sent.push(['tenant', ctx.tenantId, ctx.branchId, ev, pl]), toOwner: (t: string, ev: string) => sent.push(['owner', t, ev]) } as any;
  return { sent, ops: new RealtimeOpsEmitter(new RealtimeAssignmentEmitter(bus)) };
}

describe('RealtimeOpsEmitter delegates to the one assignment emitter', () => {
  it('every ops event, branch-scoped, reaches the branch under its registry name', () => {
    const { sent, ops } = rig();
    const cases: [any, string][] = [['alert_raised', EVENTS.queueAlertRaised], ['alert_acknowledged', EVENTS.queueAlertAcknowledged], ['alert_resolved', EVENTS.queueAlertResolved],
      ['record_repaired', EVENTS.queueRecordRepaired], ['settings_changed', EVENTS.queueAssignmentSettingsChanged], ['auto_killed', EVENTS.queueAutoAssignmentKilled]];
    for (const [ev] of cases) ops.emit({ tenantId: T, branchId: B }, ev, { x: 1 });
    expect(sent).toEqual(cases.map(([, wire]) => ['tenant', T, B, wire, { x: 1 }]));
  });
  it('a salon-wide change (no branch) is not pushed from here — the projection owns it', () => {
    const { sent, ops } = rig();
    ops.emit({ tenantId: T, branchId: null }, 'auto_killed', { scope: 'salon' });
    ops.emit({ tenantId: T, branchId: null }, 'settings_changed', { scope: 'salon' });
    expect(sent).toEqual([]);
  });
  it('a throwing bus never breaks the caller', () => {
    const ops = new RealtimeOpsEmitter({ emit: () => { throw new Error('down'); } });
    expect(() => ops.emit({ tenantId: T, branchId: B }, 'alert_raised', {})).not.toThrow();
  });
});

// B-14 remainder (Oct 20 2026): every name this emitter sends is now a recorded domain event the projection delivers; with
// the publisher ON the emitter pushes nothing (it would be a second, unrecorded copy). Publisher off → it is the fallback.
describe('RealtimeAssignmentEmitter is the publisher-off fallback', () => {
  const bus = () => { const sent: any[] = []; return { sent, rt: { toTenant: (c: any, ev: string, p: any) => sent.push([ev, p]) } as any }; };
  it('projection delivers → no push', () => {
    const { sent, rt } = bus();
    new RealtimeAssignmentEmitter(rt, true, { EVENT_PUBLISHER_ENABLED: 'on' } as any).emit({ tenantId: T, branchId: B } as any, 'queue.auto_assigned', { queueEntryId: 'q' });
    expect(sent).toEqual([]);
  });
  it('projection does not deliver (no outbox / publisher off) → the push, as before', () => {
    const { sent, rt } = bus();
    new RealtimeAssignmentEmitter(rt, true, { EVENT_PUBLISHER_ENABLED: 'off' } as any).emit({ tenantId: T, branchId: B } as any, 'queue.auto_assigned', { queueEntryId: 'q' });
    expect(sent).toEqual([[EVENTS.queueAutoAssigned, { queueEntryId: 'q' }]]);
    const { sent: s2, rt: rt2 } = bus();
    new RealtimeAssignmentEmitter(rt2, false, { EVENT_PUBLISHER_ENABLED: 'on' } as any).emit({ tenantId: T, branchId: B } as any, 'queue.auto_assigned', { queueEntryId: 'q' });   // not recorded here (no database / outbox) = fallback, publisher or not
    expect(s2).toHaveLength(1);
  });
  it('every name the emitter maps has a recorded domain event of the same name (nothing is lost when it goes quiet)', async () => {
    const { DOMAIN_EVENTS } = await import('@aipowersalon/events');
    const recorded = new Set<string>(Object.values(DOMAIN_EVENTS) as string[]);
    const alias: Record<string, string> = { 'queue.auto_assignment_killed': 'queue.auto_assignment_disabled' };
    for (const name of Object.keys(RealtimeAssignmentEmitter.WIRE)) expect(recorded.has(alias[name] ?? name), name).toBe(true);
  });
});
