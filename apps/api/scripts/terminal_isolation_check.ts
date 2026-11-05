/**
 * terminal_isolation_check.ts — verifies per-tenant/branch terminal-pairing ISOLATION against a live Postgres.
 * Drives KyselyTerminalPairingRepository directly against `pos_payment_terminals`: a terminal paired by one tenant
 * (and branch) can never be listed, tested, unpaired, or overwritten by another tenant — and the SAME terminal id under
 * a different tenant is a distinct, independent row. Also proves pairing PERSISTS (a fresh repo instance sees it).
 *
 *   DATABASE_URL=postgres://… npx tsx apps/api/scripts/terminal_isolation_check.ts
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import type { SettingsContext } from '../../../modules/tenants/src/settings/settings.dto';
import { KyselyTerminalPairingRepository } from '../../../modules/tenants/src/settings/settings.terminals.kysely.repository';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`   ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails.push(label);
};
async function threw(fn: () => Promise<unknown>): Promise<boolean> { try { await fn(); return false; } catch { return true; } }

async function main() {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
  const repo = new KyselyTerminalPairingRepository(db);
  const rid = Date.now().toString().slice(-6);

  const A: SettingsContext = { tenantId: 'TA' + rid, branchId: 'brA', userId: 'u', role: 'OWNER', permissions: [] };
  const Ab2: SettingsContext = { ...A, branchId: 'brB' };           // same tenant, DIFFERENT branch
  const B: SettingsContext = { tenantId: 'TB' + rid, branchId: 'brB', userId: 'u', role: 'OWNER', permissions: [] };
  const CODE = '111111'; const ID = 'term_' + CODE;

  console.log('== terminal pairing isolation (tenant + branch) ==');

  // tenant A pairs a terminal
  const ta = await repo.pair(A, CODE, 'Front A', 'stA');
  ok('tenant A pairs a terminal', ta.status === 'paired' && ta.id === ID, ta.id);
  ok('A list shows its terminal', (await repo.list(A)).some((t) => t.id === ID));
  ok('A test reachable when paired', (await repo.test(A, ID)).reachable === true);

  // persistence: a FRESH repo instance over the same DB still sees it (not in-memory)
  const repo2 = new KyselyTerminalPairingRepository(db);
  ok('pairing persisted (a fresh repo instance sees it)', (await repo2.list(A)).some((t) => t.id === ID));

  // cross-tenant isolation: B (different tenant) cannot see/test/unpair A's terminal even with the SAME id
  ok("tenant B does NOT see A's terminal", (await repo.list(B)).length === 0);
  ok("tenant B cannot test A's terminal (not found)", await threw(() => repo.test(B, ID)));
  ok("tenant B cannot unpair A's terminal (not found)", await threw(() => repo.unpair(B, ID)));

  // B pairs its OWN terminal with the SAME id -> distinct row; A unaffected
  const tb = await repo.pair(B, CODE, 'Front B', 'stB');
  ok('tenant B pairs its own terminal with the same id', tb.id === ID);
  const listA = await repo.list(A); const listB = await repo.list(B);
  ok('A still sees only its own one terminal', listA.length === 1 && listA[0].label === 'Front A', `${listA.length}`);
  ok('B sees only its own one terminal', listB.length === 1 && listB[0].label === 'Front B', `${listB.length}`);
  ok("A's terminal is unaffected by B (still paired)", (await repo.test(A, ID)).reachable === true);

  // branch scoping within tenant A: brB has no terminal
  ok('same tenant, different branch does NOT see the brA terminal', (await repo.list(Ab2)).length === 0);
  ok('same tenant, other branch cannot test the brA terminal', await threw(() => repo.test(Ab2, ID)));

  // unpair within A is independent of B
  const un = await repo.unpair(A, ID);
  ok('A unpairs its terminal', un.status === 'unpaired');
  ok('A test now not reachable', (await repo.test(A, ID)).reachable === false);
  ok('B terminal still paired after A unpaired (independent)', (await repo.test(B, ID)).reachable === true);

  // validation still enforced
  ok('bad pairing code rejected', await threw(() => repo.pair(A, 'abc', 'X')));

  console.log('\n== RESULT ==');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join('; ')}` : 'ALL TERMINAL ISOLATION CHECKS PASSED ✓');
  await db.destroy();
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
