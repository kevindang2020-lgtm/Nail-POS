// deals-capacity.postgres-race — BUILD_PLAN Phase 5 exit criterion: "oversell proven impossible on real Postgres under
// concurrency". Real PostgreSQL, a real connection pool, requests truly in flight together:
//   • a deal capped at N, many customers booking it at once (reserve → appointment → consume) → exactly N bookings;
//   • a deal applied to many walk-in tickets at once → exactly N applications;
//   • a coupon code with a cap of 1 redeemed from several registers at once → exactly one;
//   • one customer, max 1 per customer, several tabs at once → exactly one.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DealsService } from './deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { hashCode, codeHint } from '../engine/coupons';

const url = process.env.PG_RACE_URL;
const T = 'a5500000-0000-4000-8000-0000000000aa';
const B = 'b5500000-0000-4000-8000-0000000000bb';
const CAT = 'c5500000-0000-4000-8000-0000000000cc';
const SVC = 'd5500000-0000-4000-8000-0000000000dd';
const TECH = 'e5500000-0000-4000-8000-0000000000ee';
const ctx: any = { tenantId: T, branchId: B, userId: 'f5500000-0000-4000-8000-0000000000ff', role: 'OWNER', permissions: [] };
let db: Kysely<any>; let pool: pg.Pool; let svc: DealsService;
let day = 0;

async function deal(over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const o: any = { max_redemptions: null, max_per_customer: null, ...over };
  await sql`insert into deals (id, tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status, max_redemptions, max_per_customer)
            values (${id}, ${T}, ${B}, 'salon', 'Race deal', 'percent', 20, 5000, 4000, 'active', ${o.max_redemptions}, ${o.max_per_customer})`.execute(db);
  await sql`insert into deal_services (deal_id, service_id, tenant_id) values (${id}, ${SVC}, ${T})`.execute(db);
  return id;
}
async function ticket(customerId: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values (${id}, ${T}, ${B}, ${customerId}, 'ready_checkout', 5000, 5000)`.execute(db);
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
            values (${T}, ${B}, ${id}, ${SVC}, 'Gel', 5000, 45, 5000)`.execute(db);
  return id;
}
/** The cashier's whole "apply" on one register: judge → (priced) → take the place atomically. */
async function applyAt(checkout: DealsCheckoutService, ticketId: string, req: { dealId?: string; code?: string }): Promise<boolean> {
  try {
    const c = await checkout.candidate(ctx, ticketId, req);
    await checkout.reserve(ctx, ticketId, c, { id: c.offer.id, category: c.offer.category, description: '', appliedCents: 1000, lines: [] });
    return true;
  } catch (e: any) {
    // a refusal is a clean DealRefusedError (sold out, used, budget spent) — never a raw database error surfacing as a 500
    if (e?.name === 'DealRefusedError') return false;
    throw e;
  }
}
async function customer(): Promise<string> {
  const id = randomUUID();
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${id}, ${T}, ${B}, 'Race', 'Cust', 'Race Cust')`.execute(db);
  return id;
}
async function appointment(customerId: string): Promise<string> {
  const id = randomUUID();
  const d = new Date(Date.UTC(2028, 0, 1) + (day++) * 86_400_000).toISOString().slice(0, 10);
  await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
            values (${id}, ${T}, ${B}, ${TECH}, ${customerId}, 'Race Cust', ${d}, '10:00', '11:00', ${JSON.stringify([{ serviceId: SVC }])}::jsonb, 'booked')`.execute(db);
  return id;
}
/** One customer's whole booking: reserve the deal, create the appointment, consume the reservation. */
async function book(dealId: string, customerId: string): Promise<boolean> {
  try {
    const r = await svc.reserveDeal(ctx, dealId, customerId, 'race-' + randomUUID(), { serviceIds: [SVC], channel: 'customer_app' });
    if (r.soldOut) return false;
    await svc.consumeReservation(ctx, r.holdId!, await appointment(customerId));
    return true;
  } catch { return false; }
}
const cleanup = async () => {
  for (const t of ['deal_redemptions', 'deal_redemption_holds', 'deal_analytics_events', 'deal_services', 'deal_coupon_codes', 'deal_coupon_batches', 'deal_code_lookup_failures', 'deal_versions', 'ticket_service_lines']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from tickets where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from audit_logs where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from deals where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from customers where tenant_id = ${T}`.execute(db).catch(() => undefined);
};

describe.skipIf(!url)('deal capacity under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await cleanup();
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Deals', 'Race Deals', 'race-deals', 'RDL01', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 45, 5000) on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Rae', 'Deal', 'Rae Deal', true) on conflict (id) do nothing`.execute(db);
    svc = new DealsService(new KyselyDealsRepository(db as any, new OutboxWriter()));
  });
  afterAll(async () => {
    await cleanup();
    await sql`delete from technicians where id = ${TECH}`.execute(db).catch(() => undefined);
    await sql`delete from services where id = ${SVC}`.execute(db).catch(() => undefined);
    await sql`delete from service_categories where id = ${CAT}`.execute(db).catch(() => undefined);
    await sql`delete from branches where id = ${B}`.execute(db).catch(() => undefined);
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('a deal capped at 3, twelve customers booking at once → exactly 3 bookings hold it', async () => {
    const d = await deal({ max_redemptions: 3 });
    const customers = await Promise.all(Array.from({ length: 12 }, () => customer()));
    const won = (await Promise.all(customers.map((c) => book(d, c)))).filter(Boolean);
    expect(won).toHaveLength(3);
    const held = (await sql`select count(*)::int as n from deal_redemption_holds where deal_id = ${d} and status in ('held','consumed','redeemed')`.execute(db)).rows[0] as any;
    expect(held.n).toBe(3);
    // and a thirteenth, later, sequentially: still sold out
    expect(await book(d, await customer())).toBe(false);
  });

  it('deterministic interleaving: a booking INSIDE an open transaction holding the deal\'s lock, a second meanwhile → still one place', async () => {
    const d = await deal({ max_redemptions: 1 });
    const [c1, c2] = [await customer(), await customer()];
    let second: Promise<boolean> | null = null;
    await db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'dealhold:' + d}, 0))`.execute(trx);   // what the ledger takes
      second = book(d, c2);                                    // starts while the first holds the lock
      await new Promise((r) => setTimeout(r, 300));
      await sql`INSERT INTO deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at) VALUES (${d}, ${T}, ${c1}, ${'manual-' + randomUUID()}, 'consumed', now())`.execute(trx);
    });
    expect(await second!).toBe(false);
    const held = (await sql`select count(*)::int as n from deal_redemption_holds where deal_id = ${d} and status in ('held','consumed','redeemed')`.execute(db)).rows[0] as any;
    expect(held.n).toBe(1);
  });

  it('a walk-in deal capped at 2, applied at ten registers at once → exactly 2 tickets carry it', async () => {
    const d = await deal({ max_redemptions: 2 });
    const checkout = new DealsCheckoutService(svc, (svc as any).repo.ledger);
    const tickets = await Promise.all(Array.from({ length: 10 }, async () => ticket(await customer())));
    const won = (await Promise.all(tickets.map((t) => applyAt(checkout, t, { dealId: d })))).filter(Boolean);
    expect(won).toHaveLength(2);
    expect(((await sql`select count(*)::int as n from deal_redemptions where deal_id = ${d} and status = 'applied'`.execute(db)).rows[0] as any).n).toBe(2);
  });

  it('a single-use coupon code typed at eight registers at once → exactly one ticket gets it', async () => {
    const d = await deal({});
    await sql`update deals set kind = 'coupon', requires_code = true, stackable = true where id = ${d}`.execute(db);
    await sql`insert into deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, single_use) values (${T}, ${d}, ${hashCode(T, 'RACE-ONE-0001')}, ${codeHint('RACE-ONE-0001')}, true)`.execute(db);
    const checkout = new DealsCheckoutService(svc, (svc as any).repo.ledger);
    const tickets = await Promise.all(Array.from({ length: 8 }, async () => ticket(await customer())));
    const won = (await Promise.all(tickets.map((t) => applyAt(checkout, t, { code: 'race-one-0001' })))).filter(Boolean);
    expect(won).toHaveLength(1);
    const code = (await sql`select use_count, status from deal_coupon_codes where deal_id = ${d}`.execute(db)).rows[0] as any;
    expect(code).toMatchObject({ use_count: 1, status: 'exhausted' });
  });

  it('a shared code capped at 3 uses across all its codes (the deal cap), twelve registers → exactly 3', async () => {
    const d = await deal({ max_redemptions: 3 });
    await sql`update deals set kind = 'coupon', requires_code = true where id = ${d}`.execute(db);
    await sql`insert into deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, single_use) values (${T}, ${d}, ${hashCode(T, 'SPRING3')}, ${codeHint('SPRING3')}, false)`.execute(db);
    const checkout = new DealsCheckoutService(svc, (svc as any).repo.ledger);
    const tickets = await Promise.all(Array.from({ length: 12 }, async () => ticket(await customer())));
    expect((await Promise.all(tickets.map((t) => applyAt(checkout, t, { code: 'SPRING3' })))).filter(Boolean)).toHaveLength(3);
  });

  it('a budget of $25 with $10 discounts, six registers at once → exactly 2 (the database refuses the third $10)', async () => {
    const d = await deal({});
    await sql`update deals set budget_cents = 2500 where id = ${d}`.execute(db);
    const checkout = new DealsCheckoutService(svc, (svc as any).repo.ledger);
    const tickets = await Promise.all(Array.from({ length: 6 }, async () => ticket(await customer())));
    expect((await Promise.all(tickets.map((t) => applyAt(checkout, t, { dealId: d })))).filter(Boolean)).toHaveLength(2);
    expect(Number(((await sql`select budget_reserved_cents from deals where id = ${d}`.execute(db)).rows[0] as any).budget_reserved_cents)).toBe(2000);
  });

  it('one customer, one per customer, five tabs booking at once → exactly one', async () => {
    const d = await deal({ max_per_customer: 1 });
    const c = await customer();
    expect((await Promise.all(Array.from({ length: 5 }, () => book(d, c)))).filter(Boolean)).toHaveLength(1);
  });
});
