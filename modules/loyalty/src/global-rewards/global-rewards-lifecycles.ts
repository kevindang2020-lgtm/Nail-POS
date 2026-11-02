// global-rewards-lifecycles.ts — the Global Loyalty & Rewards Network's status lifecycles (Constitution 5 §74–§78), ONE
// transition table each, used by every writer through canMoveToSql / assertTransition (check:state-transitions).
// Money states are deliberately one-way (LoyaltyTokens.pdf §5.4, §7.4; LoyaltyRules.pdf §5.4):
//   • a token purchase becomes spendable ONLY at FUNDS_VERIFIED; PAYMENT_CONFIRMED / SETTLEMENT_PENDING never skip to
//     spendable without passing through it, and a final state never reopens;
//   • a reimbursement is PAID only from SUBMITTED / PROCESSING / UNKNOWN (a provider answer) — never from PAYABLE or
//     BATCHED directly;
//   • an activated earning-policy version is never edited: it can only be CANCELED before its time (the guard is in SQL).
import { defineStateMachine } from '@aipowersalon/database';

export const TENANT_EARNING_POLICY_VERSION = defineStateMachine({
  name: 'tenant_earning_policy_version', table: 'tenant_earning_policy_versions', column: 'status',
  states: ['DRAFT', 'ACTIVATED', 'DISCARDED', 'CANCELED'],
  transitions: { DRAFT: ['DRAFT', 'ACTIVATED', 'DISCARDED'], ACTIVATED: ['CANCELED'] },
  initial: ['DRAFT', 'ACTIVATED'],
});

export const GLOBAL_EARNING_RULE_VERSION = defineStateMachine({
  name: 'global_earning_rule_version', table: 'global_earning_rule_versions', column: 'status',
  states: ['published', 'canceled'],
  transitions: { published: ['canceled'] },
  initial: ['published'],
});

export const GLOBAL_REWARDS_ENROLLMENT = defineStateMachine({
  name: 'global_rewards_enrollment', table: 'global_rewards_enrollments', column: 'status',
  states: ['enrolled', 'suspended', 'withdrawn'],
  transitions: { enrolled: ['enrolled', 'suspended', 'withdrawn'], suspended: ['enrolled', 'suspended', 'withdrawn'], withdrawn: ['enrolled'] },
  initial: ['enrolled'],
});

export const TENANT_TOKEN_WALLET = defineStateMachine({
  name: 'tenant_token_wallet', table: 'tenant_token_wallets', column: 'status',
  states: ['active', 'suspended', 'locked'],
  transitions: { active: ['active', 'suspended', 'locked'], suspended: ['active', 'suspended', 'locked'], locked: ['active', 'suspended', 'locked'] },
  initial: ['active'],
});

export const TOKEN_PURCHASE_INTENT = defineStateMachine({
  name: 'token_purchase_intent', table: 'token_purchase_intents', column: 'status',
  states: ['REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING', 'FUNDS_VERIFIED', 'FAILED', 'DECLINED', 'REVERSED', 'CHARGED_BACK', 'CANCELED'],
  transitions: {
    REQUESTED: ['PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'DECLINED', 'FAILED', 'CANCELED'],
    PROCESSING: ['UNKNOWN', 'PAYMENT_CONFIRMED', 'DECLINED', 'FAILED'],
    UNKNOWN: ['PAYMENT_CONFIRMED', 'DECLINED', 'FAILED'],
    PAYMENT_CONFIRMED: ['SETTLEMENT_PENDING', 'FUNDS_VERIFIED', 'REVERSED', 'CHARGED_BACK'],
    SETTLEMENT_PENDING: ['FUNDS_VERIFIED', 'REVERSED', 'CHARGED_BACK', 'FAILED'],
    FUNDS_VERIFIED: ['REVERSED', 'CHARGED_BACK'],
  },
  initial: ['REQUESTED'],
});

export const GLOBAL_REWARDS_ACCOUNT = defineStateMachine({
  name: 'global_rewards_account', table: 'global_rewards_accounts', column: 'status',
  states: ['active', 'suspended', 'closed'],
  transitions: { active: ['suspended', 'closed'], suspended: ['active', 'closed'] },
  initial: ['active'],
});

export const REWARD_EARN_TRANSACTION = defineStateMachine({
  name: 'reward_earn_transaction', table: 'reward_earn_transactions', column: 'status',
  states: ['EARNED', 'NOT_ELIGIBLE', 'BLOCKED_POLICY', 'BLOCKED_INSUFFICIENT_TOKENS', 'PARTIALLY_REVERSED', 'REVERSED'],
  transitions: { EARNED: ['PARTIALLY_REVERSED', 'REVERSED'], PARTIALLY_REVERSED: ['PARTIALLY_REVERSED', 'REVERSED'] },
  initial: ['EARNED', 'NOT_ELIGIBLE', 'BLOCKED_POLICY', 'BLOCKED_INSUFFICIENT_TOKENS'],
});

// Final Completion guide §05: only one terminal action wins; CONFIRMED_REDEEMED moves on only through a compensating event
export const REWARD_REDEMPTION = defineStateMachine({
  name: 'reward_redemption', table: 'reward_redemptions', column: 'status',
  states: ['CREATED', 'HELD', 'CONFIRMED_REDEEMED', 'RELEASED', 'EXPIRED', 'REVERSED'],
  transitions: { CREATED: ['HELD', 'RELEASED'], HELD: ['CONFIRMED_REDEEMED', 'RELEASED', 'EXPIRED'], CONFIRMED_REDEEMED: ['REVERSED'] },
  initial: ['CREATED', 'HELD'],
});

// guide §05: PAID only from a SETTLED payout attempt (DB trigger trg_mr_paid_guard); a PAID payable is history — a later
// reversal is an OFFSET claim (reimbursement_adjustments), never a rewrite
export const MERCHANT_REIMBURSEMENT = defineStateMachine({
  name: 'merchant_reimbursement', table: 'merchant_reimbursements', column: 'status',
  states: ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'],
  transitions: {
    ACCRUED_OWED: ['PAYOUT_ELIGIBLE', 'ON_HOLD', 'ADJUSTED'], PAYOUT_ELIGIBLE: ['PAYOUT_PENDING', 'ON_HOLD', 'ADJUSTED'],
    PAYOUT_PENDING: ['PAID', 'PAYOUT_FAILED', 'ON_HOLD'], PAYOUT_FAILED: ['PAYOUT_ELIGIBLE', 'ON_HOLD', 'ADJUSTED'],
    ON_HOLD: ['PAYOUT_ELIGIBLE', 'ADJUSTED'], PAID: ['OFFSET'],
  },
  initial: ['ACCRUED_OWED'],
});

export const PAYOUT_ATTEMPT = defineStateMachine({
  name: 'payout_attempt', table: 'payout_attempts', column: 'status',
  states: ['REQUESTED', 'SUBMITTED', 'SETTLED', 'FAILED', 'UNKNOWN'],
  transitions: { REQUESTED: ['SUBMITTED', 'FAILED', 'UNKNOWN'], SUBMITTED: ['SETTLED', 'FAILED', 'UNKNOWN'], UNKNOWN: ['SETTLED', 'FAILED'] },
  initial: ['REQUESTED'],
});

export const REWARDS_RECON_RUN = defineStateMachine({
  name: 'rewards_recon_run', table: 'rewards_recon_runs', column: 'status',
  states: ['RUNNING', 'PASS', 'WARNING', 'FAILED', 'UNKNOWN', 'ERROR'],
  transitions: { RUNNING: ['PASS', 'WARNING', 'FAILED', 'UNKNOWN', 'ERROR'], ERROR: ['RUNNING'] },
  initial: ['RUNNING'],
});

export const REWARDS_RECON_FINDING = defineStateMachine({
  name: 'rewards_recon_finding', table: 'rewards_recon_findings', column: 'review_status',
  states: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED'],
  transitions: { OPEN: ['INVESTIGATING', 'RESOLVED', 'ACCEPTED'], INVESTIGATING: ['RESOLVED', 'ACCEPTED', 'OPEN'] },
  initial: ['OPEN'],
});

export const LOYALTY_FRAUD_ALERT = defineStateMachine({
  name: 'loyalty_fraud_alert', table: 'loyalty_fraud_alerts', column: 'status',
  states: ['OPEN', 'INVESTIGATING', 'DISMISSED', 'CONFIRMED'],
  transitions: { OPEN: ['INVESTIGATING', 'DISMISSED', 'CONFIRMED'], INVESTIGATING: ['DISMISSED', 'CONFIRMED', 'OPEN'] },
  initial: ['OPEN'],
});
