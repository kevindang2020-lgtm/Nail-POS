// sms-platform-controls.pgtest.vitest.spec.ts — §40 master controls on the REAL schema.
// The asymmetry is the whole point and is pinned here: an EMERGENCY STOP refuses sends; a BILLING PAUSE does not
// — sends continue, unbilled — because a billing problem must never become a customer-facing outage.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';   // Constitution 13: stated by the package, not assumed from the file's location
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { SmsEntitlementService } from './sms-entitlement.service';
import { SmsPlatformControlsService } from './sms-platform-controls.service';
import { SmsTenantPlanService } from './sms-tenant-plan.service';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let controls: SmsPlatformControlsService;
let ent: SmsEntitlementService;
let plans: SmsTenantPlanService;
const T = 'a5000000-0000-4000-8000-000000000001';
const T_NEW = 'a5000000-0000-4000-8000-000000000002';
const CTX = { userId: 'b5000000-0000-4000-8000-000000000001', ip: '127.0.0.1' };
let GROWTH = '';

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
  controls = new SmsPlatformControlsService(db);
  ent = new SmsEntitlementService(db, controls);
  plans = new SmsTenantPlanService(db, ent, controls);
  for (const [t, slug] of [[T, 'ctl-a'], [T_NEW, 'ctl-b']] as const) {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '')}, 'active')`.execute(db);
  }
  const pk: any = await sql`select id from sms_verification_packages where code = 'sms_growth'`.execute(db);
  GROWTH = pk.rows[0].id;
  await sql`update sms_verification_packages set included_verification_count = 100, monthly_price_cents = 4900 where id = ${GROWTH}`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T}, ${GROWTH})`.execute(db);
});

afterEach(async () => {
  // leave the platform in its safe state for the next case
  await sql`update platform_settings set value = 'true'::jsonb where setting_key in
    ('sms.verification_platform_enabled','sms.package_billing_enabled','sms.new_tenant_enrollment_enabled')`.execute(db);
  await sql`update platform_settings set value = 'false'::jsonb where setting_key = 'sms.emergency_send_disabled'`.execute(db);
});

describe('§40 SMS master controls', () => {
  it('migration 430 seeds the SAFE state: platform on, billing on, enrollment on, emergency OFF', async () => {
    const c = await controls.getControls();
    expect(c).toEqual({
      'sms.verification_platform_enabled': true,
      'sms.package_billing_enabled': true,
      'sms.new_tenant_enrollment_enabled': true,
      'sms.emergency_send_disabled': false,
    });
    const pre = await ent.precheck(T, 'BOOKING_VERIFICATION');
    expect(pre.allowed).toBe(true);
    expect((pre as any).billable).toBe(true);
  });

  it('EMERGENCY STOP refuses every tenant-funded send immediately', async () => {
    await controls.setControl(CTX, 'sms.emergency_send_disabled', true, 'runaway spend incident');
    const pre = await ent.precheck(T, 'BOOKING_VERIFICATION');
    expect(pre.allowed).toBe(false);
    expect((pre as any).reason).toBe('hard_limit_reached');
  });

  it('turning the PRODUCT off refuses sends the same way', async () => {
    await controls.setControl(CTX, 'sms.verification_platform_enabled', false, 'product paused');
    const pre = await ent.precheck(T, 'BOOKING_VERIFICATION');
    expect(pre.allowed).toBe(false);
  });

  it('BILLING PAUSE does NOT stop sends — they continue, unbilled (billing problem ≠ outage)', async () => {
    await controls.setControl(CTX, 'sms.package_billing_enabled', false, 'billing maintenance');
    const pre = await ent.precheck(T, 'BOOKING_VERIFICATION');
    expect(pre.allowed).toBe(true);
    expect((pre as any).billable).toBe(false);
    const rec = await ent.recordSubmission(T, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_ctl_pause_1' });
    expect(rec.recorded).toBe(true);
  });

  it('ENROLLMENT PAUSE blocks a NEW subscription but never disturbs an existing one', async () => {
    await controls.setControl(CTX, 'sms.new_tenant_enrollment_enabled', false, 'onboarding freeze');
    await expect(plans.assignPackage(CTX, T_NEW, GROWTH, { reason: 'new salon' })).rejects.toThrow(/paused platform-wide/i);
    const existing = await plans.assignPackage(CTX, T, GROWTH, { reason: 'no-op re-assert' }).catch((e) => e);
    expect(String(existing?.message ?? '')).toMatch(/already has this package/i);   // reached the normal path, not the freeze
  });

  it('every change is audited with before/after + reason; unknown keys and blank reasons are refused', async () => {
    await controls.setControl(CTX, 'sms.emergency_send_disabled', true, 'incident 42');
    const a: any = await sql`select metadata_json from audit_logs
      where action_type = 'super_admin.sms_master_control_changed' order by created_at desc limit 1`.execute(db);
    expect(a.rows[0].metadata_json).toMatchObject({ key: 'sms.emergency_send_disabled', before: false, after: true, reason: 'incident 42' });
    await expect(controls.setControl(CTX, 'sms.not_a_control', true, 'x')).rejects.toThrow(/not an SMS platform control/i);
    await expect(controls.setControl(CTX, 'sms.emergency_send_disabled', true, '   ')).rejects.toThrow(/reason/i);
  });

  it('§41: default package validates the code, audits, and applyDefaultForNewTenant assigns with the §41 reason', async () => {
    await expect(controls.setDefaultPackageCode(CTX, 'sms_nonsense', 'x')).rejects.toThrow(/does not exist/i);
    await expect(controls.setDefaultPackageCode(CTX, 'sms_growth', '  ')).rejects.toThrow(/reason/i);
    await controls.setDefaultPackageCode(CTX, 'sms_growth', 'standard onboarding');
    expect(await controls.getDefaultPackageCode()).toBe('sms_growth');

    const T_FRESH = 'a5000000-0000-4000-8000-000000000003';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values (${T_FRESH}, 'ctl-c', 'ctl-c', 'ctl-c', 'CTLC', 'active')`.execute(db);
    const out = await plans.applyDefaultForNewTenant(T_FRESH);
    expect(out).toEqual({ applied: true, packageCode: 'sms_growth' });
    const sub: any = await sql`select p.code from tenant_sms_subscriptions s
      join sms_verification_packages p on p.id = s.package_id where s.tenant_id = ${T_FRESH}`.execute(db);
    expect(sub.rows[0].code).toBe('sms_growth');
    const a: any = await sql`select metadata_json from audit_logs
      where action_type = 'system.sms_default_package_applied' and entity_id = ${T_FRESH}`.execute(db);
    expect(a.rows[0].metadata_json.reason).toBe('Default package for new tenants (§41)');
    // B-14 remainder: the actor is the ONE system-context shape — no user, role SYSTEM, and the job named
    const who: any = await sql`select user_id, role, metadata_json from audit_logs where action_type = 'system.sms_default_package_applied' and entity_id = ${T_FRESH}`.execute(db);
    expect(who.rows[0]).toMatchObject({ user_id: null, role: 'SYSTEM' });
    expect(who.rows[0].metadata_json.systemActor).toBe('sms-default-package');

    // back to none → the hook is a clean no-op
    await controls.setDefaultPackageCode(CTX, null, 'clearing default');
    const T_FRESH2 = 'a5000000-0000-4000-8000-000000000004';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values (${T_FRESH2}, 'ctl-d', 'ctl-d', 'ctl-d', 'CTLD', 'active')`.execute(db);
    expect(await plans.applyDefaultForNewTenant(T_FRESH2)).toEqual({ applied: false });
  });

  it('§46: recentUsage returns tenant-scoped ledger rows with §21 masked recipients only', async () => {
    await ent.recordSubmission(T, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_ctl_use_1', recipientMasked: '***-***-1234' });
    const u = await plans.recentUsage(T, 10);
    expect(u.records.length).toBeGreaterThanOrEqual(1);
    const top = u.records[0];
    expect(top.purpose).toBe('BOOKING_VERIFICATION');
    expect(top.hasSid).toBe(true);
    expect(top.recipientMasked === null || /\*/.test(String(top.recipientMasked))).toBe(true);   // masked or absent, never raw
    const other = await plans.recentUsage('a5000000-0000-4000-8000-00000000000f', 10);
    expect(other.records.length).toBe(0);                                                        // tenant-scoped
  });
});
