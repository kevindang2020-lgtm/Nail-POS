/* verify-owner-expenses.ts — proves the Expenses domain over real Postgres (PGlite): CRUD, period totals + by-category,
 * tenant isolation, manager branch-scoping, permission gates (view = owner.expenses.view, mutate = owner.expenses.manage),
 * and that real expenses flow into the finance net profit (revenue − commission − expenses). */
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
  const PORT = 5486;
  const T = '00000000-0000-0000-0000-0000000e0001', T2 = '00000000-0000-0000-0000-0000000e0002';
  const B1 = '00000000-0000-0000-0000-0000000eb001', B2 = '00000000-0000-0000-0000-0000000eb002';
  const U = '00000000-0000-0000-0000-0000000e0a01', MGR = '00000000-0000-0000-0000-0000000e0a02';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-ex','PEX'),('${T2}','O','O','p-ex2','PEX2')`);
  // pin tenant tz to UTC so the month window matches the UTC CURRENT_DATE / now() seeds
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}',NULL,'Owner','O','Owner O','o@x.com','active','OWNER'),('${MGR}','${T}','${B1}','Mara','M','Mara M','m@x.com','active','MANAGER')`);
  // revenue this month (one paid ticket, no service lines → commission 0) to exercise net profit = revenue − expenses
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${T}','${B1}',gen_random_uuid(),'paid',100000,0,0,100000,0, now())`);
  // a foreign-tenant expense that must never appear in T's totals
  await db.exec(`INSERT INTO expenses (id, tenant_id, branch_id, category, amount_cents, incurred_on) VALUES (gen_random_uuid(),'${T2}',NULL,'rent',999999, CURRENT_DATE)`);

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const today = new Date().toISOString().slice(0, 10);
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };
  const mgr: OwnerContext = { tenantId: T, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] };
  const tech: OwnerContext = { tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] };

  try {
    const rent = await svc.createExpense(owner, { category: 'rent', amountCents: 200000, incurredOn: today, branchId: B1, vendor: 'Landlord LLC' });
    const supplies = await svc.createExpense(owner, { category: 'supplies', amountCents: 50000, incurredOn: today, branchId: B1, description: 'Polish + files' });
    await svc.createExpense(owner, { category: 'marketing', amountCents: 30000, incurredOn: today, branchId: B2 }); // B2 expense
    ok('createExpense returns persisted rows with ids + cents', !!rent.id && rent.amountCents === 200000 && supplies.category === 'supplies');

    const list = await svc.getExpenses(owner, 'month');
    ok('listExpenses returns all 3 tenant expenses for the month (foreign tenant excluded)', list.length === 3, String(list.length));

    const sum = await svc.getExpenseSummary(owner, 'month');
    ok('expense summary total = 280000 across 3 (200k+50k+30k)', sum.totalCents === 280000 && sum.count === 3, JSON.stringify({ t: sum.totalCents, c: sum.count }));
    ok('summary by-category includes rent/supplies/marketing', sum.byCategory.map((x) => x.category).sort().join() === 'marketing,rent,supplies', sum.byCategory.map((x) => x.category).join());

    const upd = await svc.updateExpense(owner, supplies.id, { amountCents: 60000 });
    ok('updateExpense changes the amount', upd.amountCents === 60000, String(upd.amountCents));

    const del = await svc.deleteExpense(owner, rent.id);
    ok('deleteExpense removes the row', del.deleted === true);
    ok('after delete, list has 2 (supplies@B1 + marketing@B2)', (await svc.getExpenses(owner, 'month')).length === 2);

    // net profit: revenue 100000 − commission 0 − expenses (60000 B1 + 30000 B2 = 90000) = 10000
    const fin = await svc.getFinanceSummary(owner, 'month');
    ok('finance net profit = revenue − commission − expenses (100000 − 0 − 90000 = 10000)', fin.netProfitCents === 10000 && fin.totalExpensesCents === 90000 && fin.totalCommissionCents === 0, JSON.stringify({ net: fin.netProfitCents, exp: fin.totalExpensesCents, com: fin.totalCommissionCents }));

    // branch scoping (view): a MANAGER at B1 sees only B1 expenses, never B2's
    const mgrList = await svc.getExpenses(mgr, 'month');
    ok('manager (branch B1) sees only B1 expenses, not B2', mgrList.length === 1 && mgrList.every((e) => e.branchId === B1), JSON.stringify(mgrList.map((e) => e.branchId)));
    const mgrFin = await svc.getFinanceSummary(mgr, 'month');
    ok('manager finance expenses are branch-scoped to B1 (60000, excludes B2 30000)', mgrFin.totalExpensesCents === 60000, String(mgrFin.totalExpensesCents));

    // permission gates
    await throws('view gate: TECHNICIAN getExpenses → forbidden', () => svc.getExpenses(tech, 'month'), 'forbidden');
    await throws('manage gate: MANAGER createExpense → forbidden (view-only)', () => svc.createExpense(mgr, { category: 'rent', amountCents: 1000, incurredOn: today }), 'forbidden');
    await throws('manage gate: MANAGER deleteExpense → forbidden', () => svc.deleteExpense(mgr, supplies.id), 'forbidden');
    await throws('validation: negative amount rejected', () => svc.createExpense(owner, { category: 'rent', amountCents: -5, incurredOn: today }), 'invalid');
    await throws('validation: bad date rejected', () => svc.createExpense(owner, { category: 'rent', amountCents: 100, incurredOn: '06/01/2026' }), 'invalid');
    await throws('tenant isolation: deleting a foreign expense id → not_found', () => svc.deleteExpense(owner, '00000000-0000-0000-0000-00000000dead'), 'not_found');

    // audit: each mutation was logged
    const audit = await svc.getAuditLog(owner);
    const acts = audit.map((a) => a.action).filter((a) => a.startsWith('expense_')).sort();
    ok('expense mutations are audit-logged (create×3, update, delete)', acts.join() === 'expense_create,expense_create,expense_create,expense_delete,expense_update', acts.join());
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-expenses: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
