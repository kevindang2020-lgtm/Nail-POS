/* verify-owner-alerts.ts — proves Module 6 Alerts/More over real Postgres (PGlite) against the NEW owner_alerts table
 * (migration 054): summary counts by severity/status + unread, list filtering, acknowledge/resolve/dismiss transitions
 * (resolve stamps resolved_at), the profile card + settings snapshot, tenant isolation, and permission gates (view needs
 * owner.alerts.view; act needs owner.alerts.resolve — MANAGER can view but not act; settings needs owner.settings.view). */
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
  const PORT = 5482;
  const T = '00000000-0000-0000-0000-00000000ab01', T2 = '00000000-0000-0000-0000-00000000ab02';
  const B1 = '00000000-0000-0000-0000-00000000bb01', B2 = '00000000-0000-0000-0000-00000000bb02', BX = '00000000-0000-0000-0000-00000000bbff';
  const U = '00000000-0000-0000-0000-00000000cb01';
  const A1 = '00000000-0000-0000-0000-0000000a1b01', A2 = '00000000-0000-0000-0000-0000000a1b02', A3 = '00000000-0000-0000-0000-0000000a1b03', AX = '00000000-0000-0000-0000-0000000a1bff';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Glow LLC','Glow Salon','glow','GLW'),('${T2}','O','O','p-o','POO')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','inactive'),('${BX}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','Anderson','Sarah Anderson','s@x.com','active','OWNER')`);
  const alert = (id: string | null, t: string, b: string | null, sev: string, st: string, title: string) =>
    db.exec(`INSERT INTO owner_alerts (id, tenant_id, branch_id, severity, status, title, category) VALUES (${id ? `'${id}'` : 'gen_random_uuid()'},'${t}',${b ? `'${b}'` : 'NULL'},'${sev}','${st}','${title}','general')`);
  // T: critical/new, warning/new, high/acknowledged, info/resolved, warning/dismissed → total 5, unread 2
  await alert(A1, T, B1, 'critical', 'new', 'Payment gateway error');
  await alert(A2, T, null, 'warning', 'new', 'Low inventory: gel polish');
  await alert(A3, T, B1, 'high', 'acknowledged', 'Refund spike');
  await alert(null, T, null, 'info', 'resolved', 'Nightly backup complete');
  await alert(null, T, B1, 'warning', 'dismissed', 'Late clock-in');
  await alert(AX, T2, BX, 'critical', 'new', 'Other tenant alert'); // excluded

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };
  const manager: OwnerContext = { tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] };

  try {
    const sum = await svc.getAlertSummary(owner);
    ok('summary: total 5, unread 2 (other tenant excluded)', sum.total === 5 && sum.unread === 2, JSON.stringify({ t: sum.total, u: sum.unread }));
    ok('summary bySeverity {info1,warning2,high1,critical1}', sum.bySeverity.info === 1 && sum.bySeverity.warning === 2 && sum.bySeverity.high === 1 && sum.bySeverity.critical === 1, JSON.stringify(sum.bySeverity));
    ok('summary byStatus {new2,acknowledged1,resolved1,dismissed1,in_progress0}', sum.byStatus.new === 2 && sum.byStatus.acknowledged === 1 && sum.byStatus.resolved === 1 && sum.byStatus.dismissed === 1 && sum.byStatus.in_progress === 0, JSON.stringify(sum.byStatus));

    ok('list all = 5', (await svc.getAlerts(owner, {})).length === 5);
    ok('list filter status=new → 2', (await svc.getAlerts(owner, { status: 'new' })).length === 2);
    ok('list filter severity=critical → 1', (await svc.getAlerts(owner, { severity: 'critical' })).length === 1);

    const acked = await svc.acknowledgeAlert(owner, A2);
    ok('acknowledge A2 → status acknowledged', acked.status === 'acknowledged', acked.status);
    const resolved = await svc.resolveAlert(owner, A1);
    ok('resolve A1 → status resolved + resolvedAt stamped', resolved.status === 'resolved' && !!resolved.resolvedAt, JSON.stringify({ s: resolved.status, r: resolved.resolvedAt }));
    const dismissed = await svc.dismissAlert(owner, A3);
    ok('dismiss A3 → status dismissed', dismissed.status === 'dismissed', dismissed.status);
    ok('after transitions unread = 0', (await svc.getAlertSummary(owner)).unread === 0);

    const prof = await svc.getProfileCard(owner);
    ok('profile card: Sarah Anderson · Glow Salon · OWNER · 2 branches', prof.fullName === 'Sarah Anderson' && prof.businessName === 'Glow Salon' && prof.role === 'OWNER' && prof.branchCount === 2, JSON.stringify({ n: prof.fullName, b: prof.businessName, r: prof.role, c: prof.branchCount }));
    const settings = await svc.getSettings(owner);
    ok('settings: Glow Salon, 2 branches (1 active), USD', settings.businessName === 'Glow Salon' && settings.branchCount === 2 && settings.activeBranchCount === 1 && settings.currency === 'USD', JSON.stringify(settings));

    await throws('tenant isolation: act on foreign-tenant alert → not_found', () => svc.acknowledgeAlert(owner, AX), 'not_found');
    ok('MANAGER can view the alert summary (owner.alerts.view)', (await svc.getAlertSummary(manager)).total === 5);
    await throws('permission gate: list needs owner.alerts.view (TECHNICIAN → forbidden)', () => svc.getAlerts({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }, {}), 'forbidden');
    await throws('permission gate: resolve needs owner.alerts.resolve (MANAGER lacks it → forbidden)', () => svc.resolveAlert(manager, A1), 'forbidden');
    await throws('permission gate: settings needs owner.settings.view (MANAGER lacks it → forbidden)', () => svc.getSettings(manager), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-alerts: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
