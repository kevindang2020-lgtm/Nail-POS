// sms-billing.pgtest.vitest.spec.ts — §47/§22-§24/§45 on the REAL schema (sms-packages P7).
// Pins: the charges feed prices from the CYCLE SNAPSHOT and shapes rows exactly like billing_invoice_lines ·
// §68 exact money math (base + count × unit, integer cents) · provider cost is NULL-honest with zero recorded
// micros and REAL when micros exist (10,000 micros = 1 cent) · §45 groups by purpose over billable rows only.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';   // Constitution 13: stated by the package, not assumed from the file's location
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { SmsEntitlementService } from './sms-entitlement.service';
import { SmsBillingService } from './sms-billing.service';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let ent: SmsEntitlementService;
let billing: SmsBillingService;
const T = 'a4000000-0000-4000-8000-000000000001';
const MONTH = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  const lite = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await applyMigrationToPglite(lite, readFileSync(join(dir, f), 'utf8'));
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {}, acquireConnection: async () => ({
          executeQuery: async (q: any) => { const r = await lite.query(q.sql, q.parameters as any[]); return { rows: r.rows as any[], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
          streamQuery: () => { throw new Error('no stream'); },
        }),
        beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
        releaseConnection: async () => {}, destroy: async () => {},
      }),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  ent = new SmsEntitlementService(db);
  billing = new SmsBillingService(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
            values (${T}, 'Bill Salon', 'Bill Salon', 'bill-salon', 'BILL01', 'active')`.execute(db);
  const pk: any = await sql`select id from sms_verification_packages where code = 'sms_growth'`.execute(db);
  await sql`update sms_verification_packages set included_verification_count = 2, monthly_price_cents = 4900,
            overage_enabled = true, overage_unit_price_cents = 3 where id = ${pk.rows[0].id}`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T}, ${pk.rows[0].id})`.execute(db);
  await ent.recordSubmission(T, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_bill_1' });
  await ent.recordSubmission(T, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_bill_2' });
  await ent.recordSubmission(T, 'CUSTOMER_PHONE_CHANGE', { providerMessageId: 'SM_bill_3' });   // overage #1
}, 240_000);

describe('SMS billing — §47 feed + §22-§24 margin honesty + §45 analytics', () => {
  it('§47/§68: the charges feed prices from the SNAPSHOT and shapes invoice-ready lines with exact cents', async () => {
    const out = await billing.chargesForMonth(MONTH);
    const t = out.tenants.find((x: any) => x.tenantId === T)!;
    expect(t.baseCents).toBe(4900);
    expect(t.overageCents).toBe(3);                                   // 1 × snapshot 3¢
    expect(t.totalCents).toBe(4903);
    expect(t.lines[0]).toMatchObject({ kind: 'sms_package_base', quantity: 1, unit_price_cents: 4900, amount_cents: 4900 });
    expect(t.lines[1]).toMatchObject({ kind: 'sms_overage', quantity: 1, unit_price_cents: 3, amount_cents: 3 });
  });

  it('§22/§23: with ZERO recorded provider costs, costAvailable is false and nothing is invented', async () => {
    const a = await billing.revenueAnalytics(MONTH);
    expect(a.totals.subscriptionRevenueCents).toBe(4900);
    expect(a.totals.overageRevenueCents).toBe(3);
    expect(a.totals.costAvailable).toBe(false);
    expect(a.totals.providerCostCents).toBeNull();
    expect(a.totals.grossMarginCents).toBeNull();
  });

  it('when provider micros EXIST, cost and margin become real (10,000 micros = 1¢)', async () => {
    await sql`update sms_usage_records set provider_cost_micros = 79000 where provider_message_id = 'SM_bill_1'`.execute(db);
    await sql`update sms_usage_records set provider_cost_micros = 79000 where provider_message_id = 'SM_bill_2'`.execute(db);
    const a = await billing.revenueAnalytics(MONTH);
    expect(a.totals.costAvailable).toBe(true);
    expect(a.totals.providerCostCents).toBe(16);                      // 158,000 micros → 15.8¢ → 16 rounded
    expect(a.totals.grossMarginCents).toBe(4903 - 16);
  });

  it('§45: purposes group over BILLABLE rows; statuses report raw honest counts', async () => {
    const a = await billing.revenueAnalytics(MONTH);
    const purposes = Object.fromEntries(a.byPurpose.map((p: any) => [p.purpose, p.count]));
    expect(purposes.BOOKING_VERIFICATION).toBe(2);
    expect(purposes.CUSTOMER_PHONE_CHANGE).toBe(1);
    expect(a.byStatus.find((s: any) => s.status === 'SUBMITTED')!.count).toBeGreaterThanOrEqual(3);
  });
});
