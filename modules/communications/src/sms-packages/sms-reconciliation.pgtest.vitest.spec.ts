// sms-reconciliation.pgtest.vitest.spec.ts — §58/§59 on the REAL schema through the REAL service + scheduler.
// The pins that matter: a corrupted counter is FILED with both numbers and NEVER auto-fixed · a clean cycle files
// nothing · §59 dedupe is structural (second run updates the same open row, count stays 1) · resolving reopens
// the lane (still-broken next run files a FRESH finding — that is correct, not a dedupe failure) · package-less
// traffic and hard-limit-stopped tenants are flagged for Super Admin · the scheduler's tick fires exactly once
// per day at/after 03:30 through the SAME code path production runs.
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
import { SmsReconciliationService, SmsReconciliationScheduler } from './sms-reconciliation.service';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

let db: Kysely<any>;
let ent: SmsEntitlementService;
let recon: SmsReconciliationService;
const T_OK = 'a3000000-0000-4000-8000-000000000001';     // healthy cycle
const T_ORPH = 'a3000000-0000-4000-8000-000000000002';   // traffic, no package
const T_HARD = 'a3000000-0000-4000-8000-000000000003';   // hard limit reached

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
  recon = new SmsReconciliationService(db);
  for (const [t, slug] of [[T_OK, 'rec-ok'], [T_ORPH, 'rec-orph'], [T_HARD, 'rec-hard']] as const) {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
              values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase().replace('-', '')}, 'active')`.execute(db);
  }
  const pk: any = await sql`select id, code from sms_verification_packages`.execute(db);
  const growth = pk.rows.find((p: any) => p.code === 'sms_growth').id;
  const starter = pk.rows.find((p: any) => p.code === 'sms_starter').id;
  await sql`update sms_verification_packages set included_verification_count = 10, overage_enabled = true, overage_unit_price_cents = 3 where id = ${growth}`.execute(db);
  await sql`update sms_verification_packages set included_verification_count = 1, overage_enabled = false, hard_limit_enabled = true where id = ${starter}`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T_OK}, ${growth})`.execute(db);
  await sql`insert into tenant_sms_subscriptions (tenant_id, package_id) values (${T_HARD}, ${starter})`.execute(db);
  // real traffic through the entitled path
  await ent.recordSubmission(T_OK, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_rec_ok_1' });
  await ent.recordSubmission(T_OK, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_rec_ok_2' });
  await ent.recordSubmission(T_ORPH, 'BOOKING_VERIFICATION', { providerMessageId: 'SM_rec_orph_1' });   // unbilled
  await ent.recordSubmission(T_HARD, 'LOGIN_OTP', { providerMessageId: 'SM_rec_hard_1' });             // hits limit
}, 240_000);

describe('SMS reconciliation — §58/§59 on the real schema', () => {
  it('first run: healthy cycle files NOTHING; orphan traffic and hard-limit tenants are flagged', async () => {
    const out = await recon.runDaily(new Date('2026-07-29T04:00:00Z'));
    expect(out.providerComparison).toBe('unavailable');    // honest: no Twilio creds in-sandbox
    const { findings } = await recon.listOpenFindings();
    const types = findings.map((f) => `${f.tenantId}:${f.findingType}`);
    expect(types).not.toContain(`${T_OK}:counter_ledger_mismatch`);
    expect(types).toContain(`${T_ORPH}:unbilled_usage_no_package`);
    expect(types).toContain(`${T_HARD}:hard_limit_reached`);
    const orph = findings.find((f) => f.tenantId === T_ORPH)!;
    expect((orph.details as any).unbilledThisMonth).toBe(1);
  });

  it('a corrupted counter is FILED with both numbers — and the run NEVER touches the counter itself', async () => {
    await sql`update tenant_sms_billing_cycles set used_included = used_included + 5 where tenant_id = ${T_OK}`.execute(db);
    await recon.runDaily(new Date('2026-07-29T04:10:00Z'));
    const { findings } = await recon.listOpenFindings();
    const mm = findings.find((f) => f.tenantId === T_OK && f.findingType === 'counter_ledger_mismatch')!;
    expect(mm).toBeTruthy();
    expect((mm.details as any).ledgerBillable).toBe(2);
    expect((mm.details as any).counterTotal).toBe(7);
    const c: any = await sql`select used_included from tenant_sms_billing_cycles where tenant_id = ${T_OK}`.execute(db);
    expect(Number(c.rows[0].used_included)).toBe(7);       // §58: still corrupted — a HUMAN fixes it, not the job
  });

  it('§59 dedupe is structural: a second run UPDATES the open finding, never duplicates it', async () => {
    await recon.runDaily(new Date('2026-07-30T04:00:00Z'));
    const n: any = await sql`select count(*)::int as n, max(run_date) as latest from sms_reconciliation_findings
      where tenant_id = ${T_OK} and finding_type = 'counter_ledger_mismatch' and status = 'open'`.execute(db);
    expect(n.rows[0].n).toBe(1);
    expect(new Date(n.rows[0].latest).toISOString().slice(0, 10)).toBe('2026-07-30');   // details/run_date refreshed on the SAME row
  });

  it('resolving closes the row; a still-broken next run files a FRESH open finding', async () => {
    const { findings } = await recon.listOpenFindings();
    const mm = findings.find((f) => f.tenantId === T_OK && f.findingType === 'counter_ledger_mismatch')!;
    const r = await recon.resolveFinding('b3000000-0000-4000-8000-000000000001', mm.id, 'resolved');
    expect(r.ok).toBe(true);
    await recon.runDaily(new Date('2026-07-31T04:00:00Z'));
    const rows: any = await sql`select status, count(*)::int as n from sms_reconciliation_findings
      where tenant_id = ${T_OK} and finding_type = 'counter_ledger_mismatch' group by status order by status`.execute(db);
    const byStatus = Object.fromEntries(rows.rows.map((x: any) => [x.status, x.n]));
    expect(byStatus.resolved).toBe(1);
    expect(byStatus.open).toBe(1);                          // still broken → correctly re-filed
  });

  it('scheduler tick: skips before 03:30, runs once at/after it, skips the rest of the day', async () => {
    const sched = new SmsReconciliationScheduler(recon);
    expect(await sched.tick(new Date('2026-08-01T02:00:00'))).toBe('skipped');
    expect(await sched.tick(new Date('2026-08-01T03:45:00'))).toBe('ran');
    expect(await sched.tick(new Date('2026-08-01T09:00:00'))).toBe('skipped');
    expect(await sched.tick(new Date('2026-08-02T03:45:00'))).toBe('ran');
  });
});
