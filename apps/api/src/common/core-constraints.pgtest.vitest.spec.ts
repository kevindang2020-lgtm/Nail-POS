// core-constraints.pgtest — BUILD_PLAN Phase 10 (Constitution 1 §33–40, §69–71) on the real migrated schema:
//   (a) a fresh database defers NOTHING (every constraint of 537–539 applies cleanly);
//   (b) each new constraint refuses the bad row;
//   (c) a deferred constraint is recorded instead of failing the deploy, and the retry service resolves it once the data
//       is fixed (and refuses a retry statement that is not one the migrations write);
//   (d) the five new tenant-consistency triggers refuse a cross-tenant child;
//   (e) expectedVersion 409s (technician schedule, inventory location stock); (f) the settlement batch is linked.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechniciansRepository, ScheduleVersionConflict } from '@aipowersalon/workforce';
import { InventoryService } from '@aipowersalon/inventory';
import { PaymentWebhookService, settlementTxnIds } from '@aipowersalon/payments';
import { DbConstraintsService, allowedRetrySql } from './db-constraints.service';

let pg: any; let db: any;
const TA = 'b0b0b0b0-0000-4000-8000-00000000000a', TB = 'b0b0b0b0-0000-4000-8000-00000000000b';
const BA = 'b1b1b1b1-0000-4000-8000-00000000000a', BB = 'b1b1b1b1-0000-4000-8000-00000000000b';
const CA = 'b2b2b2b2-0000-4000-8000-00000000000a', CB = 'b2b2b2b2-0000-4000-8000-00000000000b';
const KA = 'b3b3b3b3-0000-4000-8000-00000000000a';   // salon A's ticket

/** Insert a row filling every NOT NULL, default-less column the caller did not give — robust to columns other Phase 10
 *  migrations add. Returns the row's id. */
async function insertMinimal(table: string, values: Record<string, unknown>): Promise<string> {
  const cols = (await pg.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`, [table])).rows as any[];
  const v: Record<string, unknown> = { ...values };
  for (const c of cols) {
    if (c.column_name in v) continue;
    v[c.column_name] = c.data_type === 'uuid' ? crypto.randomUUID()
      : /int|numeric|double|real/.test(c.data_type) ? 0
      : c.data_type === 'boolean' ? false
      : c.data_type === 'jsonb' || c.data_type === 'json' ? '{}'
      : /timestamp|date/.test(c.data_type) ? new Date().toISOString()
      : c.data_type === 'ARRAY' ? '{}'
      : 'x';
  }
  const keys = Object.keys(v);
  const r = await pg.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, keys.map((k) => v[k]));
  return r.rows[0].id;
}
const refused = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[TA, 'P10BA'], [TB, 'P10BB']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${TA}', 'A'), ('${BB}', '${TB}', 'B')`);
  await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CA}', '${TA}', '${BA}', 'A', 'A', 'A A'), ('${CB}', '${TB}', '${BB}', 'B', 'B', 'B B')`);
  await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${KA}', '${TA}', '${BA}', '${CA}')`);
});

describe('(a) a fresh database defers nothing', () => {
  it('no 537–539 constraint is in schema_deferred_constraints', async () => {
    expect((await pg.query(`SELECT name FROM schema_deferred_constraints WHERE migration ~ '^53[789]_'`)).rows).toEqual([]);
  });
  it('every constraint 538/539 add is VALIDATED (not left NOT VALID)', async () => {
    const r = (await pg.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname ~ '^(chk_.*_status_vocab|fk_payments_ticket|fk_payment_refunds_payment|fk_tickets_customer|fk_ticket_service_lines_ticket|fk_customers_tenant|fk_payments_settlement_batch|chk_booking_holds_window|chk_pos_tech_appointments_times|chk_inventory_location_stock_nonneg)$'`)).rows as any[];
    expect(r.filter((x) => x.conname.endsWith('_status_vocab'))).toHaveLength(64);
    expect(r).toHaveLength(64 + 9);
    expect(r.filter((x) => !x.convalidated)).toEqual([]);
  });
  it('the five unique indexes exist as UNIQUE', async () => {
    const r = (await pg.query(`SELECT indexname FROM pg_indexes WHERE indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexname = ANY($1)`,
      // Phase 15 C (567/568): the processor-event claim is per salon — uq_payment_gateway_events_tenant_processed replaced 538's
      // platform-wide uq_payment_gateway_events_processed (docs/UNIQUE_INDEX_TENANT_REVIEW.md)
      [['uq_users_tenant_email_ci', 'uq_users_tenant_phone', 'uq_customer_loyalty_profiles_customer', 'uq_payment_gateway_events_tenant_processed', 'uq_sms_delivery_logs_provider_sid']])).rows;
    expect(r).toHaveLength(5);
  });
  it('the migrations re-run cleanly (idempotent) and still defer nothing', async () => {
    for (const f of ['538_core_constraints.sql', '539_versions_consistency_ids_settlement.sql']) await pg.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
    expect((await pg.query(`SELECT count(*)::int c FROM schema_deferred_constraints WHERE migration ~ '^53[789]_'`)).rows[0].c).toBe(0);
  });
});

describe('(b) each constraint refuses the bad row', () => {
  it('core FKs: a payment / service line for a ticket that does not exist, a refund of a missing payment', async () => {
    const ghost = crypto.randomUUID();
    await refused(insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: ghost, method: 'cash', status: 'approved' }), /fk_payments_ticket/);
    await refused(insertMinimal('ticket_service_lines', { tenant_id: TA, branch_id: BA, ticket_id: ghost, service_id: crypto.randomUUID(), status: 'assigned' }), /fk_ticket_service_lines_ticket/);
    await refused(insertMinimal('payment_refunds', { tenant_id: TA, payment_id: ghost, status: 'refunded' }), /fk_payment_refunds_payment/);
  });
  it('core FK: a ticket for a customer that does not exist', async () => {
    await refused(pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3)`, [TA, BA, crypto.randomUUID()]), /fk_tickets_customer/);
  });
  it('core FK: customers follow their salon (CASCADE, the way branches and users already do)', async () => {
    const T = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID();
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'X', 'X', 'p10x', 'P10X', 'active')`);
    await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'X')`);
    await pg.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'X', 'X', 'X X')`);
    await pg.query(`DELETE FROM tenants WHERE id = $1`, [T]);
    expect((await pg.query(`SELECT count(*)::int c FROM customers WHERE id = $1`, [C])).rows[0].c).toBe(0);
    expect((await pg.query(`SELECT confdeltype FROM pg_constraint WHERE conname = 'fk_customers_tenant'`)).rows[0].confdeltype).toBe('c');
  });
  it('users: one login per email (case-insensitive) and per phone inside a salon; another salon may reuse them', async () => {
    await insertMinimal('users', { tenant_id: TA, email: 'Dup@Example.test', normalized_phone: '+15550001111', role: 'OWNER', status: 'active' });
    await refused(insertMinimal('users', { tenant_id: TA, email: 'dup@example.TEST', role: 'MANAGER', status: 'active' }), /uq_users_tenant_email_ci/);
    await refused(insertMinimal('users', { tenant_id: TA, normalized_phone: '+15550001111', role: 'MANAGER', status: 'active' }), /uq_users_tenant_phone/);
    await expect(insertMinimal('users', { tenant_id: TB, email: 'dup@example.test', normalized_phone: '+15550001111', role: 'OWNER', status: 'active' })).resolves.toBeTruthy();
  });
  it('one loyalty profile per customer', async () => {
    await insertMinimal('customer_loyalty_profiles', { tenant_id: TA, branch_id: BA, customer_id: CA });
    await refused(insertMinimal('customer_loyalty_profiles', { tenant_id: TA, branch_id: BA, customer_id: CA }), /uq_customer_loyalty_profiles_customer/);
  });
  it('a processor event is PROCESSED once; unprocessed delivery attempts may repeat', async () => {
    const ev = { tenant_id: TA, processor_type: 'fiserv', event_id: 'evt-p10-1', signature_valid: false };   // Phase 15 C: per salon
    await insertMinimal('payment_gateway_events', ev); await insertMinimal('payment_gateway_events', ev);   // two failed attempts: fine
    await insertMinimal('payment_gateway_events', { ...ev, signature_valid: true, processed_at: new Date().toISOString() });
    await refused(insertMinimal('payment_gateway_events', { ...ev, signature_valid: true, processed_at: new Date().toISOString() }), /uq_payment_gateway_events_tenant_processed/);
  });
  it('one SMS delivery log per provider message id', async () => {
    await insertMinimal('sms_delivery_logs', { provider_sid: 'SM-p10-1', status: 'sent', phone_masked: 'x', template: 'x' });
    await refused(insertMinimal('sms_delivery_logs', { provider_sid: 'SM-p10-1', status: 'delivered', phone_masked: 'x', template: 'x' }), /uq_sms_delivery_logs_provider_sid/);
  });
  it('booking hold window, appointment HH:MM times, stock never negative', async () => {
    const t = Date.now();
    await refused(insertMinimal('booking_holds', { tenant_id: TA, branch_id: BA, start_time: new Date(t).toISOString(), end_time: new Date(t).toISOString(), expires_at: new Date(t + 6e5).toISOString() }), /chk_booking_holds_window/);
    const appt = { tenant_id: TA, branch_id: BA, technician_id: null as any, customer_name: 'A', appt_date: '2026-10-08' };
    const tech = await insertMinimal('technicians', { tenant_id: TA, branch_id: BA, first_name: 'T', last_name: 'T', full_name: 'T T' });
    appt.technician_id = tech;
    await refused(insertMinimal('pos_tech_appointments', { ...appt, start_time: '9:00', end_time: '10:00' }), /chk_pos_tech_appointments_times/);
    await refused(insertMinimal('pos_tech_appointments', { ...appt, start_time: '10:00', end_time: '09:30' }), /chk_pos_tech_appointments_times/);
    await expect(insertMinimal('pos_tech_appointments', { ...appt, start_time: '09:00', end_time: '10:00' })).resolves.toBeTruthy();
    await refused(insertMinimal('inventory_location_stock', { tenant_id: TA, branch_id: BA, product_id: crypto.randomUUID(), quantity_on_hand: -1 }), /chk_inventory_location_stock_nonneg/);
  });
  it('status vocabularies: a typo is refused on a real insert (payments, sessions, campaigns)', async () => {
    await refused(insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: KA, method: 'cash', status: 'aproved' }), /chk_payments_status_vocab/);
    await expect(insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: KA, method: 'cash', status: 'approved' })).resolves.toBeTruthy();
    await refused(insertMinimal('campaigns', { tenant_id: TA, status: 'sending' }), /chk_campaigns_status_vocab/);
  });
  it('every one of the 64 status CHECKs refuses an unknown value and accepts each value it lists', async () => {
    const r = (await pg.query(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE 'chk\\_%\\_status\\_vocab'`)).rows as any[];
    expect(r).toHaveLength(64);
    for (const c of r) {
      const expr = String(c.def).replace(/^CHECK\s*/, '').replace(/\bstatus\b/g, '$1::text');
      expect((await pg.query(`SELECT ${expr} AS ok`, ['zz_not_a_status'])).rows[0].ok, c.conname).toBe(false);
      for (const v of [...c.def.matchAll(/'([a-z_]+)'::text/g)].map((m: any) => m[1])) expect((await pg.query(`SELECT ${expr} AS ok`, [v])).rows[0].ok, `${c.conname}:${v}`).toBe(true);
    }
  });
});

describe('(c) pre-flight: existing bad data defers instead of failing; the retry resolves it once fixed', () => {
  const svc = () => new DbConstraintsService(pg);
  const deferral = async (name: string) => (await pg.query(`SELECT * FROM schema_deferred_constraints WHERE name = $1`, [name])).rows[0];

  it('CHECK: added NOT VALID + recorded (counts only); retry is still_blocked until the row is fixed, then validates', async () => {
    await pg.exec(`ALTER TABLE booking_holds DROP CONSTRAINT chk_booking_holds_window`);
    const id = await insertMinimal('booking_holds', { tenant_id: TA, branch_id: BA, start_time: '2026-10-08T10:00:00Z', end_time: '2026-10-08T09:00:00Z', expires_at: '2026-10-08T11:00:00Z' });
    await pg.exec(`SELECT schema_apply_check('booking_holds', 'chk_booking_holds_window', 'end_time > start_time', '538_core_constraints.sql')`);
    const d = await deferral('chk_booking_holds_window');
    expect(d).toMatchObject({ kind: 'check_validation', blocking_rows: 1, table_name: 'booking_holds' });
    expect(d.reason).not.toMatch(/2026|09:00/);   // counts, never row contents
    expect((await pg.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'chk_booking_holds_window'`)).rows[0].convalidated).toBe(false);
    expect((await svc().retry(d.id)).status).toBe('still_blocked');
    await pg.query(`UPDATE booking_holds SET end_time = '2026-10-08T10:30:00Z' WHERE id = $1`, [id]);
    expect(await svc().retry(d.id, 'test')).toMatchObject({ status: 'resolved', blockingRows: 0 });
    expect((await pg.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'chk_booking_holds_window'`)).rows[0].convalidated).toBe(true);
    expect((await deferral('chk_booking_holds_window')).resolved_by).toBe('test');
  });
  it('UNIQUE: duplicates → a NON-unique fallback index + a deferral; resolved after the duplicate goes', async () => {
    await pg.exec(`DROP INDEX uq_users_tenant_email_ci`);
    await insertMinimal('users', { tenant_id: TB, email: 'twin@example.test', role: 'OWNER', status: 'active' });
    const dup = await insertMinimal('users', { tenant_id: TB, email: 'TWIN@example.test', role: 'MANAGER', status: 'active' });
    await pg.exec(`SELECT schema_apply_unique('users', 'uq_users_tenant_email_ci', 'tenant_id, lower(email)', 'email IS NOT NULL', 'idx_users_tenant_email_ci', '538_core_constraints.sql')`);
    const d = await deferral('uq_users_tenant_email_ci');
    expect(d).toMatchObject({ kind: 'unique', blocking_rows: 1 });
    expect((await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_users_tenant_email_ci'`)).rows[0].indexdef).not.toMatch(/UNIQUE/);
    expect((await svc().retry(d.id)).status).toBe('still_blocked');
    await pg.query(`UPDATE users SET email = 'twin2@example.test' WHERE id = $1`, [dup]);
    expect((await svc().retry(d.id)).status).toBe('resolved');
    expect((await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_users_tenant_email_ci'`)).rows[0].indexdef).toMatch(/UNIQUE/);
  });
  it('FOREIGN KEY: orphans keep it NOT VALID + deferred; validated once they are gone', async () => {
    await pg.exec(`ALTER TABLE tickets DROP CONSTRAINT fk_tickets_customer`);
    const orphan = (await pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [TA, BA, crypto.randomUUID()])).rows[0].id;
    await pg.exec(`SELECT schema_apply_fk('tickets', 'fk_tickets_customer', 'customer_id', 'customers', 'id', 'NO ACTION', '538_core_constraints.sql')`);
    const d = await deferral('fk_tickets_customer');
    expect(d).toMatchObject({ kind: 'foreign_key_validation', blocking_rows: 1 });
    expect(await svc().blockingRows({ name: d.name, tableName: d.table_name, kind: d.kind, retrySql: d.retry_sql })).toBe(1);
    await pg.query(`DELETE FROM tickets WHERE id = $1`, [orphan]);
    expect((await svc().retryAll()).find((r) => r.name === 'fk_tickets_customer')?.status).toBe('resolved');
    expect((await pg.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'fk_tickets_customer'`)).rows[0].convalidated).toBe(true);
  });
  it('TYPE CHANGE: a non-UUID value defers text → uuid; converted once fixed', async () => {
    await pg.exec(`CREATE TABLE zz_p10_text_ids (id serial PRIMARY KEY, tenant_id text NOT NULL)`);
    await pg.exec(`INSERT INTO zz_p10_text_ids (tenant_id) VALUES ('${TA}'), ('platform')`);
    await pg.exec(`SELECT schema_apply_uuid_type('zz_p10_text_ids', 'tenant_id', '539_versions_consistency_ids_settlement.sql')`);
    const d = await deferral('uuid_zz_p10_text_ids_tenant_id');
    expect(d).toMatchObject({ kind: 'type_change', blocking_rows: 1 });
    expect(d.reason).not.toMatch(/platform/);
    expect((await svc().retry(d.id)).status).toBe('still_blocked');
    await pg.exec(`UPDATE zz_p10_text_ids SET tenant_id = '${TB}' WHERE tenant_id = 'platform'`);
    expect((await svc().retry(d.id)).status).toBe('resolved');
    expect((await pg.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'zz_p10_text_ids' AND column_name = 'tenant_id'`)).rows[0].data_type).toBe('uuid');
  });
  it('the 539 conversions landed on the real schema (uuid now)', async () => {
    const r = (await pg.query(`SELECT table_name || '.' || column_name AS c, data_type FROM information_schema.columns WHERE (table_name, column_name) IN
      (('pos_display_devices','tenant_id'), ('pos_display_devices','branch_id'), ('pos_tech_appointments','overbook_by_user_id'), ('reception_copilot_sessions','receptionist_user_id'), ('admin_commission_auth_codes','tenant_id'))`)).rows as any[];
    expect(r).toHaveLength(5);
    expect(r.filter((x) => x.data_type !== 'uuid')).toEqual([]);
  });
  it('a retry statement that is not one the migrations write is REFUSED, never executed', async () => {
    expect(allowedRetrySql('DROP TABLE tenants')).toBeNull();
    expect(allowedRetrySql('ALTER TABLE users VALIDATE CONSTRAINT x; DROP TABLE tenants')).toBeNull();
    expect(allowedRetrySql('ALTER TABLE users VALIDATE CONSTRAINT fk_x')).toBe('ALTER TABLE users VALIDATE CONSTRAINT fk_x');
    expect(allowedRetrySql('CREATE UNIQUE INDEX IF NOT EXISTS uq_a ON users (tenant_id, lower(email)) WHERE email IS NOT NULL')).not.toBeNull();
    await pg.exec(`SELECT schema_defer_constraint('zz_evil', 'tenants', 'other', 'test', 'x', 0, 'DROP TABLE tenants')`);
    const d = await deferral('zz_evil');
    expect((await svc().retry(d.id)).status).toBe('refused');
    expect((await pg.query(`SELECT to_regclass('tenants') IS NOT NULL AS ok`)).rows[0].ok).toBe(true);
  });
});

describe('(d) 539: the five new tenant-consistency triggers refuse a cross-tenant child', () => {
  it('a service line on another salon\'s ticket', async () => {
    await refused(insertMinimal('ticket_service_lines', { tenant_id: TB, branch_id: BB, ticket_id: KA, service_id: crypto.randomUUID(), status: 'assigned' }), /cross-tenant reference refused: ticket_service_lines\.ticket_id/);
  });
  it('a gift-card ledger row booked against another salon\'s card', async () => {
    const card = await insertMinimal('gift_cards', { tenant_id: TA, code: 'GC-P10-1', status: 'active' });
    await refused(insertMinimal('gift_card_transactions', { tenant_id: TB, gift_card_id: card, type: 'adjust' }), /gift_card_transactions\.gift_card_id/);
    await expect(insertMinimal('gift_card_transactions', { tenant_id: TA, gift_card_id: card, type: 'adjust' })).resolves.toBeTruthy();
  });
  it('loyalty ledger and loyalty profile for another salon\'s customer', async () => {
    await refused(insertMinimal('loyalty_ledger', { tenant_id: TB, customer_id: CA }), /loyalty_ledger\.customer_id/);
    await refused(insertMinimal('customer_loyalty_profiles', { tenant_id: TB, branch_id: BB, customer_id: CA }), /customer_loyalty_profiles\.customer_id/);
  });
  it('a redemption of another salon\'s deal', async () => {
    const deal = await insertMinimal('deals', { tenant_id: TA, title: 'D', status: 'active', owner_type: 'salon', discount_type: 'percent', discount_percent: 10 });
    await refused(insertMinimal('deal_redemptions', { tenant_id: TB, deal_id: deal, status: 'applied' }), /deal_redemptions\.deal_id/);
  });
  it('re-pointing an existing child at another salon is refused too (UPDATE OF tenant_id)', async () => {
    const card = await insertMinimal('gift_cards', { tenant_id: TA, code: 'GC-P10-2', status: 'active' });
    const tx = await insertMinimal('gift_card_transactions', { tenant_id: TA, gift_card_id: card, type: 'adjust' });
    await refused(pg.query(`UPDATE gift_card_transactions SET tenant_id = $1 WHERE id = $2`, [TB, tx]), /cross-tenant/);
  });
});

describe('(e) optimistic concurrency: a stale expectedVersion is a 409, not a silent overwrite', () => {
  const ctx = (tenantId: string, branchId: string) => ({ tenantId, branchId, userId: crypto.randomUUID(), role: 'OWNER', permissions: ['*'] } as any);
  it('technician schedule: version increments per save; a stale save is refused with the current version', async () => {
    const tech = await insertMinimal('technicians', { tenant_id: TA, branch_id: BA, first_name: 'S', last_name: 'S', full_name: 'S S' });
    const repo = new KyselyTechniciansRepository(db);
    const week = { weekly: { monday: { isWorking: true, startTime: '09:00', endTime: '17:00' } }, unavailableDates: [] };
    const v1 = await repo.setSchedule(ctx(TA, BA), tech, { ...week });
    expect(v1?.version).toBe(1);
    const v2 = await repo.setSchedule(ctx(TA, BA), tech, { ...week, expectedVersion: 1 });
    expect(v2?.version).toBe(2);
    const stale = repo.setSchedule(ctx(TA, BA), tech, { ...week, expectedVersion: 1 });
    await expect(stale).rejects.toBeInstanceOf(ScheduleVersionConflict);
    await expect(repo.setSchedule(ctx(TA, BA), tech, { ...week, expectedVersion: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 2 });
    expect((await repo.getSchedule(ctx(TA, BA), tech))?.version).toBe(2);   // nothing was overwritten
  });
  it('inventory location stock: the overrides PATCH honours expectedVersion (409 VERSION_CONFLICT)', async () => {
    const product = await insertMinimal('inventory_products', { tenant_id: TA, name: 'Gel' });
    const svc = new InventoryService(db);
    await svc.setLocationStockOverrides(ctx(TA, BA), product, { reorderLevelOverride: 3 });
    const v = (await svc.getProduct(ctx(TA, BA), product)).product.stockVersion;
    expect(typeof v).toBe('number');
    await svc.setLocationStockOverrides(ctx(TA, BA), product, { reorderLevelOverride: 4, expectedVersion: v });
    await expect(svc.setLocationStockOverrides(ctx(TA, BA), product, { reorderLevelOverride: 9, expectedVersion: v })).rejects.toMatchObject({ status: 409, extra: { code: 'VERSION_CONFLICT' } });
    expect((await pg.query(`SELECT reorder_level_override FROM inventory_location_stock WHERE product_id = $1`, [product])).rows[0].reorder_level_override).toBe(4);
  });
  it('the stock version is bumped by every update (trigger), not only by the overrides route', async () => {
    const product = await insertMinimal('inventory_products', { tenant_id: TA, name: 'Top coat' });
    await pg.query(`INSERT INTO inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand) VALUES ($1, $2, $3, 0)`, [TA, BA, product]);
    await pg.query(`UPDATE inventory_location_stock SET quantity_on_hand = 2 WHERE product_id = $1`, [product]);
    await pg.query(`UPDATE inventory_location_stock SET quantity_on_hand = 3 WHERE product_id = $1`, [product]);
    expect((await pg.query(`SELECT version FROM inventory_location_stock WHERE product_id = $1`, [product])).rows[0].version).toBe(2);
  });
});

describe('(f) payments ↔ settlement batch (§19)', () => {
  it('the webhook ledger: a duplicate PROCESSED event (a concurrent re-delivery) is absorbed; any other insert error still surfaces', async () => {
    const svc: any = new PaymentWebhookService(db, {} as any);
    const row = { tenant_id: TA, processor_type: 'fiserv', event_id: 'evt-race-p10', signature_valid: true, processed_at: true, payload_json_safe: {} };
    await svc.record(row);
    await expect(svc.record(row)).resolves.toBeUndefined();   // lost the race on uq_payment_gateway_events_tenant_processed (Phase 15 C): a duplicate, not a 500
    expect((await pg.query(`SELECT count(*)::int c FROM payment_gateway_events WHERE event_id = 'evt-race-p10'`)).rows[0].c).toBe(1);
    await expect(svc.record({ ...row, processor_type: null, event_id: 'evt-bad-p10' })).rejects.toThrow();   // NOT NULL: a real failure
  });
  it('settlementTxnIds reads the event\'s own id and the batch list, deduplicated', () => {
    expect(settlementTxnIds({ transactionIds: ['t1', 't2', 't1'], transactions: [{ retref: 't3' }, { id: 't2' }] }, 't0').sort()).toEqual(['t0', 't1', 't2', 't3']);
    expect(settlementTxnIds({}, null)).toEqual([]);
  });
  it('a signed settlement webhook links THIS salon\'s payments it names to the new batch row; another salon\'s are untouched', async () => {
    const secret = 'p10-test-webhook-secret';   // test fixture, not a credential
    const resolver: any = { resolveTenantByMerchantId: async (mid: string) => mid === 'MID-A' ? { tenantId: TA, webhookSecret: secret, merchantIdMasked: '***A' } : null };
    const kB = (await pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [TB, BB, CB])).rows[0].id;
    const pA1 = await insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: KA, method: 'card', status: 'approved', processor_transaction_id: 'rr-1' });
    const pA2 = await insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: KA, method: 'card', status: 'approved', processor_transaction_id: 'rr-2' });
    const pB = await insertMinimal('payments', { tenant_id: TB, branch_id: BB, ticket_id: kB, method: 'card', status: 'approved', processor_transaction_id: 'rr-2' });
    const body = { merchantId: 'MID-A', eventType: 'settlement.batch_closed', eventId: 'evt-settle-p10', settlementId: 'B-77', grossCents: 2000, transactionIds: ['rr-1', 'rr-2'] };
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    const res = await new PaymentWebhookService(db, resolver).handle('fiserv', raw, body, sig, { 'x-webhook-signature': sig });
    expect(res.status).toBe(200);
    expect((res.body as any).linkedPayments).toBe(2);
    const batch = (await pg.query(`SELECT id FROM payment_settlements WHERE tenant_id = $1 AND settlement_id = 'B-77'`, [TA])).rows[0].id;
    const rows = (await pg.query(`SELECT id, settlement_batch_id FROM payments WHERE id = ANY($1)`, [[pA1, pA2, pB]])).rows as any[];
    expect(rows.find((r) => r.id === pA1).settlement_batch_id).toBe(batch);
    expect(rows.find((r) => r.id === pA2).settlement_batch_id).toBe(batch);
    expect(rows.find((r) => r.id === pB).settlement_batch_id).toBeNull();
  });
  it('every status the webhook writes to a payment (settled / refunded / voided) is inside the payments CHECK', async () => {
    const secret = 'p10-test-webhook-secret';   // test fixture, not a credential
    const resolver: any = { resolveTenantByMerchantId: async () => ({ tenantId: TA, webhookSecret: secret, merchantIdMasked: '***A' }) };
    for (const [ev, want] of [['settlement.completed', 'settled'], ['refund.completed', 'refunded'], ['transaction.voided', 'voided']]) {
      const txn = `rr-st-${want}`;
      const p = await insertMinimal('payments', { tenant_id: TA, branch_id: BA, ticket_id: KA, method: 'card', status: 'approved', processor_transaction_id: txn });
      const body = { merchantId: 'MID-A', eventType: ev, eventId: `evt-${want}-p10`, transactionId: txn, amountCents: 100 };
      const raw = JSON.stringify(body); const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
      const res = await new PaymentWebhookService(db, resolver).handle('fiserv', raw, body, sig, { 'x-webhook-signature': sig });
      expect(res.status, ev).toBe(200);
      expect((await pg.query(`SELECT status FROM payments WHERE id = $1`, [p])).rows[0].status, ev).toBe(want);
    }
  });
});
