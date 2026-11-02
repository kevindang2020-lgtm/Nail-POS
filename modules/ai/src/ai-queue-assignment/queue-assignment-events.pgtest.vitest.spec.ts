// queue-assignment-events.pgtest — B-14 remainder (Oct 20 2026): every fact the queue-assignment layer used to push DIRECTLY
// to the boards is now a domain event, recorded in the same transaction as its write — so the realtime projection can deliver
// it and the direct push becomes the publisher-off fallback. Four facts had no record at all: a recommendation, an alert's
// ESCALATION, an alert acknowledged, a repair. (Raised / resolved / decided / auto-assigned / settings were already recorded.)
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';
import { KyselyQueueAlertRepository } from './ai-queue-assignment-alerts.repository';

const T = 'a7a7a7a7-0000-4000-8000-000000000001', B = 'a7a7a7a7-0000-4000-8000-000000000002';
const Q1 = 'a7a7a7a7-0000-4000-8000-0000000000e1', TECH = 'a7a7a7a7-0000-4000-8000-0000000000c1', U = 'a7a7a7a7-0000-4000-8000-0000000000aa';
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: [] };
const scope = { tenantId: T, branchId: B };
let pg: any; let repo: KyselyQueueAssignmentRepository; let alerts: KyselyQueueAlertRepository;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const events = (type: string) => q(`select aggregate_type, aggregate_id, branch_id, actor_id, payload_json from outbox_events where tenant_id = $1 and event_type = $2 order by created_at`, [T, type]);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Ev Salon', 'Ev Salon', 'ev-salon-b14', 'EVB14', 'active');
                 INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');`);
  const db = kyselyFor(pg) as never;
  repo = new KyselyQueueAssignmentRepository(db, new OutboxWriter());
  alerts = new KyselyQueueAlertRepository(db, new OutboxWriter());
}, 120000);

describe('B-14: the queue-assignment facts are recorded', () => {
  it('a recommendation → queue.assignment_recommended, ids and the decision inputs only', async () => {
    const saved = await repo.saveRecommendation(ctx, {
      queueEntryId: Q1, recommended: { technicianId: TECH, name: 'Ava', matchScore: 0.9, eligible: true, reasons: [], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 45 } as any,
      alternates: [], confidence: 0.8, conflicts: [], warnings: [], requiredAction: 'assignable', ruleVersion: 'r1', recoVersion: 'v1', generatedAt: new Date().toISOString(),
    } as any, 'staff');
    const ev = await events('queue.assignment_recommended');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'queue_assignment_recommendation', aggregate_id: saved.id, branch_id: B, actor_id: U });
    expect(ev[0].payload_json).toEqual({ queueEntryId: Q1, recommendationId: saved.id, recommended: TECH, requiredAction: 'assignable', confidence: 0.8, source: 'staff' });
  });
  it('an alert raised, then ESCALATED by a later scan → queue.alert_raised twice (the second escalated: true)', async () => {
    await alerts.applyScan(scope, [{ queueEntryId: Q1, type: 'waiting_too_long', severity: 'warning', reason: 'waiting 25 min', ageMinutes: 25 } as any]);
    const out = await alerts.applyScan(scope, [{ queueEntryId: Q1, type: 'waiting_too_long', severity: 'critical', reason: 'waiting 60 min', ageMinutes: 60 } as any]);
    expect(out.escalated).toHaveLength(1);
    const ev = await events('queue.alert_raised');
    expect(ev.map((e: any) => [e.payload_json.severity, e.payload_json.escalated ?? false])).toEqual([['warning', false], ['critical', true]]);
  });
  it('an alert acknowledged → queue.alert_acknowledged with the acting user; a second acknowledge records nothing', async () => {
    const [a] = await alerts.list(scope);
    expect(await alerts.acknowledge(scope, a.id, U, 'on it')).toBeTruthy();
    await alerts.acknowledge(scope, a.id, U, 'again');
    const ev = await events('queue.alert_acknowledged');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'queue_alert', aggregate_id: a.id, actor_id: U });
    expect(ev[0].payload_json).toMatchObject({ alertId: a.id, type: 'waiting_too_long', queueEntryId: Q1, status: 'acknowledged' });
  });
  it('a repair → queue.record_repaired with the action, in the repair\'s transaction', async () => {
    const [a] = await alerts.list(scope);
    await alerts.recordRepair(scope, { queueEntryId: Q1, alertId: a.id, action: 'unassign', reason: 'stuck', performedBy: U, role: 'MANAGER' });
    const ev = await events('queue.record_repaired');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ aggregate_type: 'queue_alert', aggregate_id: a.id, actor_id: U });
    expect(ev[0].payload_json).toEqual({ alertId: a.id, queueEntryId: Q1, action: 'unassign' });
  });
});
