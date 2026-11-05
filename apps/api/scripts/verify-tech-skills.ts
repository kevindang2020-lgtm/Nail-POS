/* verify-tech-skills.ts — proves technician skills/specialties + working hours read from the REAL existing tables
 * (technician_services → services → service_categories, and technician_schedules) over PGlite. No new schema.
 * Verifies GET /tech/skills (specialties + eligible services + is_primary), GET /tech/working-hours (weekly grid),
 * the derived More-screen labels (skillsLabel / workingHoursLabel), and tenant isolation. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyTechRepository } from '../../../modules/queue/src/tech/tech.kysely.repository';
import { TechService } from '../../../modules/queue/src/tech/tech.service';
import type { TechContext } from '../../../modules/queue/src/tech/tech.repository';
import { permissionsFor } from '../../../packages/permissions/src/rbac';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5475;
  const T = '00000000-0000-0000-0000-00000000a401', B = '00000000-0000-0000-0000-00000000b401';
  const T2 = '00000000-0000-0000-0000-00000000a402', B2 = '00000000-0000-0000-0000-00000000b402';
  const U = '00000000-0000-0000-0000-00000000c401', TECH = '00000000-0000-0000-0000-00000000d401';
  const U2 = '00000000-0000-0000-0000-00000000c402', TECH2 = '00000000-0000-0000-0000-00000000d402';
  const CAT_GEL = '00000000-0000-0000-0000-0000000ca001', CAT_PED = '00000000-0000-0000-0000-0000000ca002', CAT_X = '00000000-0000-0000-0000-0000000ca003';
  const S1 = '00000000-0000-0000-0000-0000000c5001', S2 = '00000000-0000-0000-0000-0000000c5002', S3 = '00000000-0000-0000-0000-0000000c5003', SX = '00000000-0000-0000-0000-0000000c5004';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-t1','PT1'),('${T2}','O','O','p-t2','PT2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main'),('${B2}','${T2}','M2')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${TECH}','${T}','${B}','${U}','Amy','N','Amy N','available','percent',40,true),
    ('${TECH2}','${T2}','${B2}','${U2}','Cam','N','Cam N','available','percent',40,true)`);
  const cat = (id: string, tenant: string, branch: string, name: string) =>
    db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, status) VALUES ('${id}','${tenant}','${branch}','${name}',0,'active')`);
  const svc = (id: string, tenant: string, branch: string, catId: string, name: string) =>
    db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order)
      VALUES ('${id}','${tenant}','${branch}','${catId}','${name}',30,5000,'percent',40,true,true,true,'active',0)`);
  const teched = (tenant: string, branch: string, tech: string, svcId: string, primary: boolean) =>
    db.exec(`INSERT INTO technician_services (id, tenant_id, branch_id, technician_id, service_id, is_primary) VALUES (gen_random_uuid(),'${tenant}','${branch}','${tech}','${svcId}',${primary})`);
  const sched = (tenant: string, branch: string, tech: string, dow: number, working: boolean) =>
    db.exec(`INSERT INTO technician_schedules (id, tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) VALUES
      (gen_random_uuid(),'${tenant}','${branch}','${tech}',${dow}, '09:00:00', '19:00:00', ${working})`);

  await cat(CAT_GEL, T, B, 'Gel'); await cat(CAT_PED, T, B, 'Pedicure'); await cat(CAT_X, T2, B2, 'Waxing');
  await svc(S1, T, B, CAT_GEL, 'Gel Manicure'); await svc(S2, T, B, CAT_GEL, 'Gel Removal'); await svc(S3, T, B, CAT_PED, 'Spa Pedicure'); await svc(SX, T2, B2, CAT_X, 'Leg Wax');
  await teched(T, B, TECH, S1, true); await teched(T, B, TECH, S2, false); await teched(T, B, TECH, S3, true); // specialties: Gel, Pedicure; 3 services
  await teched(T2, B2, TECH2, SX, true);                                                                       // other tenant — must not bleed
  for (let d = 0; d < 7; d++) await sched(T, B, TECH, d, d >= 1 && d <= 5);                                     // Mon–Fri working 09:00–19:00

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const repo = new KyselyTechRepository(k);
  const svcLayer = new TechService(repo);
  const ctx: TechContext = { tenantId: T, branchId: B, userId: U, role: 'TECHNICIAN' as any, permissions: permissionsFor('TECHNICIAN') as string[] };

  try {
    const sk = await svcLayer.getSkills(ctx);
    ok('skills: 3 eligible services', sk.services.length === 3, String(sk.services.length));
    ok('skills: specialties = Gel + Pedicure (distinct categories)', sk.specialties.length === 2 && sk.specialties.includes('Gel') && sk.specialties.includes('Pedicure'), sk.specialties.join('|'));
    ok('skills: is_primary preserved (Gel Manicure primary)', sk.services.find((x) => x.serviceName === 'Gel Manicure')?.isPrimary === true);
    ok('skills: non-primary preserved (Gel Removal not primary)', sk.services.find((x) => x.serviceName === 'Gel Removal')?.isPrimary === false);
    ok('skills: tenant isolation (other-tenant "Leg Wax" excluded)', !sk.services.some((x) => x.serviceName === 'Leg Wax'));

    const wh = await svcLayer.getWorkingHours(ctx);
    ok('working-hours: 7 day rows', wh.length === 7, String(wh.length));
    const mon = wh.find((d) => d.dayOfWeek === 1);
    ok('working-hours: Mon working 09:00–19:00', !!mon && mon.isWorking && mon.startTime === '09:00:00' && mon.endTime === '19:00:00');
    ok('working-hours: Sunday not working', wh.find((d) => d.dayOfWeek === 0)?.isWorking === false);

    const more = await svcLayer.getMore(ctx);
    ok('More: skillsLabel = "Gel, Pedicure"', more.skillsLabel === 'Gel, Pedicure', String(more.skillsLabel));
    ok('More: workingHoursLabel = "9:00 AM – 7:00 PM"', more.workingHoursLabel === '9:00 AM – 7:00 PM', String(more.workingHoursLabel));
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-tech-skills: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
