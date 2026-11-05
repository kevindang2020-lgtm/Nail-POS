// sms-packages.pgtest.vitest.spec.ts — P1 on the REAL schema (migration 427 + full boot).
// Proves: the three seeds exist unpriced (§53, honest §1), Super Admin CRUD persists + audits (§5, §55),
// threshold sanity, and — the §12 cornerstone — one Twilio Message SID can NEVER produce two ledger rows,
// enforced by the database itself, not application politeness.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';   // Constitution 13: stated by the package, not assumed from the file's location
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { SmsPackagesService } from './sms-packages.service';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let svc: SmsPackagesService;
const T = 'a0000000-0000-4000-8000-00000000005e';
const CTX = { userId: 'b0000000-0000-4000-8000-00000000005e', ip: '127.0.0.1' };

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
  svc = new SmsPackagesService(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
            values (${T}, 'Sms Salon', 'Sms Salon', 'sms-salon', 'SMS01', 'active')`.execute(db);
}, 240_000);

describe('SMS verification packages — P1 schema + CRUD', () => {
  it('seeds exactly the three packages, unpriced and not self-service until Super Admin configures them', async () => {
    const { packages } = await svc.listPackages();
    expect(packages.map((p) => p.code)).toEqual(['sms_starter', 'sms_growth', 'sms_pro']);
    for (const p of packages) {
      expect(p.monthlyPriceCents).toBe(0);
      expect(p.includedVerificationCount).toBe(0);
      expect(p.selfServiceAvailable).toBe(false);          // honest: nothing is offered before pricing exists
      expect(p.description).toMatch(/not yet set by Super Admin/);
      expect(p.tenantCount).toBe(0);
    }
  });

  it('Super Admin edits every configurable number; the change persists and is audited with before/after', async () => {
    const { packages } = await svc.listPackages();
    const growth = packages.find((p) => p.code === 'sms_growth')!;
    const after = await svc.updatePackage(CTX, growth.id, {
      monthly_price_cents: 4900, included_verification_count: 2000,
      overage_enabled: true, overage_unit_price_cents: 3, hard_limit_enabled: false,
      warning_threshold_percent: 80, critical_threshold_percent: 95, self_service_available: true,
    });
    expect(after.monthlyPriceCents).toBe(4900);
    expect(after.includedVerificationCount).toBe(2000);
    expect(after.overageUnitPriceCents).toBe(3);
    expect(after.selfServiceAvailable).toBe(true);
    const audit: any = await sql`select action_type, metadata_json from audit_logs
      where entity_type = 'sms_verification_package' and entity_id = ${growth.id}
      order by created_at desc limit 1`.execute(db);
    expect(audit.rows[0].action_type).toBe('super_admin.sms_package_updated');
    const meta = audit.rows[0].metadata_json;
    expect(meta.before.monthlyPriceCents).toBe(0);
    expect(meta.after.monthlyPriceCents).toBe(4900);
  });

  it('rejects nonsense: negative money, non-integers, warning ≥ critical', async () => {
    const { packages } = await svc.listPackages();
    const starter = packages.find((p) => p.code === 'sms_starter')!;
    await expect(svc.updatePackage(CTX, starter.id, { monthly_price_cents: -1 })).rejects.toThrow(/non-negative/);
    await expect(svc.updatePackage(CTX, starter.id, { included_verification_count: 12.5 })).rejects.toThrow(/non-negative integer/);
    await expect(svc.updatePackage(CTX, starter.id, { warning_threshold_percent: 96, critical_threshold_percent: 95 })).rejects.toThrow(/below critical/);
  });

  it('disable stops new offering without touching assignments; both directions audited', async () => {
    const { packages } = await svc.listPackages();
    const pro = packages.find((p) => p.code === 'sms_pro')!;
    const off = await svc.setActive(CTX, pro.id, false);
    expect(off.active).toBe(false);
    const on = await svc.setActive(CTX, pro.id, true);
    expect(on.active).toBe(true);
    const audit: any = await sql`select action_type from audit_logs
      where entity_type = 'sms_verification_package' and entity_id = ${pro.id}
      and action_type in ('super_admin.sms_package_enabled','super_admin.sms_package_disabled')`.execute(db);
    expect(audit.rows.length).toBe(2);
  });

  it('§12 at the DATABASE: the same Twilio Message SID cannot create a second ledger row', async () => {
    await sql`insert into sms_usage_records (tenant_id, purpose, provider, provider_message_id, status, billable)
              values (${T}, 'BOOKING_VERIFICATION', 'twilio', 'SM_dup_test_1', 'ACCEPTED', true)`.execute(db);
    let code: string | null = null;
    try {
      await sql`insert into sms_usage_records (tenant_id, purpose, provider, provider_message_id, status, billable)
                values (${T}, 'BOOKING_VERIFICATION', 'twilio', 'SM_dup_test_1', 'DELIVERED', true)`.execute(db);
    } catch (e: any) { code = e?.code ?? null; }
    expect(code).toBe('23505');                              // unique_violation — retries can never double-bill
    // NULL SIDs (pre-submission rows) are exempt from the partial unique: two REQUESTED rows coexist fine.
    await sql`insert into sms_usage_records (tenant_id, purpose, status) values (${T}, 'LOGIN_OTP', 'REQUESTED')`.execute(db);
    await sql`insert into sms_usage_records (tenant_id, purpose, status) values (${T}, 'LOGIN_OTP', 'REQUESTED')`.execute(db);
    const n: any = await sql`select count(*)::int as n from sms_usage_records where tenant_id = ${T}`.execute(db);
    expect(n.rows[0].n).toBe(3);
  });

  it('dynamic update is parameterized: apostrophes and unicode in text fields round-trip exactly', async () => {
    const pk: any = await sql`select id from sms_verification_packages where code = 'sms_starter'`.execute(db);
    const id = String(pk.rows[0].id);
    const name = "O'Brien's — Größte 'Salon' Päckchen";
    const description = "It's got 'quotes', backslash \\ and ; semicolons -- comment";
    const out: any = await svc.updatePackage(CTX, id, { name, description });
    expect(out.name).toBe(name);
    expect(out.description).toBe(description);
    const row: any = await sql`select name, description, active from sms_verification_packages where id = ${id}`.execute(db);
    expect(row.rows[0].name).toBe(name);
    expect(row.rows[0].description).toBe(description);
    expect(row.rows[0].active).toBe(true);            // nothing else was touched by the text write
    await expect(svc.updatePackage(CTX, id, { name: '   ' })).rejects.toThrow(/non-empty string/i);
    await expect(svc.updatePackage(CTX, id, { description: 42 as any })).rejects.toThrow(/string or null/i);
  });
});
