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
});
