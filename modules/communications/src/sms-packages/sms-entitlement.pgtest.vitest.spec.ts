// sms-entitlement.pgtest.vitest.spec.ts — spec tests §60-§63 on the REAL schema through the REAL service.
// §60 package selection · §61 soft limit → overage at snapshot price · §62 hard limit → refused, nothing billed
// · §63 duplicate provider SID → one ledger row, one counted unit · plus the rollout-safe no-package path.
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
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let svc: SmsEntitlementService;
const T_FREE = 'a1000000-0000-4000-8000-000000000001';   // no package assigned
const T_SOFT = 'a1000000-0000-4000-8000-000000000002';   // included 2, overage on @ 3¢
const T_HARD = 'a1000000-0000-4000-8000-000000000003';   // included 1, hard limit

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
  svc = new SmsEntitlementService(db);
  for (const [t, slug] of [[T_FREE, 'sms-free'], [T_SOFT, 'sms-soft'], [T_HARD, 'sms-hard']] as const) {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '')}, 'active')`.execute(db);
  }
  // configure Growth-like terms on the seeded packages, then assign
  const pk: any = await sql`select id, code from sms_verification_packages order by display_order`.execute(db);
  const growth = pk.rows.find((p: any) => p.code === 'sms_growth').id;
  const starter = pk.rows.find((p: any) => p.code === 'sms_starter').id;
  await sql`update sms_verification_packages set included_verification_count = 2, overage_enabled = true,
            overage_unit_price_cents = 3, hard_limit_enabled = false, monthly_price_cents = 4900 where id = ${growth}`.execute(db);
  await sql`update sms_verification_packages set included_verification_count = 1, overage_enabled = false,
            hard_limit_enabled = true, monthly_price_cents = 1900 where id = ${starter}`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T_SOFT}, ${growth})`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T_HARD}, ${starter})`.execute(db);
}, 240_000);

describe('SMS entitlement — §60-§63 on the real schema', () => {
  it('rollout-safe: a tenant with NO package keeps verifying, unbilled and honestly ledgered', async () => {
    const pre = await svc.precheck(T_FREE, 'BOOKING_VERIFICATION');
    expect(pre.allowed).toBe(true);
    expect((pre as any).billable).toBe(false);
    const rec = await svc.recordSubmission(T_FREE, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_free_1' });
    expect(rec).toMatchObject({ recorded: true, billable: false });
    const row: any = await sql`select billable, package_id, billing_cycle_id from sms_usage_records
      where provider_message_id = 'SM_free_1'`.execute(db);
    expect(row.rows[0]).toMatchObject({ billable: false, package_id: null, billing_cycle_id: null });
  });

  it('§60+§61: consumption fills the allowance, then overflows into overage at the SNAPSHOT unit price', async () => {
    const p1 = await svc.precheck(T_SOFT, 'BOOKING_VERIFICATION');
    expect(p1).toMatchObject({ allowed: true, billable: true, willBeOverage: false, remainingIncluded: 2 });
    await svc.recordSubmission(T_SOFT, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_soft_1' });
    await svc.recordSubmission(T_SOFT, 'CUSTOMER_PHONE_VERIFICATION', { providerMessageId: 'SM_soft_2' });
    const p3 = await svc.precheck(T_SOFT, 'BOOKING_VERIFICATION');
    expect(p3).toMatchObject({ allowed: true, willBeOverage: true, remainingIncluded: 0, overageUnitPriceCents: 3 });
    const r3 = await svc.recordSubmission(T_SOFT, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_soft_3' });
    expect(r3.overage).toBe(true);
    const bal = await svc.balance(T_SOFT);
    expect(bal).toMatchObject({ hasPackage: true, usedIncluded: 2, overageCount: 1, estimatedOverageCents: 3 });
    const led: any = await sql`select unit_price_cents from sms_usage_records where provider_message_id = 'SM_soft_3'`.execute(db);
    expect(Number(led.rows[0].unit_price_cents)).toBe(3);    // priced from the cycle snapshot, exact cents
  });

  it('§62: hard limit refuses BEFORE any send — clear reason, no billable ledger row created', async () => {
    await svc.recordSubmission(T_HARD, 'LOGIN_OTP', { providerMessageId: 'SM_hard_1' });   // consumes the 1 included
    const pre = await svc.precheck(T_HARD, 'LOGIN_OTP');
    expect(pre).toMatchObject({ allowed: false, reason: 'hard_limit_reached', remainingIncluded: 0 });
    const n: any = await sql`select count(*)::int as n from sms_usage_records where tenant_id = ${T_HARD} and billable = true`.execute(db);
    expect(n.rows[0].n).toBe(1);                              // nothing new was billed after the refusal
  });

  it('§63: the same provider SID reported twice counts ONCE — duplicate flagged, counters unmoved', async () => {
    const before = await svc.balance(T_SOFT);
    const dup = await svc.recordSubmission(T_SOFT, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_soft_3' });
    expect(dup).toMatchObject({ recorded: false, duplicate: true });
    const after = await svc.balance(T_SOFT);
    expect(after.usedIncluded).toBe(before.usedIncluded);
    expect(after.overageCount).toBe(before.overageCount);
    const rows: any = await sql`select count(*)::int as n from sms_usage_records where provider_message_id = 'SM_soft_3'`.execute(db);
    expect(rows.rows[0].n).toBe(1);
  });

  it('§11 lifecycle: a delivery callback advances the ledger FORWARD only, and never rewrites billing', async () => {
    // mirrors what booking-verification-webhook.controller does on a TRUSTED, signature-verified payload
    const advance = async (sid: string, next: string, stamp: string) =>
      sql`update sms_usage_records set status = ${next}, ${sql.raw(stamp)} = now()
          where provider_message_id = ${sid} and status not in ('DELIVERED','UNDELIVERED','FAILED')`.execute(db);

    await advance('SM_soft_1', 'DELIVERED', 'delivered_at');
    let r: any = await sql`select status, billable, delivered_at from sms_usage_records where provider_message_id = 'SM_soft_1'`.execute(db);
    expect(r.rows[0].status).toBe('DELIVERED');
    expect(r.rows[0].billable).toBe(true);                 // acceptance already billed it; delivery doesn't re-decide
    expect(r.rows[0].delivered_at).toBeTruthy();

    // a LATE 'undelivered' retry must not drag a delivered row backwards
    await advance('SM_soft_1', 'UNDELIVERED', 'failed_at');
    r = await sql`select status, billable from sms_usage_records where provider_message_id = 'SM_soft_1'`.execute(db);
    expect(r.rows[0].status).toBe('DELIVERED');
    expect(r.rows[0].billable).toBe(true);

    // and the counters never moved for any of it
    const bal = await svc.balance(T_SOFT);
    expect(bal.hasPackage && bal.usedIncluded).toBe(2);
  });

  it('failures are ledgered FAILED and never billed (§20/§64 policy)', async () => {
    await svc.recordFailure(T_SOFT, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_soft_fail_1' });
    const row: any = await sql`select status, billable from sms_usage_records where provider_message_id = 'SM_soft_fail_1'`.execute(db);
    expect(row.rows[0]).toMatchObject({ status: 'FAILED', billable: false });
    const bal = await svc.balance(T_SOFT);
    expect(bal.failedCount).toBe(1);
  });
});
