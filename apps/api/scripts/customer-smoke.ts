/* customer-smoke.ts — exercises the new KyselyCustomerRepository against live Postgres (no HTTP server).
 * Reads seeded ids from /tmp/ids.txt (tenant, branch, owner-user used as the linked customer's user_id). */
import { readFileSync } from 'node:fs';
import { createDatabase } from '../../../packages/database/src/kysely.provider';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';

const [TENANT, BRANCH, OWNER] = readFileSync('/tmp/ids.txt', 'utf8').trim().split('\n');
const ctx: any = { tenantId: TENANT, branchId: BRANCH, userId: OWNER, role: 'CUSTOMER', permissions: [] };

let pass = 0, fail = 0;
async function run(name: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); pass++; console.log(`✅ ${name}: ${r === undefined ? 'ok (void)' : JSON.stringify(r).slice(0, 240)}`); }
  catch (e: any) { fail++; console.log(`❌ ${name}: ${e?.message || e}`); }
}

(async () => {
  const db = createDatabase(); if (!db) { console.log('NO DB'); process.exit(1); }
  const repo = new KyselyCustomerRepository(db);
  const id = await repo.resolveCustomerId(ctx);
  console.log(`resolveCustomerId → ${id}`);
  if (!id) { console.log('❌ customer not resolved — link missing'); await db.destroy(); process.exit(2); }
  pass++;
  await run('getLoyaltyConfig', () => repo.getLoyaltyConfig());
  await run('loyaltyPoints',    () => repo.loyaltyPoints(ctx, id));
  await run('homeRaw',          () => repo.homeRaw(ctx, id));
  await run('appointments',     () => repo.appointments(ctx, id));
  await run('receipts',         () => repo.receipts(ctx, id));
  await run('activeService',    () => repo.activeService(ctx, id));
  await run('updateProfile',    () => repo.updateProfile(ctx, id, { smsOptIn: true, emailOptIn: false, phone: '(856) 555-0199' }));
  // confirm the write landed
  const after = await db.selectFrom('customers').select(['phone_display', 'marketing_sms_opt_in']).where('id', '=', id).executeTakeFirst();
  console.log(`after updateProfile → ${JSON.stringify(after)}`);
  await db.destroy();
  console.log(`\n=== customer smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 2 : 0);
})();
