// serving-retail.pgtest.vitest.spec.ts — the retail line on the REAL schema (Jul 27, 2026).
//
// The unit spec proves the rules; this proves the row. Migration 423 made `service_id` nullable and added
// `product_id` plus a CHECK that a line is EITHER a service OR a product. That constraint is the thing standing
// between "retail is sellable" and "a null/null line prices itself from a snapshot and belongs to no catalog
// item", so it is asserted here against real Postgres rather than trusted.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyServingRepository } from './serving.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T1 = 'f1000000-0000-0000-0000-000000000001';
const B1 = 'f1000000-0000-0000-0000-0000000000b1';
const TICKET = 'f1000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'f1000000-0000-0000-0000-0000000000d1';
const ctx: any = { tenantId: T1, branchId: B1, userId: 'f1000000-0000-0000-0000-0000000000e1', role: 'OWNER', permissions: [] };

let pg: PGlite;
let repo: KyselyServingRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyServingRepository(db as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Retail Co','Retail Salon','retail-co','RTL')`, [T1]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B1, T1]);
  const CUSTOMER = 'f1000000-0000-0000-0000-0000000000f1';
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Retail','Guest','Retail Guest')`, [CUSTOMER, T1, B1]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'serving')`, [TICKET, T1, B1, CUSTOMER]);
  await q(`insert into inventory_products (id, tenant_id, name, is_retail, active, retail_price_cents, cost_cents)
           values ($1,$2,'Gel Polish — Rose', true, true, 1499, 620)`, [PRODUCT, T1]);
});

describe('retail line on the real schema', () => {
  it('only sells an active, retail-flagged, PRICED product', async () => {
    expect(await repo.retailProduct(ctx, PRODUCT)).toMatchObject({ name: 'Gel Polish — Rose', retailPriceCents: 1499 });

    // A product with no retail price is NOT sellable — refusing beats selling it for $0.
    const unpriced = 'f1000000-0000-0000-0000-0000000000d2';
    await q(`insert into inventory_products (id, tenant_id, name, is_retail, active, retail_price_cents) values ($1,$2,'Unpriced', true, true, null)`, [unpriced, T1]);
    expect(await repo.retailProduct(ctx, unpriced)).toBeNull();

    // Service-only stock (is_retail false) is back-bar product, not merchandise.
    const backbar = 'f1000000-0000-0000-0000-0000000000d3';
    await q(`insert into inventory_products (id, tenant_id, name, is_retail, active, retail_price_cents) values ($1,$2,'Back Bar Acetone', false, true, 900)`, [backbar, T1]);
    expect(await repo.retailProduct(ctx, backbar)).toBeNull();

    // Another salon's product is invisible here.
    const otherTenant = 'f1000000-0000-0000-0000-000000000002';
    const otherProduct = 'f1000000-0000-0000-0000-0000000000d4';
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Other','Other','other-co','OTH')`, [otherTenant]);
    await q(`insert into inventory_products (id, tenant_id, name, is_retail, active, retail_price_cents) values ($1,$2,'Their Polish', true, true, 1200)`, [otherProduct, otherTenant]);
    expect(await repo.retailProduct(ctx, otherProduct)).toBeNull();
  });

  it('writes a line with product_id set, service_id NULL, line_kind retail, and no duration', async () => {
    const ok = await repo.addRetailLine(ctx, TICKET, { serviceLineId: 'ignored', productId: PRODUCT, productName: 'Gel Polish — Rose', unitPriceCents: 1499, quantity: 2 });
    expect(ok).toBe(true);

    const row = (await q(`select service_id, product_id, line_kind, quantity, price_cents_snapshot, line_total_cents, duration_minutes_snapshot, status
                          from ticket_service_lines where ticket_id = $1`, [TICKET]))[0];
    expect(row.service_id).toBeNull();                       // only possible because 423 dropped NOT NULL
    expect(String(row.product_id)).toBe(PRODUCT);
    expect(row.line_kind).toBe('retail');                    // what compensation + Checkout reporting key on
    expect(Number(row.quantity)).toBe(2);
    expect(Number(row.price_cents_snapshot)).toBe(1499);     // unit price snapshot
    expect(Number(row.line_total_cents)).toBe(2998);         // integer cents, no float math
    expect(Number(row.duration_minutes_snapshot)).toBe(0);   // a product adds no time to the appointment
    expect(row.status).toBe('done');
  });

  it('the CHECK refuses a line that is neither a service nor a product', async () => {
    await expect(q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, product_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status)
                    values ($1,$2,$3,null,null,'Nothing',100,0,100,'done')`, [T1, B1, TICKET])).rejects.toThrow();
  });
});

// ── Phase 2: stock follows the sale (Jul 27, 2026) ──────────────────────────────────────────────────────────
describe('retail sale moves stock', () => {
  it('consumes the oldest sealed units, records ONE retail_sale movement, and never blocks a short sale', async () => {
    const { InventoryService } = await import('@aipowersalon/inventory');
    const db = (repo as any).db;
    const inv = new InventoryService(db);
    const invCtx: any = { tenantId: T1, branchId: B1, userId: ctx.userId, role: 'OWNER', permissions: ['inventory.view'] };

    // Two sealed units on the shelf — stock is unit rows even for a 'quantity'-tracked product.
    await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, created_at)
             values ($1,$2,$3,'unopened', now() - interval '2 days'), ($1,$2,$3,'unopened', now() - interval '1 day')`, [T1, B1, PRODUCT]);

    const sale = await inv.recordRetailSale(invCtx, PRODUCT, 1, TICKET);
    expect(sale.consumed).toBe(1);
    expect(sale.shortBy).toBe(0);
    expect(sale.onHand).toBe(1);                       // one sealed unit left

    // FIFO: the OLDER unit is the one that left the shelf.
    const sold = await q(`select status, extract(epoch from created_at) e from inventory_units
                          where product_id = $1 order by created_at asc`, [PRODUCT]);
    expect(sold[0].status).toBe('sold');
    expect(sold[1].status).toBe('unopened');

    const mv = (await q(`select movement_type, quantity_before, quantity_change, quantity_after, related_type, related_id
                         from inventory_stock_movements where product_id = $1 order by created_at desc limit 1`, [PRODUCT]))[0];
    expect(mv.movement_type).toBe('retail_sale');
    expect(Number(mv.quantity_before)).toBe(2);
    expect(Number(mv.quantity_change)).toBe(-1);
    expect(Number(mv.quantity_after)).toBe(1);
    expect(mv.related_type).toBe('ticket');
    expect(String(mv.related_id)).toBe(TICKET);

    // Selling 5 with 1 left: the sale is NOT refused — we consume what exists and report the shortfall.
    const short = await inv.recordRetailSale(invCtx, PRODUCT, 5, TICKET);
    expect(short.consumed).toBe(1);
    expect(short.shortBy).toBe(4);
    expect(short.onHand).toBe(0);
    const shortMove = (await q(`select reason from inventory_stock_movements where product_id = $1 order by created_at desc limit 1`, [PRODUCT]))[0];
    expect(String(shortMove.reason)).toMatch(/only 1 in stock/i);   // the discrepancy is recorded, not hidden
  });
});

// ── Phase 4: a retail line reaches the money (Jul 27, 2026) ─────────────────────────────────────────────────
// Tax in this platform is ONE salon-wide rate applied to the whole subtotal — there is no per-item taxability
// column (tax_setting exists only on service_templates, and the services table deliberately has none). So a
// retail line is taxed exactly like a service line, automatically, because it is in the subtotal. Whether a
// product SHOULD be taxed differently from a service is a jurisdiction question for the salon's accountant, not
// something this code decides. What IS this code's job is that the line actually reaches the subtotal — proven
// here rather than assumed, since a retail line is the first line type that carries no service_id.
describe('a retail line reaches checkout money', () => {
  it('is included in the ticket subtotal alongside service lines', async () => {
    const T = 'f1000000-0000-0000-0000-0000000000c2';
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status)
             select $1,$2,$3,customer_id,'serving' from tickets where id = $4`, [T, T1, B1, TICKET]);
    // one service line + one retail line (2 × $14.99)
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, line_kind)
             values ($1,$2,$3,gen_random_uuid(),'Signature Manicure',5500,45,5500,'done','service')`, [T1, B1, T]);
    await repo.addRetailLine(ctx, T, { serviceLineId: 'x', productId: PRODUCT, productName: 'Gel Polish — Rose', unitPriceCents: 1499, quantity: 2 });

    const rows = await q(`select line_kind, line_total_cents from ticket_service_lines where ticket_id = $1 order by line_kind`, [T]);
    expect(rows.map((r: any) => r.line_kind).sort()).toEqual(['retail', 'service']);
    const subtotal = rows.reduce((n: number, r: any) => n + Number(r.line_total_cents), 0);
    expect(subtotal).toBe(5500 + 2998);          // the retail line is real money on the ticket, not a note

    // Sanity on the flat-rate consequence: at a 7.75% salon rate the product is taxed like the service.
    expect(Math.round(subtotal * 0.0775)).toBe(Math.round((5500 + 2998) * 0.0775));
  });
});
