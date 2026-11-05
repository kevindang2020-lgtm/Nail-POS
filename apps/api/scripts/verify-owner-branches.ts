/* verify-owner-branches.ts — proves the Module 2 Branch Performance endpoints aggregate REAL per-branch data over
 * Postgres (PGlite): grouped paid-ticket revenue + counts, bookings per branch, ranking, totals, top performer, the
 * quick-comparison cards, single-branch detail, tenant isolation, and the owner.branches.view permission gate.
 * All seeded "now" so the default (this month) window is deterministic; prior period empty → trends 100. */
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
  const PORT = 5478;
  const T = '00000000-0000-0000-0000-00000000a701', T2 = '00000000-0000-0000-0000-00000000a702';
  const B1 = '00000000-0000-0000-0000-00000000b701', B2 = '00000000-0000-0000-0000-00000000b702', B3 = '00000000-0000-0000-0000-00000000b703', B4 = '00000000-0000-0000-0000-00000000b704', BX = '00000000-0000-0000-0000-00000000b7ff';
  const U = '00000000-0000-0000-0000-00000000c701';
  const D1 = '00000000-0000-0000-0000-0000000d7001', D2 = '00000000-0000-0000-0000-0000000d7002', D3 = '00000000-0000-0000-0000-0000000d7003', D4 = '00000000-0000-0000-0000-0000000d7004', DX = '00000000-0000-0000-0000-0000000d70ff';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-b1','PB1'),('${T2}','O','O','p-b2','PB2')`);
  // pin tenant tz to UTC so tz-aware day/period windows match the UTC now()/CURRENT_DATE seeds (non-UTC behavior lives in verify-owner-tz.ts)
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES
    ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active'),('${B3}','${T}','Midtown','active'),('${B4}','${T}','Closed Lab','inactive'),('${BX}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','Anderson','Sarah Anderson','s@x.com','active','OWNER')`);
  const tech = (id: string, t: string, b: string) => db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${id}','${t}','${b}',gen_random_uuid(),'T','T','T','available','percent',40,true)`);
  await tech(D1, T, B1); await tech(D2, T, B2); await tech(D3, T, B3); await tech(D4, T, B4); await tech(DX, T2, BX);
  const paid = (t: string, b: string, total: number, tip: number) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${t}','${b}',gen_random_uuid(),'paid',${total},0,0,${total},${tip}, now())`);
  await paid(T, B1, 6000, 600); await paid(T, B1, 4000, 400); // B1 = 10000 (2 tickets, avg 5000)
  await paid(T, B2, 7000, 700);                                // B2 = 7000  (1 ticket, avg 7000)
  await paid(T, B3, 2000, 200);                                // B3 = 2000
  await paid(T, B4, 500, 50);                                  // B4 (inactive) = 500
  await paid(T2, BX, 9999, 999);                               // other tenant → excluded
  const appt = (t: string, b: string, d: string) => db.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) VALUES (gen_random_uuid(),'${t}','${b}','${d}','W', CURRENT_DATE,'10:00','10:30','booked')`);
  for (let i = 0; i < 3; i++) await appt(T, B1, D1); for (let i = 0; i < 2; i++) await appt(T, B2, D2); await appt(T, B3, D3); await appt(T2, BX, DX); // B1=3,B2=2,B3=1

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  try {
    const list = await svc.getBranchList(owner);
    ok('branch list = 4 (tenant only; other tenant excluded)', list.length === 4 && !list.some((b) => b.branchId === BX), String(list.length));

    const p = await svc.getBranchPerformance(owner); // default = month
    ok('total revenue = $195.00 (all tenant branches, other tenant excluded)', p.totalRevenueCents === 19500, String(p.totalRevenueCents));
    ok('total trend = 100% (prior period empty, not Infinity)', p.totalRevenueTrendPercent === 100);
    ok('total branches = 4, active = 3', p.totalBranches === 4 && p.activeBranches === 3, `${p.totalBranches}/${p.activeBranches}`);
    ok('ranked by revenue: B1 > B2 > B3 > B4', p.branches.map((b) => b.branchId).join() === [B1, B2, B3, B4].join(), p.branches.map((b) => b.branchName).join());
    ok('rank #1 = Downtown $100.00, avg $50.00, 3 bookings', p.branches[0].rank === 1 && p.branches[0].revenueCents === 10000 && p.branches[0].averageTicketCents === 5000 && p.branches[0].bookingCount === 3, JSON.stringify(p.branches[0]));
    ok('top performing branch = Downtown', p.topBranch?.branchId === B1, p.topBranch?.branchName);
    ok('quick: highest ATV = Uptown ($70.00)', p.quickComparison.highestAverageTicket?.branchId === B2 && p.quickComparison.highestAverageTicket?.valueCents === 7000, JSON.stringify(p.quickComparison.highestAverageTicket));
    ok('quick: top bookings = Downtown (3)', p.quickComparison.topBookings?.branchId === B1 && p.quickComparison.topBookings?.value === 3, JSON.stringify(p.quickComparison.topBookings));
    ok('quick: best growth = 100% (prior empty)', p.quickComparison.bestGrowth?.valuePercent === 100, String(p.quickComparison.bestGrowth?.valuePercent));
    ok('comparison endpoint returns the ranked payload', (await svc.getComparison(owner)).branches.length === 4);

    const d = await svc.getBranchDetail(owner, B1);
    ok('branch detail B1: revenue $100.00, 3 bookings, avg $50.00, tips $10.00', d.revenueCents === 10000 && d.bookingCount === 3 && d.averageTicketCents === 5000 && d.tipsCents === 1000, JSON.stringify({ r: d.revenueCents, b: d.bookingCount, a: d.averageTicketCents, t: d.tipsCents }));

    await throws('tenant isolation: branch detail for a foreign-tenant branch → not_found', () => svc.getBranchDetail(owner, BX), 'not_found');
    await throws('permission gate: no owner.branches.view → forbidden', () => svc.getBranchPerformance({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-branches: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
