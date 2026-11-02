/**
 * giftcard_split_atomic_check.ts — verifies that recordSplitAtomic settles a split payment in ONE transaction:
 *   • FAILURE: if a later gift segment can't be redeemed (over-redeem), the whole settlement rolls back — the earlier
 *     segment's gift decrement is undone and NO payment rows are written;
 *   • SUCCESS: a valid split commits all gift decrements + payment rows together.
 * Drives the repo method directly (bypassing the service's pre-validation) to force the mid-split failure.
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/giftcard_split_atomic_check.ts
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
  const A: any = { tenantId: `${rid}-aaaa-5555-5555-555555555555`, branchId: '00000000-0000-0000-0000-0000000000a1', userId: '00000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: [] };
  const TK = `${rid}-7777-5555-5555-555555555555`;
  const GA = 'GCA-' + rid, GB = 'GCB-' + rid;
  const bal = async (code: string) => { const c = await repo.getGiftCard(A, code); return c ? c.balanceCents : null; };
  const payCount = async () => { const r: any = await db.selectFrom('payments').select((eb: any) => eb.fn.countAll().as('n')).where('tenant_id', '=', A.tenantId).where('ticket_id', '=', TK).executeTakeFirst().catch(() => undefined); return r ? Number(r.n) : -1; };

  console.log('== split settlement atomicity (live PG) ==');
  await repo.issueGiftCard(A, { code: GA, amountCents: 5000 });
  await repo.issueGiftCard(A, { code: GB, amountCents: 2000 });

  // FAILURE: second gift segment over-redeems (only 2000 on GB) -> must roll the whole thing back
  let threw = false;
  try { await repo.recordSplitAtomic(A, TK, [{ method: 'gift_card', amountCents: 3000, giftCardCode: GA }, { method: 'gift_card', amountCents: 9999, giftCardCode: GB }], {}); }
  catch { threw = true; }
  ok('over-redeem split throws', threw);
  ok('GA rolled back to 5000 (first decrement undone)', (await bal(GA)) === 5000, 'got ' + await bal(GA));
  ok('GB untouched at 2000', (await bal(GB)) === 2000, 'got ' + await bal(GB));
  ok('NO payment rows written on rollback', (await payCount()) === 0, 'count ' + await payCount());

  // SUCCESS: a valid split commits everything
  const recs = await repo.recordSplitAtomic(A, TK, [{ method: 'gift_card', amountCents: 3000, giftCardCode: GA }, { method: 'gift_card', amountCents: 2000, giftCardCode: GB }], {});
  ok('valid split returns 2 payment records', Array.isArray(recs) && recs.length === 2, 'len ' + (recs?.length));
  ok('GA now 2000', (await bal(GA)) === 2000, 'got ' + await bal(GA));
  ok('GB now 0', (await bal(GB)) === 0, 'got ' + await bal(GB));
  ok('2 payment rows committed', (await payCount()) === 2, 'count ' + await payCount());

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL SPLIT-ATOMICITY CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
