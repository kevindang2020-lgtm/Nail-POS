// cash-drawer-producer.pgtest — Constitution 13 §343 for the register cash drawer. Each drawer fact is written to the
// outbox in the SAME transaction as the drawer row, and the realtime projection turns it into exactly the client event the
// service used to push directly. With the publisher off the repository says so, and the service keeps its direct push.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { CashDrawerRepository } from '@aipowersalon/checkout';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

let db: any; let repo: CashDrawerRepository;
const T = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
const ctx = { tenantId: T, branchId: B, userId: U };
const D = '2026-09-26';
const saved = process.env.EVENT_PUBLISHER_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.EVENT_PUBLISHER_ENABLED; else process.env.EVENT_PUBLISHER_ENABLED = saved; });

async function outbox(type: string) {
  return (await sql`SELECT event_type, aggregate_id, tenant_id, branch_id, payload_json, actor_type FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];
}
async function project(row: any) {
  const sent: any[] = [];
  const c = new RealtimeProjectionConsumer({ toTenant: (scope: any, event: any, payload: any) => sent.push({ scope, event, payload }) } as any);
  await c.handle({ eventType: row.event_type, tenantId: row.tenant_id, branchId: row.branch_id, aggregateId: row.aggregate_id, payload: row.payload_json } as any);
  return sent;
}

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Drawer Salon') ON CONFLICT DO NOTHING`, [T]).catch(() => {});
  await pg.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`, [B, T]).catch(() => {});
  repo = new CashDrawerRepository(db, new OutboxWriter());
});

describe('cash drawer facts go through the outbox and the projection (§343)', () => {
  it('open -> cash_drawer.opened in the same transaction -> the client event cash_drawer_opened', async () => {
    await repo.open(ctx, B, 'main', D, 15000);   // registerId (developer's multi-register drawers, migration 478)
    const [e] = await outbox('cash_drawer.opened');
    expect(e).toMatchObject({ tenant_id: T, branch_id: B, actor_type: 'user' });
    expect(e.payload_json).toMatchObject({ branchId: B, businessDate: D, openingFloatCents: 15000 });
    const [c] = await project(e);
    expect(c.event).toBe('cash_drawer_opened');
    expect(c.scope).toMatchObject({ tenantId: T, branchId: B });
  });
  it('a movement and its void each record a fact -> cash_drawer_movement', async () => {
    await repo.addMovement(ctx, B, 'main', D, 'out', 2500, 'supplies', null);
    const [m] = await outbox('cash_drawer.movement_recorded');
    expect(m.payload_json).toMatchObject({ direction: 'out', amountCents: 2500 });
    expect((await project(m))[0].event).toBe('cash_drawer_movement');
    expect(await repo.voidMovement(ctx, m.aggregate_id)).toBe(true);
    const [v] = await outbox('cash_drawer.movement_voided');
    expect(v.payload_json).toMatchObject({ voidedMovementId: m.aggregate_id, branchId: B, businessDate: D });
    expect(await repo.voidMovement(ctx, m.aggregate_id)).toBe(false);           // already voided: no second fact
    expect((await outbox('cash_drawer.movement_voided')).length).toBe(1);
  });
  it('reconcile -> cash_drawer.reconciled; a variance projects to cash_drawer_discrepancy', async () => {
    await repo.reconcile(ctx, B, 'main', D, 999999, null);
    const [r] = await outbox('cash_drawer.reconciled');
    expect(r.payload_json.status).toBe('discrepancy');
    expect((await project(r))[0].event).toBe('cash_drawer_discrepancy');
  });
  it('the repository reports the delivery path: projection only when the publisher is ON', () => {
    delete process.env.EVENT_PUBLISHER_ENABLED;
    expect(repo.emitsDomainEvents()).toBe(false);      // the service keeps its direct push
    process.env.EVENT_PUBLISHER_ENABLED = '1';
    expect(repo.emitsDomainEvents()).toBe(true);       // the projection delivers; no double push
    expect(new CashDrawerRepository(db).emitsDomainEvents()).toBe(false);
  });
});
