/* verify-tech-skill-requests.ts — proves the technician skill-change-request lifecycle (§13) over REAL Postgres
 * (PGlite, incl. migration 053). A technician requests a service; a manager approves/rejects; approval mutates the
 * real eligibility table (technician_services). Verifies the requestable menu, duplicate guard, manager-only gate,
 * approve-then-eligible, reject-then-not-eligible, already-decided guard, and tenant isolation. */
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
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PORT = 5476;
  const T = '00000000-0000-0000-0000-00000000a501', B = '00000000-0000-0000-0000-00000000b501';
  const T2 = '00000000-0000-0000-0000-00000000a502', B2 = '00000000-0000-0000-0000-00000000b502';
  const U = '00000000-0000-0000-0000-00000000c501', TECH = '00000000-0000-0000-0000-00000000d501', MGR = '00000000-0000-0000-0000-00000000e501';
  const U2 = '00000000-0000-0000-0000-00000000c502', TECH2 = '00000000-0000-0000-0000-00000000d502';
  const CAT = '00000000-0000-0000-0000-0000000ca501', CAT2 = '00000000-0000-0000-0000-0000000ca502';
  const S1 = '00000000-0000-0000-0000-0000000c5501', S2 = '00000000-0000-0000-0000-0000000c5502', S3 = '00000000-0000-0000-0000-0000000c5503', SX = '00000000-0000-0000-0000-0000000c5504';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-t1','PT1'),('${T2}','O','O','p-t2','PT2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main'),('${B2}','${T2}','M2')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES
    ('${TECH}','${T}','${B}','${U}','Amy','N','Amy N','available','percent',40,true),
    ('${TECH2}','${T2}','${B2}','${U2}','Cam','N','Cam N','available','percent',40,true)`);
  await db.exec(`INSERT INTO service_categories (id, tenant_id, branch_id, name, sort_order, status) VALUES ('${CAT}','${T}','${B}','Gel',0,'active'),('${CAT2}','${T2}','${B2}','Wax',0,'active')`);
  const svc = (id: string, tenant: string, branch: string, catId: string, name: string) =>
    db.exec(`INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order)
      VALUES ('${id}','${tenant}','${branch}','${catId}','${name}',30,5000,'percent',40,true,true,true,'active',0)`);
  await svc(S1, T, B, CAT, 'Service One'); await svc(S2, T, B, CAT, 'Service Two'); await svc(S3, T, B, CAT, 'Service Three'); await svc(SX, T2, B2, CAT2, 'Other Tenant Svc');
  await db.exec(`INSERT INTO technician_services (id, tenant_id, branch_id, technician_id, service_id, is_primary) VALUES (gen_random_uuid(),'${T}','${B}','${TECH}','${S1}',true)`); // TECH already eligible for S1

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svcLayer = new TechService(new KyselyTechRepository(k));
  const tech: TechContext = { tenantId: T, branchId: B, userId: U, role: 'TECHNICIAN' as any, permissions: permissionsFor('TECHNICIAN') as string[] };
  const mgr: TechContext = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER' as any, permissions: permissionsFor('MANAGER') as string[] };
  const tech2: TechContext = { tenantId: T2, branchId: B2, userId: U2, role: 'TECHNICIAN' as any, permissions: permissionsFor('TECHNICIAN') as string[] };

  try {
    const view0 = await svcLayer.getSkills(tech);
    const ids0 = view0.requestableServices.map((r) => r.serviceId);
    ok('requestable menu = S2 + S3 (excludes already-eligible S1)', ids0.includes(S2) && ids0.includes(S3) && !ids0.includes(S1), ids0.length + ' items');

    const req = await svcLayer.requestSkillChange(tech, { serviceId: S2 });
    ok('request created pending for "Service Two"', req.status === 'pending' && req.serviceName === 'Service Two', req.status);

    await throws('duplicate pending request rejected (invalid_state)', () => svcLayer.requestSkillChange(tech, { serviceId: S2 }), 'invalid_state');

    const mine = await svcLayer.mySkillChangeRequests(tech);
    ok('technician sees their 1 request', mine.length === 1 && mine[0].serviceId === S2, String(mine.length));

    const pend = await svcLayer.pendingSkillChangeRequests(mgr);
    ok('manager sees 1 pending (with technician name)', pend.length === 1 && pend[0].technicianName === 'Amy N', `${pend.length}/${pend[0]?.technicianName}`);

    await throws('technician CANNOT decide (manager-only, forbidden)', () => svcLayer.decideSkillChange(tech, req.id, 'approved'), 'forbidden');

    const decided = await svcLayer.decideSkillChange(mgr, req.id, 'approved');
    ok('manager approval → status approved + decidedAt set', decided.status === 'approved' && !!decided.decidedAt);

    const view1 = await svcLayer.getSkills(tech);
    ok('approval MUTATED eligibility: S2 now an eligible service', view1.services.some((s) => s.serviceId === S2));
    ok('requestable menu no longer offers S2', !view1.requestableServices.some((r) => r.serviceId === S2));

    await throws('deciding an already-decided request rejected (invalid_state)', () => svcLayer.decideSkillChange(mgr, req.id, 'rejected'), 'invalid_state');

    // reject flow
    const req3 = await svcLayer.requestSkillChange(tech, { serviceId: S3 });
    const rej = await svcLayer.decideSkillChange(mgr, req3.id, 'rejected');
    const view2 = await svcLayer.getSkills(tech);
    ok('rejection → status rejected and S3 NOT added to eligibility', rej.status === 'rejected' && !view2.services.some((s) => s.serviceId === S3));

    // tenant isolation
    const reqOther = await svcLayer.requestSkillChange(tech2, { serviceId: SX });
    const pendT = await svcLayer.pendingSkillChangeRequests(mgr);
    ok('tenant isolation: tenant-T manager does NOT see tenant-T2 request', !pendT.some((p) => p.id === reqOther.id), `${pendT.length} pending in T`);
    await throws('tenant isolation: tenant-T manager cannot decide a T2 request (not_found)', () => svcLayer.decideSkillChange(mgr, reqOther.id, 'approved'), 'not_found');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-tech-skill-requests: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
