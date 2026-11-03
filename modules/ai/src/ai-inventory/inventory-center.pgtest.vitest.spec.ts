// inventory-center.pgtest — AI Inventory Assistant guides (Nov 3 2026; migration 779) on the REAL schema.
// SU = the six cards + definitions + reasons (incl. a salon-wide login no longer reading every product as out of stock) ·
// PR = products (search, status incl. no threshold / ledger mismatch, sort, pages) · AC = stock activity · HL = Check Inventory System.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryCenter, InventoryCenterError, criticalOf } from './inventory-center';

const id = (n: number) => `77790000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), OWNER = id(10), V = id(20);
const P = { gel: id(31), polish: id(32), files: id(33), acetone: id(34), oil: id(35), other: id(36) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['inventory.view', 'pos.ai_inventory.view'], ...o });
let pg: any; let db: any; let ic: InventoryCenter;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof InventoryCenterError ? e.code : (e as Error).message; } }

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  ic = new InventoryCenter(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','ic-779','IC779','active'), ($2,'X','Other','ic-779x','IC779X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$2,'North','active','UTC')`, [B, T, B2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@ic.test','active','OWNER')`, [OWNER, T]);
  await q(`insert into inventory_vendors (id, tenant_id, name, lead_time_days) values ($1,$2,'Sally Beauty',5)`, [V, T]);
  // gel: critical by the DERIVED rule (reorder 10 → critical 5; on hand 3) · polish: critical by an explicit level · files: low ·
  // acetone: out of stock · oil: no thresholds at all · other salon's product never counted
  await q(`insert into inventory_products (id, tenant_id, name, sku, reorder_level, critical_level, maximum_stock, preferred_vendor_id) values
    ($1,$7,'Gel base coat','GEL-01',10,null,null,$8), ($2,$7,'OPI polish red','OPI-R',8,4,null,null), ($3,$7,'Nail files','FILE-100',20,null,100,$8),
    ($4,$7,'Acetone','ACE-1',5,null,null,$8), ($5,$7,'Cuticle oil','OIL-1',0,null,null,null), ($6,$9,'Other gel','X-1',10,null,null,null)`,
  [P.gel, P.polish, P.files, P.acetone, P.oil, P.other, T, V, X]);
  await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand) values
    ($1,$2,$3,3), ($1,$2,$4,2), ($1,$2,$5,15), ($1,$2,$6,0), ($1,$2,$7,40), ($1,$8,$3,9)`, [T, B, P.gel, P.polish, P.files, P.acetone, P.oil, B2]);
  // the ledger for gel at Main ends at 4 while the stock row says 3 → a difference
  await q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_at) values
    ($1,$2,$3,'received',0,10,10,'PO-77', now() - interval '3 days'), ($1,$2,$3,'service_usage',10,-6,4,'Gel manicure', now() - interval '1 day'),
    ($1,$2,$4,'received',0,2,2,'PO-78', now() - interval '2 days')`, [T, B, P.gel, P.polish]);
}, 180_000);

describe('Inventory — the six cards', () => {
  it('SU-01 this branch: each product in exactly one card; why the critical ones are critical; no-threshold and ledger counts', async () => {
    const s: any = await ic.summary(ctx());
    expect(s.cards).toEqual({ products: 5, inStock: 1, low: 1, critical: 2, outOfStock: 1, overstock: 0 });
    expect(s.reasons).toMatchObject({ criticalExplicit: 1, criticalDerived: 1, noThreshold: 1, ledgerMismatch: 1 });
    expect(s.scope).toBe('branch');
    expect(s.definitions.critical).toContain('half the reorder level');
  });
  it('SU-02 a salon-wide login sums every branch (before: no branch → every product "out of stock")', async () => {
    const s: any = await ic.summary(ctx({ branchId: null }));
    expect(s.scope).toBe('all_branches');
    expect(s.cards.outOfStock).toBe(1);                // only acetone
    expect(s.cards.critical).toBe(1);                  // gel 3 + 9 = 12 is above its reorder level of 10 → only the polish is critical
  });
  it('SU-03 needs inventory.view', async () => {
    expect(await code(ic.summary(ctx({ permissions: ['pos.ai_inventory.view'] })))).toBe('PERMISSION_DENIED');
  });
  it('criticalOf: explicit, derived, none', () => {
    expect(criticalOf(10, null)).toEqual({ level: 5, source: 'derived' });
    expect(criticalOf(8, 4)).toEqual({ level: 4, source: 'explicit' });
    expect(criticalOf(0, null)).toEqual({ level: 0, source: 'none' });
  });
});

describe('Inventory — products', () => {
  it('PR-01 most urgent first; levels and their source; open-order and ledger fields', async () => {
    const l: any = await ic.productsList(ctx(), {});
    expect(l.items.map((r: any) => r.name)).toEqual(['Acetone', 'Gel base coat', 'OPI polish red', 'Nail files', 'Cuticle oil']);
    expect(l.items[1]).toMatchObject({ status: 'critical', criticalLevel: 5, criticalSource: 'derived', onHand: 3, ledgerBalance: 4, ledgerMismatch: true, vendor: 'Sally Beauty', leadTimeDays: 5 });
    expect(l.items[2]).toMatchObject({ criticalSource: 'explicit', ledgerMismatch: false });
  });
  it('PR-02 search name / SKU / vendor; status filters incl. no threshold and ledger mismatch; pages', async () => {
    expect((await ic.productsList(ctx(), { q: 'OPI' }) as any).items.map((r: any) => r.name)).toEqual(['OPI polish red']);
    expect((await ic.productsList(ctx(), { q: 'FILE-100' }) as any).total).toBe(1);
    expect((await ic.productsList(ctx(), { q: 'Sally' }) as any).total).toBe(3);
    expect((await ic.productsList(ctx(), { status: 'no_threshold' }) as any).items.map((r: any) => r.name)).toEqual(['Cuticle oil']);
    expect((await ic.productsList(ctx(), { status: 'ledger_mismatch' }) as any).items.map((r: any) => r.name)).toEqual(['Gel base coat']);
    expect((await ic.productsList(ctx(), { status: 'critical' }) as any).total).toBe(2);
    expect((await ic.productsList(ctx(), { q: 'Other gel' }) as any).total).toBe(0);
    const p: any = await ic.productsList(ctx(), { pageSize: 10, page: 2 });
    expect(p).toMatchObject({ items: [], total: 5, totalPages: 1 });
  });
});

describe('Inventory — stock activity', () => {
  it('AC-01 newest first; search; type; presets; this branch only; From after To refused', async () => {
    const a: any = await ic.activity(ctx(), {});
    expect(a.items.map((r: any) => r.reason)).toEqual(['Gel manicure', 'PO-78', 'PO-77']);
    expect(a.items[0]).toMatchObject({ group: 'service_usage', change: -6, after: 4, product: 'Gel base coat' });
    expect((await ic.activity(ctx(), { type: 'received' }) as any).total).toBe(2);
    expect((await ic.activity(ctx(), { q: 'OPI' }) as any).total).toBe(1);
    expect((await ic.activity(ctx(), { preset: 'today' }) as any).total).toBe(0);
    expect((await ic.activity(ctx(), { preset: 'last_7' }) as any).total).toBe(3);
    expect((await ic.activity(ctx({ branchId: B2 }), {}) as any).total).toBe(0);
    expect(await code(ic.activity(ctx(), { preset: 'custom', from: '2026-11-03', to: '2026-11-01' }))).toBe('IC_INVALID_PERIOD');
  });
});

describe('Check Inventory System', () => {
  it('HL-01 flags the ledger difference, missing thresholds, a derived critical; read-only; reused within 30 s', async () => {
    const before = (await q(`select count(*)::int as n from inventory_location_stock`))[0].n;
    const h: any = await ic.check(ctx());
    const k = Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
    expect(k.ledger_matches_stock).toMatchObject({ state: 'FAILED', count: 1 });
    expect(k.thresholds_set).toMatchObject({ state: 'WARNING', count: 1 });
    expect(k.critical_explained).toMatchObject({ state: 'WARNING', count: 1 });
    expect(k.no_negative_stock.state).toBe('PASSED');
    expect(k.movements_recorded.state).toBe('PASSED');
    expect(k.reorder_data).toMatchObject({ state: 'WARNING', count: 1 });   // the OPI polish has no vendor
    expect(k.tenant_isolation.state).toBe('PASSED');
    expect(h.overall).toBe('FAILED');
    expect(h.checks[0].state).toBe('FAILED');
    expect((await q(`select count(*)::int as n from inventory_location_stock`))[0].n).toBe(before);
    expect((await ic.check(ctx()) as any).reused).toBe(true);
  });
});
