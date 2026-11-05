/* verify-owner-bookings.ts — proves the Module 3 Booking Overview endpoints over real Postgres (PGlite) from
 * pos_tech_appointments: status buckets (completed/cancelled/no_show) + percentages of total, completion/cancellation/
 * no-show rates + trends, the 7-day bookings trend, drill-down filtering, single-appointment detail, tenant isolation,
 * and permission gates (overview needs owner.bookings.view; detail needs owner.bookings.details — MANAGER lacks detail). */
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
  const PORT = 5479;
  const T = '00000000-0000-0000-0000-00000000a801', T2 = '00000000-0000-0000-0000-00000000a802';
  const B1 = '00000000-0000-0000-0000-00000000b801', B2 = '00000000-0000-0000-0000-00000000b802', BX = '00000000-0000-0000-0000-00000000b8ff';
  const U = '00000000-0000-0000-0000-00000000c801';
  const D1 = '00000000-0000-0000-0000-0000000d8001', D2 = '00000000-0000-0000-0000-0000000d8002', DX = '00000000-0000-0000-0000-0000000d80ff';
  const AC = '00000000-0000-0000-0000-0000000a8c01'; // a specific cancelled appt in B1 (detail test)
  const AT2 = '00000000-0000-0000-0000-0000000a82f1'; // a T2 appt (isolation detail test)

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-k1','PK1'),('${T2}','O','O','p-k2','PK2')`);
  // pin tenant tz to UTC so tz-aware day/period windows match the UTC now()/CURRENT_DATE seeds (non-UTC behavior lives in verify-owner-tz.ts)
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active'),('${BX}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','Anderson','Sarah Anderson','s@x.com','active','OWNER')`);
  const tech = (id: string, t: string, b: string) => db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${id}','${t}','${b}',gen_random_uuid(),'T','T','T','available','percent',40,true)`);
  await tech(D1, T, B1); await tech(D2, T, B2); await tech(DX, T2, BX);
  const appt = (t: string, b: string, tech: string, status: string, id?: string) =>
    db.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, customer_phone, appt_date, start_time, end_time, status, source) VALUES
      (${id ? `'${id}'` : 'gen_random_uuid()'},'${t}','${b}','${tech}','Walk-in','+16095551212', CURRENT_DATE,'10:00','10:30','${status}','online')`);
  // Tenant T: B1 = completed×4, cancelled×1(=AC), no_show×1, booked×1 ; B2 = completed×1, cancelled×1, booked×1  → total 10
  for (let i = 0; i < 4; i++) await appt(T, B1, D1, 'completed'); await appt(T, B1, D1, 'cancelled', AC); await appt(T, B1, D1, 'no_show'); await appt(T, B1, D1, 'booked');
  await appt(T, B2, D2, 'completed'); await appt(T, B2, D2, 'cancelled'); await appt(T, B2, D2, 'booked');
  // Other tenant: completed×3 (one = AT2) — must be excluded from T
  await appt(T2, BX, DX, 'completed', AT2); await appt(T2, BX, DX, 'completed'); await appt(T2, BX, DX, 'completed');

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  try {
    const o = await svc.getBookingOverview(owner, 'week');
    ok('total bookings = 10 (incl. upcoming; other tenant excluded)', o.totalBookings === 10, String(o.totalBookings));
    ok('completed 5 / 50.0% of total', o.completed.count === 5 && o.completed.percentage === 50, `${o.completed.count}/${o.completed.percentage}`);
    ok('cancelled 2 / 20.0%', o.cancelled.count === 2 && o.cancelled.percentage === 20, `${o.cancelled.count}/${o.cancelled.percentage}`);
    ok('no-show 1 / 10.0%', o.noShow.count === 1 && o.noShow.percentage === 10, `${o.noShow.count}/${o.noShow.percentage}`);
    ok('rates: completion 50, cancellation 20, no-show 10', o.completionRate === 50 && o.cancellationRate === 20 && o.noShowRate === 10, `${o.completionRate}/${o.cancellationRate}/${o.noShowRate}`);
    ok('rate trends = 100% (prior week empty, not Infinity)', o.completionRateTrendPercent === 100 && o.cancellationRateTrendPercent === 100 && o.noShowRateTrendPercent === 100);
    ok('trend has 7 day buckets summing to 10 (today bucket = 10)', o.trend.length === 7 && o.trend.reduce((s, d) => s + d.bookingCount, 0) === 10, String(o.trend.length));

    const b1 = await svc.getBookingOverview(owner, 'week', B1);
    ok('branch B1: total 7, completed 4, cancelled 1, no-show 1', b1.totalBookings === 7 && b1.completed.count === 4 && b1.cancelled.count === 1 && b1.noShow.count === 1, JSON.stringify({ t: b1.totalBookings, c: b1.completed.count }));
    ok('branch B1: completion rate = round(4/7) = 57.1%', b1.completionRate === 57.1, String(b1.completionRate));

    const cancelled = await svc.getBookingDrillDown(owner, { period: 'week', status: 'cancelled' });
    ok('drill-down cancelled = 2 rows, all cancelled', cancelled.length === 2 && cancelled.every((a) => a.status === 'cancelled'), String(cancelled.length));
    const b1completed = await svc.getBookingDrillDown(owner, { period: 'week', branchId: B1, status: 'completed' });
    ok('drill-down B1 completed = 4 rows', b1completed.length === 4, String(b1completed.length));

    const detail = await svc.getAppointment(owner, AC);
    ok('appointment detail: AC is cancelled w/ masked-source fields', detail.appointmentId === AC && detail.status === 'cancelled' && detail.source === 'online', JSON.stringify({ id: detail.appointmentId === AC, s: detail.status }));

    await throws('tenant isolation: foreign-tenant appointment detail → not_found', () => svc.getAppointment(owner, AT2), 'not_found');
    await throws('permission gate: overview needs owner.bookings.view (TECHNICIAN → forbidden)', () => svc.getBookingOverview({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }, 'week'), 'forbidden');
    await throws('permission gate: detail needs owner.bookings.details (MANAGER lacks it → forbidden)', () => svc.getAppointment({ tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }, AC), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-bookings: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
