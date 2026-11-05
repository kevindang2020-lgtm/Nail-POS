/* verify-owner-scope.ts — proves cross-cutting branch authorization over real Postgres (PGlite): OWNER sees every branch in
 * the tenant; a MANAGER (users.branch_id = B1) is forced to their assigned branch across dashboard / branches / bookings /
 * finance / staff / alerts, and is FORBIDDEN from explicitly requesting another branch. Tenant isolation still holds. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyOwnerRepository } from '../../../modules/analytics/src/owner/owner.kysely.repository';
import { OwnerService } from '../../../modules/analytics/src/owner/owner.service';
import type { OwnerContext } from '../../../modules/analytics/src/owner/owner.repository';
import { permissionsFor } from '../../../packages/permissions/src/rbac';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5483;
  const T = '00000000-0000-0000-0000-00000000ac01';
  const B1 = '00000000-0000-0000-0000-00000000bc01', B2 = '00000000-0000-0000-0000-00000000bc02';
  const UO = '00000000-0000-0000-0000-00000000c0a1', UM = '00000000-0000-0000-0000-00000000c0b1';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-sc','PSC')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active')`);
  // OWNER has no assigned branch (sees all); MANAGER is assigned to B1.
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES
    ('${UO}','${T}',NULL,'Olivia','Owner','Olivia Owner','o@x.com','active','OWNER'),
    ('${UM}','${T}','${B1}','Mara','Manager','Mara Manager','m@x.com','active','MANAGER')`);
  const ticket = (t: string, b: string, total: number) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${t}','${b}',gen_random_uuid(),'paid',${total},0,0,${total},0, now())`);
  await ticket(T, B1, 10000); await ticket(T, B2, 5000); // B1 $100, B2 $50
  await db.exec(`INSERT INTO owner_alerts (id, tenant_id, branch_id, severity, status, title) VALUES
    (gen_random_uuid(),'${T}','${B1}','warning','new','B1 alert'),
    (gen_random_uuid(),'${T}','${B2}','warning','new','B2 alert')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner = (): OwnerContext => ({ tenantId: T, userId: UO, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });
  const manager = (selectedBranchId?: string): OwnerContext => ({ tenantId: T, userId: UM, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[], selectedBranchId });

  try {
    ok('OWNER branch list = 2 (all tenant branches)', (await svc.getBranchList(owner())).length === 2);
    ok('MANAGER branch list = 1 (only assigned B1)', (await svc.getBranchList(manager())).map((b) => b.branchId).join() === B1, (await svc.getBranchList(manager())).map((b) => b.branchId).join());

    const opx = await svc.getBranchPerformance(owner());
    ok('OWNER branch performance: 2 branches, total revenue $150', opx.totalBranches === 2 && opx.totalRevenueCents === 15000, JSON.stringify({ n: opx.totalBranches, r: opx.totalRevenueCents }));
    const mpx = await svc.getBranchPerformance(manager());
    ok('MANAGER branch performance: 1 branch (B1 only), total revenue $100', mpx.branches.length === 1 && mpx.branches[0].branchId === B1 && mpx.totalRevenueCents === 10000, JSON.stringify({ n: mpx.branches.length, r: mpx.totalRevenueCents }));

    ok('OWNER dashboard weekly revenue = $150 (all branches)', (await svc.getDashboard(owner())).weeklyRevenueCents === 15000);
    ok('MANAGER dashboard weekly revenue = $100 (forced to B1)', (await svc.getDashboard(manager())).weeklyRevenueCents === 10000, String((await svc.getDashboard(manager())).weeklyRevenueCents));
    ok('OWNER can select B2 → dashboard weekly revenue $50', (await svc.getDashboard({ ...owner(), selectedBranchId: B2 })).weeklyRevenueCents === 5000);
    await throws('MANAGER selecting B2 on dashboard → forbidden', () => svc.getDashboard(manager(B2)), 'forbidden');

    ok('MANAGER branch detail B1 → allowed', (await svc.getBranchDetail(manager(), B1)).branchId === B1);
    await throws('MANAGER branch detail B2 → forbidden', () => svc.getBranchDetail(manager(), B2), 'forbidden');

    ok('MANAGER bookings (no branch) → scoped to B1 (ok)', (await svc.getBookingOverview(manager(), 'week')).totalBookings >= 0);
    await throws('MANAGER bookings ?branchId=B2 → forbidden', () => svc.getBookingOverview(manager(), 'week', B2), 'forbidden');

    ok('MANAGER finance (no branch) → scoped to B1 revenue $100', (await svc.getFinanceSummary(manager())).totalRevenueCents === 10000, String((await svc.getFinanceSummary(manager())).totalRevenueCents));
    await throws('MANAGER finance ?branchId=B2 → forbidden', () => svc.getFinanceSummary(manager(), 'month', B2), 'forbidden');
    await throws('MANAGER staff ?branchId=B2 → forbidden', () => svc.getStaffPerformance(manager(), 'month', B2), 'forbidden');

    ok('OWNER alert summary = 2 (both branches)', (await svc.getAlertSummary(owner())).total === 2);
    const ma = await svc.getAlertSummary(manager());
    ok('MANAGER alert summary scoped to B1: total 1, unread 1', ma.total === 1 && ma.unread === 1, JSON.stringify({ t: ma.total, u: ma.unread }));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-scope: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
