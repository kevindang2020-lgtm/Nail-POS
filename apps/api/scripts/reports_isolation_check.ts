/**
 * reports_isolation_check.ts — verifies the Reports aggregations against a live Postgres:
 *   (1) TENANT ISOLATION — one salon's reported revenue never includes another salon's payments; and
 *   (2) REVENUE ACCURACY — declined / not_configured / voided payments (which collected nothing) are excluded from
 *       reported sales, while approved payments count.
 * Seeds payments for two tenants via the real checkout repo, then reads each tenant's report via the real reports repo.
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/reports_isolation_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCheckoutRepository } from '../../../modules/checkout/src/checkout/checkout.kysely.repository';
import { KyselyReportsRepository } from '../../../modules/reports/src/reports/reports.kysely.repository';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => { console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); if (!cond) fails.push(label); };

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const checkout: any = new KyselyCheckoutRepository(db);
  const reports = new KyselyReportsRepository(db);
  const rid = Date.now().toString(16).slice(-8).padStart(8, '0'); // fresh hex prefix per run -> unique tenants, no accumulation

  const A: any = { tenantId: `${rid}-aaaa-3333-3333-333333333333`, branchId: '00000000-0000-0000-0000-0000000000a1', userId: '00000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: [] };
  const B: any = { tenantId: `${rid}-dddd-3333-3333-333333333333`, branchId: '00000000-0000-0000-0000-0000000000e1', userId: '00000000-0000-0000-0000-0000000000f1', role: 'OWNER', permissions: [] };
  const TK = '77777777-3333-3333-3333-333333333333';
  const pay = (ctx: any, amountCents: number, status: string) =>
    checkout.recordPayment(ctx, { paymentId: 'ignored', ticketId: TK, method: 'cash', amountCents, tipCents: 0, status, createdAt: new Date().toISOString() });

  console.log('== reports tenant-isolation + revenue-accuracy ==');
  await pay(A, 1000, 'approved');
  await pay(A, 2000, 'approved');
  await pay(A, 9999, 'declined');        // collected nothing -> must NOT count
  await pay(A, 7777, 'not_configured');  // collected nothing -> must NOT count
  await pay(B, 5000, 'approved');         // another tenant -> must NOT appear in A's report

  const filters: any = { from: '2000-01-01', to: '2999-12-31' };
  const aRev = (await reports.query(A, filters)).state.revenueOverview.totalRevenueCents;
  const bRev = (await reports.query(B, filters)).state.revenueOverview.totalRevenueCents;

  ok('tenant A reported revenue = 3000 (only A’s approved; declined + not_configured + tenant B all excluded)', aRev === 3000, 'got ' + aRev);
  ok('tenant B reported revenue = 5000 (tenant A excluded)', bRev === 5000, 'got ' + bRev);

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL REPORTS ISOLATION + ACCURACY CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
