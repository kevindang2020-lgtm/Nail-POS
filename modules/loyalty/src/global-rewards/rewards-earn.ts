// rewards-earn.ts — funded global-points earning on authoritative Checkout completion (LoyaltyTokens.pdf §6.1–§6.2,
// LoyaltyRules.pdf §2.3, §5.1–§5.2). Called by the checkout.completed consumer inside the event runner's transaction.
//
//   checkout.completed → per-ticket lock → already judged? (one judgement per ticket, ever) → ticket (tenant-checked, PAID)
//   → eligible amount (paid − tax − tips − gift-card value bought − reward tender) → verified, opted-in global identity
//   → THE resolver at the ticket's paid_at (a late worker resolves the rule in force THEN) → exact points + backing
//   → lock the EARNING salon's wallet → debit exactly the backing (never overdraw, never the cheaper global rate)
//   → credit the customer's global points → balanced journal (merchant prepaid liability → rewards liability)
//   → one reward_earn_transactions row holding the complete snapshot.
// Every outcome writes that row (EARNED / NOT_ELIGIBLE / BLOCKED_POLICY / BLOCKED_INSUFFICIENT_TOKENS) so a replay never
// judges the ticket again — except when the earn flags are OFF: then nothing is written at all (no side effects).
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { computeEarn, eligibleCentsOf, refundedEligibleCentsOf, tenthsLabel, tokensLabel, alertLevel, GlobalRewardsError, type EffectiveEarningRule } from './global-rewards-core';
import { GlobalRewardsRepository, postJournal } from './global-rewards.repository';
import { flagState } from './global-rewards-flags';
import { REWARD_EARN_TRANSACTION } from './global-rewards-lifecycles';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
/** tender statuses that moved money (the same list the tenant loyalty consumer nets against) */
export const PAID_TENDER_STATUSES = ['approved', 'partial', 'captured', 'completed', 'settled', 'succeeded'] as const;
export const REWARD_TENDER_METHOD = 'global_reward';

export interface EarnOutcome {
  outcome: 'flag_off' | 'not_paid' | 'duplicate' | 'judged';
  status?: 'EARNED' | 'NOT_ELIGIBLE' | 'BLOCKED_POLICY' | 'BLOCKED_INSUFFICIENT_TOKENS';
  earnId?: string; tenantId?: string; branchId?: string | null; identityId?: string | null;
  pointTenths?: number; backingCents?: number; ruleSource?: string | null; reason?: string | null; walletAfterCents?: number | null; alertRaised?: string | null;
}

export class TenantMismatchError extends Error { constructor(m: string) { super(m); this.name = 'TenantMismatchError'; } }

export async function earnForTicket(trx: Transaction<any>, repo: GlobalRewardsRepository, a: { tenantId: string; ticketId: string; eventId: string | null; giftCardChargeCents: number }): Promise<EarnOutcome> {
  const T = a.tenantId;
  const flags = await flagState(trx, T);
  if (!flags.engine || !flags.earn) return { outcome: 'flag_off' };
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'gr-earn:' + a.ticketId}))`.execute(trx);
  const prior = (await sql<Row>`SELECT e.id, e.status FROM reward_earn_transactions e WHERE e.tenant_id = ${T}::uuid AND e.ticket_id = ${a.ticketId}::uuid`.execute(trx)).rows[0];
  if (prior) return { outcome: 'duplicate', earnId: String(prior.id), status: prior.status };

  const ticket = (await sql<Row>`SELECT t.tenant_id, t.branch_id, t.customer_id, t.status, t.paid_at, t.tax_cents, t.tip_cents FROM tickets t WHERE t.id = ${a.ticketId}::uuid`.execute(trx)).rows[0];
  if (!ticket) return { outcome: 'not_paid' };
  if (String(ticket.tenant_id) !== T) throw withCode(new TenantMismatchError(`ticket ${a.ticketId} belongs to another tenant`), 'TENANT_ACCESS_DENIED');
  if (String(ticket.status) !== 'paid' || !ticket.paid_at) return { outcome: 'not_paid' };
  const branchId: string | null = ticket.branch_id ? String(ticket.branch_id) : null;
  const effectiveAt = new Date(ticket.paid_at);

  // money the customer paid on this ticket; the reward-funded part (a global_reward tender) never earns (guide §2.6)
  const pay = (await sql<Row>`SELECT coalesce(sum(p.amount_cents), 0) AS paid FROM payments p
    WHERE p.tenant_id = ${T}::uuid AND p.ticket_id = ${a.ticketId}::uuid AND p.amount_cents > 0 AND p.status = ANY(${[...PAID_TENDER_STATUSES]}::text[])
      AND p.method IS DISTINCT FROM ${REWARD_TENDER_METHOD}`.execute(trx)).rows[0];
  const grossEligible = eligibleCentsOf({ paidCents: n(pay?.paid), taxCents: n(ticket.tax_cents), tipCents: n(ticket.tip_cents), giftCardChargeCents: Math.max(0, n(a.giftCardChargeCents)), rewardTenderCents: 0 });
  // a refund already settled before this earning was judged (events out of order) is not earned on (Nov 3 audit)
  const eligible = Math.max(0, grossEligible - await refundedEligibleForTicket(trx, T, a.ticketId, grossEligible));

  const identity = ticket.customer_id ? (await sql<Row>`SELECT l.identity_id FROM customer_identity_links l
      JOIN customer_identities ci ON ci.id = l.identity_id JOIN global_rewards_accounts ga ON ga.identity_id = l.identity_id
    WHERE l.tenant_id = ${T}::uuid AND l.customer_id = ${ticket.customer_id}::uuid AND ci.phone_verified_at IS NOT NULL AND ci.status = 'active' AND ga.status = 'active' AND ga.opted_in_at IS NOT NULL AND ga.withdrawn_at IS NULL
    LIMIT 1`.execute(trx)).rows[0] : undefined;
  const identityId: string | null = identity ? String(identity.identity_id) : null;

  const resolved = await repo.resolveEarningRule(trx, T, effectiveAt, flags);
  const earnId = randomUUID();
  const rule: EffectiveEarningRule | null = resolved.ok ? resolved.rule : null;
  const program = resolved.program ?? (await repo.program(trx));
  const calc = rule ? computeEarn(eligible, rule, program) : null;
  const cpt = program.redeemBlockValueCents / (program.pointsPerRedeemBlock * 10);

  let status: NonNullable<EarnOutcome['status']>; let reason: string | null = null;
  if (!identityId) { status = 'NOT_ELIGIBLE'; reason = ticket.customer_id ? 'no_verified_rewards_account' : 'no_customer'; }
  else if (!resolved.ok) { status = 'BLOCKED_POLICY'; reason = resolved.reason; }
  else if (!calc || calc.pointTenths <= 0) { status = 'NOT_ELIGIBLE'; reason = calc?.belowMinimum ? 'below_minimum' : 'below_increment'; }
  else status = 'EARNED';

  const insert = (st: string, why: string | null, tenths: number, backing: number) => sql`INSERT INTO reward_earn_transactions (id, tenant_id, branch_id, ticket_id, customer_id, identity_id,
      effective_at, eligible_cents, rule_source, rule_version_id, spend_increment_cents, point_tenths_per_increment, min_eligible_cents, per_ticket_cap_tenths, rounding_mode, cents_per_point_tenth,
      point_tenths, backing_cents, status, block_reason, source_event_id)
    VALUES (${earnId}::uuid, ${T}::uuid, ${branchId}, ${a.ticketId}::uuid, ${ticket.customer_id ?? null}, ${identityId}, ${effectiveAt.toISOString()}::timestamptz, ${eligible},
      ${rule?.source ?? null}, ${rule?.versionId ?? null}, ${rule?.spendIncrementCents ?? null}, ${rule?.pointTenthsPerIncrement ?? null}, ${rule?.minEligibleCents ?? null},
      ${rule?.perTicketCapTenths ?? null}, ${rule?.roundingMode ?? null}, ${cpt}, ${tenths}, ${backing}, ${st}, ${why}, ${a.eventId})`.execute(trx);

  if (status !== 'EARNED') {
    await insert(status, reason, 0, 0);
    return { outcome: 'judged', status, earnId, tenantId: T, branchId, identityId, pointTenths: 0, backingCents: 0, ruleSource: rule?.source ?? null, reason };
  }
  const tenths = calc!.pointTenths, backing = calc!.backingCents;
  // the earning salon's OWN wallet, locked; a short wallet blocks — it never falls back to a cheaper rule or overdraws
  const before = (await sql<Row>`SELECT w.available_cents FROM tenant_token_wallets w WHERE w.tenant_id = ${T}::uuid`.execute(trx)).rows[0];
  const debit = await repo.debitWallet(trx, { tenantId: T, branchId, cents: backing, sourceTable: 'reward_earn_transactions', sourceId: earnId, reason: `${tenthsLabel(tenths)} points on ticket` });
  if (!debit.ok && debit.walletStatus !== 'active' && debit.walletStatus !== 'none') {
    // a suspended / locked wallet is a policy block, not a shortage — never tell the owner to "Buy Tokens" for it
    const why = `wallet_${debit.walletStatus}`;
    await insert('BLOCKED_POLICY', why, tenths, backing);
    await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
      VALUES (${T}::uuid, ${branchId}, 'loyalty', 'warning', 'new', 'Rewards not issued: token wallet on hold',
        ${`A customer's sale would have earned ${tenthsLabel(tenths)} global points, but this salon's token wallet is ${debit.walletStatus === 'locked' ? 'locked (a token purchase was reversed after it was spent)' : 'suspended'}. The sale completed normally; no points were issued. Contact AIPowerSalon support to resolve it.`},
        ${JSON.stringify({ earnId, ticketId: a.ticketId, neededCents: backing, availableCents: debit.availableCents, code: 'WALLET_' + debit.walletStatus.toUpperCase() })}::jsonb)`.execute(trx);
    return { outcome: 'judged', status: 'BLOCKED_POLICY', earnId, tenantId: T, branchId, identityId, pointTenths: tenths, backingCents: backing, ruleSource: rule!.source, reason: why, walletAfterCents: debit.availableCents };
  }
  if (!debit.ok) {
    await insert('BLOCKED_INSUFFICIENT_TOKENS', 'insufficient_tokens', tenths, backing);
    await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
      VALUES (${T}::uuid, ${branchId}, 'loyalty', 'warning', 'new', 'Rewards not issued: not enough tokens',
        ${`A customer's sale would have earned ${tenthsLabel(tenths)} global points (${tokensLabel(backing, program.tokenValueCents)} tokens), but the wallet has ${tokensLabel(debit.availableCents, program.tokenValueCents)}. The sale completed normally; no points were issued. Buy Tokens to keep rewarding customers.`},
        ${JSON.stringify({ earnId, ticketId: a.ticketId, neededCents: backing, availableCents: debit.availableCents, code: 'INSUFFICIENT_TOKENS' })}::jsonb)`.execute(trx);
    return { outcome: 'judged', status: 'BLOCKED_INSUFFICIENT_TOKENS', earnId, tenantId: T, branchId, identityId, pointTenths: tenths, backingCents: backing, ruleSource: rule!.source, reason: 'insufficient_tokens', walletAfterCents: debit.availableCents };
  }
  await insert('EARNED', null, tenths, backing);
  // the customer's global points, under the account lock
  const acct = (await sql<Row>`SELECT ga.available_tenths, ga.reserved_tenths FROM global_rewards_accounts ga WHERE ga.identity_id = ${identityId}::uuid FOR UPDATE`.execute(trx)).rows[0];
  // the points ledger's running balance is the account TOTAL (available + held); the account row keeps the split
  const after = n(acct?.available_tenths) + tenths;
  const totalAfter = after + n(acct?.reserved_tenths);
  await sql`INSERT INTO global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, branch_id, source_table, source_id)
    VALUES (${identityId}::uuid, 'earn', ${tenths}, ${totalAfter}, ${T}::uuid, ${branchId}, 'reward_earn_transactions', ${earnId})`.execute(trx);
  await sql`UPDATE global_rewards_accounts ga SET available_tenths = ${after}, lifetime_earned_tenths = ga.lifetime_earned_tenths + ${tenths}, version = ga.version + 1, updated_at = now()
    WHERE ga.identity_id = ${identityId}::uuid`.execute(trx);
  await postJournal(trx, { entryType: 'earn_allocation', tenantId: T, sourceTable: 'reward_earn_transactions', sourceId: earnId, memo: `Funded ${tenthsLabel(tenths)} points`,
    lines: [{ account: 'merchant_prepaid_liability', tenantId: T, debit: backing }, { account: 'rewards_liability', tenantId: null, credit: backing }] });   // points are global (earned here, spendable at any salon): the liability is the platform's, like on redeem
  // one owner alert per threshold CROSSING (not every sale below it — guide §5.6 "avoid alert spam")
  const lvlBefore = alertLevel(n(before?.available_cents), program), lvlAfter = alertLevel(debit.balanceAfterCents, program);
  let alertRaised: string | null = null;
  if (lvlAfter !== lvlBefore && (lvlAfter === 'low' || lvlAfter === 'critical' || lvlAfter === 'empty')) {
    alertRaised = lvlAfter;
    await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
      VALUES (${T}::uuid, ${branchId}, 'loyalty', ${lvlAfter === 'low' ? 'warning' : 'high'}, 'new', ${lvlAfter === 'low' ? 'Reward tokens running low' : lvlAfter === 'critical' ? 'Reward tokens critically low' : 'Reward tokens used up'},
        ${`Your rewards wallet has ${tokensLabel(debit.balanceAfterCents, program.tokenValueCents)} tokens left. Customers stop earning global points when it runs out.`},
        ${JSON.stringify({ level: lvlAfter, availableCents: debit.balanceAfterCents })}::jsonb)`.execute(trx);
  }
  return { outcome: 'judged', status: 'EARNED', earnId, tenantId: T, branchId, identityId, pointTenths: tenths, backingCents: backing, ruleSource: rule!.source, reason: null, walletAfterCents: debit.balanceAfterCents, alertRaised };
}

/**
 * The ticket's refunded EARNING amount so far (Nov 3 audit): settled refunds of non-reward tenders, a refund that gave
 * the tip back taken from the tip first, the tax share of service money excluded. Feeds reverseEarnForRefund.
 */
export async function refundedEligibleForTicket(trx: Transaction<any>, tenantId: string, ticketId: string, eligibleOverride?: number): Promise<number> {
  const T = tenantId;
  const [tk, paid, earn, refunds] = await Promise.all([
    sql<Row>`SELECT t.tax_cents, t.tip_cents FROM tickets t WHERE t.tenant_id = ${T}::uuid AND t.id = ${ticketId}::uuid`.execute(trx),
    sql<Row>`SELECT coalesce(sum(p.amount_cents), 0) AS v FROM payments p WHERE p.tenant_id = ${T}::uuid AND p.ticket_id = ${ticketId}::uuid AND p.amount_cents > 0
      AND p.status = ANY(${[...PAID_TENDER_STATUSES, 'partially_refunded', 'refunded']}::text[]) AND p.method IS DISTINCT FROM ${REWARD_TENDER_METHOD}`.execute(trx),
    sql<Row>`SELECT e.eligible_cents FROM reward_earn_transactions e WHERE e.tenant_id = ${T}::uuid AND e.ticket_id = ${ticketId}::uuid`.execute(trx),
    sql<Row>`SELECT r.amount_cents, r.request_detail FROM payment_refunds r JOIN payments p2 ON p2.id = r.payment_id AND p2.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${T}::uuid AND p2.ticket_id = ${ticketId}::uuid AND r.status = 'refunded' AND p2.method IS DISTINCT FROM ${REWARD_TENDER_METHOD} ORDER BY r.created_at, r.id`.execute(trx),
  ]);
  // request_detail is jsonb (an object); a legacy string row is read as JSON text
  const tipFlag = (v: unknown): boolean => {
    const o: unknown = typeof v === 'string' && v.trim().startsWith('{') ? JSON.parse(v) : v;
    return !!o && typeof o === 'object' && (o as { tipRefunded?: unknown }).tipRefunded === true;
  };
  return refundedEligibleCentsOf({ paidCents: n(paid.rows[0]?.v), taxCents: n(tk.rows[0]?.tax_cents), tipCents: n(tk.rows[0]?.tip_cents), eligibleCents: eligibleOverride ?? n(earn.rows[0]?.eligible_cents),
    refunds: refunds.rows.map((r) => ({ amountCents: n(r.amount_cents), tipRefunded: tipFlag(r.request_detail) })) });
}

/**
 * Refund of an earning sale (guide §8.1, addendum §2.3 / T12): reverse with the ORIGINAL snapshot — never the current rule.
 * Deterministic: after a refund the ticket keeps exactly what its remaining eligible amount earns under the snapshot.
 * Points the customer still has are taken back and their unused backing returns to the earning salon's wallet; points
 * already spent cannot be taken back — that part stays a recorded finance exception (no tokens minted from nothing).
 * Idempotent per refund id (a repeated refund webhook never reverses twice).
 */
export async function reverseEarnForRefund(trx: Transaction<any>, repo: GlobalRewardsRepository, a: { tenantId: string; ticketId: string; refundId: string; refundedEligibleCents: number }) {
  const T = a.tenantId;
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'gr-earn:' + a.ticketId}))`.execute(trx);
  const e = (await sql<Row>`SELECT e.id, e.status, e.identity_id, e.branch_id, e.eligible_cents, e.point_tenths, e.reversed_tenths, e.spend_increment_cents, e.point_tenths_per_increment,
    e.min_eligible_cents, e.per_ticket_cap_tenths, e.cents_per_point_tenth FROM reward_earn_transactions e WHERE e.tenant_id = ${T}::uuid AND e.ticket_id = ${a.ticketId}::uuid FOR UPDATE`.execute(trx)).rows[0];
  if (!e || !['EARNED', 'PARTIALLY_REVERSED'].includes(String(e.status))) return { outcome: 'nothing_to_reverse' as const };
  const seen = (await sql<Row>`SELECT 1 AS x FROM global_points_ledger g WHERE g.tenant_id = ${T}::uuid AND g.source_table = 'refunds' AND g.source_id = ${a.refundId} AND g.entry_type = 'earn_reversal'`.execute(trx)).rows[0]
    || (await sql<Row>`SELECT 1 AS x FROM token_wallet_ledger l WHERE l.tenant_id = ${T}::uuid AND l.source_table = 'refunds' AND l.source_id = ${a.refundId} AND l.entry_type = 'earn_reversal'`.execute(trx)).rows[0];
  if (seen) return { outcome: 'duplicate' as const };
  const program = await repo.program(trx);
  const snapshot = { spendIncrementCents: n(e.spend_increment_cents), pointTenthsPerIncrement: n(e.point_tenths_per_increment), minEligibleCents: n(e.min_eligible_cents),
    perTicketCapTenths: e.per_ticket_cap_tenths == null ? null : n(e.per_ticket_cap_tenths), roundingMode: 'COMPLETED_INCREMENT' as const };
  const cpt = n(e.cents_per_point_tenth) || 1;
  // the ticket's cumulative refunded eligible amount after this refund, under the ORIGINAL rule and program cap
  const remainingEligible = Math.max(0, n(e.eligible_cents) - Math.max(0, Math.floor(a.refundedEligibleCents)));
  const keep = Math.min(computeEarn(remainingEligible, snapshot, { ...program, maxPointTenthsPerTicket: Number.MAX_SAFE_INTEGER }).pointTenths, n(e.point_tenths));
  const outstanding = n(e.point_tenths) - n(e.reversed_tenths);
  const want = Math.max(0, outstanding - keep);
  if (want === 0) return { outcome: 'nothing_to_reverse' as const };
  const acct = (await sql<Row>`SELECT ga.available_tenths, ga.reserved_tenths FROM global_rewards_accounts ga WHERE ga.identity_id = ${e.identity_id}::uuid FOR UPDATE`.execute(trx)).rows[0];
  // held points are not available: a refund never takes back points another salon is holding
  const take = Math.min(want, n(acct?.available_tenths));
  const restoreCents = take * cpt;
  if (take > 0) {
    const after = n(acct.available_tenths) - take;
    await sql`INSERT INTO global_points_ledger (identity_id, entry_type, delta_tenths, balance_after_tenths, tenant_id, branch_id, source_table, source_id)
      VALUES (${e.identity_id}::uuid, 'earn_reversal', ${-take}, ${after + n(acct.reserved_tenths)}, ${T}::uuid, ${e.branch_id ?? null}, 'refunds', ${a.refundId})`.execute(trx);
    await sql`UPDATE global_rewards_accounts ga SET available_tenths = ${after}, version = ga.version + 1, updated_at = now() WHERE ga.identity_id = ${e.identity_id}::uuid`.execute(trx);
    await repo.creditWallet(trx, { tenantId: T, branchId: e.branch_id ?? null, cents: restoreCents, entryType: 'earn_reversal', sourceTable: 'refunds', sourceId: a.refundId,
      reason: `Refund took back ${tenthsLabel(take)} unused points`, journal: { entryType: 'earn_reversal', memo: `Refund ${a.refundId}`, lines: [
        { account: 'rewards_liability', tenantId: null, debit: restoreCents }, { account: 'merchant_prepaid_liability', tenantId: T, credit: restoreCents }] } });
  }
  const reversedTenths = n(e.reversed_tenths) + take;
  const exception = want - take;
  const to = reversedTenths >= n(e.point_tenths) ? 'REVERSED' : 'PARTIALLY_REVERSED';
  const upd = (await sql<Row>`UPDATE reward_earn_transactions e2 SET reversed_tenths = ${reversedTenths}, reversed_backing_cents = e2.reversed_backing_cents + ${restoreCents},
      status = ${to}, block_reason = CASE WHEN ${exception} > 0 THEN 'refund_points_already_spent' ELSE e2.block_reason END, updated_at = now()
    WHERE e2.tenant_id = ${T}::uuid AND e2.id = ${e.id}::uuid AND ${canMoveToSql(REWARD_EARN_TRANSACTION, to, 'e2')} RETURNING e2.id`.execute(trx)).rows[0];
  if (!upd) throw new GlobalRewardsError('The earning could not be reversed.', 'INVALID_STATE_TRANSITION', 409);
  return { outcome: 'reversed' as const, reversedTenths: take, restoredCents: restoreCents, exceptionTenths: exception, status: to };
}
