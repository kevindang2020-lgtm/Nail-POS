/* verify-owner-expenses.ts — proves the Owner App's expense routes over real Postgres (PGlite): CRUD, period totals +
 * by-category, tenant isolation, manager branch-scoping, permission gates (view = owner.expenses.view, mutate =
 * owner.expenses.manage), and that real expenses flow into the finance net profit (revenue − commission − expenses).
 * Oct 21 2026 (finance mandate): the Owner App's expense methods delegate to the finance module (ExpenseService), bound
 * exactly as the API binds it (apps/api/src/finance/finance-wiring.ts bindFinancePorts) — so this harness now also proves
 * that delegation: a delete VOIDS an approved expense (never a hard delete), a MANAGER (who now holds
 * owner.expenses.manage) is confined to their own branch, and only approved expenses reach the P&L. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyOwnerRepository } from '../../../modules/analytics/src/owner/owner.kysely.repository';
import { OwnerService } from '../../../modules/analytics/src/owner/owner.service';
import type { OwnerContext } from '../../../modules/analytics/src/owner/owner.repository';
import { permissionsFor } from '../../../packages/permissions/src/rbac';
import { ExpenseService } from '@aipowersalon/finance';
import { bindFinancePorts } from '../src/finance/finance-bindings';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const throws = async (n: string, fn: () => Promise<any>, code?: string) => {
  try { await fn(); ok(n, false, 'did not throw'); } catch (e: any) { ok(n, code ? e?.code === code : true, e?.code || e?.message); }
};

(async () => {
  const T = '00000000-0000-0000-0000-0000000e0001', T2 = '00000000-0000-0000-0000-0000000e0002';
  const B1 = '00000000-0000-0000-0000-0000000eb001', B2 = '00000000-0000-0000-0000-0000000eb002';
  const U = '00000000-0000-0000-0000-0000000e0a01', MGR = '00000000-0000-0000-0000-0000000e0a02';

  const { migratedPglite } = await import('@aipowersalon/testing');   // Oct 20 2026: ONE schema builder (pgcrypto + pg_trgm + btree_gist, cached) — the hand-rolled replay lacked pg_trgm (migration 107)
  const db = await migratedPglite();
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','P','P','p-ex','PEX','active'),('${T2}','O','O','p-ex2','PEX2','active')`);
  // pin tenant tz to UTC so the month window matches the UTC CURRENT_DATE / now() seeds
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${B2}','${T}','Uptown','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}',NULL,'Owner','O','Owner O','o@x.com','active','OWNER'),('${MGR}','${T}','${B1}','Mara','M','Mara M','m@x.com','active','MANAGER')`);
  // revenue this month (one paid ticket, no service lines → commission 0) to exercise net profit = revenue − expenses
  await db.exec(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name, created_at) SELECT t.id, (SELECT b.id FROM branches b WHERE b.tenant_id = t.id ORDER BY b.created_at, b.id LIMIT 1), 'Walk', 'FixtureGuest', 'Walk FixtureGuest', now() - interval '400 days' FROM tenants t WHERE EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id) AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.tenant_id = t.id AND c.last_name = 'FixtureGuest')`);   // Oct 20 2026: tickets.customer_id is NOT NULL + FK (Oct 8) — every fixture ticket belongs to a real customer row (back-dated: never a "new client")
  await db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES (gen_random_uuid(),'${T}','${B1}',(SELECT id FROM customers WHERE tenant_id = '${T}' AND last_name = 'FixtureGuest' LIMIT 1),'paid',100000,0,0,100000,0, now())`);
  // a foreign-tenant expense that must never appear in T's totals
  await db.exec(`INSERT INTO expenses (id, tenant_id, branch_id, category, amount_cents, incurred_on) VALUES (gen_random_uuid(),'${T2}',NULL,'rent',999999, CURRENT_DATE)`);

  // Oct 21 2026: the in-process PGlite dialect (as the pgtests use) — the finance service runs transactions beside reads,
  // which a one-connection socket pool would deadlock on.
  const { kyselyFor } = await import('@aipowersalon/testing');
  const k = kyselyFor(db) as unknown as Kysely<DB>;
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const finance = new ExpenseService(k as never, { async resolve() { throw new Error('unbound'); } });
  bindFinancePorts(finance, svc as never, null, null);
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
    ok('deleteExpense removes it from the list', del.deleted === true);
    ok('after delete, list has 2 (supplies@B1 + marketing@B2)', (await svc.getExpenses(owner, 'month')).length === 2);
    const kept = await k.selectFrom('expenses').select(['status', 'void_reason']).where('id', '=', rent.id).executeTakeFirst();
    ok('an approved expense is VOIDED with a reason, never hard-deleted (§85)', kept?.status === 'voided' && !!kept?.void_reason, JSON.stringify(kept));

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
    // Oct 21 2026: a MANAGER now holds owner.expenses.manage (Kevin's mandate §§14–16) — confined to their own branch
    await throws('branch gate: MANAGER (B1) createExpense into B2 → forbidden', () => svc.createExpense(mgr, { category: 'rent', amountCents: 1000, incurredOn: today, branchId: B2 }), 'forbidden');
    const mine = await svc.createExpense(mgr, { category: 'supplies', amountCents: 1000, incurredOn: today, branchId: B1 });
    ok('MANAGER (B1) records an expense at their own branch', mine.branchId === B1, String(mine.branchId));
    await throws('branch gate: MANAGER (B1) cannot see / delete a B2 expense', async () => { const b2 = (await svc.getExpenses(owner, 'month')).find((e) => e.branchId === B2)!; await svc.deleteExpense(mgr, b2.id); });
    await throws('validation: negative amount rejected', () => svc.createExpense(owner, { category: 'rent', amountCents: -5, incurredOn: today }), 'invalid');
    await throws('validation: bad date rejected', () => svc.createExpense(owner, { category: 'rent', amountCents: 100, incurredOn: '06/01/2026' }), 'invalid');
    await throws('tenant isolation: deleting a foreign expense id → not_found', () => svc.deleteExpense(owner, '00000000-0000-0000-0000-00000000dead'), 'not_found');

    // audit: each mutation was logged
    const audit = await svc.getAuditLog(owner);
    const acts = audit.map((a) => a.action).filter((a) => a.startsWith('expense_')).sort();
    ok('expense mutations are audit-logged (create×4, a correction of the approved one, void)', acts.join() === 'expense_corrected,expense_created,expense_created,expense_created,expense_created,expense_voided', acts.join());
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-expenses: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
