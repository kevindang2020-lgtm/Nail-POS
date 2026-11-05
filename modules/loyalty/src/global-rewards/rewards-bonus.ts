// rewards-bonus.ts — Customer Profile & Global Loyalty Protection guide (Nov 4 2026) §05: an OWNER-APPROVED bonus award
// to a customer's global points, funded by the awarding salon's prepaid token wallet.
//
// Called only by the approved-request executor (modules/customers loyalty-bonus) inside its transaction, never by a
// route. One posting per approval request (the request id is the source id on every row, and each ledger's unique
// (tenant, source_table, source_id, entry_type) makes a replay a no-op):
//
//   lock the salon's wallet → enough available tokens? (no → nothing moves, NEEDS_FUNDING) → debit exactly the backing
//   → lock the customer's global account → credit the points → one balanced journal entry (merchant prepaid liability
//   → rewards liability, the same accounts a funded earn uses, so the books check's projections stay exact).
//
// Points are global (spendable at any salon); the cost is the central program's: backing = point tenths × cents per tenth
// (10 points = $1.00 at the default policy) — never a client figure, never floating point.
import { sql, type Kysely, type Transaction } from 'kysely';
import { postJournal } from './global-rewards.repository';
import { flagState } from './global-rewards-flags';
import { rewardsIdentityFor } from './rewards-redemption';

type Exec = Transaction<any> | Kysely<any>;
type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
export const BONUS_SOURCE_TABLE = 'tenant_approval_requests';

/** The central conversion in force: cents of salon tokens per point tenth (exact by the program's CHECK). */
export async function bonusCentsPerTenth(x: Exec): Promise<number> {
  const p = (await sql<Row>`SELECT points_per_redeem_block, redeem_block_value_cents FROM global_rewards_program WHERE id = 1`.execute(x)).rows[0];
  if (!p) return 0;
  return n(p.redeem_block_value_cents) / (n(p.points_per_redeem_block) * 10);
}

/** Where a bonus for this customer would go: their verified, opted-in global account (when the salon is on the network),
 *  else null (the salon's own points program). */
export async function bonusGlobalTarget(x: Exec, tenantId: string, customerId: string): Promise<{ identityId: string; centsPerTenth: number } | null> {
  const flags = await flagState(x as Kysely<any>, tenantId);
  if (!flags.engine || !flags.earn) return null;
  const enrolled = (await sql<Row>`SELECT status FROM global_rewards_enrollments WHERE tenant_id = ${tenantId}::uuid`.execute(x)).rows[0];
  if (!enrolled || enrolled.status !== 'enrolled') return null;
  const id = await rewardsIdentityFor(x, tenantId, customerId);
  if (!id.ok) return null;
  const centsPerTenth = await bonusCentsPerTenth(x);
  return centsPerTenth > 0 ? { identityId: id.identityId, centsPerTenth } : null;
}

export type BonusPostResult =
  | { ok: true; replay: boolean; pointTenths: number; backingCents: number; walletAfterCents: number; pointsAfterTenths: number }
  | { ok: false; code: 'NEEDS_FUNDING'; neededCents: number; availableCents: number }
  | { ok: false; code: 'WALLET_NOT_ACTIVE'; status: string };

/** Post one approved bonus: wallet debit + global points credit + journal, all-or-nothing in the caller's transaction. */
export async function postFundedBonus(trx: Transaction<any>, a: { tenantId: string; branchId: string | null; identityId: string; points: number; requestId: string; actorUserId: string | null; reason: string }): Promise<BonusPostResult> {
  const T = a.tenantId;
  const done = (await sql<Row>`SELECT delta_cents, balance_after_cents FROM token_wallet_ledger WHERE tenant_id = ${T}::uuid AND source_table = ${BONUS_SOURCE_TABLE} AND source_id = ${a.requestId} AND entry_type = 'adjustment'`.execute(trx)).rows[0];
  const cpt = await bonusCentsPerTenth(trx);
  const tenths = a.points * 10;
  const backing = tenths * cpt;
  if (done) {   // already posted (a retry): report it, move nothing
    const acct = (await sql<Row>`SELECT available_tenths + reserved_tenths AS t FROM global_rewards_accounts WHERE identity_id = ${a.identityId}::uuid`.execute(trx)).rows[0];
    return { ok: true, replay: true, pointTenths: tenths, backingCents: -n(done.delta_cents), walletAfterCents: n(done.balance_after_cents), pointsAfterTenths: n(acct?.t) };
  }
  const w = (await sql<Row>`SELECT available_cents, status FROM tenant_token_wallets WHERE tenant_id = ${T}::uuid FOR UPDATE`.execute(trx)).rows[0];
  if (w && w.status !== 'active') return { ok: false, code: 'WALLET_NOT_ACTIVE', status: String(w.status) };
  const available = n(w?.available_cents);
  if (!w || available < backing) return { ok: false, code: 'NEEDS_FUNDING', neededCents: backing, availableCents: available };
  const walletAfter = available - backing;
  await sql`UPDATE tenant_token_wallets SET available_cents = ${walletAfter}, lifetime_allocated_cents = lifetime_allocated_cents + ${backing}, version = version + 1, updated_by = ${a.actorUserId}, updated_at = now() WHERE tenant_id = ${T}::uuid`.execute(trx);
  await sql`INSERT INTO token_wallet_ledger (tenant_id, branch_id, entry_type, delta_cents, balance_after_cents, source_table, source_id, actor_user_id, reason)
    VALUES (${T}::uuid, ${a.branchId}, 'adjustment', ${-backing}, ${walletAfter}, ${BONUS_SOURCE_TABLE}, ${a.requestId}, ${a.actorUserId}, ${('Owner-approved bonus: ' + a.reason).slice(0, 300)})`.execute(trx);
  const acct = (await sql<Row>`SELECT available_tenths, reserved_tenths FROM global_rewards_accounts WHERE identity_id = ${a.identityId}::uuid FOR UPDATE`.execute(trx)).rows[0];
  const after = n(acct?.available_tenths) + tenths;
  const totalAfter = after + n(acct?.reserved_tenths);
  await sql`INSERT INTO global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, branch_id, source_table, source_id)
    VALUES (${a.identityId}::uuid, 'adjustment', ${tenths}, ${totalAfter}, ${T}::uuid, ${a.branchId}, ${BONUS_SOURCE_TABLE}, ${a.requestId})`.execute(trx);
  await sql`UPDATE global_rewards_accounts SET available_tenths = ${after}, lifetime_earned_tenths = lifetime_earned_tenths + ${tenths}, version = version + 1, updated_at = now() WHERE identity_id = ${a.identityId}::uuid`.execute(trx);
  await postJournal(trx, { entryType: 'bonus_award', tenantId: T, sourceTable: BONUS_SOURCE_TABLE, sourceId: a.requestId, memo: `Owner-approved bonus of ${a.points} points`,
    lines: [{ account: 'merchant_prepaid_liability', tenantId: T, debit: backing }, { account: 'rewards_liability', tenantId: null, credit: backing }] });
  return { ok: true, replay: false, pointTenths: tenths, backingCents: backing, walletAfterCents: walletAfter, pointsAfterTenths: totalAfter };
}
