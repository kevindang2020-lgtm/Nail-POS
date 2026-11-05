/* verify-owner-finance.ts — proves Module 5 Finance & Reports over real Postgres (PGlite): revenue + transactions + tax/
 * tips/discounts from PAID tickets, expenses = staff commission (the only POS-tracked cost) with net profit as a labelled
 * estimate, payment mix by method over successful payments, the report catalog, real CSV exports (sales / payment-mix /
 * staff / bookings), tenant isolation, and permission gates (finance needs owner.finance.view; export needs
 * owner.reports.export — MANAGER can view reports but not export). */
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
  const PORT = 5481;
  const T = '00000000-0000-0000-0000-00000000aa01', T2 = '00000000-0000-0000-0000-00000000aa02';
  const B1 = '00000000-0000-0000-0000-00000000ba01', BX = '00000000-0000-0000-0000-00000000baff';
  const U = '00000000-0000-0000-0000-00000000ca01';
  const TE = '00000000-0000-0000-0000-0000000da001', TX = '00000000-0000-0000-0000-0000000da0ff';
  const K1 = '00000000-0000-0000-0000-000000001aa1', K2 = '00000000-0000-0000-0000-000000001aa2', K3 = '00000000-0000-0000-0000-000000001aa3', KX = '00000000-0000-0000-0000-000000001aaf';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','P','P','p-f1','PF1'),('${T2}','O','O','p-f2','PF2')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Downtown','active'),('${BX}','${T2}','Other','active')`);
  await db.exec(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, status, role) VALUES ('${U}','${T}','Sarah','A','Sarah A','s@x.com','active','OWNER')`);
  await db.exec(`INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, commission_type, commission_value, is_active) VALUES ('${TE}','${T}','${B1}',gen_random_uuid(),'Emma','X','Emma','available','percent',40,true),('${TX}','${T2}','${BX}',gen_random_uuid(),'O','X','O','available','percent',40,true)`);
  const ticket = (id: string, t: string, b: string, status: string, total: number, tax: number, tip: number, disc: number) => db.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, paid_at) VALUES ('${id}','${t}','${b}',gen_random_uuid(),'${status}',${total},${tax},${disc},${total},${tip}, ${status === 'paid' ? 'now()' : 'NULL'})`);
  await ticket(K1, T, B1, 'paid', 10000, 800, 1000, 500); await ticket(K2, T, B1, 'paid', 5000, 400, 500, 0);
  await ticket(K3, T, B1, 'serving', 9999, 0, 0, 0); await ticket(KX, T2, BX, 'paid', 99999, 9999, 0, 0);
  const line = (ticketId: string, t: string, b: string, tech: string, total: number) => db.exec(`INSERT INTO ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, progress_percent, completed_at) VALUES (gen_random_uuid(),'${t}','${b}','${ticketId}',gen_random_uuid(),'${tech}','Mani',${total},30,'percent',40,${total},'completed',100, now())`);
  await line(K1, T, B1, TE, 6000); await line(K2, T, B1, TE, 3000); // commission 2400 + 1200 = 3600
  await line(KX, T2, BX, TX, 50000); // other tenant → excluded
  const pay = (t: string, b: string, ticket: string, method: string, amount: number, status: string) => db.exec(`INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents) VALUES (gen_random_uuid(),'${t}','${b}','${ticket}','${method}',${amount},0,0,0,'${status}',0)`);
  await pay(T, B1, K1, 'card', 10000, 'paid'); await pay(T, B1, K2, 'cash', 3000, 'captured'); await pay(T, B1, K2, 'gift_card', 2000, 'completed');
  await pay(T, B1, K1, 'card', 7777, 'pending'); // not successful → excluded
  await pay(T2, BX, KX, 'card', 99999, 'paid'); // other tenant → excluded

  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await db.exec(`INSERT INTO tenant_settings (id, tenant_id, branch_id, category, settings_json) VALUES (gen_random_uuid(),'${T}',NULL,'business-branch','{"timezone":"UTC","currency":"USD"}'::jsonb)`);
  await db.exec(`INSERT INTO expenses (id, tenant_id, branch_id, category, amount_cents, incurred_on) VALUES (gen_random_uuid(),'${T}','${B1}','supplies',2000, CURRENT_DATE)`);
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const svc = new OwnerService(new KyselyOwnerRepository(k));
  const owner: OwnerContext = { tenantId: T, userId: U, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  try {
    const f = await svc.getFinanceSummary(owner);
    ok('revenue $150.00, 2 transactions, avg $75.00 (unpaid + other tenant excluded)', f.totalRevenueCents === 15000 && f.totalTransactions === 2 && f.averageTicketCents === 7500, JSON.stringify({ r: f.totalRevenueCents, t: f.totalTransactions, a: f.averageTicketCents }));
    ok('revenue trend = 100% (prior period empty)', f.revenueTrendPercent === 100);
    ok('recorded expenses $20.00; commission $36.00 tracked separately', f.totalExpensesCents === 2000 && f.totalCommissionCents === 3600, JSON.stringify({ exp: f.totalExpensesCents, com: f.totalCommissionCents }));
    ok('net profit $94.00 (revenue − commission − expenses: 15000 − 3600 − 2000), trend 100%', f.netProfitCents === 9400 && f.profitTrendPercent === 100, String(f.netProfitCents));
    ok('tax $12.00, tips $15.00, discounts $5.00', f.taxCollectedCents === 1200 && f.tipsCents === 1500 && f.discountsCents === 500, JSON.stringify({ tax: f.taxCollectedCents, tip: f.tipsCents, d: f.discountsCents }));

    const pm = await svc.getPaymentMix(owner);
    ok('payment mix total $150.00, 3 methods (pending + other tenant excluded)', pm.totalCents === 15000 && pm.methods.length === 3, JSON.stringify({ t: pm.totalCents, n: pm.methods.length }));
    ok('mix sorted: card $100/66.7%, cash $30/20%, gift_card $20/13.3%', pm.methods[0].method === 'card' && pm.methods[0].percentage === 66.7 && pm.methods[1].method === 'cash' && pm.methods[1].percentage === 20 && pm.methods[2].percentage === 13.3, pm.methods.map((m) => `${m.method}:${m.percentage}`).join());

    const reports = await svc.getReports(owner);
    ok('report catalog = 4 (sales, payment-mix, staff, bookings)', reports.length === 4 && reports.map((r) => r.id).sort().join() === 'bookings,payment-mix,sales,staff', reports.map((r) => r.id).join());

    const sales = await svc.exportReport(owner, 'sales');
    ok('CSV export sales: header + $150.00 / 2 txns row, .csv filename', sales.contentType === 'text/csv' && sales.content.startsWith('Date,Revenue (USD),Transactions') && sales.content.includes('150.00') && sales.filename.endsWith('.csv'), sales.content.split('\r\n')[1]);
    const mixCsv = await svc.exportReport(owner, 'payment-mix');
    ok('CSV export payment-mix: card,100.00,1 present', mixCsv.content.includes('card,100.00,1'), mixCsv.content.replace(/\r\n/g, ' | '));
    const staffCsv = await svc.exportReport(owner, 'staff');
    ok('CSV export staff: Emma sales 90.00 / commission 36.00', staffCsv.content.includes('Emma,2,90.00,36.00'), staffCsv.content.replace(/\r\n/g, ' | '));
    const bookCsv = await svc.exportReport(owner, 'bookings');
    ok('CSV export bookings: header + total row', bookCsv.content.startsWith('Status,Count') && bookCsv.content.includes('total,0'), bookCsv.content.replace(/\r\n/g, ' | '));
    await throws('unknown report id → not_found', () => svc.exportReport(owner, 'nope'), 'not_found');

    ok('MANAGER can view the report catalog (owner.reports.view)', (await svc.getReports({ tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] })).length === 4);
    await throws('permission gate: finance needs owner.finance.view (TECHNICIAN → forbidden)', () => svc.getFinanceSummary({ tenantId: T, userId: U, role: 'TECHNICIAN', permissions: permissionsFor('TECHNICIAN') as string[] }), 'forbidden');
    await throws('permission gate: export needs owner.reports.export (MANAGER lacks it → forbidden)', () => svc.exportReport({ tenantId: T, userId: U, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }, 'sales'), 'forbidden');
  } catch (e: any) {
    ok('harness ran without throwing', false, e?.message || String(e)); console.error(e);
  } finally {
    await k.destroy(); await server.stop(); await db.close();
    console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-owner-finance: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
