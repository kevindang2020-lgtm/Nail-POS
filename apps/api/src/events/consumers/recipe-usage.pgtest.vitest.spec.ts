// recipe-usage.pgtest — D4 (Oct 22 2026) on real Postgres semantics: when a ticket reaches Service Done, every completed
// service line's recipe leaves the shelf EXACTLY ONCE — however many times the event is delivered, replayed, or written by
// the second Service Done path — and a line with no recipe, a retail line or a removed line moves nothing.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from '@aipowersalon/inventory';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { RecipeUsageConsumer } from './recipe-usage.consumer';

const T = '31111111-1111-1111-1111-111111111111', T2 = '32222222-2222-2222-2222-222222222222';
const B = '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B2 = '3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAT = '3ccccc00-cccc-cccc-cccc-cccccccccccc', GEL = '3cccccc1-cccc-cccc-cccc-cccccccccccc', PEDI = '3cccccc2-cccc-cccc-cccc-cccccccccccc';
const POLISH = '3ddddd01-dddd-dddd-dddd-dddddddddddd', OIL = '3ddddd02-dddd-dddd-dddd-dddddddddddd';
const CUST = '3dddddd9-dddd-dddd-dddd-dddddddddddd', TICKET = '3eeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', TICKET_T2 = '3eeeeee2-eeee-eeee-eeee-eeeeeeeeeeee';
const L_GEL = '3fffff01-ffff-ffff-ffff-ffffffffffff', L_GEL2 = '3fffff02-ffff-ffff-ffff-ffffffffffff', L_PEDI = '3fffff03-ffff-ffff-ffff-ffffffffffff', L_RETAIL = '3fffff04-ffff-ffff-ffff-ffffffffffff', L_REMOVED = '3fffff05-ffff-ffff-ffff-ffffffffffff';
let db: any; let runner: ConsumerRunner; let publisher: OutboxPublisher; let consumer: RecipeUsageConsumer;

const completed = (ticketId: string, tenantId = T, branchId = B) => createDomainEvent({
  eventType: DOMAIN_EVENTS.SERVICE_COMPLETED, tenantId, branchId, aggregateType: 'ticket', aggregateId: ticketId, actorType: 'user',
  correlationId: `ticket:${ticketId}`, payload: { ticketId, status: 'service_done', source: 'serving_mark_done', technicianIds: [], subtotalCents: 9000, idempotencyKey: `${ticketId}:send_to_service_done:9000` },
});
const onHand = async (p: string) => Number(((await sql`SELECT quantity_on_hand FROM inventory_location_stock WHERE product_id = ${p} AND branch_id = ${B}`.execute(db)).rows[0] as any)?.quantity_on_hand ?? 0);
const moves = async (p: string) => (await sql`SELECT movement_type, quantity_change, related_type, related_id, actor_user_id FROM inventory_stock_movements WHERE product_id = ${p} ORDER BY created_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','R','Recipe','recipe','RCP01','active'), ('${T2}','O','Other','other-rcp','RCP02','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown'), ('${B2}','${T2}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}','${T}','${B}','Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${GEL}','${T}','${B}','${CAT}','Gel Manicure',45,4500,'active'), ('${PEDI}','${T}','${B}','${CAT}','Pedicure',45,4500,'active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO inventory_products (id, tenant_id, name, is_retail, is_service, active, retail_price_cents, cost_cents) VALUES ('${POLISH}','${T}','Gel Polish',false,true,true,0,900), ('${OIL}','${T}','Cuticle Oil',true,false,true,1200,400);
    INSERT INTO inventory_units (tenant_id, branch_id, product_id, status, created_at) VALUES
      ('${T}','${B}','${POLISH}','unopened', now() - interval '3 days'), ('${T}','${B}','${POLISH}','unopened', now() - interval '2 days'), ('${T}','${B}','${POLISH}','unopened', now() - interval '1 day'),
      ('${T}','${B}','${OIL}','unopened', now() - interval '1 day');
    INSERT INTO service_product_recipes (tenant_id, service_id, product_id, quantity) VALUES ('${T}','${GEL}','${POLISH}',1);
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CUST}','${T}','${B}','Mia','Tran','Mia Tran','+16095550199','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES ('${TICKET}','${T}','${B}','${CUST}','service_done') ON CONFLICT (id) DO NOTHING;
    INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, quantity, line_kind, product_id, removed_at) VALUES
      ('${L_GEL}','${T}','${B}','${TICKET}','${GEL}','Gel Manicure',4500,45,4500,'completed',1,'service',NULL,NULL),
      ('${L_GEL2}','${T}','${B}','${TICKET}','${GEL}','Gel Manicure',4500,45,4500,'completed',1,'service',NULL,NULL),
      ('${L_PEDI}','${T}','${B}','${TICKET}','${PEDI}','Pedicure',4500,45,4500,'completed',1,'service',NULL,NULL),
      ('${L_RETAIL}','${T}','${B}','${TICKET}','${GEL}','Cuticle Oil',1200,0,1200,'completed',1,'retail','${OIL}',NULL),
      ('${L_REMOVED}','${T}','${B}','${TICKET}','${GEL}','Gel Manicure',4500,45,4500,'completed',1,'service',NULL,now());
    SET session_replication_role = replica;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES ('${TICKET_T2}','${T2}','${B2}','${CUST}','service_done') ON CONFLICT (id) DO NOTHING;
    SET session_replication_role = DEFAULT;
  `);
  db = kyselyFor(pg);
  consumer = new RecipeUsageConsumer(new InventoryService(db));
  const registry = new ConsumerRegistry(); registry.register(consumer);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);

describe('inventory.recipe_usage_on_service_done — a completed line deducts its recipe exactly once', () => {
  it('two completed Gel Manicure lines take two polish (one movement per LINE, related to the line, system actor kept by name); the pedicure (no recipe), the retail line and the removed line move nothing', async () => {
    expect(await onHand(POLISH)).toBe(0);                                             // location stock is computed on first movement
    await new OutboxWriter().write(db, completed(TICKET)); await publisher.tick();
    const m = await moves(POLISH);
    expect(m.map((x) => [x.movement_type, x.quantity_change, x.related_type])).toEqual([['service_usage', -1, 'ticket_line'], ['service_usage', -1, 'ticket_line']]);
    expect(new Set(m.map((x) => x.related_id))).toEqual(new Set([L_GEL, L_GEL2]));
    expect(m.every((x) => x.actor_user_id === null)).toBe(true);                     // 'system:<job>' is not a UUID — kept in the audit metadata, never in the column
    expect(await onHand(POLISH)).toBe(1);
    expect(await moves(OIL)).toEqual([]);
    const audit = (await sql`SELECT metadata_json FROM audit_logs WHERE tenant_id = ${T} AND action_type = 'service_recipe_consumed_at_service_done'`.execute(db)).rows as any[];
    expect(audit.length).toBe(2);
    expect(audit[0].metadata_json.systemActor).toBe('system:inventory.recipe_usage_on_service_done');
  });
  it('a redelivery of the same event, and the same fact re-emitted by the other Service Done write path, deduct nothing more', async () => {
    const again = completed(TICKET);
    expect((await runner.run(consumer, again)).status).toBe('processed');
    expect((await runner.run(consumer, again)).status).toBe('duplicate');
    expect((await moves(POLISH)).length).toBe(2);
    expect(await onHand(POLISH)).toBe(1);
  });
  it('§14: a ticket of another salon named by this salon\'s event is a security failure, not a deduction', async () => {
    const r = await runner.run(consumer, completed(TICKET_T2, T, B));
    expect(r.status).not.toBe('processed');
    expect((await moves(POLISH)).length).toBe(2);
  });
  it('a ticket that is gone, or a salon with no InventoryService bound, is a quiet no-op (never a retry storm)', async () => {
    expect((await runner.run(consumer, completed('3eeeeee9-eeee-eeee-eeee-eeeeeeeeeeee'))).status).toBe('processed');
    expect((await runner.run(new RecipeUsageConsumer(null), completed(TICKET))).status).toBe('processed');
    expect((await moves(POLISH)).length).toBe(2);
  });
});
