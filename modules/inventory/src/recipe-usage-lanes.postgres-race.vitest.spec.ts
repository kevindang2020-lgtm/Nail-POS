// recipe-usage-lanes.postgres-race.vitest.spec.ts — M4 lanes follow-up (Oct 26 2026): two `service.completed` consumers for
// DIFFERENT tickets of one branch now run at the same time (the publisher's lanes), each deducting its service's recipe
// inside its own transaction. What this pins on real PostgreSQL (PGlite is one session and cannot overlap two
// transactions):
//   • the deterministic overlap: ticket A deducts and HOLDS its transaction open; ticket B starts while A is uncommitted,
//     A commits, B finishes. B's movement is exactly −1 per product (before the fix: before − after spanned A's commit and
//     recorded −2 for one bottle);
//   • 20 rounds of two overlapping deductions whose recipes list the two shared products in opposite insertion order:
//     no deadlock (40P01), movements sum to the true usage, the stock cache equals the bottle rows;
//   • the alert that fires when the product crosses into 'low' is recorded once, and the inventory.low_stock event once —
//     written INSIDE the deducting transaction (before: on another connection, re-written by a deadlock retry).
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { InventoryService } from './inventory.service';

const url = process.env.PG_RACE_URL;
const T = 'a7a00000-0000-4000-8000-0000000000a2', B = 'b7a00000-0000-4000-8000-0000000000b2', CAT = 'c7a00000-0000-4000-8000-0000000000c2';
const SVC_A = 'd7a00000-0000-4000-8000-0000000000d1', SVC_B = 'd7a00000-0000-4000-8000-0000000000d2';
const ctx = { tenantId: T, branchId: B, userId: 'system:inventory.recipe_usage_on_service_done', role: 'SYSTEM', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let svc: InventoryService;
const TABLES = ['outbox_events', 'inventory_alerts', 'inventory_stock_movements', 'inventory_units', 'inventory_location_stock', 'service_product_recipes', 'inventory_products'];

const onHand = async (productId: string) => Number((await sql`select count(*)::int n from inventory_units where tenant_id = ${T} and product_id = ${productId} and status in ('unopened', 'opened', 'low')`.execute(db)).rows[0].n);
const cached = async (productId: string) => Number((await sql`select quantity_on_hand from inventory_location_stock where branch_id = ${B} and product_id = ${productId}`.execute(db)).rows[0]?.quantity_on_hand ?? -1);
const movements = async (productId: string) => (await sql<{ quantity_before: number; quantity_change: number; quantity_after: number; related_id: string }>`select quantity_before, quantity_change, quantity_after, related_id from inventory_stock_movements where tenant_id = ${T} and product_id = ${productId} and movement_type = 'service_usage' order by created_at`.execute(db)).rows;
const openAlerts = async (productId: string) => (await sql`select status from inventory_alerts where tenant_id = ${T} and product_id = ${productId} and resolved_at is null`.execute(db)).rows as any[];
const lowStockEvents = async (productId: string) => (await sql`select 1 from outbox_events where tenant_id = ${T} and event_type = 'inventory.low_stock' and aggregate_id = ${productId}`.execute(db)).rows.length;

describe.skipIf(!url)('recipe deduction under the publisher lanes (M4)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 6 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    svc = new InventoryService(db as any, undefined, new OutboxWriter());
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'INV-L', 'INV-L', 'inv-lanes', 'INVL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicures') on conflict (id) do nothing`.execute(db);
    for (const [id, n] of [[SVC_A, 'Gel A'], [SVC_B, 'Gel B']]) await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${id}, ${T}, ${B}, ${CAT}, ${n}, 30, 3000) on conflict (id) do nothing`.execute(db);
    for (const t of TABLES) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => { for (const t of TABLES) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  /** two products, `stock` bottles each; service A's recipe lists P then Q, service B's lists Q then P (opposite order) */
  async function fixture(stock: number, reorderLevel: number, criticalLevel: number | null = null) {
    for (const t of ['outbox_events', 'inventory_alerts', 'inventory_stock_movements', 'inventory_units', 'inventory_location_stock', 'service_product_recipes', 'inventory_products']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
    const P = (await svc.createProduct(ctx, { name: 'Base Coat', reorderLevel })).id;
    const Q = (await svc.createProduct(ctx, { name: 'Top Coat', reorderLevel })).id;
    for (const id of [P, Q]) { if (criticalLevel != null) await svc.updateProduct(ctx, id, { criticalLevel }); await svc.addStock(ctx, id, { quantity: stock }); }
    for (const [s, order] of [[SVC_A, [P, Q]], [SVC_B, [Q, P]]] as const) for (const pid of order) await sql`insert into service_product_recipes (tenant_id, service_id, product_id, quantity) values (${T}, ${s}, ${pid}, 1)`.execute(db);
    await sql`delete from outbox_events where tenant_id = ${T}`.execute(db); await sql`delete from inventory_alerts where tenant_id = ${T}`.execute(db);   // the receipt's own alert/event noise
    return { P, Q };
  }
  const consume = (serviceId: string, lineId: string, trx: any) => svc.consumeRecipeForTicketLine(ctx, { ticketId: 'ticket-' + lineId, lineId, serviceId, quantity: 1 }, trx);

  it('ticket B deducting while ticket A is uncommitted records −1, not −2 (the "before" count is taken under the stock-row lock)', async () => {
    const { P, Q } = await fixture(10, 100);   // reorder level far above: no alert tier changes here
    let releaseA!: () => void; const holdA = new Promise<void>((r) => { releaseA = r; });
    let aDeducted = false;
    const A = db.transaction().execute(async (trx) => { await consume(SVC_A, 'a7a00000-0000-4000-8000-00000000aaa1', trx); aDeducted = true; await holdA; });
    while (!aDeducted) await new Promise((r) => setTimeout(r, 5));
    const bStarted = Date.now();
    const Bp = db.transaction().execute(async (trx) => consume(SVC_B, 'a7a00000-0000-4000-8000-00000000bbb1', trx));
    await new Promise((r) => setTimeout(r, 150));   // B is now blocked on A's locks
    releaseA(); await A;
    const b = await Bp;
    expect(Date.now() - bStarted).toBeGreaterThanOrEqual(140);   // B really waited for A
    expect((b as any).deducted.map((d: any) => d.deducted)).toEqual([1, 1]);
    for (const id of [P, Q]) {
      expect(await onHand(id)).toBe(8); expect(await cached(id)).toBe(8);
      const m = await movements(id);
      expect(m.map((x) => [Number(x.quantity_before), Number(x.quantity_change), Number(x.quantity_after)])).toEqual([[10, -1, 9], [9, -1, 8]]);
    }
  });

  it('20 rounds of two overlapping deductions with opposite recipe order: no deadlock, movements sum to the usage, cache = bottles', async () => {
    const { P, Q } = await fixture(60, 100);
    const errors: string[] = [];
    for (let i = 0; i < 20; i++) {
      const a = `a7a00000-0000-4000-8000-00000000${String(i).padStart(2, "0")}a1`, b = `a7a00000-0000-4000-8000-00000000${String(i).padStart(2, "0")}b1`;
      await Promise.all([
        db.transaction().execute((trx) => consume(SVC_A, a, trx)).catch((e) => { errors.push(String((e as any)?.code ?? e)); }),
        db.transaction().execute((trx) => consume(SVC_B, b, trx)).catch((e) => { errors.push(String((e as any)?.code ?? e)); }),
      ]);
    }
    expect(errors).toEqual([]);
    for (const id of [P, Q]) {
      expect(await onHand(id)).toBe(20); expect(await cached(id)).toBe(20);
      const m = await movements(id);
      expect(m).toHaveLength(40);
      expect(m.reduce((s, x) => s + Number(x.quantity_change), 0)).toBe(-40);
      expect(m.every((x) => Number(x.quantity_change) === -1 && Number(x.quantity_before) - Number(x.quantity_after) === 1)).toBe(true);
    }
  }, 60_000);

  it('crossing into "low" under two overlapping deductions records ONE open alert and ONE inventory.low_stock event per product, inside the deducting transaction', async () => {
    const auditRows = async () => Number((await sql`select count(*)::int n from audit_logs where tenant_id = ${T} and action_type = 'inventory_stock_alert'`.execute(db)).rows[0].n);
    const { P, Q } = await fixture(5, 4, 1);
    const audit0 = await auditRows();   // audit_logs is append-only: counted against a baseline   // 5 on hand, reorder level 4, critical 1: the first deduction (→ 4) crosses into 'low', the second (→ 3) stays 'low'
    let releaseA!: () => void; const holdA = new Promise<void>((r) => { releaseA = r; });
    let aDeducted = false;
    const A = db.transaction().execute(async (trx) => { await consume(SVC_A, 'a7a00000-0000-4000-8000-00000000aaa2', trx); aDeducted = true; await holdA; });
    while (!aDeducted) await new Promise((r) => setTimeout(r, 5));
    // A's alert, its audit row and its low_stock event are not visible yet: they belong to A's open transaction
    for (const id of [P, Q]) { expect(await openAlerts(id)).toEqual([]); expect(await lowStockEvents(id)).toBe(0); }
    const Bp = db.transaction().execute(async (trx) => consume(SVC_B, 'a7a00000-0000-4000-8000-00000000bbb2', trx));
    await new Promise((r) => setTimeout(r, 100));
    releaseA(); await A; await Bp;
    for (const id of [P, Q]) {
      expect(await onHand(id)).toBe(3);
      expect((await openAlerts(id)).map((a) => a.status)).toEqual(['low']);
      expect(await lowStockEvents(id)).toBe(1);
    }
    expect(await auditRows() - audit0).toBe(2);   // one alert audit row per product, none re-written
  });

  it('Nov 3 audit — the SAME ticket line delivered twice at once is deducted once (the check and the write were not under one lock)', async () => {
    const { P } = await fixture(10, 100);
    const line = 'a7a00000-0000-4000-8000-00000000ccc1';
    let release!: () => void; const hold = new Promise<void>((r) => { release = r; });
    let firstDone = false;
    const A = db.transaction().execute(async (trx) => { await consume(SVC_A, line, trx); firstDone = true; await hold; });
    while (!firstDone) await new Promise((r) => setTimeout(r, 10));
    const B = db.transaction().execute(async (trx) => consume(SVC_A, line, trx));   // waits on the line lock until A commits
    await new Promise((r) => setTimeout(r, 150)); release();
    const [, rb] = await Promise.all([A, B]);
    expect((rb as any).alreadyDeducted).toBe(true);
    expect((await movements(P)).filter((m) => m.related_id === line)).toHaveLength(1);
    expect(await onHand(P)).toBe(9);
  });
  it('Nov 3 audit — an expired bottle is never used on a client; the soonest-expiring good bottle goes first', async () => {
    const { P } = await fixture(1, 100);
    await sql`update inventory_units set expiration_date = '2020-01-01' where tenant_id = ${T} and product_id = ${P}`.execute(db);   // the one bottle on hand has expired
    await svc.addStock(ctx, P, { quantity: 1, expirationDate: '2099-12-31' });
    await svc.addStock(ctx, P, { quantity: 1, expirationDate: '2098-06-30' });
    await db.transaction().execute((trx) => consume(SVC_A, 'a7a00000-0000-4000-8000-00000000ddd1', trx));
    const left = (await sql<{ d: string; status: string }>`select to_char(expiration_date, 'YYYY-MM-DD') d, status from inventory_units where tenant_id = ${T} and product_id = ${P} order by expiration_date`.execute(db)).rows;
    expect(left).toEqual([{ d: '2020-01-01', status: 'unopened' }, { d: '2098-06-30', status: 'empty' }, { d: '2099-12-31', status: 'unopened' }]);
  });
  it('Nov 3 audit — Add Stock with a purchase-order id is refused (it labelled a manual add "purchase received", unchecked)', async () => {
    const { P } = await fixture(1, 100);
    await expect(svc.addStock(ctx, P, { quantity: 2, purchaseOrderId: 'a7a00000-0000-4000-8000-00000000eee1' })).rejects.toMatchObject({ status: 400 });
    expect(await onHand(P)).toBe(1);
  });
});
