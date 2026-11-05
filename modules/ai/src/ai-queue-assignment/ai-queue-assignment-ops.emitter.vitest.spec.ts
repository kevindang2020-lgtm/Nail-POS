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
