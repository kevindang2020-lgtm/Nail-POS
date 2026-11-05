/**
 * totp_replay_check.ts — verifies the production TOTP replay guard against a live Postgres: markTotpStepUsed advances
 * mfa_factors.last_used_step atomically, accepting a strictly-newer step and rejecting a replayed or older one.
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/totp_replay_check.ts   (migration 040 must be applied)
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselySuperAdminTenantsRepo } from '../../../modules/super-admin/src/super-admin-tenants/super-admin-tenants.kysely.repository';
import { KyselyAuthUserRepository } from '../../../modules/identity/src/auth/auth-user.kysely.repository';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => { console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); if (!cond) fails.push(label); };

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const sa = new KyselySuperAdminTenantsRepo(db);
  const auth = new KyselyAuthUserRepository(db);
  const rid = Date.now().toString(36).slice(-6);

  console.log('== TOTP replay guard (live PG) ==');
  const tId = await sa.createTenant({ displayName: 'TOTP Co ' + rid, tenantCode: 'TOTP' + rid, ownerName: 'Olive Owner', ownerEmail: `o+${rid}@totp.test`, plan: 'starter' });
  const owner: any = await db.selectFrom('users').select(['id']).where('tenant_id', '=', tId).where('role', '=', 'OWNER').executeTakeFirst();
  const uid = owner.id as string;
  await db.insertInto('mfa_factors').values({ user_id: uid, type: 'totp', secret_enc: 'enc', confirmed: true } as any).execute();

  ok('first use of step 100 accepted', (await auth.markTotpStepUsed(uid, 100)) === true);
  ok('replay of step 100 rejected', (await auth.markTotpStepUsed(uid, 100)) === false);
  ok('older step 99 rejected', (await auth.markTotpStepUsed(uid, 99)) === false);
  ok('newer step 101 accepted', (await auth.markTotpStepUsed(uid, 101)) === true);
  ok('replay of 101 rejected', (await auth.markTotpStepUsed(uid, 101)) === false);
  ok('no confirmed factor for unknown user -> false', (await auth.markTotpStepUsed('00000000-0000-0000-0000-0000000aa099', 5)) === false);

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL TOTP REPLAY-GUARD CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
