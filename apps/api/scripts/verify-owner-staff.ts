/* verify-owner-staff.ts — proves Module 4 Staff Performance over real Postgres (PGlite): per-technician services + sales
 * + commission (from ticket_service_lines snapshots on PAID tickets), ratings (reviews joined via service lines), tips,
 * utilization (busy service minutes ÷ scheduled shift minutes), attendance (latest technician_statuses + today's shifts),
 * per-technician detail + earnings, tenant isolation, and permission gates (performance vs earnings; MANAGER lacks earnings). */
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
  const PORT = 5480;
  const T = '00000000-0000-0000-0000-00000000a901', T2 = '00000000-0000-0000-0000-00000000a902';
  const B1 = '00000000-0000-0000-0000-00000000b901', BX = '00000000-0000-0000-0000-00000000b9ff';
  const U = '00000000-0000-0000-0000-00000000c901';
  const TE = '00000000-0000-0000-0000-0000000d9001', TS = '00000000-0000-0000-0000-0000000d9002', TI = '00000000-0000-0000-0000-0000000d9003', TX = '00000000-0000-0000-0000-0000000d90ff';
  const K1 = '00000000-0000-0000-0000-0000000091c1', K2 = '00000000-0000-0000-0000-0000000091c2', K3 = '00000000-0000-0000-0000-0000000091c3', KX = '00000000-0000-0000-0000-0000000091cf';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-s1','PS1'),('${T2}','O','O','p-s2','PS2')`);
  // pin tenant tz to UTC so tz-aware day/period windows match the UTC now()/CURRENT_DATE seeds (non-UTC behavior lives in verify-owner-tz.ts)
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${BX}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','Anderson','Sarah Anderson','s@x.com','active','OWNER')`);
  const tech = (id: string, t: string, b: string, name: string) => db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${id}','${t}','${b}',gen_random_uuid(),'${name}','X','${name}','available','percent',40,true)`);
  await tech(TE, T, B1, 'Emma'); await tech(TS, T, B1, 'Sophia'); await tech(TI, T, B1, 'Idle'); await tech(TX, T2, BX, 'Other');
  const ticket = (id: string, t: string, b: string, status: string, total: number) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES ('${id}','${t}','${b}',gen_random_uuid(),'${status}',${total},0,0,${total},0, ${status === 'paid' ? 'now()' : 'NULL'})`);
  await ticket(K1, T, B1, 'paid', 6450); await ticket(K2, T, B1, 'paid', 7260); await ticket(K3, T, B1, 'serving', 9999); await ticket(KX, T2, BX, 'paid', 9999);
  const line = (ticketId: string, t: string, b: string, tech: string, total: number, dur: number) => db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent, completed_at) VALUES (gen_random_uuid(),'${t}','${b}','${ticketId}',gen_random_uuid(),'${tech}','Mani',${total},${dur},'percent',40,${total},'completed',100, now())`);
  await line(K1, T, B1, TE, 4000, 30); await line(K1, T, B1, TE, 2450, 30); // Emma: sales 6450, commission 2580, busy 60
  await line(K2, T, B1, TS, 7260, 60); // Sophia: sales 7260, commission 2904, busy 60
  await line(K3, T, B1, TE, 5000, 30); // on UNPAID ticket → excluded from sales
  await line(KX, T2, BX, TX, 9999, 30); // other tenant → excluded
  await db.exec(`INSERT INTO ticket_tip_allocations (id, tenant_id, branch_id, ticket_id, technician_id, tip_cents) VALUES (gen_random_uuid(),'${T}','${B1}','${K1}','${TE}',1000),(gen_random_uuid(),'${T}','${B1}','${K2}','${TS}',500)`);
  await db.exec(`INSERT INTO reviews (id, tenant_id, branch_id, customer_id, ticket_id, rating) VALUES (gen_random_uuid(),'${T}','${B1}',NULL,'${K1}',5),(gen_random_uuid(),'${T}','${B1}',NULL,'${K2}',4)`);
  // Emma shift today 09:00–17:00 (480 min); Sophia has none.
  await db.exec(`INSERT INTO technician_shifts (id, tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) VALUES (gen_random_uuid(),'${T}','${B1}','${TE}', CURRENT_DATE, (CURRENT_DATE + TIME '00:00'), (CURRENT_DATE + TIME '08:00'),'scheduled')`);
  await db.exec(`INSERT INTO technician_statuses (id, tenant_id, branch_id, technician_id, status, changed_at) VALUES
    (gen_random_uuid(),'${T}','${B1}','${TE}','available', now()),
    (gen_random_uuid(),'${T}','${B1}','${TS}','on_break', now()),
    (gen_random_uuid(),'${T}','${B1}','${TI}','off', now())`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  try {
    const sp = await svc.getStaffPerformance(owner); // default month
    ok('top technicians = 3 (roster), sorted by sales desc', sp.topTechnicians.length === 3 && sp.topTechnicians[0].technicianId === TS && sp.topTechnicians[1].technicianId === TE, sp.topTechnicians.map((t) => t.fullName).join());
    ok('Sophia #1: sales $72.60, 1 service, rating 4.0', sp.topTechnicians[0].salesCents === 7260 && sp.topTechnicians[0].servicesCompleted === 1 && sp.topTechnicians[0].rating === 4, JSON.stringify(sp.topTechnicians[0]));
    ok('Emma #2: sales $64.50, 2 services, rating 5.0', sp.topTechnicians[1].salesCents === 6450 && sp.topTechnicians[1].servicesCompleted === 2 && sp.topTechnicians[1].rating === 5, JSON.stringify(sp.topTechnicians[1]));
    ok('total commission = $54.84 (2580 + 2904; unpaid + other tenant excluded)', sp.totalCommissionCents === 5484, String(sp.totalCommissionCents));
    ok('total staff = 3, on duty = 2 (available + on_break; off excluded)', sp.totalStaff === 3 && sp.onDutyCount === 2, `${sp.totalStaff}/${sp.onDutyCount}`);
    ok('utilization = 25% (120 busy ÷ 480 scheduled min)', sp.utilizationPercent === 25, String(sp.utilizationPercent));
    ok('utilization trend = 100% (prior period empty)', sp.utilizationTrendPercent === 100);

    const att = await svc.getStaffAttendance(owner);
    ok('attendance: scheduled 1, clockedIn 1, onBreak 1, offShift ≥1', att.scheduled === 1 && att.clockedIn === 1 && att.onBreak === 1 && att.offShift >= 1, JSON.stringify(att));

    const d = await svc.getTechnicianDetail(owner, TE);
    ok('Emma detail: 2 services, $64.50 sales, $25.80 commission, $10 tips, avg $32.25', d.servicesCompleted === 2 && d.salesCents === 6450 && d.commissionCents === 2580 && d.tipsCents === 1000 && d.averageTicketCents === 3225, JSON.stringify({ s: d.servicesCompleted, sa: d.salesCents, c: d.commissionCents, t: d.tipsCents, a: d.averageTicketCents }));
    ok('Emma detail: rating 5.0 (1 review), utilization round(60/480)=13%, payroll $35.80', d.rating === 5 && d.reviewCount === 1 && d.utilizationPercent === 13 && d.payrollEstimateCents === 3580, JSON.stringify({ r: d.rating, u: d.utilizationPercent, p: d.payrollEstimateCents }));

    const e = await svc.getTechnicianEarnings(owner, TE);
    ok('Emma earnings: sales 6450, commission 2580, tips 1000, total 3580', e.salesCents === 6450 && e.commissionCents === 2580 && e.tipsCents === 1000 && e.totalEstimateCents === 3580, JSON.stringify(e));

    await throws('tenant isolation: foreign-tenant technician detail → not_found', () => svc.getTechnicianDetail(owner, TX), 'not_found');
    await throws('permission gate: performance needs owner.staff.performance.view (TECHNICIAN → forbidden)', () => svc.getStaffPerformance({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }), 'forbidden');
    await throws('permission gate: earnings needs owner.staff.earnings.view (MANAGER lacks it → forbidden)', () => svc.getTechnicianEarnings({ tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }, TE), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-staff: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
