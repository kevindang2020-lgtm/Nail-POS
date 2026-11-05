/* verify-owner-dashboard.ts — proves GET /owner/dashboard/state aggregates the REAL canonical tables over Postgres
 * (PGlite): paid-ticket revenue/tips/avg, appointment bookings, new customers, latest-status active technicians —
 * with tenant isolation, branch scoping, and the owner.dashboard.view permission gate. All seeded "now" so the
 * today/this-week windows are deterministic regardless of weekday (prior periods are empty → trend 100). */
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
  const PORT = 5477;
  const T = '00000000-0000-0000-0000-00000000a601', B1 = '00000000-0000-0000-0000-00000000b601', B2 = '00000000-0000-0000-0000-00000000b602';
  const T2 = '00000000-0000-0000-0000-00000000a602', B3 = '00000000-0000-0000-0000-00000000b603';
  const U = '00000000-0000-0000-0000-00000000c601';
  const T1 = '00000000-0000-0000-0000-0000000d6001', T2t = '00000000-0000-0000-0000-0000000d6002', T3 = '00000000-0000-0000-0000-0000000d6003';
  const TX = '00000000-0000-0000-0000-0000000d6004'; // technician in the OTHER tenant (FK target for its appointment)

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-o1','PO1'),('${T2}','O','O','p-o2','PO2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active'),('${B3}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','Anderson','Sarah Anderson','sarah@x.com','active','OWNER')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${T1}','${T}','${B1}',gen_random_uuid(),'A','A','A','available','percent',40,true),
    ('${T2t}','${T}','${B2}',gen_random_uuid(),'B','B','B','available','percent',40,true),
    ('${T3}','${T}','${B1}',gen_random_uuid(),'C','C','C','available','percent',40,true),
    ('${TX}','${T2}','${B3}',gen_random_uuid(),'X','X','X','available','percent',40,true)`);
  // latest status: T1 available (on-shift), T2 off (scheduled-only), T3 in_service (on-shift). All is_active=true.
  await db.exec(`INSERT INTO technician_statuses (id, tenant_id, branch_id, technician_id, status, changed_at) VALUES
    (gen_random_uuid(),'${T}','${B1}','${T1}','available', now()),
    (gen_random_uuid(),'${T}','${B2}','${T2t}','off', now()),
    (gen_random_uuid(),'${T}','${B1}','${T3}','in_service', now())`);
  const paidTicket = (tenant: string, branch: string, total: number, tip: number) =>
    db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES
      (gen_random_uuid(),'${tenant}','${branch}',gen_random_uuid(),'paid',${total},0,0,${total},${tip}, now())`);
  await paidTicket(T, B1, 5000, 1000); await paidTicket(T, B1, 3000, 500); await paidTicket(T, B2, 2000, 200); // tenant T paid: rev 10000, tips 1700, 3 tickets
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) VALUES (gen_random_uuid(),'${T}','${B1}',gen_random_uuid(),'serving',9999,0,0,9999,0)`); // unpaid → excluded
  await paidTicket(T2, B3, 7777, 777); // other tenant → must be excluded
  const appt = (tenant: string, branch: string, techId: string) =>
    db.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) VALUES
      (gen_random_uuid(),'${tenant}','${branch}','${techId}','Walk-in', CURRENT_DATE, '10:00','10:30','booked')`);
  for (let i = 0; i < 4; i++) await appt(T, B1, T1); await appt(T, B2, T2t); await appt(T2, B3, TX); // T week bookings = 5 (B1=4), other tenant excluded
  const cust = (tenant: string, branch: string) =>
    db.exec(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in) VALUES
      (gen_random_uuid(),'${tenant}','${branch}','N','N','N N','active',false,false,false)`);
  for (let i = 0; i < 3; i++) await cust(T, B1); await cust(T, B2); await cust(T2, B3); // T new clients = 4 (B1=3), other tenant excluded
  // owner_alerts (Module 6): 2 unread (status 'new') for T + 1 resolved (not unread) + 1 for another tenant (excluded)
  await db.exec(`INSERT INTO owner_alerts (id, tenant_id, branch_id, severity, status, title) VALUES
    (gen_random_uuid(),'${T}','${B1}','critical','new','Gateway error'),
    (gen_random_uuid(),'${T}',NULL,'warning','new','Low inventory'),
    (gen_random_uuid(),'${T}','${B1}','info','resolved','Backup done'),
    (gen_random_uuid(),'${T2}','${B3}','critical','new','Other tenant')`);
  // pin tenant tz to UTC so tz-aware day/period windows match the UTC now()/CURRENT_DATE seeds (non-UTC behavior lives in verify-owner-tz.ts)
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner = (branchId?: string): OwnerContext => ({ tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[], selectedBranchId: branchId });

  try {
    const all = await svc.getDashboard(owner());
    ok('owner profile resolved (Sarah Anderson)', all.owner.fullName === 'Sarah Anderson' && all.owner.firstName === 'Sarah', all.owner.fullName);
    ok('today revenue = $100.00 (paid only, tenant-scoped)', all.todayRevenueCents === 10000, String(all.todayRevenueCents));
    ok('tenant isolation: other tenant $77.77 ticket excluded', all.todayRevenueCents === 10000);
    ok('unpaid ticket excluded from revenue', all.todayRevenueCents === 10000);
    ok('tips today = $17.00', all.tipsTodayCents === 1700, String(all.tipsTodayCents));
    ok('weekly revenue includes today = $100.00', all.weeklyRevenueCents === 10000, String(all.weeklyRevenueCents));
    ok('average ticket = round(10000/3) = $33.33', all.averageTicketCents === 3333, String(all.averageTicketCents));
    ok('total bookings (this week) = 5', all.totalBookings === 5, String(all.totalBookings));
    ok('new clients (this week) = 4', all.newClients === 4, String(all.newClients));
    ok('active technicians = 2 (latest on-shift status)', all.activeTechnicians === 2, String(all.activeTechnicians));
    ok('scheduled technicians = 3 (is_active roster)', all.scheduledTechnicians === 3, String(all.scheduledTechnicians));
    ok('trend = 100% (prior period empty, not Infinity)', all.todayRevenueTrendPercent === 100 && all.weeklyRevenueTrendPercent === 100);
    ok('revenue trend has 7 day buckets summing to weekly', all.revenueTrend.length === 7 && all.revenueTrend.reduce((s, d) => s + d.revenueCents, 0) === 10000, String(all.revenueTrend.length));
    ok('unread notifications = 2 (owner_alerts status new; resolved + other tenant excluded)', all.unreadNotificationCount === 2, String(all.unreadNotificationCount));

    const b1 = await svc.getDashboard(owner(B1));
    ok('branch scope B1: revenue $80.00', b1.todayRevenueCents === 8000, String(b1.todayRevenueCents));
    ok('branch scope B1: avg $40.00 (2 tickets), tips $15.00', b1.averageTicketCents === 4000 && b1.tipsTodayCents === 1500, `${b1.averageTicketCents}/${b1.tipsTodayCents}`);
    ok('branch scope B1: bookings 4, new clients 3', b1.totalBookings === 4 && b1.newClients === 3, `${b1.totalBookings}/${b1.newClients}`);
    ok('branch scope B1: active 2, scheduled 2', b1.activeTechnicians === 2 && b1.scheduledTechnicians === 2, `${b1.activeTechnicians}/${b1.scheduledTechnicians}`);

    await throws('tenant isolation: owner cannot scope to a foreign-tenant branch (not_found)', () => svc.getDashboard(owner(B3)), 'not_found');
    await throws('permission gate: no owner.dashboard.view → forbidden', () => svc.getDashboard({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-dashboard: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
