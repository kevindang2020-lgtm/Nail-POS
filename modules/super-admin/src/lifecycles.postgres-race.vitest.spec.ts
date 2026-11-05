// lifecycles.postgres-race.vitest.spec — BUILD_PLAN Phase 12 (#27): the Super Admin writers that move money / people,
// on REAL Postgres with real concurrent connections (PGlite is one session and cannot show a lost update). Runs when
// PG_RACE_URL points at a migrated database (the CI race lane).
//
// Each case is a lost update the code had before its writer went through its machine:
//   • two approvals of one revenue adjustment both posted a ledger entry;
//   • an approve and a reject of one worker transfer both landed (and the approve moved the worker either way);
//   • two overlapping imports of one CSV created two customers per row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyRevenueResidualsRepo } from './super-admin-revenue-residuals/super-admin-revenue-residuals.kysely.repository';
import { SuperAdminStaffKyselyRepository } from './super-admin-staff/super-admin-staff.kysely.repository';
import { KyselyImportRepo } from './super-admin-customer-data/customer-import.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'd2b00000-0000-4000-8000-000000000001', B1 = 'd2b00000-0000-4000-8000-0000000000b1', B2 = 'd2b00000-0000-4000-8000-0000000000b2';
const U = 'd2b00000-0000-4000-8000-0000000000c1';

describe.skipIf(!url)('Super Admin lifecycles under real concurrency (Postgres)', () => {
  let pool: pg.Pool; let db: Kysely<any>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES (${T}, 'Race SA LLC', 'Race SA', 'd2brace', 'D2BR') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B1}, ${T}, 'Main'), (${B2}, ${T}, 'East') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO users (id, tenant_id, branch_id, role, email) VALUES (${U}, ${T}, ${B1}, 'TECHNICIAN', 'race-tech@example.test') ON CONFLICT (id) DO NOTHING`.execute(db);
  });
  afterAll(async () => {
    await sql`DELETE FROM revenue_records WHERE source_reference LIKE 'RACE-ADJ-%'`.execute(db).catch(() => undefined);
    await sql`DELETE FROM revenue_audit_log WHERE reason LIKE 'ledger entry %' OR action LIKE 'revenue_adjustment_%'`.execute(db).catch(() => undefined);
    await sql`DELETE FROM revenue_adjustments WHERE adjustment_ref LIKE 'RACE-ADJ-%'`.execute(db).catch(() => undefined);
    for (const t of ['customer_import_rows', 'customer_import_jobs', 'customers', 'worker_transfer_requests', 'audit_logs', 'outbox_events']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM users WHERE id = ${U}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM branches WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it('revenue adjustment: 12 concurrent approvals → exactly one applied, exactly ONE ledger entry (it used to be one per approval)', async () => {
    const ref = `RACE-ADJ-${Date.now()}`;
    const ins: any = await sql`INSERT INTO revenue_adjustments (adjustment_ref, tenant_id, adjustment_type, amount_cents, direction, reason, requires_dual_approval, status)
                               VALUES (${ref}, ${T}, 'credit', 2500, 'increase', 'race', false, 'pending_approval') RETURNING id`.execute(db);
    const id = String(ins.rows[0].id);
    const repo = new KyselyRevenueResidualsRepo(db as any);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => repo.approveAdjustment({ id: `d2b00000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, role: 'SUPER_ADMIN' }, id)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect((r as any).error).toBe('invalid_state');
    const ledger: any = await sql`SELECT count(*)::int AS n FROM revenue_records WHERE source_reference = ${ref}`.execute(db);
    expect(ledger.rows[0].n).toBe(1);
    const row: any = await sql`SELECT status FROM revenue_adjustments WHERE id = ${id}`.execute(db);
    expect(row.rows[0].status).toBe('applied');
  });

  it('worker transfer: an approve and a reject race → exactly one decision lands, and the worker moves only if the approve won', async () => {
    for (let round = 0; round < 6; round++) {
      await sql`UPDATE users SET branch_id = ${B1} WHERE id = ${U}`.execute(db);
      const ins: any = await sql`INSERT INTO worker_transfer_requests (tenant_id, user_id, to_branch_id, reason) VALUES (${T}, ${U}, ${B2}, 'race') RETURNING id`.execute(db);
      const id = String(ins.rows[0].id);
      const repo = new SuperAdminStaffKyselyRepository(db as any);
      const out = await Promise.allSettled([repo.decideWorkerTransfer(id, 'approve', null), repo.decideWorkerTransfer(id, 'reject', 'no'), repo.decideWorkerTransfer(id, 'approve', null)]);
      expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const req: any = await sql`SELECT status FROM worker_transfer_requests WHERE id = ${id}`.execute(db);
      const user: any = await sql`SELECT branch_id FROM users WHERE id = ${U}`.execute(db);
      expect(String(user.rows[0].branch_id)).toBe(req.rows[0].status === 'approved' ? B2 : B1);
    }
  });

  it('a decided worker transfer is never re-applied: reject, then approve → 409 and the worker stays', async () => {
    await sql`UPDATE users SET branch_id = ${B1} WHERE id = ${U}`.execute(db);
    const ins: any = await sql`INSERT INTO worker_transfer_requests (tenant_id, user_id, to_branch_id, reason) VALUES (${T}, ${U}, ${B2}, 'late') RETURNING id`.execute(db);
    const id = String(ins.rows[0].id);
    const repo = new SuperAdminStaffKyselyRepository(db as any);
    await repo.decideWorkerTransfer(id, 'reject', 'no');
    await expect(repo.decideWorkerTransfer(id, 'approve', null)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    const user: any = await sql`SELECT branch_id FROM users WHERE id = ${U}`.execute(db);
    expect(String(user.rows[0].branch_id)).toBe(B1);
  });

  it('customer import: two overlapping runs over the same rows → one customer per row (it used to be two)', async () => {
    const job: any = await sql`INSERT INTO customer_import_jobs (tenant_id, branch_id, status, total_rows, valid_rows) VALUES (${T}, ${B1}, 'processing', 5, 5) RETURNING id`.execute(db);
    const jobId = String(job.rows[0].id);
    for (let i = 1; i <= 5; i++) {
      await sql`INSERT INTO customer_import_rows (job_id, tenant_id, row_number, dedup_key, raw_json, status)
                VALUES (${jobId}, ${T}, ${i}, ${'race-' + i}, ${JSON.stringify({ firstName: 'Race', lastName: `Guest${i}`, phone: `60955500${10 + i}` })}::jsonb, 'valid')`.execute(db);
    }
    const repo = new KyselyImportRepo(db as any);
    const rows = [1, 2, 3, 4, 5];
    await Promise.all([repo.importRows(jobId, rows), repo.importRows(jobId, rows), repo.importRows(jobId, rows)]);
    const c: any = await sql`SELECT count(*)::int AS n FROM customers WHERE tenant_id = ${T} AND last_name LIKE 'Guest%'`.execute(db);
    expect(c.rows[0].n).toBe(5);
    const st: any = await sql`SELECT count(*) FILTER (WHERE status = 'imported')::int AS n FROM customer_import_rows WHERE job_id = ${jobId}`.execute(db);
    expect(st.rows[0].n).toBe(5);
  });
});
