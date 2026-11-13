// rewards-redemption.ts — cross-salon redemption at Checkout + reimbursement payables (Final Completion guide §03–§05;
// LoyaltyTokens.pdf §6.4–§6.5, §7.4, §8.2). Every function runs inside the CALLER's transaction, so the tender row on the
// ticket and the point hold commit (or roll back) together.
//
//   hold        verified, opted-in customer → whole redemption blocks (10 points = $1), capped at what the ticket still
//               owes → ONE atomic compare-and-swap on the customer's account (available ≥ p → available −p, held +p). Two
//               salons racing for the same points: exactly one CAS succeeds; the other gets REWARDS_POINTS_INSUFFICIENT.
//   release     HELD → RELEASED (cashier removed it / ticket edited) or EXPIRED (deadline, ticket never paid); held → available.
//   finalize    on the authoritative paid-ticket event: HELD → CONFIRMED_REDEEMED once; points leave the account (ledger
//               'redeem'); the REDEEMING salon is owed the value (merchant_reimbursements ACCRUED_OWED); journal moves the
//               value from customer rewards liability to reimbursement payable. No token debit for accepting points.
//   reverse     a refund of the reward tender: points come back (ledger 'redeem_reversal'), the payable is ADJUSTED while
//               still owed, or — when it was already PAID — an OFFSET recovery claim is recorded. Nothing is rewritten.
//   payouts     PAID only through a payout provider's verified settlement (DB trigger + CHECK). No provider is approved:
//               requestPayout answers PAYOUT_PROVIDER_UNAVAILABLE (BLOCKED_EXTERNAL) and the payable stays owed.
import { sql, type Transaction, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { GlobalRewardsError, computeEarn, redeemableBlocks, tenthsLabel, dollarsLabel, centsPerPointTenth, isOwed } from './global-rewards-core';
import { GlobalRewardsRepository, postJournal, recordIdempotencyEvent } from './global-rewards.repository';
import { flagState } from './global-rewards-flags';
import { REWARD_REDEMPTION, MERCHANT_REIMBURSEMENT } from './global-rewards-lifecycles';

type Row = Record<string, any>;
type Exec = Transaction<any> | Kysely<any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export interface RedeemCtx { tenantId: string; branchId: string | null; userId: string | null; role?: string | null }

/** The redeeming salon's customer → their verified, opted-in global identity (or the reason there is none). Tenant-scoped:
 *  only a link THIS salon holds can be used; nothing about other salons is read or returned. */
export async function rewardsIdentityFor(x: Exec, tenantId: string, customerId: string): Promise<{ ok: true; identityId: string } | { ok: false; code: 'REWARDS_IDENTITY_NOT_VERIFIED' | 'REWARDS_NOT_OPTED_IN' }> {
  const r = (await sql<Row>`SELECT ci.id, ci.phone_verified_at, ga.status, ga.withdrawn_at, ga.opted_in_at FROM customer_identity_links l
      JOIN customer_identities ci ON ci.id = l.identity_id LEFT JOIN global_rewards_accounts ga ON ga.identity_id = ci.id
      WHERE l.tenant_id = ${tenantId}::uuid AND l.customer_id = ${customerId}::uuid ORDER BY ci.phone_verified_at DESC NULLS LAST LIMIT 1`.execute(x)).rows[0];
  if (!r || !r.phone_verified_at) return { ok: false, code: 'REWARDS_IDENTITY_NOT_VERIFIED' };
  if (!r.status || r.status !== 'active' || r.withdrawn_at || !r.opted_in_at) return { ok: false, code: 'REWARDS_NOT_OPTED_IN' };
  return { ok: true, identityId: String(r.id) };
}

/** What the cashier may apply right now (no write). The customer's balance is shown only to the salon serving them. */
export async function redemptionQuote(x: Exec, repo: GlobalRewardsRepository, a: { tenantId: string; customerId: string | null; dueCents: number }) {
  const program = await repo.program(x);
  const base = { pointsPerRedeemBlock: program.pointsPerRedeemBlock, redeemBlockValueCents: program.redeemBlockValueCents };
  const blocked = (code: string, reason: string) => ({ available: false as const, code, reason, ...base });
  const f = await flagState(repo.database, a.tenantId);
  if (!f.engine || !f.redemption) return blocked('LOYALTY_DISABLED', 'redemption_flag_off');
  if (program.redeemPaused) return blocked('LOYALTY_DISABLED', 'program_redemption_paused');
  const e = await repo.enrollment(x, a.tenantId);
  if (e.status !== 'enrolled') return blocked('MERCHANT_NOT_ENROLLED', 'salon_not_enrolled');
  if (!a.customerId) return blocked('REWARDS_IDENTITY_NOT_VERIFIED', 'no_customer');
  const id = await rewardsIdentityFor(x, a.tenantId, a.customerId);
  if (!id.ok) return blocked(id.code, id.code === 'REWARDS_NOT_OPTED_IN' ? 'not_opted_in' : 'identity_not_verified');
  const acct = (await sql<Row>`SELECT ga.available_tenths, ga.reserved_tenths FROM global_rewards_accounts ga WHERE ga.identity_id = ${id.identityId}::uuid`.execute(x)).rows[0];
  const max = redeemableBlocks(n(acct?.available_tenths), a.dueCents, program);
  return { available: true as const, availableTenths: n(acct?.available_tenths), heldTenths: n(acct?.reserved_tenths), maxBlocks: max.blocks, maxPointTenths: max.pointTenths, maxValueCents: max.valueCents, ...base };
}

/** C1 audit (Nov 4 2026) — guide §4.3: what this sale is expected to EARN, shown at Checkout before payment. An estimate from
 *  the rule in force now and the eligible amount so far (services and retail after discounts; tax, tips, gift cards bought and
 *  reward tenders never earn); the real earning is decided when the ticket is paid. Never writes. */
export async function earnEstimate(x: Exec, repo: GlobalRewardsRepository, a: { tenantId: string; customerId: string | null; eligibleCents: number }) {
  const no = (reason: string) => ({ available: false as const, reason });
  if (!a.customerId) return no('no_customer');
  const id = await rewardsIdentityFor(x, a.tenantId, a.customerId);
  if (!id.ok) return no(id.code === 'REWARDS_NOT_OPTED_IN' ? 'not_opted_in' : 'identity_not_verified');
  const resolved = await repo.resolveEarningRule(x, a.tenantId, new Date());
  if (!resolved.ok) return no(resolved.reason);
  const calc = computeEarn(Math.max(0, Math.floor(a.eligibleCents)), resolved.rule, resolved.program);
  return { available: true as const, eligibleCents: Math.max(0, Math.floor(a.eligibleCents)), pointTenths: calc.pointTenths, belowMinimum: calc.belowMinimum,
    ruleSource: resolved.rule.source, spendIncrementCents: resolved.rule.spendIncrementCents, pointTenthsPerIncrement: resolved.rule.pointTenthsPerIncrement, estimate: true as const };
}

/**
 * Place a hold for `blocks` redemption blocks on this ticket, paired with the tender row `paymentId` the caller writes in the
 * SAME transaction. Idempotent per (salon, idempotencyKey): a retry returns the same hold; a different amount under the same
 * key is refused. Returns the value applied (cents).
 */
export async function holdForTicket(trx: Transaction<any>, repo: GlobalRewardsRepository, c: RedeemCtx,
  a: { ticketId: string; customerId: string; blocks: number; dueCents: number; paymentId: string; idempotencyKey: string }): Promise<{ redemptionId: string; pointTenths: number; valueCents: number; expiresAt: string; replay: boolean }> {
  const T = c.tenantId;
  if (!Number.isInteger(a.blocks) || a.blocks < 1) throw new GlobalRewardsError('Choose at least one reward block.', 'VALIDATION_FAILED', 400, { field: 'blocks' });
  if (!a.idempotencyKey || a.idempotencyKey.length > 200) throw new GlobalRewardsError('A request key is required.', 'VALIDATION_FAILED', 400, { field: 'idempotencyKey' });
  const program = await repo.program(trx);
  const prior = (await sql<Row>`SELECT r.id, r.point_tenths, r.value_cents, r.expires_at, r.status FROM reward_redemptions r WHERE r.tenant_id = ${T}::uuid AND r.idempotency_key = ${a.idempotencyKey}`.execute(trx)).rows[0];
  const pointTenths = a.blocks * program.pointsPerRedeemBlock * 10;
  if (prior) {
    // extras GLOBAL LOYALTY REWARDS 11: a replay is recorded in the same transaction (it commits with the answer). A conflicting
    // reuse is refused (409) and rolls the whole checkout transaction back — with it any row written here, so it is not recorded
    if (n(prior.point_tenths) === pointTenths) await recordIdempotencyEvent(trx, { tenantId: T, scope: 'redemption', outcome: 'replay', key: a.idempotencyKey, resourceId: String(prior.id), detail: { status: prior.status } });
    if (n(prior.point_tenths) !== pointTenths) throw new GlobalRewardsError('That request key was already used for a different reward.', 'IDEMPOTENCY_KEY_REUSED', 409);
    return { redemptionId: String(prior.id), pointTenths, valueCents: n(prior.value_cents), expiresAt: iso(prior.expires_at)!, replay: true };
  }
  const q = await redemptionQuote(trx, repo, { tenantId: T, customerId: a.customerId, dueCents: a.dueCents });
  if (!q.available) throw new GlobalRewardsError(q.code === 'REWARDS_NOT_OPTED_IN' ? 'This customer has not joined AI PowerSalon Rewards.' : q.code === 'REWARDS_IDENTITY_NOT_VERIFIED' ? 'This customer needs a verified rewards account first.' : 'Rewards cannot be used here right now.', q.code, 403, { reason: q.reason });
  const valueCents = a.blocks * program.redeemBlockValueCents;
  if (valueCents > a.dueCents) throw new GlobalRewardsError('The reward is larger than what the ticket still owes.', 'VALIDATION_FAILED', 400, { field: 'blocks', dueCents: a.dueCents });
  const id = (await rewardsIdentityFor(trx, T, a.customerId)) as { ok: true; identityId: string };
  // the ONE atomic step that makes double spending impossible: available never goes below zero (CHECK + this predicate)
  const cas = (await sql<Row>`UPDATE global_rewards_accounts ga SET available_tenths = ga.available_tenths - ${pointTenths}, reserved_tenths = ga.reserved_tenths + ${pointTenths},
      version = ga.version + 1, updated_at = now()
    WHERE ga.identity_id = ${id.identityId}::uuid AND ga.status = 'active' AND ga.withdrawn_at IS NULL AND ga.available_tenths >= ${pointTenths} RETURNING ga.available_tenths`.execute(trx)).rows[0];
  if (!cas) throw new GlobalRewardsError('The customer does not have enough points for that reward.', 'REWARDS_POINTS_INSUFFICIENT', 409);
  let row: Row | undefined;
  try {
    row = (await sql<Row>`INSERT INTO reward_redemptions (tenant_id, branch_id, ticket_id, identity_id, customer_id, payment_id, point_tenths, value_cents, status, idempotency_key, expires_at, reserved_by, updated_by)
      VALUES (${T}::uuid, ${c.branchId}, ${a.ticketId}::uuid, ${id.identityId}::uuid, ${a.customerId}::uuid, ${a.paymentId}::uuid, ${pointTenths}, ${valueCents}, 'HELD', ${a.idempotencyKey},
        now() + make_interval(secs => ${program.reservationTtlSeconds}), ${c.userId}, ${c.userId}) RETURNING id, expires_at`.execute(trx)).rows[0];
  } catch (e: any) {
    if (String(e?.code) === '23505') throw new GlobalRewardsError('This ticket already has a reward applied.', 'REWARD_RESERVATION_CONFLICT', 409);
    throw e;
  }
  await recordAuditStrict(trx, { tenantId: T, branchId: c.branchId, userId: c.userId, role: c.role ?? null }, { module: 'loyalty', action: 'loyalty.redemption.held',
    summary: `Held ${tenthsLabel(pointTenths)} global points (${dollarsLabel(valueCents)}) on a ticket`, resourceType: 'reward_redemption', resourceId: String(row!.id), reason: null,
    metadata: { ticketId: a.ticketId, paymentId: a.paymentId }, before: null, after: { status: 'HELD', pointTenths, valueCents } });
  return { redemptionId: String(row!.id), pointTenths, valueCents, expiresAt: iso(row!.expires_at)!, replay: false };
}

/** HELD → RELEASED / EXPIRED (one terminal action wins). Returns the released hold, or null when it was not HELD. */
export async function releaseHold(trx: Transaction<any>, c: { tenantId: string; userId: string | null }, a: { redemptionId: string; to: 'RELEASED' | 'EXPIRED'; reason: string }): Promise<{ redemptionId: string; paymentId: string | null; pointTenths: number } | null> {
  const r = (await sql<Row>`UPDATE reward_redemptions r SET status = ${a.to}, released_at = now(), release_reason = ${a.reason}, updated_by = ${c.userId}, updated_at = now(), row_version = r.row_version + 1
    WHERE r.tenant_id = ${c.tenantId}::uuid AND r.id = ${a.redemptionId}::uuid AND ${canMoveToSql(REWARD_REDEMPTION, a.to, 'r')} RETURNING r.id, r.identity_id, r.point_tenths, r.payment_id`.execute(trx)).rows[0];
  if (!r) return null;
  await sql`UPDATE global_rewards_accounts ga SET available_tenths = ga.available_tenths + ${n(r.point_tenths)}, reserved_tenths = ga.reserved_tenths - ${n(r.point_tenths)}, version = ga.version + 1, updated_at = now()
    WHERE ga.identity_id = ${r.identity_id}::uuid`.execute(trx);
  return { redemptionId: String(r.id), paymentId: r.payment_id ? String(r.payment_id) : null, pointTenths: n(r.point_tenths) };
}

/**
 * The paid-ticket event finalizes the ticket's held reward exactly once (a retried / duplicated event finds nothing HELD).
 * Requires the ticket to be PAID and the reward tender row to still be approved — otherwise nothing is confirmed (an
 * expired/released hold is never confirmed; a paid ticket whose hold is gone is a FAILED finding for the books check).
 */
export async function finalizeForPaidTicket(trx: Transaction<any>, repo: GlobalRewardsRepository, a: { tenantId: string; ticketId: string; eventId?: string | null }): Promise<{ outcome: 'confirmed' | 'none' | 'not_paid' | 'tender_not_approved'; redemptionId?: string; payableId?: string }> {
  const T = a.tenantId;
  const h = (await sql<Row>`SELECT r.id, r.identity_id, r.branch_id, r.point_tenths, r.value_cents, r.payment_id FROM reward_redemptions r
    WHERE r.tenant_id = ${T}::uuid AND r.ticket_id = ${a.ticketId}::uuid AND r.status = 'HELD' FOR UPDATE`.execute(trx)).rows[0];
  if (!h) return { outcome: 'none' };
  const t = (await sql<Row>`SELECT t.status FROM tickets t WHERE t.id = ${a.ticketId}::uuid AND t.tenant_id = ${T}::uuid`.execute(trx)).rows[0];
  if (!t || t.status !== 'paid') return { outcome: 'not_paid' };
  const p = h.payment_id ? (await sql<Row>`SELECT p.status FROM payments p WHERE p.id = ${h.payment_id}::uuid AND p.tenant_id = ${T}::uuid`.execute(trx)).rows[0] : null;
  if (!p || !['approved', 'partial'].includes(String(p.status))) return { outcome: 'tender_not_approved' };
  const up = (await sql<Row>`UPDATE reward_redemptions r SET status = 'CONFIRMED_REDEEMED', confirmed_at = now(), committed_at = now(), correlation_id = ${a.eventId ?? null}, updated_at = now(), row_version = r.row_version + 1
    WHERE r.id = ${h.id}::uuid AND r.tenant_id = ${T}::uuid AND ${canMoveToSql(REWARD_REDEMPTION, 'CONFIRMED_REDEEMED', 'r')} RETURNING r.id`.execute(trx)).rows[0];
  if (!up) return { outcome: 'none' };
  const tenths = n(h.point_tenths), cents = n(h.value_cents);
  const acct = (await sql<Row>`UPDATE global_rewards_accounts ga SET reserved_tenths = ga.reserved_tenths - ${tenths}, lifetime_redeemed_tenths = ga.lifetime_redeemed_tenths + ${tenths}, version = ga.version + 1, updated_at = now()
    WHERE ga.identity_id = ${h.identity_id}::uuid RETURNING ga.available_tenths, ga.reserved_tenths`.execute(trx)).rows[0];
  await sql`INSERT INTO global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, branch_id, source_table, source_id)
    VALUES (${h.identity_id}::uuid, 'redeem', ${-tenths}, ${n(acct.available_tenths) + n(acct.reserved_tenths)}, ${T}::uuid, ${h.branch_id ?? null}, 'reward_redemptions', ${String(h.id)})`.execute(trx);
  const mr = (await sql<Row>`INSERT INTO merchant_reimbursements (tenant_id, branch_id, ticket_id, redemption_id, amount_cents, status, reason)
    VALUES (${T}::uuid, ${h.branch_id ?? null}, ${a.ticketId}::uuid, ${h.id}::uuid, ${cents}, 'ACCRUED_OWED', 'Global points accepted at checkout') RETURNING id`.execute(trx)).rows[0];
  await postJournal(trx, { entryType: 'redemption_committed', tenantId: T, sourceTable: 'reward_redemptions', sourceId: String(h.id), memo: `Redeemed ${tenthsLabel(tenths)} points (${dollarsLabel(cents)})`,
    lines: [{ account: 'rewards_liability', tenantId: null, debit: cents }, { account: 'reimbursement_payable', tenantId: T, credit: cents }] });
  void repo;
  return { outcome: 'confirmed', redemptionId: String(h.id), payableId: String(mr.id) };
}

/**
 * A refund of the reward tender (cumulative refunded cents on that payment) → compensating entries, at most once per refund.
 * Points return to the customer; the payable is reduced while still owed (ADJUSTED when fully reversed), or — if it was
 * already PAID — an OFFSET recovery claim is recorded. While a payout is in flight the payable goes ON_HOLD for finance.
 */
export async function reverseRedemptionForRefund(trx: Transaction<any>, program: { pointsPerRedeemBlock: number; redeemBlockValueCents: number }, a: { tenantId: string; rewardPaymentId: string; refundId: string; refundedCents: number }): Promise<{ outcome: 'reversed' | 'none' | 'duplicate'; cents?: number; payable?: string }> {
  const T = a.tenantId;
  const r = (await sql<Row>`SELECT r.id, r.identity_id, r.branch_id, r.point_tenths, r.value_cents, r.reversed_cents, r.reversed_tenths, r.status FROM reward_redemptions r
    WHERE r.tenant_id = ${T}::uuid AND r.payment_id = ${a.rewardPaymentId}::uuid AND r.status IN ('CONFIRMED_REDEEMED', 'REVERSED') FOR UPDATE`.execute(trx)).rows[0];
  if (!r) return { outcome: 'none' };
  const cpt = centsPerPointTenth(program);
  const target = Math.min(n(r.value_cents), Math.max(0, Math.floor(a.refundedCents)));
  const deltaCents = target - n(r.reversed_cents);
  if (deltaCents <= 0) return { outcome: 'duplicate' };
  const deltaTenths = Math.floor(deltaCents / cpt);
  // points back first (ledger source = this refund: a replayed refund event hits the unique key and changes nothing)
  const led = (await sql<Row>`INSERT INTO global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, branch_id, source_table, source_id)
    SELECT ${r.identity_id}::uuid, 'redeem_reversal', ${deltaTenths}, ga.available_tenths + ga.reserved_tenths + ${deltaTenths}, ${T}::uuid, ${r.branch_id ?? null}, 'payment_refunds', ${a.refundId}
    FROM global_rewards_accounts ga WHERE ga.identity_id = ${r.identity_id}::uuid
    ON CONFLICT ON CONSTRAINT uq_gpl_source DO NOTHING RETURNING id`.execute(trx)).rows[0];
  if (!led) return { outcome: 'duplicate' };
  await sql`UPDATE global_rewards_accounts ga SET available_tenths = ga.available_tenths + ${deltaTenths}, lifetime_redeemed_tenths = ga.lifetime_redeemed_tenths - ${deltaTenths}, version = ga.version + 1, updated_at = now()
    WHERE ga.identity_id = ${r.identity_id}::uuid`.execute(trx);
  const full = target === n(r.value_cents);
  await sql`UPDATE reward_redemptions r SET reversed_cents = ${target}, reversed_tenths = r.reversed_tenths + ${deltaTenths}, updated_at = now(), row_version = r.row_version + 1,
      status = ${full ? sql`CASE WHEN ${canMoveToSql(REWARD_REDEMPTION, 'REVERSED', 'r')} THEN 'REVERSED' ELSE r.status END` : sql`r.status`}
    WHERE r.id = ${r.id}::uuid AND r.tenant_id = ${T}::uuid`.execute(trx);
  const mr = (await sql<Row>`SELECT m.id, m.status, m.amount_cents, m.adjusted_cents FROM merchant_reimbursements m WHERE m.redemption_id = ${r.id}::uuid AND m.tenant_id = ${T}::uuid FOR UPDATE`.execute(trx)).rows[0];
  if (!mr) return { outcome: 'reversed', cents: deltaCents };
  if (String(mr.status) === 'PAID' || String(mr.status) === 'OFFSET') {
    // the payout already happened: a recovery claim, never a rewrite of the payout
    await sql`INSERT INTO reimbursement_adjustments (tenant_id, reimbursement_id, kind, amount_cents, source_table, source_id, reason)
      VALUES (${T}::uuid, ${mr.id}::uuid, 'OFFSET_CLAIM', ${deltaCents}, 'payment_refunds', ${a.refundId}, 'Redemption refunded after payout: recover from the salon')`.execute(trx);
    await sql`UPDATE merchant_reimbursements m SET status = 'OFFSET', version = m.version + 1, updated_at = now() WHERE m.id = ${mr.id}::uuid AND m.tenant_id = ${T}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'OFFSET', 'm')}`.execute(trx);
    await postJournal(trx, { entryType: 'reimbursement_offset', tenantId: T, sourceTable: 'payment_refunds', sourceId: a.refundId, memo: `Recovery claim ${dollarsLabel(deltaCents)}`,
      lines: [{ account: 'merchant_recovery_receivable', tenantId: T, debit: deltaCents }, { account: 'rewards_liability', tenantId: null, credit: deltaCents }] });
    return { outcome: 'reversed', cents: deltaCents, payable: 'OFFSET' };
  }
  await sql`INSERT INTO reimbursement_adjustments (tenant_id, reimbursement_id, kind, amount_cents, source_table, source_id, reason)
    VALUES (${T}::uuid, ${mr.id}::uuid, 'ADJUSTMENT', ${deltaCents}, 'payment_refunds', ${a.refundId}, 'Redemption refunded before payout')`.execute(trx);
  const adjusted = n(mr.adjusted_cents) + deltaCents;
  const to = String(mr.status) === 'PAYOUT_PENDING' ? 'ON_HOLD' : adjusted >= n(mr.amount_cents) ? 'ADJUSTED' : String(mr.status);
  const moves = to !== String(mr.status);   // a partial refund of an owed payable keeps its status; only the owed amount shrinks
  await sql`UPDATE merchant_reimbursements m SET adjusted_cents = ${adjusted}, version = m.version + 1, updated_at = now(),
      status = ${moves ? sql`CASE WHEN ${canMoveToSql(MERCHANT_REIMBURSEMENT, to, 'm')} THEN ${to} ELSE m.status END` : sql`m.status`},
      hold_reason = CASE WHEN ${to} = 'ON_HOLD' THEN 'Refund arrived while a payout was in flight' ELSE m.hold_reason END
    WHERE m.id = ${mr.id}::uuid AND m.tenant_id = ${T}::uuid`.execute(trx);
  await postJournal(trx, { entryType: 'redemption_reversed', tenantId: T, sourceTable: 'payment_refunds', sourceId: a.refundId, memo: `Redemption reversed ${dollarsLabel(deltaCents)}`,
    lines: [{ account: 'reimbursement_payable', tenantId: T, debit: deltaCents }, { account: 'rewards_liability', tenantId: null, credit: deltaCents }] });
  return { outcome: 'reversed', cents: deltaCents, payable: to };
}

export { isOwed };
// payouts (platform-wide by design: a provider callback names no salon) live in rewards-payouts.ts
export { requestPayout, applyPayoutSettlement, markPayoutEligible, holdPayable, payoutProviderFromEnv, PAYOUT_PROVIDER, type PayoutProvider } from './rewards-payouts';
