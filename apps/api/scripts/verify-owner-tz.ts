/* verify-owner-tz.ts — proves tenant timezone/currency flows from the 'business-branch' settings through the service over
 * real Postgres (PGlite): tenant-level value, branch-level override when a branch is selected, and the safe default when
 * unset. (The cross-midnight day/period boundary MATH is proven deterministically in owner.dto.vitest.spec.ts.) */
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

(async () => {
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5485;
  const T = '00000000-0000-0000-0000-00000000fc01', T2 = '00000000-0000-0000-0000-00000000fc02';
  const B1 = '00000000-0000-0000-0000-00000000fb01';
  const U = '00000000-0000-0000-0000-00000000fd01', U2 = '00000000-0000-0000-0000-00000000fd02';
  const TECH = '00000000-0000-0000-0000-00000000fe01';

  const { migratedPglite } = await import('@aipowersalon/testing');   // Oct 20 2026: ONE schema builder (pgcrypto + pg_trgm + btree_gist, cached) — the hand-rolled replay lacked pg_trgm (migration 107)
  const db = await migratedPglite();
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','P','P','p-tz1','PTZ1','active'),('${T2}','O','O','p-tz2','PTZ2','active')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}',NULL,'Owner','One','Owner One','o1@x.com','active','OWNER'),('${U2}','${T2}',NULL,'Owner','Two','Owner Two','o2@x.com','active','OWNER')`);
  // T: tenant-level LA/EUR + a branch-level override for B1 (Chicago/GBP). T2: no settings at all → defaults.
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES
    (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"America/Los_Angeles","currency":"EUR"}'::jsonb),
    (gen_random_uuid(),'${T}','${B1}','business-branch','{"timezone":"America/Chicago","currency":"GBP"}'::jsonb)`);
  // a technician + two appointments stored on salon-LOCAL dates: one on LA-today, one on LA-tomorrow.
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active) VALUES ('${TECH}','${T}','${B1}','Tina','T','Tina T','active','percent',40,100,true)`);
  await db.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status) VALUES
    (gen_random_uuid(),'${T}','${B1}','${TECH}','Walk In',false,'online','[]'::jsonb,(now() AT TIME ZONE 'America/Los_Angeles')::date,'10:00','11:00',60,'booked','not_required'),
    (gen_random_uuid(),'${T}','${B1}','${TECH}','Walk In',false,'online','[]'::jsonb,((now() AT TIME ZONE 'America/Los_Angeles')::date + 1),'10:00','11:00',60,'booked','not_required')`);
  // a paid ticket at a FIXED instant that is Jun 10 in UTC but Jun 9 in Los Angeles (06:30 UTC = 23:30 PDT Jun 9).
  await db.exec(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name, created_at) SELECT t.id, (SELECT b.id FROM branches b WHERE b.tenant_id = t.id ORDER BY b.created_at, b.id LIMIT 1), 'Walk', 'FixtureGuest', 'Walk FixtureGuest', now() - interval '400 days' FROM tenants t WHERE EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id) AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = t.id AND c.last_name = 'FixtureGuest')`);   // Oct 20 2026: tickets.customer_id is NOT NULL + FK (Oct 8) — every fixture ticket belongs to a real customer row (back-dated: never a "new client")
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${T}','${B1}',(SELECT id FROM customers WHERE tenant_id = '${T}' AND last_name = 'FixtureGuest' LIMIT 1),'paid',5000,0,0,5000,0,'2026-06-10T06:30:00Z')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const repo = new KyselyOwnerRepository(k);
  const svc = new OwnerService(repo);
  const owner = (branch?: string): OwnerContext => ({ tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[], selectedBranchId: branch });
  const ownerT2 = (): OwnerContext => ({ tenantId: T2, userId: U2, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });

  try {
    const all = await svc.getDashboard(owner());
    ok('dashboard context uses tenant-level timezone (America/Los_Angeles)', all.context.timezone === 'America/Los_Angeles', all.context.timezone);
    ok('dashboard context uses tenant-level currency (EUR)', all.context.currency === 'EUR', all.context.currency);

    const b1 = await svc.getDashboard(owner(B1));
    ok('selecting a branch applies its override timezone (America/Chicago)', b1.context.timezone === 'America/Chicago', b1.context.timezone);
    ok('selecting a branch applies its override currency (GBP)', b1.context.currency === 'GBP', b1.context.currency);

    const settings = await svc.getSettings(owner());
    ok('settings snapshot reflects the tenant-level timezone + currency', settings.timezone === 'America/Los_Angeles' && settings.currency === 'EUR', `${settings.timezone}/${settings.currency}`);

    const def = await svc.getDashboard(ownerT2());
    ok('a tenant with no settings falls back to defaults (America/New_York + USD)', def.context.timezone === 'America/New_York' && def.context.currency === 'USD', `${def.context.timezone}/${def.context.currency}`);

    // end-to-end: appt_date is salon-local, so "today" must count the LA-local day only. The pre-fix UTC slice of the
    // LA-midnight instant would extend lastDate by a day and wrongly include the LA-tomorrow appointment.
    const ov = await svc.getBookingOverview(owner(), 'today', B1);
    ok('booking "today" buckets by the tenant-local day (LA-tomorrow appt excluded; UTC slice would over-count)', ov.totalBookings === 1, `totalBookings=${ov.totalBookings}`);

    // sales export day-grouping: the fixed-instant ticket is Jun 10 in UTC but Jun 9 in LA.
    const win = { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' };
    const utcDays = await repo.revenueByDate(owner(), B1, win, 'UTC');
    const laDays = await repo.revenueByDate(owner(), B1, win, 'America/Los_Angeles');
    ok('revenue export groups by UTC day by default (ticket lands on 2026-06-10)', utcDays.some((d) => d.date === '2026-06-10' && d.revenueCents === 5000), JSON.stringify(utcDays));
    ok('revenue export groups by the tenant-local day when tz is given (2026-06-09 in LA)', laDays.some((d) => d.date === '2026-06-09' && d.revenueCents === 5000), JSON.stringify(laDays));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-tz: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
