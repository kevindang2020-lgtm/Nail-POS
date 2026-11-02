// schedule-projection.vitest.spec — BUILD_PLAN Phase 7: every schedule.* domain event reaches the optimizer screens ONLY
// through this projection (the module never emits realtime itself). Branch-scoped events go to that branch's room;
// salon-wide ones (no branch: tenant settings, the salon kill switch) to the owner's room. Payloads carry ids + status only.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer, projectToClient } from './consumers/realtime-projection.consumer';

const T = 'b7b7b7b7-0000-4000-8000-000000000001', B = 'b7b7b7b7-0000-4000-8000-000000000002', R = 'b7b7b7b7-0000-4000-8000-0000000000aa';
const SCHEDULE_TYPES = Object.entries(DOMAIN_EVENTS).filter(([k]) => k.startsWith('SCHEDULE_')).map(([, v]) => v);
function project(e: any) {
  const sent: any[] = [];
  const c = new RealtimeProjectionConsumer({
    toTenant: (ctx: any, ev: string, pl: any) => sent.push(['tenant', ctx.branchId, ev, pl]),
    toOwner: (t: string, ev: string, pl: any) => sent.push(['owner', t, ev, pl]),
  } as any);
  return c.handle(e).then(() => sent);
}

// §43 (Oct 21 2026): every projected payload also carries the resource envelope { resourceType, resourceId, resourceVersion };
// these assertions are about the DOMAIN fields, so the envelope is stripped before comparing.
const bare = (p: any) => { const { resourceType: _t, resourceId: _i, resourceVersion: _v, resourceVersionSource: _s, ...rest } = p ?? {}; return rest; };
const strip = (s: any[]) => [s[0], s[1], s[2], bare(s[3])];
describe('schedule.* → realtime projection', () => {
  it('the consumer subscribes to every schedule.* event (13)', () => {
    expect(SCHEDULE_TYPES).toHaveLength(13);
    expect(new RealtimeProjectionConsumer(null).eventTypes).toEqual(expect.arrayContaining(SCHEDULE_TYPES));
  });
  it('recommendation lifecycle events → schedule_recommendation_updated in the branch room, ids + status only', async () => {
    for (const t of [DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_GENERATED, DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_DECIDED, DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_EXPIRED,
      DOMAIN_EVENTS.SCHEDULE_CHANGE_APPLIED, DOMAIN_EVENTS.SCHEDULE_CHANGE_FAILED, DOMAIN_EVENTS.SCHEDULE_CHANGE_ROLLED_BACK]) {
      const sent = await project({ eventType: t, tenantId: T, branchId: B, aggregateId: R, payload: { recommendationId: R, status: 'applied', appointmentId: 'x', drift: ['startTime'] } });
      expect(sent.map(strip)).toEqual([['tenant', B, EVENTS.scheduleRecommendationUpdated, { recommendationId: R, status: 'applied' }]]);
    }
  });
  it('customer approval events refresh the recommendation AND the proposal views', async () => {
    const sent = await project({ eventType: DOMAIN_EVENTS.SCHEDULE_CUSTOMER_DECIDED, tenantId: T, branchId: B, aggregateId: R, payload: { recommendationId: R, status: 'customer_approved', approved: true } });
    expect(sent.map((s) => s[2])).toEqual([EVENTS.scheduleRecommendationUpdated, EVENTS.scheduleProposalUpdated]);
    expect(bare(sent[1][3])).toEqual({ recommendationId: R, proposalId: null, status: 'customer_approved' });
    expect((await project({ eventType: DOMAIN_EVENTS.SCHEDULE_CUSTOMER_APPROVAL_REQUESTED, tenantId: T, branchId: B, aggregateId: R, payload: { recommendationId: R, status: 'customer_approval_required' } })).map((s) => s[2]))
      .toEqual([EVENTS.scheduleRecommendationUpdated, EVENTS.scheduleProposalUpdated]);
  });
  it('a run → schedule_run_completed { runId, status }', async () => {
    expect((await project({ eventType: DOMAIN_EVENTS.SCHEDULE_RUN_COMPLETED, tenantId: T, branchId: B, aggregateId: R, payload: { runId: R, status: 'completed', recommendationCount: 2 } })).map(strip))
      .toEqual([['tenant', B, EVENTS.scheduleRunCompleted, { runId: R, status: 'completed' }]]);
  });
  it('settings / kill switch: branch room when scoped to a branch, the owner room when salon-wide', async () => {
    expect((await project({ eventType: DOMAIN_EVENTS.SCHEDULE_SETTINGS_CHANGED, tenantId: T, branchId: B, aggregateId: B, payload: { level: 'branch', version: 3 } })).map(strip))
      .toEqual([['tenant', B, EVENTS.scheduleSettingsChanged, { scope: 'branch', version: 3, status: 'changed' }]]);
    expect((await project({ eventType: DOMAIN_EVENTS.SCHEDULE_AUTOMATION_DISABLED, tenantId: T, branchId: null, aggregateId: T, payload: { scope: 'tenant', killed: true } })).map(strip))
      .toEqual([['owner', T, EVENTS.scheduleSettingsChanged, { scope: 'tenant', version: null, status: 'automation_disabled' }]]);
  });
  it('insights refresh the optimizer (recommendation channel) with the insight id', () => {
    const c = projectToClient({ eventType: DOMAIN_EVENTS.SCHEDULE_INSIGHT_DECIDED, tenantId: T, branchId: B, aggregateId: R, payload: { kind: 'duration', status: 'approved' } } as any);
    expect(c).toEqual([{ event: EVENTS.scheduleRecommendationUpdated, payload: { insightId: R, kind: 'duration', status: 'approved' } }]);
  });
});
