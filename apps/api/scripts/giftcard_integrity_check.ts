/**
 * giftcard_integrity_check.ts — verifies gift-card stored value against a live Postgres via the real checkout repo:
 *   (1) INTEGRITY — the guarded, atomic decrementGift refuses to over-redeem (no clamping), refuses to redeem a voided
 *       card (no resurrection), and redeems exactly to zero (status -> 'redeemed'); and
 *   (2) ISOLATION — two tenants can hold the same gift-card code, and redeeming/voiding one tenant's card never touches
 *       the other tenant's balance.
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/giftcard_integrity_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCheckoutRepository } from '../../../modules/checkout/src/checkout/checkout.kysely.repository';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => { console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); if (!cond) fails.push(label); };

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const repo: any = new KyselyCheckoutRepository(db);
  const rid = Date.now().toString(16).slice(-8).padStart(8, '0');
  const A: any = { tenantId: `${rid}-aaaa-4444-4444-444444444444`, branchId: '00000000-0000-0000-0000-0000000000a1', userId: '00000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: [] };
  const B: any = { tenantId: `${rid}-bbbb-4444-4444-444444444444`, branchId: '00000000-0000-0000-0000-0000000000b1', userId: '00000000-0000-0000-0000-0000000000d1', role: 'OWNER', permissions: [] };
  const CODE = 'GC-' + rid;

  console.log('== gift-card integrity + isolation (live PG) ==');
  await repo.issueGiftCard(A, { code: CODE, amountCents: 5000 });
  await repo.issueGiftCard(B, { code: CODE, amountCents: 5000 }); // same code, different tenant

  const r1 = await repo.decrementGift(A, CODE, 3000);
  ok('valid redeem returns true', r1 === true, 'got ' + r1);
  ok('A balance reduced to 2000', (await repo.giftBalance(A, CODE)) === 2000);
  ok('B balance UNCHANGED at 5000 (tenant isolation on shared code)', (await repo.giftBalance(B, CODE)) === 5000);

  const r2 = await repo.decrementGift(A, CODE, 5000); // more than the remaining 2000
  ok('over-redeem returns false', r2 === false, 'got ' + r2);
  ok('A balance still 2000 (NOT clamped to 0, no phantom redeem)', (await repo.giftBalance(A, CODE)) === 2000);

  await repo.voidGiftCard(A, CODE);
  const r3 = await repo.decrementGift(A, CODE, 1000);
  const voided = await repo.getGiftCard(A, CODE);
  ok('redeem on a voided card returns false', r3 === false, 'got ' + r3);
  ok('voided card stays void with 0 balance (no resurrection)', voided?.status === 'void' && voided?.balanceCents === 0, `${voided?.status}/${voided?.balanceCents}`);
  ok('B balance STILL 5000 after A was voided (isolation)', (await repo.giftBalance(B, CODE)) === 5000);

  const CODE2 = 'GC2-' + rid;
  await repo.issueGiftCard(A, { code: CODE2, amountCents: 4000 });
  const r4 = await repo.decrementGift(A, CODE2, 4000); // exact-to-zero
  const done = await repo.getGiftCard(A, CODE2);
  ok('exact-to-zero redeem returns true', r4 === true, 'got ' + r4);
  ok('card flips to redeemed at 0 balance', done?.status === 'redeemed' && done?.balanceCents === 0, `${done?.status}/${done?.balanceCents}`);

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL GIFT-CARD INTEGRITY + ISOLATION CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
