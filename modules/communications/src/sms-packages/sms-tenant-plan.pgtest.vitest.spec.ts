// sms-tenant-plan.pgtest.vitest.spec.ts — §65 + §29 on the REAL schema through the REAL services.
// Pins: first assignment · immediate change RE-SNAPSHOTS the open cycle with counters preserved · the §28
// downgrade default waits for next cycle (pending pair set, current package untouched) · lazy promotion fires
// once the pending moment passes · manual credit grows the open cycle's allowance and requires a reason ·
// every operation writes its audit + change-history rows.
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
import { SmsTenantPlanService } from './sms-tenant-plan.service';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let ent: SmsEntitlementService;
let svc: SmsTenantPlanService;
const T = 'a2000000-0000-4000-8000-000000000001';
const CTX = { userId: 'b2000000-0000-4000-8000-000000000001', ip: '127.0.0.1' };
let STARTER = ''; let GROWTH = '';

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
  svc = new SmsTenantPlanService(db, ent);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
            values (${T}, 'Plan Salon', 'Plan Salon', 'plan-salon', 'PLAN01', 'active')`.execute(db);
  const pk: any = await sql`select id, code from sms_verification_packages`.execute(db);
  STARTER = pk.rows.find((p: any) => p.code === 'sms_starter').id;
  GROWTH = pk.rows.find((p: any) => p.code === 'sms_growth').id;
  await sql`update sms_verification_packages set included_verification_count = 100, monthly_price_cents = 1900,
            overage_enabled = false, hard_limit_enabled = true where id = ${STARTER}`.execute(db);
  await sql`update sms_verification_packages set included_verification_count = 2000, monthly_price_cents = 4900,
            overage_enabled = true, overage_unit_price_cents = 3 where id = ${GROWTH}`.execute(db);
}, 240_000);

describe('SMS tenant plan — §65 assignment + §29 credit on the real schema', () => {
  it('first assignment (no current package) applies immediately and writes history + audit', async () => {
    const out = await svc.assignPackage(CTX, T, STARTER, { reason: 'pilot onboarding' });
    expect(out.effective).toBe('immediate');
    const plan = await svc.tenantPlan(T);
    expect(plan.assignment?.packageCode).toBe('sms_starter');
    expect(plan.balance.hasPackage).toBe(true);
    expect(plan.recentChanges[0]).toMatchObject({ reason: 'pilot onboarding', to: 'SMS Essential', from: null });
    const a: any = await sql`select count(*)::int as n from audit_logs where action_type = 'super_admin.sms_tenant_package_assigned' and entity_id = ${T}`.execute(db);
    expect(a.rows[0].n).toBe(1);
  });

  it('UPGRADE defaults to immediate: subscription flips AND the open cycle re-snapshots with counters preserved', async () => {
    await ent.recordSubmission(T, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_plan_1' });   // 1 used on Starter
    const out = await svc.assignPackage(CTX, T, GROWTH, { reason: 'busy season upgrade' });
    expect(out.effective).toBe('immediate');
    const bal = await ent.balance(T);
    expect(bal).toMatchObject({ packageCode: 'sms_growth', includedAllowance: 2000, usedIncluded: 1 });   // counter survived the re-snapshot
    const cyc: any = await sql`select package_code, included_count, used_included from tenant_sms_billing_cycles where tenant_id = ${T} and status = 'open'`.execute(db);
    expect(cyc.rows[0]).toMatchObject({ package_code: 'sms_growth', included_count: 2000, used_included: 1 });
  });

  it('§28: DOWNGRADE with no explicit effective waits for next cycle — pending set, current package untouched', async () => {
    const out = await svc.assignPackage(CTX, T, STARTER, { reason: 'cost review' });
    expect(out.effective).toBe('next_cycle');
    const plan = await svc.tenantPlan(T);
    expect(plan.assignment?.packageCode).toBe('sms_growth');                       // still Growth today
    expect(plan.assignment?.pending?.packageName).toBe('SMS Essential');     // Starter queued
    expect(plan.balance.packageCode).toBe('sms_growth');                           // cycle snapshot untouched (§26)
  });

  it('lazy promotion: once the pending moment passes, the next touch applies it and clears the pair', async () => {
    await sql`update tenant_sms_subscriptions set pending_effective_at = now() - interval '1 minute' where tenant_id = ${T}`.execute(db);
    const bal = await ent.balance(T);                                              // any touch promotes
    const sub: any = await sql`select package_id, pending_package_id from tenant_sms_subscriptions where tenant_id = ${T}`.execute(db);
    expect(String(sub.rows[0].package_id)).toBe(String(STARTER));
    expect(sub.rows[0].pending_package_id).toBeNull();
    expect(bal.hasPackage).toBe(true);
  });

  it('§29: manual credit needs a reason, lands on the OPEN cycle, and grows remaining allowance', async () => {
    await expect(svc.addCredit(CTX, T, 50, '   ')).rejects.toThrow(/reason/i);
    await expect(svc.addCredit(CTX, T, -5, 'x')).rejects.toThrow(/positive whole/i);
    const before = await ent.balance(T);
    const after = await svc.addCredit(CTX, T, 50, 'goodwill for outage');
    expect(after.hasPackage && before.hasPackage && after.includedAllowance).toBe(before.hasPackage ? before.includedAllowance + 50 : -1);
    const a: any = await sql`select metadata_json from audit_logs where action_type = 'super_admin.sms_manual_credit_added' and entity_id = ${T}`.execute(db);
    expect(a.rows[0].metadata_json).toMatchObject({ amount: 50, expires: 'cycle_end' });
  });

  it('§44 list: assigned tenant shows live numbers; a package-less tenant shows honest nulls', async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values ('a2000000-0000-4000-8000-000000000002', 'Bare Salon', 'Bare Salon', 'bare-salon', 'BARE01', 'active')`.execute(db);
    const { tenants } = await svc.listTenantPlans();
    const plan = tenants.find((x: any) => x.tenantId === T)!;
    expect(plan.packageCode).toBe('sms_starter');           // assignment: promoted to Starter above
    // §26: the OPEN cycle keeps the snapshot it was billed under — Growth's 2000 — until cycle end, even though
    // the assignment already reads Starter. The mix is intentional and the endpoint returns both truths.
    expect(plan.includedAllowance).toBe(2000 + 50);         // Growth snapshot + the manual credit
    expect(plan.usedIncluded).toBe(1);
    expect(plan.lastSmsAt).toBeTruthy();
    const bare = tenants.find((x: any) => x.tenantName === 'Bare Salon')!;
    expect(bare.packageCode).toBeNull();
    expect(bare.includedAllowance).toBeNull();
    expect(bare.estimatedBillCents).toBeNull();
  });
  it('§9: self-service change works ONLY for self_service packages, audits as TENANT actor', async () => {
    await sql`update sms_verification_packages set self_service_available = true where id = ${GROWTH}`.execute(db);
    await sql`update sms_verification_packages set self_service_available = false where id = ${STARTER}`.execute(db);
    await expect(svc.selfServiceChange(CTX, T, STARTER)).rejects.toThrow(/not available for self-service/i);
    const out = await svc.selfServiceChange({ userId: 'c2000000-0000-4000-8000-000000000009', ip: '10.0.0.1' }, T, GROWTH);
    expect(out.effective).toBe('immediate');                                       // upgrade → §28 default immediate
    const a: any = await sql`select role, metadata_json from audit_logs
      where action_type = 'tenant.sms_package_self_service_change' and entity_id = ${T}`.execute(db);
    expect(a.rows.length).toBe(1);
    expect(a.rows[0].role).toBe('TENANT');
    expect(a.rows[0].metadata_json.reason).toBe('Tenant self-service package change');
  });

});
