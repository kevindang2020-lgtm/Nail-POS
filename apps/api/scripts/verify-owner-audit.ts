/* verify-owner-audit.ts — proves the cross-cutting owner audit log over real Postgres (PGlite): alert transitions and
 * report exports append rows to owner_audit_log (migration 055) with the acting user/role + entity, the log reads back
 * newest-first and tenant-scoped, and the read is gated by owner.settings.view. */
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
  const PORT = 5484;
  const T = '00000000-0000-0000-0000-00000000ad01', T2 = '00000000-0000-0000-0000-00000000ad02';
  const B1 = '00000000-0000-0000-0000-00000000bd01';
  const U = '00000000-0000-0000-0000-00000000cd01';
  const A1 = '00000000-0000-0000-0000-0000000a1d01';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-au','PAU'),('${T2}','O','O','p-o2','PO2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}',NULL,'Sarah','A','Sarah A','s@x.com','active','OWNER')`);
  await db.exec(`INSERT INTO owner_alerts (id, tenant_id, branch_id, severity, status, title) VALUES ('${A1}','${T}','${B1}','warning','new','Low inventory')`);
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${T}','${B1}',gen_random_uuid(),'paid',5000,0,0,5000,0, now())`);
  // a pre-existing audit row for ANOTHER tenant — must never appear in T's log
  await db.exec(`INSERT INTO owner_audit_log (id, tenant_id, user_id, role, action, entity_type) VALUES (gen_random_uuid(),'${T2}',gen_random_uuid(),'OWNER','alert_resolved','alert')`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k)); // no emitter needed for audit
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  try {
    await svc.acknowledgeAlert(owner, A1);
    await svc.resolveAlert(owner, A1);
    await svc.exportReport(owner, 'sales');

    const log = await svc.getAuditLog(owner);
    ok('audit log has exactly 3 entries for this tenant (other tenant excluded)', log.length === 3, String(log.length));
    const actions = log.map((e) => e.action).sort();
    ok('actions recorded: alert_acknowledged, alert_resolved, owner_export_created', actions.join() === 'alert_acknowledged,alert_resolved,owner_export_created', actions.join());
    ok('each entry carries the acting user + role', log.every((e) => e.userId === U && e.role === 'OWNER'));
    const exportRow = log.find((e) => e.action === 'owner_export_created');
    ok('export entry: entityType report, entityId "sales", metadata.period present', !!exportRow && exportRow.entityType === 'report' && exportRow.entityId === 'sales' && (exportRow.metadata as any)?.period === 'month', JSON.stringify({ t: exportRow?.entityType, i: exportRow?.entityId, m: exportRow?.metadata }));
    const alertRow = log.find((e) => e.action === 'alert_resolved');
    ok('alert entry: entityType alert, entityId = the alert id', !!alertRow && alertRow.entityType === 'alert' && alertRow.entityId === A1);
    ok('limit is honored', (await svc.getAuditLog(owner, 1)).length === 1);

    await throws('permission gate: audit read needs owner.settings.view (TECHNICIAN → forbidden)', () => svc.getAuditLog({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }), 'forbidden');
    await throws('permission gate: audit read forbidden for MANAGER (no owner.settings.view)', () => svc.getAuditLog({ tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-audit: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
