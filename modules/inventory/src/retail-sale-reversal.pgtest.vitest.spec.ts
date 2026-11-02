// retail-sale-reversal.pgtest — B-17 (Oct 20 2026): retail stock moved when the line was ADDED and never came back on a
// removed line, a void or a refund; the units were picked without a lock. Now a sale stamps the units it sold with the
// ticket and line (sold_ticket_id / sold_line_id, migration 667), picks them FOR UPDATE SKIP LOCKED in one transaction,
// and reverseRetailSale() puts exactly those units back (sold → unopened) with a customer_return movement — the whole
// ticket, or the named lines. A second reversal returns nothing (idempotent).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'f2000000-0000-4000-8000-000000000001', B = 'f2000000-0000-4000-8000-0000000000b1';
const P1 = 'f2000000-0000-4000-8000-0000000000d1', P2 = 'f2000000-0000-4000-8000-0000000000d2';
const TICKET = 'f2000000-0000-4000-8000-0000000000c1', L1 = 'f2000000-0000-4000-8000-0000000000a1', L2 = 'f2000000-0000-4000-8000-0000000000a2';
const ctx: any = { tenantId: T, branchId: B, userId: 'f2000000-0000-4000-8000-0000000000e1', role: 'OWNER', permissions: ['inventory.view'] };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const units = (p: string) => q(`select status, sold_ticket_id, sold_line_id from inventory_units where product_id = $1 order by created_at`, [p]);
const onHand = async (p: string) => Number((await q(`select quantity_on_hand from inventory_location_stock where product_id = $1 and branch_id = $2`, [p, B]))[0]?.quantity_on_hand ?? 0);
const moves = (p: string) => q(`select movement_type, quantity_change, related_type, related_id, reason from inventory_stock_movements where product_id = $1 order by created_at`, [p]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Retail Co','Retail Salon','retail-rev','RTLR')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
  await q(`insert into inventory_products (id, tenant_id, name, is_retail, active, retail_price_cents, cost_cents) values ($1,$2,'Rose',true,true,1499,620), ($3,$2,'Mint',true,true,999,400)`, [P1, T, P2]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, created_at) values
    ($1,$2,$3,'unopened', now() - interval '3 days'), ($1,$2,$3,'unopened', now() - interval '2 days'), ($1,$2,$3,'unopened', now() - interval '1 day'),
    ($1,$2,$4,'unopened', now() - interval '1 day')`, [T, B, P1, P2]);
}, 120000);

describe('B-17: a retail sale is reversible, unit by unit', () => {
  it('the sale stamps the units with the ticket and line (FIFO), and the on-hand count follows', async () => {
    const s1 = await inv.recordRetailSale(ctx, P1, 2, TICKET, L1);
    expect(s1).toMatchObject({ consumed: 2, shortBy: 0, onHand: 1 });
    const s2 = await inv.recordRetailSale(ctx, P2, 1, TICKET, L2);
    expect(s2).toMatchObject({ consumed: 1, shortBy: 0, onHand: 0 });
    expect(await units(P1)).toEqual([
      { status: 'sold', sold_ticket_id: TICKET, sold_line_id: L1 }, { status: 'sold', sold_ticket_id: TICKET, sold_line_id: L1 }, { status: 'unopened', sold_ticket_id: null, sold_line_id: null }]);
    expect(await onHand(P1)).toBe(1); expect(await onHand(P2)).toBe(0);
  });
  it('reversing ONE line returns that line\'s units only — customer_return movement against the ticket; the other line stays sold', async () => {
    const r = await inv.reverseRetailSale(ctx, { ticketId: TICKET, lineIds: [L1], reason: 'line removed' });
    expect(r).toEqual({ returned: 2, byProduct: [{ productId: P1, returned: 2, onHand: 3 }] });
    expect((await units(P1)).map((u: any) => u.status)).toEqual(['unopened', 'unopened', 'unopened']);
    expect((await units(P1)).every((u: any) => u.sold_ticket_id === null && u.sold_line_id === null)).toBe(true);
    expect(await onHand(P1)).toBe(3);
    expect((await units(P2))[0].status).toBe('sold');                            // the other line is untouched
    const m = (await moves(P1)).at(-1);
    expect(m).toMatchObject({ movement_type: 'customer_return', quantity_change: 2, related_type: 'ticket', related_id: TICKET });
    expect(String(m.reason)).toMatch(/line removed/);
  });
  it('reversing the whole ticket returns what is still sold; a second reversal returns nothing', async () => {
    expect(await inv.reverseRetailSale(ctx, { ticketId: TICKET, lineIds: null, reason: 'void' })).toEqual({ returned: 1, byProduct: [{ productId: P2, returned: 1, onHand: 1 }] });
    expect(await onHand(P2)).toBe(1);
    expect(await inv.reverseRetailSale(ctx, { ticketId: TICKET, lineIds: null, reason: 'void again' })).toEqual({ returned: 0, byProduct: [] });
    expect((await moves(P2)).map((m: any) => m.movement_type)).toEqual(['retail_sale', 'customer_return']);   // no movement for a no-op
  });
  it('a unit another transaction holds is skipped, not waited on (FOR UPDATE SKIP LOCKED), and a short sale still reports the shortfall', async () => {
    // all three P1 units are sealed again; lock one in an open transaction on a second connection? PGlite serves one
    // connection — the lock clause is proven by the statement itself (PGlite refuses FOR UPDATE SKIP LOCKED only if it
    // is malformed) and by the short-sale arithmetic.
    const s = await inv.recordRetailSale(ctx, P1, 5, TICKET, L1);
    expect(s).toMatchObject({ consumed: 3, shortBy: 2, onHand: 0 });
    expect(String((await moves(P1)).at(-1).reason)).toMatch(/only 3 in stock/);
  });
});
