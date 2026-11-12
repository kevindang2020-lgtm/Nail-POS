// system-checks.pgtest — the shared read-only Check … System (extras arc, Nov 9 2026) on the REAL schema:
// every check of every page runs (none NOT_TESTED), planted problems are counted, another salon's rows never are,
// the branch scope narrows the counts, and nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SYSTEM_CHECK_DOMAINS } from '@aipowersalon/api-contracts/tenant';
import { SystemChecksService } from './system-checks.service';
import { SYSTEM_CHECKS } from './system-checks.registry';

const P = 'c8450000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), B1 = id(3), B2 = id(4), BX = id(5);
let db: any; let svc: SystemChecksService;
const q = (s: any) => s.execute(db);
const count = (r: any, key: string) => r.checks.find((c: any) => c.key === key);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new SystemChecksService(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'sc-845', 'SC845', 'active'), (${X}, 'X', 'Other', 'sc-845x', 'SC845X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B1}, ${T}, 'Main'), (${B2}, ${T}, 'Second'), (${BX}, ${X}, 'Other main')`);
  // expenses: parts that do not add up in B1, one future-dated in B2, and the same problems in the OTHER salon (never counted)
  await q(sql`insert into expenses (tenant_id, branch_id, category, amount_cents, subtotal_cents, tax_cents, incurred_on) values
    (${T}, ${B1}, 'supplies', 1500, 1000, 100, current_date), (${T}, ${B2}, 'supplies', 1200, null, null, current_date + 30), (${T}, ${B1}, 'rent', 9000, 9000, 0, current_date),
    (${X}, ${BX}, 'supplies', 700, 100, 0, current_date), (${X}, ${BX}, 'supplies', 100, null, null, current_date + 30)`);
  // deals: one redeemed past its cap, one ending before it starts
  await q(sql`insert into deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, max_redemptions, redemption_count, status, starts_at, ends_at) values
    (${T}, ${B1}, 'salon', 'Fall 10%', 'percent', 10, 5, 7, 'active', now() - interval '2 days', now() + interval '5 days'),
    (${T}, ${B1}, 'salon', 'Backwards', 'percent', 10, null, 0, 'draft', now() + interval '5 days', now() + interval '1 day'),
    (${X}, ${BX}, 'salon', 'Other', 'percent', 10, 1, 9, 'active', now() - interval '2 days', now() + interval '5 days')`);
  // technicians: two active with the same phone
  await q(sql`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, is_active) values
    (${T}, ${B1}, 'A', 'One', 'A One', '+15550001111', true), (${T}, ${B1}, 'B', 'Two', 'B Two', '+15550001111', true)`);
  // reports: ticket 11 charged 5000 but only 4000 collected; ticket 12 reconciles but its cash payment carries a surcharge;
  // ticket 13 is the other salon's identical mismatch (never counted)
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
    (${id(21)}, ${T}, ${B1}, 'C', 'One', 'C One', '+15550002221'), (${id(22)}, ${X}, ${BX}, 'C', 'X', 'C X', '+15550002222')`);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, subtotal_cents, tax_cents, discount_cents, total_cents) values
    (${id(11)}, ${T}, ${B1}, ${id(21)}, 'paid', now(), 5000, 0, 0, 5000), (${id(12)}, ${T}, ${B2}, ${id(21)}, 'paid', now(), 3000, 0, 0, 3000), (${id(13)}, ${X}, ${BX}, ${id(22)}, 'paid', now(), 5000, 0, 0, 5000)`);
  await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, surcharge_cents, tip_cents, tax_cents, discount_cents, change_due_cents, status) values
    (${T}, ${B1}, ${id(11)}, 'card', 4000, 0, 0, 0, 0, 0, 'approved'), (${T}, ${B2}, ${id(12)}, 'cash', 3000, 100, 0, 0, 0, 0, 'approved'),
    (${X}, ${BX}, ${id(13)}, 'card', 4000, 0, 0, 0, 0, 0, 'approved')`);
  // ticket 12 carries a line for a service no longer in the catalog and with no category snapshot (unmapped); the other
  // salon's ticket 13 has the same (never counted); ticket 11 has no line at all
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values
    (${T}, ${B2}, ${id(12)}, ${id(31)}, 'Nail art', 3000, 15, 3000), (${X}, ${BX}, ${id(13)}, ${id(32)}, 'Nail art', 5000, 15, 5000)`);
});

describe('shared read-only Check … System', () => {
  it('every check of every page runs on the real schema (none NOT_TESTED)', async () => {
    for (const d of SYSTEM_CHECK_DOMAINS) {
      const r = await svc.run(d, { tenantId: T });
      expect(r.checks.map((c) => c.key), d).toEqual(SYSTEM_CHECKS[d].checks.map((c) => c.key));
      expect(r.checks.filter((c) => c.state === 'NOT_TESTED').map((c) => `${d}.${c.key}`)).toEqual([]);
    }
  });
  it('counts planted problems — and never another salon\'s rows', async () => {
    const e = await svc.run('expenses', { tenantId: T });
    expect(count(e, 'parts_mismatch')).toEqual({ key: 'parts_mismatch', state: 'WARNING', count: 1 });
    expect(count(e, 'future_dated')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(e.overall).toBe('WARNING');
    const dl = await svc.run('discounts', { tenantId: T });
    expect(count(dl, 'over_redeemed')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(dl, 'ends_before_starts')).toMatchObject({ state: 'FAILED', count: 1 });
    const tc = await svc.run('technicians', { tenantId: T });
    expect(count(tc, 'duplicate_phone')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(tc, 'no_app_account')).toMatchObject({ state: 'WARNING', count: 2 });
    const rp = await svc.run('reports', { tenantId: T });
    expect(count(rp, 'charged_vs_collected')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(rp, 'surcharge_not_card')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(rp, 'paid_without_service_lines')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(rp, 'unmapped_service_lines')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(rp.overall).toBe('FAILED');
    const rp1 = await svc.run('reports', { tenantId: T, branchId: B1 });
    expect(count(rp1, 'surcharge_not_card')).toMatchObject({ state: 'READY', count: 0 });

  });
  it('extras Unfinished POS Modules 06 — Team Integrity: clock state, open punches, skills and training; never the other salon', async () => {
    const TA = id(41), TB = id(42), TC = id(43), TX = id(44), TOK = id(45);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, archived_at, status) values
      (${TA}, ${T}, ${B1}, 'Ari', 'Archived', 'Ari Archived', false, now(), 'archived'), (${TB}, ${T}, ${B1}, 'Bo', 'Busy', 'Bo Busy', true, null, 'active'),
      (${TC}, ${T}, ${B2}, 'Cy', 'Cert', 'Cy Cert', true, null, 'active'), (${TOK}, ${T}, ${B1}, 'Ok', 'Fine', 'Ok Fine', true, null, 'active'),
      (${TX}, ${X}, ${BX}, 'Xo', 'Other', 'Xo Other', false, now(), 'archived')`);
    const before = (await svc.run('technicians', { tenantId: T })).checks;
    const base = (k: string) => before.find((c: any) => c.key === k).count as number;
    // Ari is archived but still clocked in (and so is the other salon's Xo); Bo left a punch open since 3 days ago
    await q(sql`insert into technician_workforce_state (tenant_id, branch_id, technician_id, clock_status, shift_status) values
      (${T}, ${B1}, ${TA}, 'CLOCKED_IN', 'ON_SHIFT'), (${T}, ${B1}, ${TB}, 'CLOCKED_IN', 'ON_SHIFT'), (${X}, ${BX}, ${TX}, 'ON_BREAK', 'ON_SHIFT')`);
    await q(sql`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values
      (${T}, ${B1}, ${TB}, current_date - 3, now() - interval '3 days', null, 'active'), (${T}, ${B1}, ${TOK}, current_date - 3, now() - interval '3 days', now() - interval '3 days' + interval '8 hours', 'completed'),
      (${X}, ${BX}, ${TX}, current_date - 3, now() - interval '3 days', null, 'active')`);
    // Ok Fine does a service; Cy's certificate expired last month (a revoked one and a future one never count)
    await q(sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B1}, ${TOK}, ${id(31)})`);
    await q(sql`insert into technician_certifications (tenant_id, technician_id, name, expires_at, revoked_reason) values
      (${T}, ${TC}, 'Nail tech license', current_date - 30, null), (${T}, ${TC}, 'Old', current_date - 300, 'replaced'), (${T}, ${TOK}, 'Gel course', current_date + 200, null),
      (${X}, ${TX}, 'License', current_date - 30, null)`);
    const tc = await svc.run('technicians', { tenantId: T });
    expect(count(tc, 'clocked_in_not_active')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(tc, 'punch_open_past_day')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(tc, 'no_service_mapping').count).toBe(base('no_service_mapping') - 1);   // mapping Ok removes her; Bo, Cy (and the two earlier) remain; archived Ari never counts
    expect(count(tc, 'no_service_mapping').count).toBe(4);
    expect(count(tc, 'certification_expired')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(tc.overall).toBe('FAILED');
    const b2 = await svc.run('technicians', { tenantId: T, branchId: B2 });
    expect(count(b2, 'clocked_in_not_active').count).toBe(0); expect(count(b2, 'certification_expired').count).toBe(1);
  });
  it('the branch scope narrows the counts', async () => {
    const b1 = await svc.run('expenses', { tenantId: T, branchId: B1 });
    expect(b1.branchId).toBe(B1);
    expect(count(b1, 'parts_mismatch').count).toBe(1);
    expect(count(b1, 'future_dated')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('a clean page is READY; no session tenant is NOT_TESTED, never a pass', async () => {
    const m = await svc.run('memberships', { tenantId: T });
    expect(m.overall).toBe('READY');
    const none = await svc.run('expenses', {});
    expect(none.overall).toBe('NOT_TESTED');
    expect(none.checks.every((c) => c.state === 'NOT_TESTED' && c.count === null)).toBe(true);
  });
  it('writes nothing', async () => {
    const before = (await q(sql`select (select count(*) from expenses) + (select count(*) from deals) + (select count(*) from technicians) as n`)).rows[0].n;
    for (const d of SYSTEM_CHECK_DOMAINS) await svc.run(d, { tenantId: T });
    expect((await q(sql`select (select count(*) from expenses) + (select count(*) from deals) + (select count(*) from technicians) as n`)).rows[0].n).toBe(before);
  });
  it('extras: Suppliers & Purchasing — duplicate / contactless suppliers, PO totals, status vs receiving, received without stock; never the other salon', async () => {
    const V1 = id(61), V2 = id(62), V3 = id(63), VX = id(64), PR = id(65), PRX = id(66);
    await q(sql`insert into inventory_vendors (id, tenant_id, name, phone, email, active) values (${V1}, ${T}, 'Nail Supply Co', '5550001', null, true), (${V2}, ${T}, ' nail supply co', null, 'a@b.co', true),
      (${V3}, ${T}, 'Quiet Vendor', null, null, false), (${VX}, ${X}, 'Nail Supply Co', null, null, true), (${id(67)}, ${X}, 'nail supply co', null, null, true)`);
    await q(sql`insert into inventory_products (id, tenant_id, name) values (${PR}, ${T}, 'Gel Base'), (${PRX}, ${X}, 'Gel Base')`);
    // P1: totals do not add up (2 × 500 = 1000, stored 900). P2: open, with an inactive supplier, past its expected date.
    // P3: "received" but a line is short, and no stock movement. P4: sent with no supplier. PX: the other salon's identical mess.
    await q(sql`insert into purchase_orders (id, tenant_id, branch_id, vendor_id, status, expected_date, subtotal_cents, shipping_cents, tax_cents, total_cents) values
      (${id(71)}, ${T}, ${B1}, ${V1}, 'ordered', current_date + 5, 900, 0, 0, 900),
      (${id(72)}, ${T}, ${B1}, ${V3}, 'ordered', current_date - 3, 0, 0, 0, 0),
      (${id(73)}, ${T}, ${B2}, ${V1}, 'received', null, 1000, 0, 0, 1000),
      (${id(74)}, ${T}, ${B2}, null, 'approved', null, 0, 0, 0, 0),
      (${id(75)}, ${X}, ${BX}, null, 'received', current_date - 3, 900, 0, 0, 900)`);
    await q(sql`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost_cents) values
      (${T}, ${id(71)}, ${PR}, 2, 0, 500), (${T}, ${id(73)}, ${PR}, 2, 1, 500), (${X}, ${id(75)}, ${PRX}, 2, 1, 500)`);
    const r = await svc.run('suppliers', { tenantId: T });
    expect(count(r, 'duplicate_supplier_names')).toMatchObject({ state: 'WARNING', count: 1 });   // "Nail Supply Co" / " nail supply co"; the inactive one is not counted
    expect(count(r, 'supplier_no_contact')).toMatchObject({ state: 'READY', count: 0 });          // the contactless vendor is inactive
    expect(count(r, 'po_missing_supplier')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'open_po_inactive_supplier')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'po_total_mismatch')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'po_past_expected')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'po_status_vs_received')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'received_without_movement')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'stale_drafts')).toMatchObject({ state: 'READY', count: 0 });
    // the branch scope: B1 has the totals and late order, not B2's receiving problem
    const b1 = await svc.run('suppliers', { tenantId: T, branchId: B1 });
    expect(count(b1, 'received_without_movement')).toMatchObject({ state: 'READY', count: 0 });
    expect(count(b1, 'po_total_mismatch').count).toBe(1);
    // a stock movement for the received order clears it
    await q(sql`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, related_type, related_id) values (${T}, ${B2}, ${PR}, 'receive', 1, 'purchase_order', ${id(73)})`);
    expect(count(await svc.run('suppliers', { tenantId: T }), 'received_without_movement')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras: Inventory — usage without a stock movement, a technician of another salon, used after recorded, double usage movements, over-received stock', async () => {
    const PR = id(81), TE = id(82), TEX = id(83), PO = id(84), U1 = id(85), U2 = id(86), U3 = id(87), UX = id(88);
    await q(sql`insert into inventory_products (id, tenant_id, name) values (${PR}, ${T}, 'Top Coat')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TE}, ${T}, ${B1}, 'U', 'Ser', 'U Ser'), (${TEX}, ${X}, ${BX}, 'O', 'Ther', 'O Ther')`);
    const ev = (u: string, tenant: string, branch: string, tech: string, occurred: any) => q(sql`insert into product_usage_events (id, tenant_id, branch_id, product_id, technician_id, quantity_hundredths, unit, occurred_at, source,
      stock_before_hundredths, stock_after_hundredths, bottles_before, bottles_after) values (${u}, ${tenant}, ${branch}, ${PR}, ${tech}, 100, 'bottle', ${occurred}, 'front_desk', 500, 400, 5, 4)`);
    await ev(U1, T, B1, TE, sql`now()`);                         // fine: has its movement below
    await ev(U2, T, B1, TEX, sql`now() + interval '2 days'`);    // another salon's technician, dated after it was recorded, no movement
    await ev(U3, T, B1, TE, sql`now()`);                         // fine
    await ev(UX, X, BX, TE, sql`now() + interval '2 days'`);     // the other salon's: never counted
    const mv = (rt: string, rid: string, type: string, change: number) => q(sql`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, related_type, related_id)
      values (${T}, ${B1}, ${PR}, ${type}, ${change}, ${rt}, ${rid})`);
    await mv('product_usage_event', U1, 'technician_usage', -1); await mv('product_usage_event', U3, 'technician_usage', -1);
    // one service line's recipe took the product off twice (a usage event cannot: uq_inv_movements_usage_source)
    await mv('ticket_line', id(89), 'service_usage', -1); await mv('ticket_line', id(89), 'service_usage', -1);
    // a PO line that received 2 cases of 6 = 12 bottles, but 18 went on the shelf
    await q(sql`insert into purchase_orders (id, tenant_id, branch_id, status, subtotal_cents, total_cents) values (${PO}, ${T}, ${B1}, 'received', 0, 0)`);
    await q(sql`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost_cents, units_per_purchase_unit) values (${T}, ${PO}, ${PR}, 2, 2, 0, 6)`);
    await mv('purchase_order', PO, 'purchase_received', 12); await mv('purchase_order', PO, 'purchase_received', 6);
    const r = await svc.run('inventory', { tenantId: T });
    expect(count(r, 'usage_without_movement')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'usage_technician_not_in_salon')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'usage_used_after_recorded')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'duplicate_usage_movement')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'received_over_ordered_lines')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(await svc.run('inventory', { tenantId: T, branchId: B2 }), 'duplicate_usage_movement')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras: Services & Products 2 · 04 — alert reconciliation: acknowledged-but-still-low and open alerts the canonical stock no longer supports; another salon never', async () => {
    const LOW = id(201), OK = id(202), ARC = id(203), PX = id(204);
    await q(sql`insert into inventory_products (id, tenant_id, name, reorder_level, active) values (${LOW}, ${T}, 'Base Coat', 5, true), (${OK}, ${T}, 'Cuticle Oil', 5, true), (${ARC}, ${T}, 'Old Polish', 5, true), (${PX}, ${X}, 'Base Coat', 5, true)`);
    await q(sql`update inventory_products set archived_at = now() where id = ${ARC}`);
    await q(sql`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, quantity_available) values (${T}, ${B1}, ${LOW}, 2, 2), (${T}, ${B1}, ${OK}, 40, 40), (${T}, ${B1}, ${ARC}, 1, 1), (${X}, ${BX}, ${PX}, 1, 1)`);
    const alert = (tenant: string, branch: string, product: string, ack: boolean) => q(sql`insert into inventory_alerts (tenant_id, branch_id, product_id, status, on_hand, acknowledged_at) values (${tenant}, ${branch}, ${product}, 'low', 1, ${ack ? sql`now()` : null})`);
    await alert(T, B1, LOW, true);    // acknowledged, still low → on the dashboard card, not in the sidebar badge
    await alert(T, B1, OK, false);    // restocked to 40, alert row never resolved
    await alert(T, B1, ARC, false);   // archived product: never a live alert
    await alert(X, BX, PX, true); await alert(X, BX, PX, false);
    const r = await svc.run('inventory', { tenantId: T });
    expect(count(r, 'acknowledged_still_low')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'open_alert_not_live')).toMatchObject({ state: 'WARNING', count: 2 });
    expect(count(await svc.run('inventory', { tenantId: T, branchId: B2 }), 'open_alert_not_live')).toMatchObject({ state: 'READY', count: 0 });
    await q(sql`update inventory_alerts set resolved_at = now() where tenant_id = ${T} and product_id in (${OK}, ${ARC})`);
    expect(count(await svc.run('inventory', { tenantId: T }), 'open_alert_not_live')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras: ADD-ONS 05 — sold add-on lines: no technician on a paid ticket, a technician who did not work the ticket, no base service, a double charge; removed lines and another salon never', async () => {
    const TA = id(301), TB = id(302), TC = id(303), TXX = id(304), TE1 = id(305), TE2 = id(306), TEX = id(307);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TE1}, ${T}, ${B1}, 'Ann', 'A', 'Ann A'), (${TE2}, ${T}, ${B1}, 'Bea', 'B', 'Bea B'), (${TEX}, ${X}, ${BX}, 'Xo', 'X', 'Xo X')`);
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, subtotal_cents, tax_cents, discount_cents, total_cents) values
      (${TA}, ${T}, ${B1}, ${id(21)}, 'paid', now(), 0, 0, 0, 0), (${TB}, ${T}, ${B1}, ${id(21)}, 'open', null, 0, 0, 0, 0), (${TC}, ${T}, ${B1}, ${id(21)}, 'paid', now(), 0, 0, 0, 0), (${TXX}, ${X}, ${BX}, ${id(22)}, 'paid', now(), 0, 0, 0, 0)`);
    const line = (tenant: string, branch: string, ticket: string, name: string, tech: string | null, kind: string, removed = false) => q(sql`insert into ticket_service_lines
      (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind, is_add_on, removed_at)
      values (${tenant}, ${branch}, ${ticket}, ${id(399)}, ${tech}, ${name}, 500, 10, 500, ${kind}, ${kind === 'add_on'}, ${removed ? sql`now()` : null})`);
    // ticket A (paid): Gel manicure by Ann; add-ons — French tips by Bea (not on the ticket), Chrome with nobody, Paraffin by Ann twice (a double charge)
    await line(T, B1, TA, 'Gel manicure', TE1, 'service'); await line(T, B1, TA, 'French tips', TE2, 'add_on'); await line(T, B1, TA, 'Chrome', null, 'add_on');
    await line(T, B1, TA, 'Paraffin', TE1, 'add_on'); await line(T, B1, TA, 'paraffin ', TE1, 'add_on');
    await line(T, B1, TA, 'Glitter', TE2, 'add_on', true);   // removed: never counted
    // ticket B (open): an add-on with no base service (unpaid, so no-technician does not count here)
    await line(T, B1, TB, 'Nail repair', null, 'add_on');
    // ticket C (paid): fine — Pedicure by Bea + Callus by Bea
    await line(T, B1, TC, 'Pedicure', TE2, 'service'); await line(T, B1, TC, 'Callus', TE2, 'add_on');
    // the other salon: every problem at once
    await line(X, BX, TXX, 'Chrome', null, 'add_on'); await line(X, BX, TXX, 'Chrome', null, 'add_on');
    const r = await svc.run('catalog', { tenantId: T });
    expect(count(r, 'addon_paid_no_technician')).toMatchObject({ state: 'WARNING', count: 1 });         // Chrome on A
    expect(count(r, 'addon_technician_not_on_ticket')).toMatchObject({ state: 'WARNING', count: 1 });   // French tips by Bea on A
    expect(count(r, 'addon_without_base_service')).toMatchObject({ state: 'WARNING', count: 1 });       // Nail repair on B
    expect(count(r, 'addon_duplicate_charge')).toMatchObject({ state: 'WARNING', count: 1 });           // Paraffin ×2 on A
    expect(count(await svc.run('catalog', { tenantId: T, branchId: B2 }), 'addon_duplicate_charge')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras: Stock Alerts 05 — a recipe naming an archived product; a Service Done recipe that could only take part of the amount', async () => {
    const PA = id(251), PB = id(252), SV = id(253), PX = id(254), SVX = id(255);
    await q(sql`insert into inventory_products (id, tenant_id, name, active, archived_at) values (${PA}, ${T}, 'Old Gel', false, now()), (${PB}, ${T}, 'Cuticle Oil', true, null), (${PX}, ${X}, 'Old Gel X', false, now())`);
    const CA = id(259), CAX = id(260);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name, status) values (${CA}, ${T}, ${B1}, 'Feet', 'active'), (${CAX}, ${X}, ${BX}, 'Feet', 'active')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SV}, ${T}, ${B1}, ${CA}, 'Gel Pedicure', 45, 5000), (${SVX}, ${X}, ${BX}, ${CAX}, 'Other', 30, 3000)`);
    await q(sql`insert into service_product_recipes (tenant_id, service_id, product_id, quantity) values (${T}, ${SV}, ${PA}, 1), (${T}, ${SV}, ${PB}, 1), (${X}, ${SVX}, ${PX}, 1)`);
    const mv = (branch: string, line: string, meta: string, at: any) => q(sql`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, related_type, related_id, metadata_json, created_at)
      values (${T}, ${branch}, ${PB}, 'service_usage', -1, 'ticket_line', ${line}, ${meta}::jsonb, ${at})`);
    await mv(B1, id(256), '{"quantityHundredths":40,"requestedHundredths":100,"shortHundredths":60}', sql`now()`);           // short
    await mv(B1, id(257), '{"quantityHundredths":100,"requestedHundredths":100,"shortHundredths":0}', sql`now()`);          // full
    await mv(B1, id(258), '{"quantityHundredths":10,"requestedHundredths":100,"shortHundredths":90}', sql`now() - interval '45 days'`);   // older than 30 days
    const r = await svc.run('inventory', { tenantId: T });
    expect(count(r, 'recipe_inactive_product')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'recipe_short_deduction')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(await svc.run('inventory', { tenantId: T, branchId: B2 }), 'recipe_short_deduction')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras: Discounts — redemption integrity: pending on a paid ticket, redeemed on an unpaid one, bad timestamps, coupon use counter drift, a single-use code used twice', async () => {
    const D = id(91), DX = id(92), CODE = id(93), CODE2 = id(94), CODEX = id(95), K1 = id(96), K2 = id(97), K3 = id(98), KX = id(99);
    await q(sql`insert into deals (id, tenant_id, branch_id, owner_type, title, discount_type, discount_percent, status, starts_at, ends_at) values
      (${D}, ${T}, ${B1}, 'salon', 'Code 15', 'percent', 15, 'active', now() - interval '2 days', now() + interval '5 days'),
      (${DX}, ${X}, ${BX}, 'salon', 'Other code', 'percent', 15, 'active', now() - interval '2 days', now() + interval '5 days')`);
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, subtotal_cents, tax_cents, discount_cents, total_cents) values
      (${K1}, ${T}, ${B1}, ${id(21)}, 'paid', now() - interval '1 hour', 4000, 0, 600, 3400), (${K2}, ${T}, ${B1}, ${id(21)}, 'open', null, 4000, 0, 600, 3400),
      (${K3}, ${T}, ${B1}, ${id(21)}, 'paid', now() - interval '1 hour', 4000, 0, 600, 3400), (${KX}, ${X}, ${BX}, ${id(22)}, 'paid', now() - interval '1 hour', 4000, 0, 600, 3400)`);
    // CODE: single use, counter 1 (the constraint caps it) but live on two tickets → reused AND drift; CODE2: counter 1, no live use → drift
    await q(sql`insert into deal_coupon_codes (id, tenant_id, deal_id, code_hash, code_hint, single_use, use_count, status) values
      (${CODE}, ${T}, ${D}, 'h1', 'AB12', true, 1, 'exhausted'), (${CODE2}, ${T}, ${D}, 'h2', 'CD34', false, 1, 'active'), (${CODEX}, ${X}, ${DX}, 'hx', 'EF56', true, 1, 'exhausted')`);
    const red = (tenant: string, branch: string, deal: string, ticket: string, status: string, code: string | null, applied: any, redeemed: any) => q(sql`insert into deal_redemptions
      (tenant_id, branch_id, deal_id, ticket_id, customer_id, amount_discounted_cents, deal_version, status, coupon_code_id, applied_at, redeemed_at)
      values (${tenant}, ${branch}, ${deal}, ${ticket}, null, 600, 1, ${status}, ${code}, ${applied}, ${redeemed})`);
    await red(T, B1, D, K1, 'applied', CODE, sql`now() - interval '2 hours'`, null);                              // pending although paid an hour ago
    await red(T, B1, D, K2, 'redeemed', CODE, sql`now() - interval '2 hours'`, sql`now() - interval '3 hours'`);   // redeemed on an unpaid ticket, redeemed before applied
    await red(T, B1, D, K3, 'redeemed', null, sql`now() - interval '2 hours'`, sql`now() - interval '1 hour'`);    // fine
    await red(X, BX, DX, KX, 'applied', CODEX, sql`now() - interval '2 hours'`, null);                             // the other salon's: never counted
    await red(X, BX, DX, KX, 'released', CODEX, sql`now() + interval '1 day'`, null);
    const r = await svc.run('discounts', { tenantId: T });
    expect(count(r, 'redemption_pending_on_paid')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'redeemed_ticket_unpaid')).toMatchObject({ state: 'FAILED', count: 1 });
    expect(count(r, 'redemption_bad_timestamps')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(count(r, 'coupon_use_count_drift')).toMatchObject({ state: 'FAILED', count: 2 });
    expect(count(r, 'single_use_code_reused')).toMatchObject({ state: 'FAILED', count: 1 });
    const b2 = await svc.run('discounts', { tenantId: T, branchId: B2 });
    expect(['redemption_pending_on_paid', 'redeemed_ticket_unpaid', 'coupon_use_count_drift', 'single_use_code_reused'].map((k) => count(b2, k).count)).toEqual([0, 0, 0, 0]);
  });

  it('Discounts #14 configuration drift: live deals on a closed branch or an unavailable service — read-only', async () => {
    const BC = id(70), BCX = id(71), SA = id(72), SB = id(73), SX = id(74);
    const DL1 = id(75), DL2 = id(76), DL3 = id(77), DL4 = id(78), DLX = id(79), DLD = id(80);
    await q(sql`insert into branches (id, tenant_id, name, status) values (${BC}, ${T}, 'Closed', 'inactive'), (${BCX}, ${X}, 'Other closed', 'inactive')`);
    const CAT = id(83), CATX = id(84);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name, status) values (${CAT}, ${T}, ${B2}, 'Nails', 'active'), (${CATX}, ${X}, ${BX}, 'Nails', 'active')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values
      (${SA}, ${T}, ${B2}, ${CAT}, 'Gel', 45, 4000, 'active'), (${SX}, ${X}, ${BX}, ${CATX}, 'Gel', 45, 4000, 'active')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values (${SB}, ${T}, ${B2}, ${CAT}, 'Old acrylic', 60, 5000, 'archived', now())`);
    await q(sql`insert into deals (id, tenant_id, branch_id, owner_type, title, discount_type, discount_percent, status, starts_at, ends_at) values
      (${DL1}, ${T}, ${BC}, 'salon', 'Closed shop deal', 'percent', 10, 'active', now() - interval '1 day', now() + interval '5 days'),
      (${DL2}, ${T}, ${B2}, 'salon', 'Archived service deal', 'percent', 10, 'scheduled', now() + interval '1 day', now() + interval '5 days'),
      (${DL3}, ${T}, ${B2}, 'salon', 'Healthy deal', 'percent', 10, 'active', now() - interval '1 day', now() + interval '5 days'),
      (${DL4}, ${T}, ${B2}, 'salon', 'Gone service deal', 'percent', 10, 'active', now() - interval '1 day', now() + interval '5 days'),
      (${DLD}, ${T}, ${BC}, 'salon', 'Archived deal on closed shop', 'percent', 10, 'archived', now() - interval '9 days', now() - interval '5 days'),
      (${DLX}, ${X}, ${BCX}, 'salon', 'Other salon', 'percent', 10, 'active', now() - interval '1 day', now() + interval '5 days')`);
    await q(sql`insert into deal_services (deal_id, service_id, tenant_id) values (${DL2}, ${SA}, ${T}), (${DL2}, ${SB}, ${T}), (${DL3}, ${SA}, ${T}),
      (${DL4}, ${id(81)}, ${T}), (${DLX}, ${id(82)}, ${X})`);
    const before = await q(sql`select count(*)::int as n from deals`);
    const r = await svc.run('discounts', { tenantId: T });
    expect(count(r, 'live_deal_branch_closed')).toMatchObject({ state: 'WARNING', count: 1 });          // DL1 only (archived DLD and the other salon's skipped)
    expect(count(r, 'live_deal_service_unavailable')).toMatchObject({ state: 'WARNING', count: 2 });    // DL2 (one archived of two) + DL4 (missing) — counted once each
    const b2 = await svc.run('discounts', { tenantId: T, branchId: B2 });
    expect(count(b2, 'live_deal_branch_closed').count).toBe(0);
    expect(count(b2, 'live_deal_service_unavailable').count).toBe(2);
    const b1 = await svc.run('discounts', { tenantId: T, branchId: B1 });
    expect(count(b1, 'live_deal_service_unavailable').count).toBe(0);
    expect((await q(sql`select count(*)::int as n from deals`)).rows).toEqual(before.rows);
  });
  it('extras Team Management #08: overdue training, a completed course without its certificate link, verified certificates without a date or past expiry, profile changes waiting — never the other salon', async () => {
    const TA = id(90), TB = id(91), TXX = id(92), CO = id(93), COX = id(94), CN = id(95), GP = id(96), GPX = id(97), U1 = id(98);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id) values
      (${TA}, ${T}, ${B1}, 'Tr', 'One', 'Tr One', ${GP}), (${TB}, ${T}, ${B2}, 'Tr', 'Two', 'Tr Two', null), (${TXX}, ${X}, ${BX}, 'Tr', 'X', 'Tr X', ${GPX})`);
    await q(sql`insert into team_training_courses (id, tenant_id, name, certification_name) values (${CO}, ${T}, 'Gel safety', 'Gel certificate'), (${CN}, ${T}, 'Front desk', null), (${COX}, ${X}, 'Gel safety', 'Gel certificate')`);
    await q(sql`insert into team_training_assignments (tenant_id, branch_id, course_id, technician_id, status, due_date, completed_at) values
      (${T}, ${B1}, ${CO}, ${TA}, 'assigned', current_date - 5, null),
      (${T}, ${B2}, ${CN}, ${TB}, 'in_progress', current_date + 5, null),
      (${T}, ${B2}, ${CO}, ${TB}, 'completed', current_date - 9, now()),
      (${T}, ${B1}, ${CN}, ${TA}, 'completed', null, now()),
      (${X}, ${BX}, ${COX}, ${TXX}, 'assigned', current_date - 5, null),
      (${X}, ${BX}, ${COX}, ${TXX}, 'canceled', null, null)`);
    await q(sql`insert into technician_certifications (tenant_id, technician_id, name, issued_at, expires_at, verification_status) values
      (${T}, ${TA}, 'No date', null, null, 'VERIFIED'), (${T}, ${TA}, 'Lapsed', current_date - 400, current_date - 10, 'VERIFIED'),
      (${T}, ${TB}, 'Fine', current_date - 30, current_date + 300, 'VERIFIED'), (${T}, ${TB}, 'Unverified no date', null, null, 'UNVERIFIED'),
      (${X}, ${TXX}, 'Other no date', null, current_date - 10, 'VERIFIED')`);
    await q(sql`insert into team_staff_certifications (tenant_id, user_id, name, issued_on, expires_on, verification_status) values
      (${T}, ${U1}, 'Desk no date', null, null, 'VERIFIED'), (${X}, ${U1}, 'Other desk', null, null, 'VERIFIED')`);
    await q(sql`insert into global_tech_profiles (id, public_slug, display_name, tech_code) values (${GP}, 'tr-one-845', 'Tr One', 'TC8451'), (${GPX}, 'tr-x-845', 'Tr X', 'TC8452')`);
    await q(sql`insert into tech_profile_change_requests (global_tech_profile_id, changes, status, created_at) values
      (${GP}, '{}'::jsonb, 'pending', now() - interval '10 days'), (${GPX}, '{}'::jsonb, 'pending', now() - interval '10 days')`);
    const before = await q(sql`select (select count(*) from team_training_assignments) + (select count(*) from technician_certifications) + (select count(*) from tech_profile_change_requests) as n`);
    const all = await svc.run('technicians', { tenantId: T });
    expect(count(all, 'training_overdue')).toMatchObject({ state: 'WARNING', count: 1 });                  // TA's open course; the future one and the other salon's skipped
    expect(count(all, 'training_certificate_unlinked')).toMatchObject({ state: 'WARNING', count: 1 });     // TB's completed Gel course; Front desk awards no certificate
    expect(count(all, 'verified_certificate_no_date')).toMatchObject({ state: 'WARNING', count: 2 });      // TA 'No date' + the staff 'Desk no date'
    expect(count(all, 'verified_certificate_expired')).toMatchObject({ state: 'WARNING', count: 1 });      // TA 'Lapsed'
    expect(count(all, 'profile_change_waiting')).toMatchObject({ state: 'WARNING', count: 1 });            // GP only — GPX is the other salon's technician
    const b2 = await svc.run('technicians', { tenantId: T, branchId: B2 });
    expect(count(b2, 'training_overdue')).toMatchObject({ state: 'READY', count: 0 });
    expect(count(b2, 'training_certificate_unlinked').count).toBe(1);
    expect(count(b2, 'verified_certificate_no_date').count).toBe(0);                                         // staff certificates are salon-wide: every-branch scope only
    expect(count(b2, 'verified_certificate_expired').count).toBe(0);
    expect(count(b2, 'profile_change_waiting').count).toBe(0);
    expect((await q(sql`select (select count(*) from team_training_assignments) + (select count(*) from technician_certifications) + (select count(*) from tech_profile_change_requests) as n`)).rows).toEqual(before.rows);
  });
  it('extras PAYMENTS & MONEY 04: a cash or gift-card tender tied to a processor settlement batch is counted (a card one is not; another salon never)', async () => {
    const SB = id(640), SBX = id(641), K1 = id(642), KX = id(643);
    await q(sql`insert into payment_settlements (id, tenant_id, branch_id, settlement_id, gross_cents, net_cents) values (${SB}, ${T}, ${B1}, 'B-640', 9000, 8800), (${SBX}, ${X}, ${BX}, 'B-641', 100, 100)`);
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${K1}, ${T}, ${B1}, ${id(21)}, 'open', 0, 0, 0, 0), (${KX}, ${X}, ${BX}, ${id(22)}, 'open', 0, 0, 0, 0)`);
    await q(sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, settlement_batch_id) values
      (${T}, ${B1}, ${K1}, 'cash', 2000, 'approved', ${SB}), (${T}, ${B1}, ${K1}, 'gift_card', 1000, 'approved', ${SB}), (${T}, ${B1}, ${K1}, 'card', 6000, 'approved', ${SB}),
      (${T}, ${B1}, ${K1}, 'cash', 500, 'declined', ${SB}), (${X}, ${BX}, ${KX}, 'cash', 100, 'approved', ${SBX})`);
    expect(count(await svc.run('payments', { tenantId: T }), 'non_card_in_processor_batch')).toMatchObject({ state: 'FAILED', count: 2 });
    expect(count(await svc.run('payments', { tenantId: T, branchId: B2 }), 'non_card_in_processor_batch')).toMatchObject({ state: 'READY', count: 0 });
  });
  it('extras Membership Overview 13·08 / 16·03 / 16·02 — benefit redemption integrity and stuck billing; branch-scoped; never another salon; writes nothing', async () => {
    // own salon pair (ids 630..669, agent-3 range) so nothing planted earlier in this shared DB is counted
    const T3 = id(630), X3 = id(631), B31 = id(632), B32 = id(633), BX3 = id(634), C3 = id(635), CX3 = id(636), PL = id(637), PV = id(638), PLX = id(639), PVX = id(640);
    const BEN = id(641), BENX = id(642), M1 = id(643), M2 = id(644), MX = id(645), K1 = id(646), K2 = id(647), K3 = id(648), KX = id(649), RES = id(650), RESX = id(651), RES2 = id(652);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T3}, 'M', 'Members', 'sc-630', 'SC630', 'active'), (${X3}, 'MX', 'Other members', 'sc-631', 'SC631', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name) values (${B31}, ${T3}, 'Main'), (${B32}, ${T3}, 'Second'), (${BX3}, ${X3}, 'Other')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
      (${C3}, ${T3}, ${B31}, 'Mem', 'Ber', 'Mem Ber', '+15550006301'), (${CX3}, ${X3}, ${BX3}, 'Oth', 'Er', 'Oth Er', '+15550006302')`);
    await q(sql`insert into membership_plans (id, tenant_id, name, status) values (${PL}, ${T3}, 'Gold', 'active'), (${PLX}, ${X3}, 'Gold X', 'active')`);
    await q(sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, price_cents) values (${PV}, ${PL}, ${T3}, 1, 4900), (${PVX}, ${PLX}, ${X3}, 1, 4900)`);
    await q(sql`insert into membership_benefits (id, plan_version_id, tenant_id, benefit_type, label, credits_per_cycle) values (${BEN}, ${PV}, ${T3}, 'service_credit', 'Gel', 1), (${BENX}, ${PVX}, ${X3}, 'service_credit', 'Gel', 1)`);
    // M1 in B1 (cancelled yesterday), M2 in B2, MX the other salon's
    await q(sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, auto_renew, auto_renew_consent_at, canceled_at) values
      (${M1}, ${T3}, ${B31}, ${C3}, ${PL}, ${PV}, 'canceled', false, now(), now() - interval '1 day'),
      (${M2}, ${T3}, ${B32}, ${C3}, ${PL}, ${PV}, 'active', false, now(), null),
      (${MX}, ${X3}, ${BX3}, ${CX3}, ${PLX}, ${PVX}, 'canceled', false, now(), now() - interval '1 day')`);
    // K1 paid (B1), K2 voided (B2), K3 voided (B2, reversed), KX the other salon's voided ticket
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at, total_cents) values
      (${K1}, ${T3}, ${B31}, ${C3}, 'paid', now(), 4900), (${K2}, ${T3}, ${B32}, ${C3}, 'voided', null, 4900), (${K3}, ${T3}, ${B32}, ${C3}, 'void', null, 4900),
      (${KX}, ${X3}, ${BX3}, ${CX3}, 'voided', null, 4900)`);
    await q(sql`insert into membership_credit_ledger (tenant_id, customer_membership_id, benefit_id, entry_type, quantity, ticket_id, reservation_ref, reason) values
      (${T3}, ${M1}, ${BEN}, 'issued', 1, null, null, 'enrollment'),
      (${T3}, ${M1}, ${BEN}, 'redeemed', 1, ${K1}, null, 'service_redeem'),
      (${T3}, ${M1}, ${BEN}, 'redeemed', 1, ${K1}, null, 'service_redeem'),
      (${T3}, ${M1}, ${BEN}, 'reserved', 1, ${K1}, ${RES}, 'booking_reserve'),
      (${T3}, ${M2}, ${BEN}, 'issued', 3, null, null, 'enrollment'),
      (${T3}, ${M2}, ${BEN}, 'redeemed', 1, ${K2}, null, 'service_redeem'),
      (${T3}, ${M2}, ${BEN}, 'redeemed', 1, ${K3}, null, 'service_redeem'),
      (${T3}, ${M2}, ${BEN}, 'restored', 1, ${K3}, null, 'void_reversal'),
      (${T3}, ${M2}, ${BEN}, 'reserved', 1, ${K2}, ${RES2}, 'booking_reserve'),
      (${T3}, ${M2}, ${BEN}, 'released', 1, null, ${RES2}, 'booking_release'),
      (${X3}, ${MX}, ${BENX}, 'redeemed', 2, ${KX}, null, 'service_redeem'),
      (${X3}, ${MX}, ${BENX}, 'reserved', 1, ${KX}, ${RESX}, 'booking_reserve')`);
    // redemption snapshots: M1 has ONE for K1 although the ledger spent TWO (mismatch); M2's K2 and K3 match their ledger rows
    await q(sql`insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, benefit_id) values
      (${T3}, ${B31}, ${M1}, ${K1}, ${BEN}), (${T3}, ${B32}, ${M2}, ${K2}, ${BEN}), (${T3}, ${B32}, ${M2}, ${K3}, ${BEN}), (${X3}, ${BX3}, ${MX}, ${KX}, ${BENX})`);
    await q(sql`insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, created_at) values
      (${T3}, ${B31}, ${M1}, ${C3}, 'renewal', 4900, 'succeeded', 'sc630-a', now()),
      (${T3}, ${B32}, ${M2}, ${C3}, 'renewal', 4900, 'pending', 'sc630-b', now() - interval '3 days'),
      (${T3}, ${B32}, ${M2}, ${C3}, 'renewal', 4900, 'pending', 'sc630-c', now() - interval '2 hours'),
      (${T3}, ${B31}, ${M1}, ${C3}, 'enrollment', 4900, 'succeeded', 'sc630-d', now()),
      (${X3}, ${BX3}, ${MX}, ${CX3}, 'renewal', 4900, 'succeeded', 'sc630-x', now()),
      (${X3}, ${BX3}, ${MX}, ${CX3}, 'renewal', 4900, 'pending', 'sc630-y', now() - interval '3 days')`);
    const tally = sql`select (select count(*) from membership_credit_ledger) + (select count(*) from membership_redemptions) + (select count(*) from membership_payments) as n`;
    const before = (await q(tally)).rows;
    const all = await svc.run('memberships', { tenantId: T3 });
    expect(count(all, 'benefit_balance_negative')).toMatchObject({ state: 'FAILED', count: 1 });          // M1: 1 issued − 2 redeemed − 1 open hold; M2 is 3 − 2 + 1 restored = 2
    expect(count(all, 'redemption_ledger_mismatch')).toMatchObject({ state: 'FAILED', count: 1 });        // M1/K1: 1 snapshot vs 2 ledger redeems
    expect(count(all, 'reservation_open_on_closed_ticket')).toMatchObject({ state: 'WARNING', count: 1 }); // RES on paid K1; RES2 was released
    expect(count(all, 'redeemed_on_voided_ticket')).toMatchObject({ state: 'WARNING', count: 1 });        // K2 (K3 was restored)
    expect(count(all, 'payment_pending_stuck')).toMatchObject({ state: 'WARNING', count: 1 });            // the 3-day one, not the 2-hour one
    expect(count(all, 'charged_after_cancel')).toMatchObject({ state: 'FAILED', count: 1 });              // the renewal after M1's cancel; the enrollment row is not a renewal
    expect(all.overall).toBe('FAILED');
    const b2 = await svc.run('memberships', { tenantId: T3, branchId: B32 });
    expect(count(b2, 'benefit_balance_negative').count).toBe(0);
    expect(count(b2, 'redemption_ledger_mismatch').count).toBe(0);
    expect(count(b2, 'reservation_open_on_closed_ticket').count).toBe(0);
    expect(count(b2, 'redeemed_on_voided_ticket').count).toBe(1);
    expect(count(b2, 'payment_pending_stuck').count).toBe(1);
    expect(count(b2, 'charged_after_cancel').count).toBe(0);
    expect((await q(tally)).rows).toEqual(before);
  });
  it('extras Membership Overview 13·12 — collections against the payment ledger: invoice no longer paid, over the invoice, card without a reference; branch-scoped; never another salon; writes nothing', async () => {
    // own salon pair (ids 4401..4449, agent-4 range) so nothing planted earlier in this shared DB is counted
    const T4 = id(4401), X4 = id(4402), B41 = id(4403), B42 = id(4404), BX4 = id(4405), C4 = id(4406), CX4 = id(4407), PL = id(4408), PV = id(4409), PLX = id(4410), PVX = id(4411);
    const M1 = id(4412), M2 = id(4413), MX = id(4414), I1 = id(4415), I2 = id(4416), I3 = id(4417), IX = id(4418);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'M4', 'Members4', 'sc-4401', 'SC4401', 'active'), (${X4}, 'MX4', 'Other4', 'sc-4402', 'SC4402', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name) values (${B41}, ${T4}, 'Main'), (${B42}, ${T4}, 'Second'), (${BX4}, ${X4}, 'Other')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
      (${C4}, ${T4}, ${B41}, 'Fin', 'Ance', 'Fin Ance', '+15550044001'), (${CX4}, ${X4}, ${BX4}, 'Oth', 'Er', 'Oth Er', '+15550044002')`);
    await q(sql`insert into membership_plans (id, tenant_id, name, status) values (${PL}, ${T4}, 'Gold', 'active'), (${PLX}, ${X4}, 'Gold X', 'active')`);
    await q(sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, price_cents) values (${PV}, ${PL}, ${T4}, 1, 4900), (${PVX}, ${PLX}, ${X4}, 1, 4900)`);
    await q(sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, auto_renew, auto_renew_consent_at) values
      (${M1}, ${T4}, ${B41}, ${C4}, ${PL}, ${PV}, 'active', false, now()), (${M2}, ${T4}, ${B42}, ${C4}, ${PL}, ${PV}, 'active', false, now()),
      (${MX}, ${X4}, ${BX4}, ${CX4}, ${PLX}, ${PVX}, 'active', false, now())`);
    // I1 still paid (covers 4900), I2 refunded since, I3 paid but only 3000, IX the other salon's refunded invoice
    await q(sql`insert into invoices (id, tenant_id, branch_id, customer_id, invoice_number, status, subtotal_cents, total_cents, issue_date) values
      (${I1}, ${T4}, ${B41}, ${C4}, 'SC44-1', 'paid', 4900, 4900, current_date), (${I2}, ${T4}, ${B41}, ${C4}, 'SC44-2', 'refunded', 4900, 4900, current_date),
      (${I3}, ${T4}, ${B42}, ${C4}, 'SC44-3', 'paid', 3000, 3000, current_date), (${IX}, ${X4}, ${BX4}, ${CX4}, 'SC44-X', 'refunded', 4900, 4900, current_date)`);
    await q(sql`insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, processor, processor_ref, idempotency_key) values
      (${T4}, ${B41}, ${M1}, ${C4}, 'enrollment', 4900, 'succeeded', 'invoice', ${I1}, 'sc4401-ok'),
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'succeeded', 'invoice', ${I2}, 'sc4401-refunded-inv'),
      (${T4}, ${B42}, ${M2}, ${C4}, 'enrollment', 4900, 'succeeded', 'invoice', ${I3}, 'sc4401-over'),
      (${T4}, ${B42}, ${M2}, ${C4}, 'renewal', 4900, 'succeeded', 'card_on_file', null, 'sc4401-noref'),
      (${T4}, ${B42}, ${M2}, ${C4}, 'renewal', 4900, 'failed', 'card_on_file', null, 'sc4401-failed-noref'),
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'succeeded', 'recorded', null, 'sc4401-recorded'),
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'succeeded', 'card_on_file', 'ref-1', 'sc4401-withref'),
      (${X4}, ${BX4}, ${MX}, ${CX4}, 'enrollment', 4900, 'succeeded', 'invoice', ${IX}, 'sc4401-x'),
      (${X4}, ${BX4}, ${MX}, ${CX4}, 'renewal', 4900, 'succeeded', 'card_on_file', null, 'sc4401-x2')`);
    const tally = sql`select (select count(*) from membership_payments) + (select count(*) from invoices) as n`;
    const before = (await q(tally)).rows;
    const all = await svc.run('memberships', { tenantId: T4 });
    expect(count(all, 'invoice_collection_not_paid')).toMatchObject({ state: 'FAILED', count: 1 });       // I2 refunded; I1 and I3 still paid
    expect(count(all, 'invoice_collection_over_invoice')).toMatchObject({ state: 'FAILED', count: 1 });   // 4900 claimed on the 3000 I3
    expect(count(all, 'card_collection_without_ref')).toMatchObject({ state: 'WARNING', count: 1 });      // the failed and 'recorded' rows are not counted
    const b1 = await svc.run('memberships', { tenantId: T4, branchId: B41 });
    expect(count(b1, 'invoice_collection_not_paid').count).toBe(1);
    expect(count(b1, 'invoice_collection_over_invoice').count).toBe(0);
    expect(count(b1, 'card_collection_without_ref').count).toBe(0);
    expect((await q(tally)).rows).toEqual(before);
  });
  it('extras Membership Overview 16·07 / 16·08 — duplicate member notices, a decline the member was never told about, another salon\'s branch / plan / money rows; branch-scoped; writes nothing', async () => {
    // own salon pair (ids 4450..4499, agent-4 range)
    const T4 = id(4450), X4 = id(4451), B41 = id(4452), B42 = id(4453), BX4 = id(4454), C4 = id(4455), CX4 = id(4456), PL = id(4457), PV = id(4458), PLX = id(4459), PVX = id(4460);
    const M1 = id(4461), M2 = id(4462), M3 = id(4463), MX = id(4464);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'M5', 'Members5', 'sc-4450', 'SC4450', 'active'), (${X4}, 'MX5', 'Other5', 'sc-4451', 'SC4451', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name) values (${B41}, ${T4}, 'Main'), (${B42}, ${T4}, 'Second'), (${BX4}, ${X4}, 'Other')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
      (${C4}, ${T4}, ${B41}, 'Con', 'Sent', 'Con Sent', '+15550044501'), (${CX4}, ${X4}, ${BX4}, 'Oth', 'Er', 'Oth Er', '+15550044502')`);
    await q(sql`insert into membership_plans (id, tenant_id, name, status) values (${PL}, ${T4}, 'Gold', 'active'), (${PLX}, ${X4}, 'Gold X', 'active')`);
    await q(sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, price_cents) values (${PV}, ${PL}, ${T4}, 1, 4900), (${PVX}, ${PLX}, ${X4}, 1, 4900)`);
    // M1 (B1) fine; M2 (B2) points at the OTHER salon's plan; M3 sits in the other salon's branch; MX the other salon's own
    await q(sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, auto_renew, auto_renew_consent_at) values
      (${M1}, ${T4}, ${B41}, ${C4}, ${PL}, ${PV}, 'active', false, now()), (${M2}, ${T4}, ${B42}, ${C4}, ${PLX}, ${PV}, 'active', false, now()),
      (${M3}, ${T4}, ${BX4}, ${C4}, ${PL}, ${PV}, 'active', false, now()), (${MX}, ${X4}, ${BX4}, ${CX4}, ${PLX}, ${PVX}, 'active', false, now())`);
    // M1: two declines — one told, one not; an old untold decline (> 30 days) is not counted; M2's decline told.
    // A payment filed under the other salon for M1 (leak), and the other salon's own untold decline (never counted).
    await q(sql`insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, created_at) values
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'failed', 'sc4450-told', now() - interval '2 days'),
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'failed', 'sc4450-untold', now() - interval '1 hour'),
      (${T4}, ${B41}, ${M1}, ${C4}, 'renewal', 4900, 'failed', 'sc4450-old', now() - interval '40 days'),
      (${T4}, ${B42}, ${M2}, ${C4}, 'installment', 4900, 'failed', 'sc4450-m2', now() - interval '3 hours'),
      (${X4}, ${BX4}, ${M1}, ${C4}, 'renewal', 4900, 'succeeded', 'sc4450-leak', now()),
      (${X4}, ${BX4}, ${MX}, ${CX4}, 'renewal', 4900, 'failed', 'sc4450-x', now())`);
    // notices: M1's decline told at -2 days (its later decline has none after it); M1's welcome twice (duplicate); M2 told
    await q(sql`insert into customer_notifications (tenant_id, customer_id, type, title, reference, created_at) values
      (${T4}, ${C4}, 'membership', 'Payment issue', ${'membership-payment-failed:' + M1 + ':2026-11-10'}, now() - interval '2 days'),
      (${T4}, ${C4}, 'membership', 'Welcome', ${'membership-welcome:' + M1}, now() - interval '9 days'),
      (${T4}, ${C4}, 'membership', 'Welcome', ${'membership-welcome:' + M1}, now() - interval '9 days'),
      (${T4}, ${C4}, 'membership', 'Payment issue', ${'membership-payment-failed:' + M2 + ':2026-11-12'}, now() - interval '2 hours'),
      (${X4}, ${CX4}, 'membership', 'Welcome', ${'membership-welcome:' + MX}, now()), (${X4}, ${CX4}, 'membership', 'Welcome', ${'membership-welcome:' + MX}, now())`);
    const tally = sql`select (select count(*) from membership_payments) + (select count(*) from customer_notifications) + (select count(*) from customer_memberships) as n`;
    const before = (await q(tally)).rows;
    const all = await svc.run('memberships', { tenantId: T4 });
    expect(count(all, 'duplicate_member_notice')).toMatchObject({ state: 'WARNING', count: 1 });      // M1's welcome; the other salon's pair never
    expect(count(all, 'failed_charge_not_told')).toMatchObject({ state: 'WARNING', count: 1 });       // the 1-hour decline only
    expect(count(all, 'branch_or_plan_other_salon')).toMatchObject({ state: 'FAILED', count: 2 });    // M2 (plan) and M3 (branch)
    expect(count(all, 'money_rows_other_salon')).toMatchObject({ state: 'FAILED', count: 1 });        // the payment filed under the other salon for M1
    const x = await svc.run('memberships', { tenantId: X4 });
    expect(count(x, 'money_rows_other_salon').count).toBe(1);                                          // seen from the other side too (it holds a row for T's member)
    const b2 = await svc.run('memberships', { tenantId: T4, branchId: B42 });
    expect(count(b2, 'duplicate_member_notice').count).toBe(0);
    expect(count(b2, 'failed_charge_not_told').count).toBe(0);
    expect(count(b2, 'branch_or_plan_other_salon').count).toBe(1);
    expect(count(b2, 'money_rows_other_salon').count).toBe(0);
    expect((await q(tally)).rows).toEqual(before);
  });
  it('extras Membership Overview 16·06 — wiring: a benefit used on another customer\'s ticket, a redemption line on another ticket, a live membership on an archived profile; branch-scoped; writes nothing', async () => {
    // own salon pair (ids 4500..4549, agent-4 range)
    const T4 = id(4500), X4 = id(4501), B41 = id(4502), B42 = id(4503), BX4 = id(4504), C1 = id(4505), C2 = id(4506), CA = id(4507), CX = id(4508), PL = id(4509), PV = id(4510), PLX = id(4511), PVX = id(4512);
    const M1 = id(4513), M2 = id(4514), MA = id(4515), MX = id(4516), K1 = id(4517), K2 = id(4518), K3 = id(4519), KX = id(4520), L1 = id(4521), L2 = id(4522), LX = id(4523);
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T4}, 'W4', 'Wiring4', 'sc-4500', 'SC4500', 'active'), (${X4}, 'WX4', 'OtherW4', 'sc-4501', 'SC4501', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name) values (${B41}, ${T4}, 'Main'), (${B42}, ${T4}, 'Second'), (${BX4}, ${X4}, 'Other')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, archived_at) values
      (${C1}, ${T4}, ${B41}, 'Mem', 'One', 'Mem One', '+15550045001', null), (${C2}, ${T4}, ${B41}, 'Guest', 'Two', 'Guest Two', '+15550045002', null),
      (${CA}, ${T4}, ${B42}, 'Old', 'Profile', 'Old Profile', '+15550045003', now()), (${CX}, ${X4}, ${BX4}, 'Oth', 'Er', 'Oth Er', '+15550045004', now())`);
    await q(sql`insert into membership_plans (id, tenant_id, name, status) values (${PL}, ${T4}, 'Gold', 'active'), (${PLX}, ${X4}, 'Gold X', 'active')`);
    await q(sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, price_cents) values (${PV}, ${PL}, ${T4}, 1, 4900), (${PVX}, ${PLX}, ${X4}, 1, 4900)`);
    await q(sql`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, auto_renew, auto_renew_consent_at) values
      (${M1}, ${T4}, ${B41}, ${C1}, ${PL}, ${PV}, 'active', false, now()), (${M2}, ${T4}, ${B41}, ${C1}, ${PL}, ${PV}, 'canceled', false, now()),
      (${MA}, ${T4}, ${B42}, ${CA}, ${PL}, ${PV}, 'active', false, now()), (${MX}, ${X4}, ${BX4}, ${CX}, ${PLX}, ${PVX}, 'active', false, now())`);
    // K1 the member's own ticket, K2 the guest's ticket, K3 another ticket of the member; KX the other salon's guest ticket
    await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents) values
      (${K1}, ${T4}, ${B41}, ${C1}, 'open', 4900), (${K2}, ${T4}, ${B41}, ${C2}, 'open', 4900), (${K3}, ${T4}, ${B41}, ${C1}, 'open', 4900), (${KX}, ${X4}, ${BX4}, ${CX}, 'open', 4900), (${id(4532)}, ${X4}, ${BX4}, ${CX}, 'open', 4900)`);
    await q(sql`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values
      (${L1}, ${T4}, ${B41}, ${K1}, ${id(4530)}, 'Gel', 4900, 45, 4900), (${L2}, ${T4}, ${B41}, ${K3}, ${id(4530)}, 'Gel', 4900, 45, 4900), (${LX}, ${X4}, ${BX4}, ${KX}, ${id(4531)}, 'Gel', 4900, 45, 4900)`);
    // fine: M1 on K1/L1; guest: M1 on K2; line L2 (on K3) recorded against K1; the other salon's mismatched line never counted
    await q(sql`insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, service_line_id) values
      (${T4}, ${B41}, ${M1}, ${K1}, ${L1}), (${T4}, ${B41}, ${M1}, ${K2}, null), (${T4}, ${B41}, ${M1}, ${K1}, ${L2}), (${X4}, ${BX4}, ${MX}, ${id(4532)}, ${LX})`);
    const tally = sql`select (select count(*) from membership_redemptions) + (select count(*) from customer_memberships) as n`;
    const before = (await q(tally)).rows;
    const all = await svc.run('memberships', { tenantId: T4 });
    expect(count(all, 'redeemed_for_other_customer')).toMatchObject({ state: 'WARNING', count: 1 });         // K2 is the guest's
    expect(count(all, 'redemption_line_other_ticket')).toMatchObject({ state: 'FAILED', count: 1 });         // L2 sits on K3
    expect(count(all, 'live_membership_archived_customer')).toMatchObject({ state: 'WARNING', count: 1 });   // MA; the cancelled M2 and the other salon's MX are not
    const b2 = await svc.run('memberships', { tenantId: T4, branchId: B42 });
    expect(count(b2, 'redeemed_for_other_customer').count).toBe(0);
    expect(count(b2, 'redemption_line_other_ticket').count).toBe(0);
    expect(count(b2, 'live_membership_archived_customer').count).toBe(1);
    expect((await q(tally)).rows).toEqual(before);
  });
});
