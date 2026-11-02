// cash-handoff-producer.pgtest — Constitution 13 §343 for a technician's cash hand-off: each fact is recorded in the SAME
// transaction as the hand-off row, and the realtime projection produces exactly what the service used to push — the
// front desk's tenant event AND the technician's own room.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { TechCashHandoffRepository } from '@aipowersalon/workforce';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';
import { seedTechnician } from './pgtest-seed';

let db: any; let repo: TechCashHandoffRepository;
const T = '44444444-4444-4444-8444-444444444444', B = '55555555-5555-4555-8555-555555555555', U = '66666666-6666-4666-8666-666666666666';
const TECH = '77777777-7777-4777-8777-777777777777';
const ctx = { tenantId: T, branchId: B, userId: U };
const D = '2026-09-26';
const saved = process.env.EVENT_PUBLISHER_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.EVENT_PUBLISHER_ENABLED; else process.env.EVENT_PUBLISHER_ENABLED = saved; });
const outbox = async (type: string) => (await sql`SELECT event_type, aggregate_id, tenant_id, branch_id, payload_json FROM outbox_events WHERE event_type = ${type}`.execute(db)).rows as any[];
async function project(row: any) {
  const sent: any[] = [];
  const c = new RealtimeProjectionConsumer({ toTenant: (scope: any, event: any, payload: any) => sent.push({ to: 'tenant', scope, event, payload }),
    toTechnician: (id: string, event: any, payload: any) => sent.push({ to: 'technician', id, event, payload }) } as any);
  await c.handle({ eventType: row.event_type, tenantId: row.tenant_id, branchId: row.branch_id, aggregateId: row.aggregate_id, payload: row.payload_json } as any);
  return sent;
}

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Handoff Salon') ON CONFLICT DO NOTHING`, [T]).catch(() => {});
  await pg.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`, [B, T]).catch(() => {});
  await seedTechnician(pg, TECH, T, B);   // was a silently-failing insert (display_name does not exist)
  repo = new TechCashHandoffRepository(db, new OutboxWriter());
});

describe('cash hand-off facts go through the outbox and the projection (§343)', () => {
  it('submit -> cash_handoff.submitted -> the front desk hears cash_handoff_submitted', async () => {
    await repo.submit(ctx, TECH, D, { expectedCents: 12000, paymentCount: 3 });
    const [e] = await outbox('cash_handoff.submitted');
    expect(e).toMatchObject({ tenant_id: T, branch_id: B, aggregate_id: `${TECH}:${D}` });
    expect(e.payload_json).toMatchObject({ technicianId: TECH, businessDate: D, expectedCents: 12000, paymentCount: 3 });
    const sent = await project(e);
    expect(sent.map((x) => [x.to, x.event])).toEqual([['tenant', 'cash_handoff_submitted']]);
  });
  it('reconcile with a variance -> the front desk hears cash_handoff_discrepancy AND the technician hears cash_handoff_reconciled', async () => {
    await repo.reconcile(ctx, TECH, D, { expectedCents: 12000, paymentCount: 3 }, 11000, null);
    const [e] = await outbox('cash_handoff.reconciled');
    expect(e.payload_json).toMatchObject({ status: 'discrepancy', varianceCents: -1000, countedCents: 11000 });
    const sent = await project(e);
    expect(sent.map((x) => [x.to, x.event])).toEqual([['tenant', 'cash_handoff_discrepancy'], ['technician', 'cash_handoff_reconciled']]);
    expect(sent[1]).toMatchObject({ id: TECH, payload: { status: 'discrepancy', varianceCents: -1000 } });
  });
  it('the delivery path: projection only with the publisher ON', () => {
    delete process.env.EVENT_PUBLISHER_ENABLED; expect(repo.emitsDomainEvents()).toBe(false);
    process.env.EVENT_PUBLISHER_ENABLED = '1'; expect(repo.emitsDomainEvents()).toBe(true);
  });
});
