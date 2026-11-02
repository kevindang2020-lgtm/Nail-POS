/**
 * super_admin_isolation_check.ts — verifies that Super Admin tenant-targeted WRITES are pinned to the route's tenant and
 * never spill onto another tenant. Super Admin scope is intentionally broad (cross-tenant by design), so a write that
 * forgets its `WHERE id = :id` would be high-blast-radius. Seeds two tenants via the real repo, then mutates ONLY tenant A
 * and asserts tenant B is untouched.
 *   (Authz — a tenant-role user getting 403 on /super-admin/* — is covered end-to-end by gateway_admin_check.py, since the
 *    SuperAdminGuard is applied class-wide to every super-admin controller.)
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/super_admin_isolation_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselySuperAdminTenantsRepo } from '../../../modules/super-admin/src/super-admin-tenants/super-admin-tenants.kysely.repository';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => { console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`); if (!cond) fails.push(label); };

async function ownerHash(db: Kysely<DB>, tenantId: string): Promise<string | null> {
  const r: any = await db.selectFrom('users').select(['password_hash']).where('tenant_id', '=', tenantId).where('role', '=', 'OWNER').executeTakeFirst().catch(() => undefined);
  return r ? (r.password_hash ?? null) : null;
}

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const repo = new KyselySuperAdminTenantsRepo(db);
  const rid = Date.now().toString(36).slice(-6);

  console.log('== super-admin tenant-targeted write scoping ==');
  const aId = await repo.createTenant({ displayName: 'Alpha Nails ' + rid, tenantCode: 'ALPHA' + rid, ownerName: 'Ada Alpha', ownerEmail: `ada+${rid}@alpha.test`, plan: 'starter' });
  const bId = await repo.createTenant({ displayName: 'Bravo Nails ' + rid, tenantCode: 'BRAVO' + rid, ownerName: 'Ben Bravo', ownerEmail: `ben+${rid}@bravo.test`, plan: 'starter' });
  ok('two distinct tenants created', !!aId && !!bId && aId !== bId, `${aId} / ${bId}`);

  // 1) lifecycle change on A must not touch B
  await repo.setStatus(aId, 'suspended', { reason: 'audit probe', byUserId: 'probe' } as any);
  const aRec: any = await repo.getTenantRecord(aId);
  const bRec: any = await repo.getTenantRecord(bId);
  ok('A is suspended after setStatus(A)', aRec?.storedStatus === 'suspended', aRec?.storedStatus);
  ok('B is UNCHANGED (still pending) — lifecycle write is tenant-pinned', bRec?.storedStatus === 'pending', bRec?.storedStatus);

  // 2) owner-password reset on A must not touch B's owner
  const bHashBefore = await ownerHash(db, bId);
  const reset = await repo.resetOwnerPassword(aId);
  const aHashAfter = await ownerHash(db, aId);
  const bHashAfter = await ownerHash(db, bId);
  ok('reset targets A’s owner (email matches A)', reset?.ownerEmail === `ada+${rid}@alpha.test`, reset?.ownerEmail || '(null)');
  ok('A’s owner password was set by the reset', !!aHashAfter);
  ok('B’s owner password is UNCHANGED — reset is tenant-pinned', bHashAfter === bHashBefore, `before=${bHashBefore === null ? 'null' : 'set'} after=${bHashAfter === null ? 'null' : 'set'}`);

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL SUPER-ADMIN WRITE-SCOPING CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
