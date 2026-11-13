// add-on-recipes.pgtest — round 11, extras ADD-ONS MANAGEMENT 06 (Nov 13 2026): add-ons MAY consume inventory — Kevin decides.
// The mechanism, on the real schema: an optional recipe per add-on (whole quantities), a salon switch that is OFF by default
// (then Service Done moves nothing for add-ons — today's behaviour), and when it is on: the add-on line's recipe is deducted
// through the SAME deduction a service recipe uses, once per ticket line; a removed line / voided ticket gives exactly that
// back, once. Never twice with a service recipe, never on an ambiguous add-on name, never another salon's product.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a72a0000-0000-4000-8000-000000000001', B = 'a72a0000-0000-4000-8000-0000000000b1', T2 = 'a72a0000-0000-4000-8000-000000000002';
const UM = 'a72a0000-0000-4000-8000-0000000000e9', CAT = 'a72a0000-0000-4000-8000-0000000000c1';
const SVC = 'a72a0000-0000-4000-8000-0000000000d1', ADDSVC = 'a72a0000-0000-4000-8000-0000000000d2', CUST = 'a72a0000-0000-4000-8000-0000000000f1';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.update', 'settings.edit'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
let pg: any; let inv: InventoryService; let n = 0;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const uuid = () => `a72a0000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function product(name: string, units = 5): Promise<string> {
  const { id } = await inv.createProduct(manager, { name, sku: name.slice(0, 3).toUpperCase() + n, unitType: 'piece' });
  await inv.addStock(manager, id, { quantity: units, costCents: 100 });
  return id;
}
async function line(o: { name: string; addOn?: boolean; serviceId?: string; qty?: number }): Promise<{ ticketId: string; lineId: string }> {
  const ticketId = uuid(); const lineId = uuid();
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values ($1,$2,$3,$4,'service_done',0,0)`, [ticketId, T, B, CUST]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, quantity, is_add_on, line_kind, status)
           values ($1,$2,$3,$4,$5,$6,1000,10,1000,$7,$8,$9,'completed')`, [lineId, T, B, ticketId, o.serviceId ?? ADDSVC, o.name, o.qty ?? 1, o.addOn !== false, o.addOn !== false ? 'add_on' : 'service']);
  return { ticketId, lineId };
}
const onHand = async (p: string) => Number((await q(`select quantity_on_hand from inventory_location_stock where product_id = $1 and branch_id = $2`, [p, B]))[0]?.quantity_on_hand ?? 0);
const moves = async (lineId: string, type: string) => q(`select product_id, movement_type, quantity_change from inventory_stock_movements where related_id = $1 and related_type = $2 order by created_at`, [lineId, type]);
const done = (l: { ticketId: string; lineId: string }, serviceId = ADDSVC) => inv.consumeRecipeForTicketLine(manager, { ...l, serviceId, quantity: 1 });

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Ao Co','Ao Salon','ao-co','AOCO'), ($2,'Bo Co','Bo Salon','bo-co','BOCO')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@ao.test','Olive Owner')`, [UM, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'C','X','C X')`, [CUST, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Mani',30,3000), ($5,$2,$3,$4,'Add-on service',10,1000)`, [SVC, T, B, CAT, ADDSVC]);
  await q(`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents) values ($1,$2,$3,'nail-art','Nail Art',1000), ($1,$2,$3,'gems','Gems',500),
           ($1,$2,$3,'dup-a','Glitter',300), ($1,$2,$3,'dup-b','glitter',300)`, [T, B, SVC]);
}, 180_000);

describe('ADD-ONS 06 (round 11) — the switch is OFF by default: behaviour unchanged', () => {
  it('off: a saved recipe waits; Service Done on an add-on line moves nothing and says nothing', async () => {
    expect(await inv.addOnRecipeSetting(manager)).toEqual({ enabled: false, updatedAt: null });
    const p = await product('Art Paint');
    const saved = await inv.setAddOnRecipe(manager, 'nail-art', { lines: [{ productId: p, quantity: 2 }] });
    expect(saved).toMatchObject({ key: 'nail-art', name: 'Nail Art', deductsAtServiceDone: false, lines: [{ productId: p, productName: 'Art Paint', quantity: 2 }] });
    const audit = await q(`select metadata_json from audit_logs where tenant_id = $1 and action_type = 'add_on_recipe_set' order by created_at desc limit 1`, [T]);
    expect(audit.length).toBe(1);
    const l = await line({ name: 'Nail Art' });
    const r: any = await done(l);
    expect(r.addOn).toBeUndefined();
    expect(await moves(l.lineId, 'ticket_line_add_on')).toEqual([]);
    expect(await onHand(p)).toBe(5);
  });
});

describe('ADD-ONS 06 (round 11) — switched on', () => {
  it('turning it on is validated and audited with before / after', async () => {
    await expect(inv.setAddOnRecipeSetting(manager, { enabled: 'yes' })).rejects.toMatchObject({ status: 400 });
    const s = await inv.setAddOnRecipeSetting(manager, { enabled: true });
    expect(s.enabled).toBe(true); expect(s.updatedAt).toEqual(expect.any(String));
    const a = await q(`select metadata_json from audit_logs where tenant_id = $1 and action_type = 'inventory_add_on_recipes_setting_changed'`, [T]);
    expect(a.length).toBe(1);
    expect(JSON.stringify(a[0].metadata_json)).toContain('"before":{"enabled":false}');
  });
  it('Service Done deducts the add-on recipe once per line (replays move nothing); a line void gives exactly it back, once', async () => {
    const p = (await inv.getAddOnRecipe(manager, 'nail-art')).lines[0].productId;
    const before = await onHand(p);
    const l = await line({ name: 'nail art', qty: 1 });   // matched by name, case-insensitive (the Add-Ons screen's rule)
    const r: any = await done(l);
    expect(r.addOn).toMatchObject({ addOnKey: 'nail-art', outcome: 'deducted', deducted: [{ productId: p, requested: 2, deducted: 2 }] });
    expect(await onHand(p)).toBe(before - 2);
    const again: any = await done(l);
    expect(again.addOn).toMatchObject({ outcome: 'already_deducted', deducted: [] });
    expect(await onHand(p)).toBe(before - 2);
    expect((await moves(l.lineId, 'ticket_line_add_on')).length).toBe(1);
    // the line is removed: what it took goes back to the bottles it came from
    const back = await inv.reverseAddOnUsage(manager, { ticketId: l.ticketId, lineIds: [l.lineId], reason: 'line removed: wrong add-on' });
    expect(back).toEqual({ returnedLines: 1, byProduct: [{ productId: p, returnedHundredths: 200, notReturnedHundredths: 0 }] });
    expect(await onHand(p)).toBe(before);
    expect(await moves(l.lineId, 'ticket_line_add_on_return')).toEqual([expect.objectContaining({ movement_type: 'correction' })]);
    expect(await inv.reverseAddOnUsage(manager, { ticketId: l.ticketId, lineIds: null, reason: 'void' })).toEqual({ returnedLines: 0, byProduct: [] });
    expect(await onHand(p)).toBe(before);
  });
  it('a whole-ticket void returns every add-on line of that ticket only; service recipes are never touched by it', async () => {
    const p = (await inv.getAddOnRecipe(manager, 'nail-art')).lines[0].productId;
    const s = await product('Base Coat');
    await inv.setServiceRecipe(manager, SVC, { lines: [{ productId: s, quantity: 1 }] });
    const l = await line({ name: 'Nail Art' });
    const other = await line({ name: 'Nail Art' });
    const svcLine = await line({ name: 'Gel Mani', addOn: false, serviceId: SVC });
    await done(l); await done(other); await done(svcLine, SVC);
    const pBefore = await onHand(p); const sBefore = await onHand(s);
    const back = await inv.reverseAddOnUsage(manager, { ticketId: l.ticketId, lineIds: null, reason: 'void: customer left' });
    expect(back.returnedLines).toBe(1);
    expect(await onHand(p)).toBe(pBefore + 2);         // only this ticket's add-on line
    expect(await onHand(s)).toBe(sBefore);             // the service recipe is not given back by the add-on reversal
  });
  it('never twice: an add-on line whose own service has a service recipe keeps only the service recipe', async () => {
    const s = await product('Topper');
    await inv.setServiceRecipe(manager, ADDSVC, { lines: [{ productId: s, quantity: 1 }] });
    const p = (await inv.getAddOnRecipe(manager, 'nail-art')).lines[0].productId;
    const pBefore = await onHand(p);
    const l = await line({ name: 'Nail Art' });
    const r: any = await done(l);
    expect(r.addOn).toMatchObject({ outcome: 'service_recipe_used', deducted: [] });
    expect(r.deducted.length).toBe(1);                 // the service recipe ran
    expect(await onHand(p)).toBe(pBefore);
    await inv.setServiceRecipe(manager, ADDSVC, { lines: [] });
  });
  it('a name two add-ons share, an add-on with no recipe, and a plain service line deduct nothing', async () => {
    const amb: any = await done(await line({ name: 'Glitter' }));
    expect(amb.addOn).toMatchObject({ addOnKey: null, outcome: 'ambiguous_add_on' });
    const none: any = await done(await line({ name: 'Gems' }));
    expect(none.addOn).toMatchObject({ addOnKey: 'gems', outcome: 'no_recipe' });
    const unknown: any = await done(await line({ name: 'Mystery' }));
    expect(unknown.addOn).toMatchObject({ outcome: 'no_add_on' });
    const plain: any = await done(await line({ name: 'Nail Art', addOn: false }));
    expect(plain.addOn).toBeUndefined();
  });
  it('turning it off again stops new deductions (nothing already taken is changed)', async () => {
    await inv.setAddOnRecipeSetting(manager, { enabled: false });
    const r: any = await done(await line({ name: 'Nail Art' }));
    expect(r.addOn).toBeUndefined();
  });
});

describe('ADD-ONS 06 (round 11) — recipe edits', () => {
  it('whole quantities only (1..1000), a product of this salon only, a known add-on only; nothing deducted by saving', async () => {
    const p = await product('Foil');
    await expect(inv.setAddOnRecipe(manager, 'gems', { lines: [{ productId: p, quantity: 0.5 }] })).rejects.toMatchObject({ status: 400 });
    await expect(inv.setAddOnRecipe(manager, 'gems', { lines: [{ productId: p, quantity: 1001 }] })).rejects.toMatchObject({ status: 400 });
    await expect(inv.setAddOnRecipe(manager, 'no-such', { lines: [] })).rejects.toMatchObject({ status: 404 });
    await expect(inv.getAddOnRecipe(manager, '../x')).rejects.toMatchObject({ status: 404 });
    const foreign = uuid();
    await q(`insert into inventory_products (id, tenant_id, name) values ($1,$2,'Other salon glue')`, [foreign, T2]);
    await expect(inv.setAddOnRecipe(manager, 'gems', { lines: [{ productId: foreign, quantity: 1 }] })).rejects.toMatchObject({ status: 400 });
    // the database refuses it too (B-12 trigger)
    await expect(q(`insert into service_add_on_recipes (tenant_id, add_on_key, product_id, quantity) values ($1,'gems',$2,1)`, [T, foreign])).rejects.toThrow();
    const ok = await inv.setAddOnRecipe(manager, 'gems', { lines: [{ productId: p, quantity: 3 }, { productId: p, quantity: 9 }] });
    expect(ok.lines).toEqual([{ productId: p, productName: 'Foil', quantity: 3, unit: 'piece' }]);   // one line per product
    expect(await onHand(p)).toBe(5);
  });
});
