// realtime-projection.b14 — B-14 (Oct 20 2026): the client events that domain services used to push DIRECTLY (outside
// outbox → projection) now come from the projection. Each case here is one of the former direct-emit sites.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './realtime-projection.consumer';

const T = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
function run(e: Record<string, unknown>) {
  const sent: Array<[string, string, unknown, unknown]> = [];
  const rt = {
    toTenant: (scope: any, ev: string, p: unknown) => sent.push(['tenant', ev, scope, p]),
    toOwner: (tenantId: string, ev: string, p: unknown) => sent.push(['owner', ev, tenantId, p]),
    toTechnician: (id: string, ev: string, p: unknown) => sent.push(['technician', ev, id, p]),
  };
  return new RealtimeProjectionConsumer(rt as any).handle({ tenantId: T, branchId: B, aggregateId: 'a1', payload: {}, ...e } as any).then(() => sent);
}

describe('B-14: former direct pushes delivered by the projection', () => {
  it('Booking board "Start service": appointment.updated { in_service } → appointmentUpdated + serviceStarted + queueUpdated', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, payload: { status: 'in_service' } });
    expect(sent.map((s) => s[1])).toEqual([EVENTS.appointmentUpdated, EVENTS.serviceStarted, EVENTS.queueUpdated]);
    expect(sent.every((s) => s[0] === 'tenant' && (s[2] as any).branchId === B)).toBe(true);
    expect(sent[1][3]).toMatchObject({ appointmentId: 'a1' });
  });
  it('a membership request reaches every room of the salon ASKED (owner, branch-less, each branch it names) — what emitTenantWide did by hand', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REQUESTED, branchId: null, aggregateId: 'req1', payload: { profileId: 'p1', transfer: true, branchIds: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] } });
    expect(sent.map((s) => [s[0], s[1], typeof s[2] === 'string' ? s[2] : (s[2] as any).branchId])).toEqual([
      ['owner', EVENTS.techMembershipRequested, T], ['tenant', EVENTS.techMembershipRequested, ''],
      ['tenant', EVENTS.techMembershipRequested, '33333333-3333-4333-8333-333333333333'], ['tenant', EVENTS.techMembershipRequested, '44444444-4444-4444-8444-444444444444']]);
    expect(sent[0][3]).toMatchObject({ profileId: 'p1', requestId: 'req1', transfer: true });   // ids only — never the salon she is leaving
  });
  it('a held profile edit is techProfileUpdated { held } to every room of the reviewing salon', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.TECHNICIAN_PROFILE_CHANGE_HELD, branchId: null, aggregateId: 'chg1', payload: { profileId: 'p1', held: true, branchIds: [B] } });
    expect(sent.map((s) => s[1])).toEqual([EVENTS.techProfileUpdated, EVENTS.techProfileUpdated, EVENTS.techProfileUpdated]);
    expect(sent[2][3]).toMatchObject({ profileId: 'p1', requestId: 'chg1', held: true });
  });
  it('any other appointment.updated stays a single appointmentUpdated (the board refetches by id)', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, payload: { status: 'arrived', date: '2026-10-20' } });
    expect(sent.map((s) => s[1])).toEqual([EVENTS.appointmentUpdated]);
    expect(sent[0][3]).toMatchObject({ appointmentId: 'a1', date: '2026-10-20' });
  });
});

// B-14 remainder: the queue-assignment layer's direct pushes (RealtimeAssignmentEmitter) now come from the projection — the
// same client names, the same id-only payloads, the branch's room; salon-wide settings / kill keep the owner's room.
describe('B-14 remainder: queue-assignment events delivered by the projection', () => {
  const Q = 'q1', R = 'r1', TECH = 't1', A = 'a1';
  const cases: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
    [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_RECOMMENDED, { queueEntryId: Q, recommendationId: R, recommended: TECH, requiredAction: 'assignable', confidence: 0.8, source: 'staff' }, EVENTS.queueAssignmentRecommended, { queueEntryId: Q, recommendationId: R, recommended: TECH, requiredAction: 'assignable', confidence: 0.8 }],
    [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_DECIDED, { decisionId: 'd1', recommendationId: R, queueItemId: Q, decision: 'accepted', technicianId: TECH, applied: true }, EVENTS.queueAssignmentDecided, { queueEntryId: Q, recommendationId: R, decisionId: 'd1', decision: 'accepted', technicianId: TECH, applied: true }],
    [DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNED, { decisionId: 'd2', recommendationId: R, queueItemId: Q, technicianId: TECH }, EVENTS.queueAutoAssigned, { queueEntryId: Q, technicianId: TECH, recommendationId: R }],
    [DOMAIN_EVENTS.QUEUE_ALERT_RAISED, { alertId: A, type: 'waiting_too_long', severity: 'critical', queueEntryId: Q, escalated: true }, EVENTS.queueAlertRaised, { alertId: A, type: 'waiting_too_long', severity: 'critical', queueEntryId: Q, escalated: true }],
    [DOMAIN_EVENTS.QUEUE_ALERT_ACKNOWLEDGED, { alertId: A, type: 'waiting_too_long', queueEntryId: Q }, EVENTS.queueAlertAcknowledged, { alertId: A, type: 'waiting_too_long' }],
    [DOMAIN_EVENTS.QUEUE_ALERT_RESOLVED, { alertId: A, type: 'waiting_too_long', queueEntryId: Q, autoResolved: false, resolution: 'resolved_by_staff' }, EVENTS.queueAlertResolved, { alertId: A, type: 'waiting_too_long', queueEntryId: Q, autoResolved: false, resolution: 'resolved_by_staff' }],
    [DOMAIN_EVENTS.QUEUE_RECORD_REPAIRED, { alertId: A, queueEntryId: Q, action: 'unassign' }, EVENTS.queueRecordRepaired, { alertId: A, queueEntryId: Q, action: 'unassign' }],
  ];
  for (const [type, payload, client, sentPayload] of cases) {
    it(`${type} → ${client} in the branch room`, async () => {
      const sent = await run({ eventType: type, payload, aggregateId: 'agg' });
      expect(sent.map((s) => [s[0], s[1], (s[2] as any).branchId])).toEqual([['tenant', client, B]]);
      expect(sent[0][3]).toMatchObject(sentPayload);
    });
  }
  it('settings changed / auto-assignment disabled: a BRANCH change → its room; a salon change → the owner room (as before)', async () => {
    const br = await run({ eventType: DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED, payload: { scope: 'branch', version: 4, change: 'update' } });
    expect(br.map((s) => [s[0], s[1], (s[2] as any).branchId])).toEqual([['tenant', EVENTS.queueAssignmentSettingsChanged, B]]);
    expect(br[0][3]).toMatchObject({ scope: 'branch', version: 4, change: 'update', resourceVersion: 4 });
    const kb = await run({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, payload: { scope: 'branch', reason: 'busy' } });
    expect(kb.map((s) => [s[0], s[1]])).toEqual([['tenant', EVENTS.queueAutoAssignmentKilled]]);
    const salon = await run({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, branchId: null, payload: { scope: 'salon' } });
    expect(salon.map((s) => [s[0], s[1]])).toEqual([['owner', EVENTS.queueAutoAssignmentKilled]]);
  });
});

// Oct 14 build plan §43 ("version on every realtime event"), rebuilt Oct 21 2026: every projected client payload names the
// resource it is about and its version, so a client can drop a stale frame (version lower than what it holds) and never
// repaint backwards. The version is the aggregate's (outbox aggregate_version, §40) when the domain tracks one, else the
// payload's own `version`, else null — and never a customer's name or phone (the projection adds ids only).
describe('resourceVersion on every projected event', () => {
  it('an appointment event carries resourceType, resourceId and the aggregate version the writer stamped', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, aggregateType: 'appointment', aggregateId: 'appt-7', aggregateVersion: 4, payload: { appointmentId: 'appt-7', status: 'in_service' } });
    const appt = sent.find((s) => s[1] === EVENTS.appointmentUpdated)!;
    expect(appt[3]).toMatchObject({ resourceType: 'appointment', resourceId: 'appt-7', resourceVersion: 4, resourceVersionSource: 'aggregate' });
  });
  it('without an aggregate version the payload\'s own version is used; with neither it is null — but the fields are always there', async () => {
    const a = await run({ eventType: DOMAIN_EVENTS.COMMUNITY_SETTINGS_CHANGED, aggregateType: 'community_settings', aggregateId: 'cs', payload: { version: 9 } });
    expect(a[0][3]).toMatchObject({ resourceType: 'community_settings', resourceId: 'cs', resourceVersion: 9, resourceVersionSource: 'payload' });
    const b = await run({ eventType: DOMAIN_EVENTS.APPOINTMENT_CANCELED, aggregateType: 'appointment', aggregateId: 'appt-8', payload: { appointmentId: 'appt-8' } });
    const ev = b.find((s) => s[1] === EVENTS.appointmentCancelled)!;
    expect(ev[3]).toMatchObject({ resourceType: 'appointment', resourceId: 'appt-8', resourceVersion: null, resourceVersionSource: null });
  });
});

// Extras REFUNDS & VOIDS 08 (Nov 12 2026): confirmed reversals refresh the money screens through the existing routing
describe('REFUNDS & VOIDS 08: confirmed reversal → existing refresh events', () => {
  it('payment.voided → checkout_total_recalculated (the ticket) + reports_updated, to the branch room, ids only', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.PAYMENT_VOIDED, aggregateId: 'pay1', payload: { paymentId: 'pay1', ticketId: 'tk1', method: 'card', amountCents: 4200 } });
    expect(sent.map((s) => s[1])).toEqual([EVENTS.checkoutTotalRecalculated, EVENTS.reportsUpdated]);
    expect(sent.every((s) => s[0] === 'tenant' && (s[2] as any).branchId === B)).toBe(true);
    expect(sent[0][3]).toMatchObject({ ticketId: 'tk1', paymentId: 'pay1' });
    expect(JSON.stringify(sent)).not.toContain('4200');
  });
  it('payment.refunded → reports_updated with the refund + payment ids (no amount)', async () => {
    const sent = await run({ eventType: DOMAIN_EVENTS.PAYMENT_REFUNDED, aggregateId: 'rf1', payload: { refundId: 'rf1', paymentId: 'pay1', amountCents: 1500 } });
    expect(sent.map((s) => s[1])).toEqual([EVENTS.reportsUpdated]);
    expect(sent[0][3]).toMatchObject({ refundId: 'rf1', paymentId: 'pay1' });
    expect(JSON.stringify(sent)).not.toContain('1500');
  });
});
