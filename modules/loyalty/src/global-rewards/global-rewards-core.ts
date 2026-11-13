// global-rewards-core.ts — the PURE rules of the AI PowerSalon Global Loyalty & Rewards Network (LoyaltyTokens.pdf v1.0)
// and the Global & Tenant Earning Rules addendum (LoyaltyRules.pdf v2.0). No database, no Nest: every rule the
// resolver, the earn processor, the POS preview and the Super Admin editor use lives here once, so they can never
// disagree (guide §9.2 "no duplicate rate calculators").
//
// Units — exact integers only (guide §2.2 "fixed-point exact calculations"; addendum §5.5 "exact money and point
// arithmetic"):
//   money / token value   CENTS             1 token = program.tokenValueCents (initially 100)
//   customer points       TENTHS of a point 0.5 point = 5 · 10 points = 100
//   cents per point-tenth = redeemBlockValueCents / (pointsPerRedeemBlock × 10)  — integral by DB constraint
//                           (initially 100 / (10 × 10) = 1 → 1 point = 10¢ = 0.10 token)
//
// Earning (COMPLETED_INCREMENT, guide §2.2): completed increments of eligible spend × points per increment; leftovers
// never carry over to another visit. $4.99 → 0 · $5 → 0.5 · $7.50 → 0.5 · $19.99 → 1.5 · $100 → 10 (with $5 = 0.5).
// The token debit is EXACTLY the redemption value of the points issued (addendum §1.5, guide §2.3): a generous custom
// rule costs more tokens — it never keeps the cheaper global deduction.

export type RuleSource = 'GLOBAL_DEFAULT' | 'TENANT_OVERRIDE';
export const ROUNDING_MODES = ['COMPLETED_INCREMENT'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** One complete earning rate — never a mix of one source's increment and another's points (addendum §2.1). */
export interface EarningRate {
  spendIncrementCents: number;
  pointTenthsPerIncrement: number;
  minEligibleCents: number;
  perTicketCapTenths: number | null;
  roundingMode: RoundingMode;
}
/** addendum §2.2 EffectiveEarningRule (repository naming) */
export interface EffectiveEarningRule extends EarningRate {
  source: RuleSource;
  versionId: string;
  versionNo: number;
  effectiveFrom: string;
}

/** The centrally fixed values + platform limits (addendum §1.2). Tenants never edit these. */
export interface ProgramPolicy {
  earnPaused: boolean; redeemPaused: boolean; purchasesPaused: boolean; reimbursementsPaused: boolean;
  pointsPerRedeemBlock: number; redeemBlockValueCents: number; tokenValueCents: number;
  customMinSpendIncrementCents: number; customMaxSpendIncrementCents: number; customMaxPointTenthsPerIncrement: number;
  customMinEligibleFloorCents: number; maxPointTenthsPerTicket: number;
  lowBalanceCents: number; criticalBalanceCents: number; reservationTtlSeconds: number;
  purchasePresetsTokens: number[]; maxPurchaseTokens: number; termsVersion: string; version: number;
}

export class GlobalRewardsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message); this.name = 'GlobalRewardsError'; }
}

export const centsPerPointTenth = (p: Pick<ProgramPolicy, 'redeemBlockValueCents' | 'pointsPerRedeemBlock'>): number => {
  const d = p.pointsPerRedeemBlock * 10;
  if (!(d > 0) || p.redeemBlockValueCents % d !== 0) throw new GlobalRewardsError('The program redemption value does not give an exact cents value per point.', 'EARNING_RULE_INVALID', 500);
  return p.redeemBlockValueCents / d;
};

export interface EarnResult { increments: number; pointTenths: number; backingCents: number; cappedBy: 'rule' | 'program' | null; belowMinimum: boolean }

/** Points + exact token backing for one eligible amount under ONE complete rate (guide §2.2/§2.3, addendum §1.4). */
export function computeEarn(eligibleCents: number, rate: EarningRate, program: ProgramPolicy): EarnResult {
  const e = Math.max(0, Math.floor(Number(eligibleCents) || 0));
  if (e < rate.minEligibleCents) return { increments: 0, pointTenths: 0, backingCents: 0, cappedBy: null, belowMinimum: true };
  const increments = Math.floor(e / rate.spendIncrementCents);
  let tenths = increments * rate.pointTenthsPerIncrement;
  let cappedBy: EarnResult['cappedBy'] = null;
  if (rate.perTicketCapTenths != null && tenths > rate.perTicketCapTenths) { tenths = rate.perTicketCapTenths; cappedBy = 'rule'; }
  if (tenths > program.maxPointTenthsPerTicket) { tenths = program.maxPointTenthsPerTicket; cappedBy = 'program'; }   // the global cap is never bypassed
  return { increments, pointTenths: tenths, backingCents: tenths * centsPerPointTenth(program), cappedBy, belowMinimum: false };
}

/** Validate a complete CUSTOM rate against the platform limits (addendum §1.2, §3.3): no zero, negative, fractional or
 *  out-of-policy values; the custom cap may only be LOWER than the global safety cap. Returns the normalised rate. */
export function validateCustomRate(input: { spendIncrementCents?: unknown; pointTenthsPerIncrement?: unknown; minEligibleCents?: unknown; perTicketCapTenths?: unknown; roundingMode?: unknown },
  program: ProgramPolicy): EarningRate {
  const int = (v: unknown, field: string, min: number): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < min) throw new GlobalRewardsError(`${field} must be a whole number of at least ${min}.`, 'EARNING_RULE_INVALID', 400, { field });
    return n;
  };
  const spend = int(input.spendIncrementCents, 'spendIncrementCents', 1);
  const pts = int(input.pointTenthsPerIncrement, 'pointTenthsPerIncrement', 1);
  const min = input.minEligibleCents == null || input.minEligibleCents === '' ? 0 : int(input.minEligibleCents, 'minEligibleCents', 0);
  const cap = input.perTicketCapTenths == null || input.perTicketCapTenths === '' ? null : int(input.perTicketCapTenths, 'perTicketCapTenths', 1);
  const rounding = input.roundingMode == null ? 'COMPLETED_INCREMENT' : String(input.roundingMode);
  if (!(ROUNDING_MODES as readonly string[]).includes(rounding)) throw new GlobalRewardsError('Only completed-increment rounding is allowed.', 'EARNING_RULE_INVALID', 400, { field: 'roundingMode' });
  const out = (field: string, limit: number) => new GlobalRewardsError(`${field} is outside the platform limits.`, 'EARNING_RULE_OUT_OF_POLICY', 400, { field, limit });
  if (spend < program.customMinSpendIncrementCents) throw out('spendIncrementCents', program.customMinSpendIncrementCents);
  if (spend > program.customMaxSpendIncrementCents) throw out('spendIncrementCents', program.customMaxSpendIncrementCents);
  if (pts > program.customMaxPointTenthsPerIncrement) throw out('pointTenthsPerIncrement', program.customMaxPointTenthsPerIncrement);
  if (min < program.customMinEligibleFloorCents) throw out('minEligibleCents', program.customMinEligibleFloorCents);
  if (cap != null && cap > program.maxPointTenthsPerTicket) throw out('perTicketCapTenths', program.maxPointTenthsPerTicket);
  return { spendIncrementCents: spend, pointTenthsPerIncrement: pts, minEligibleCents: min, perTicketCapTenths: cap, roundingMode: 'COMPLETED_INCREMENT' };
}

/** C1 audit (Nov 4 2026): the platform limits override ISSUANCE, not only activation — an active custom rate is clamped to
 *  today's limits when a sale is earned (a Super Admin lowering the cap took effect only for new activations). Clamping never
 *  issues MORE than the salon's rule: points and per-ticket cap only go down, the minimum spend and increment only go up. */
export function clampRateToPolicy(rate: EarningRate, program: ProgramPolicy): { rate: EarningRate; clamped: boolean } {
  const out: EarningRate = {
    ...rate,
    spendIncrementCents: Math.max(rate.spendIncrementCents, program.customMinSpendIncrementCents),
    pointTenthsPerIncrement: Math.min(rate.pointTenthsPerIncrement, program.customMaxPointTenthsPerIncrement),
    minEligibleCents: Math.max(rate.minEligibleCents, program.customMinEligibleFloorCents),
    perTicketCapTenths: rate.perTicketCapTenths == null ? null : Math.min(rate.perTicketCapTenths, program.maxPointTenthsPerTicket),
  };
  const clamped = out.spendIncrementCents !== rate.spendIncrementCents || out.pointTenthsPerIncrement !== rate.pointTenthsPerIncrement
    || out.minEligibleCents !== rate.minEligibleCents || out.perTicketCapTenths !== rate.perTicketCapTenths;
  return { rate: out, clamped };
}

/** Super Admin global rate validation (looser than custom — the platform's own range checks). */
export function validateGlobalRate(input: { spendIncrementCents?: unknown; pointTenthsPerIncrement?: unknown; minEligibleCents?: unknown; perTicketCapTenths?: unknown }, program: ProgramPolicy): EarningRate {
  const wide: ProgramPolicy = { ...program, customMinSpendIncrementCents: 1, customMaxSpendIncrementCents: 1_000_000, customMaxPointTenthsPerIncrement: 10_000, customMinEligibleFloorCents: 0 };
  return validateCustomRate(input, wide);
}

/** addendum §3.3: the preview table — $5 / $10 / $25 / $50 / $100 under the proposed rule vs the effective global rule. */
export const PREVIEW_AMOUNTS_CENTS = [500, 1000, 2500, 5000, 10000] as const;
export interface PreviewRow { eligibleCents: number; pointTenths: number; tokenCostCents: number; globalPointTenths: number; globalTokenCostCents: number; differenceCents: number }
export function previewRows(proposed: EarningRate, global: EarningRate, program: ProgramPolicy, amounts: readonly number[] = PREVIEW_AMOUNTS_CENTS): PreviewRow[] {
  return amounts.map((a) => {
    const p = computeEarn(a, proposed, program); const g = computeEarn(a, global, program);
    return { eligibleCents: a, pointTenths: p.pointTenths, tokenCostCents: p.backingCents, globalPointTenths: g.pointTenths, globalTokenCostCents: g.backingCents, differenceCents: p.backingCents - g.backingCents };
  });
}

// ── a salon's policy over time (addendum §1.3, §2.3, §4.4) ───────────────────────────────────────────────────────
export interface PolicyVersion {
  id: string; versionNo: number; mode: 'GLOBAL' | 'CUSTOM'; status: 'DRAFT' | 'ACTIVATED' | 'DISCARDED' | 'CANCELED';
  effectiveFrom: string | null; rate: EarningRate | null;
}
/** The activated transition in force at `at` (null → never customized → GLOBAL). Ties on time go to the higher version. */
export function policyVersionAt(versions: PolicyVersion[], at: Date): PolicyVersion | null {
  const t = at.getTime();
  let best: PolicyVersion | null = null;
  for (const v of versions) {
    if (v.status !== 'ACTIVATED' || !v.effectiveFrom) continue;
    const f = Date.parse(v.effectiveFrom);
    if (!(f <= t)) continue;
    if (!best || f > Date.parse(best.effectiveFrom!) || (f === Date.parse(best.effectiveFrom!) && v.versionNo > best.versionNo)) best = v;
  }
  return best;
}
/** What the owner sees (addendum §3.1): the mode truly in force now, and any activated transitions still in the future.
 *  "Custom Active" is shown ONLY when a CUSTOM transition is in force — a scheduled one is "Scheduled Custom: <date>". */
export function policyDisplay(versions: PolicyVersion[], now: Date): { current: PolicyVersion | null; mode: 'GLOBAL' | 'CUSTOM'; scheduled: PolicyVersion[]; drafts: PolicyVersion[] } {
  const current = policyVersionAt(versions, now);
  const scheduled = versions.filter((v) => v.status === 'ACTIVATED' && v.effectiveFrom && Date.parse(v.effectiveFrom) > now.getTime())
    .sort((a, b) => Date.parse(a.effectiveFrom!) - Date.parse(b.effectiveFrom!));
  return { current, mode: current?.mode === 'CUSTOM' ? 'CUSTOM' : 'GLOBAL', scheduled, drafts: versions.filter((v) => v.status === 'DRAFT') };
}
/** A version's state as shown in history — derived from time, never stored. */
export function versionDisplayState(v: PolicyVersion, inForce: PolicyVersion | null, now: Date): 'DRAFT' | 'DISCARDED' | 'CANCELED' | 'SCHEDULED' | 'ACTIVE' | 'SUPERSEDED' {
  if (v.status !== 'ACTIVATED') return v.status;
  if (v.effectiveFrom && Date.parse(v.effectiveFrom) > now.getTime()) return 'SCHEDULED';
  return inForce && inForce.id === v.id ? 'ACTIVE' : 'SUPERSEDED';
}

/** The global default version in force at `at` (latest published effective_from ≤ at). */
export function globalVersionAt<T extends { status: string; effectiveFrom: string; versionNo: number }>(versions: T[], at: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.status !== 'published' || Date.parse(v.effectiveFrom) > at.getTime()) continue;
    if (!best || Date.parse(v.effectiveFrom) > Date.parse(best.effectiveFrom) || (v.effectiveFrom === best.effectiveFrom && v.versionNo > best.versionNo)) best = v;
  }
  return best;
}

// ── eligibility (guide §2.6) ─────────────────────────────────────────────────────────────────────────────────────
/** The recommended initial eligible basis: what the customer actually paid for services/products after discounts —
 *  excluding tax, tips, the loyalty-funded portion (a global reward tender) and gift-card value bought on the ticket. */
export function eligibleCentsOf(t: { paidCents: number; taxCents: number; tipCents: number; giftCardChargeCents: number; rewardTenderCents: number; refundedCents?: number }): number {
  const v = t.paidCents - (t.refundedCents ?? 0) - t.taxCents - t.tipCents - t.giftCardChargeCents - t.rewardTenderCents;
  return Math.max(0, Math.floor(v));
}

/**
 * How much of a ticket's refunds came out of the EARNING amount (Nov 3 audit). A refund the POS marked as giving the tip
 * back is taken from the tip first; the rest is service money, of which the ticket's tax share is not eligible either.
 * Cumulative over every settled refund of the ticket, in order; never more than the earning's eligible amount.
 */
export function refundedEligibleCentsOf(t: { paidCents: number; taxCents: number; tipCents: number; eligibleCents: number; refunds: { amountCents: number; tipRefunded?: boolean }[] }): number {
  let tipLeft = Math.max(0, Math.floor(t.tipCents));
  const nonTip = Math.max(0, t.paidCents - t.tipCents);
  const taxShare = nonTip > 0 ? Math.min(1, Math.max(0, t.taxCents) / nonTip) : 0;
  let out = 0;
  for (const r of t.refunds) {
    const amt = Math.max(0, Math.floor(r.amountCents));
    const tipPart = r.tipRefunded ? Math.min(amt, tipLeft) : 0;
    tipLeft -= tipPart;
    const rest = amt - tipPart;
    out += rest - Math.round(rest * taxShare);
  }
  return Math.min(Math.max(0, t.eligibleCents), out);
}

// ── redemption (guide §2.2, §6.4) ───────────────────────────────────────────────────────────────────────────────
/** Redeem in whole blocks (10 points = $1, minimum one block), never more than the ticket still owes. */
export function redeemableBlocks(availableTenths: number, dueCents: number, program: ProgramPolicy): { blocks: number; pointTenths: number; valueCents: number } {
  const blockTenths = program.pointsPerRedeemBlock * 10;
  const byPoints = Math.floor(Math.max(0, availableTenths) / blockTenths);
  const byDue = Math.floor(Math.max(0, dueCents) / program.redeemBlockValueCents);
  const blocks = Math.min(byPoints, byDue);
  return { blocks, pointTenths: blocks * blockTenths, valueCents: blocks * program.redeemBlockValueCents };
}

// ── wallet alerts (guide §5.6) ───────────────────────────────────────────────────────────────────────────────────
export type AlertLevel = 'ok' | 'low' | 'critical' | 'empty';
/** C1 audit (Nov 4 2026) §5.6: the salon's own warning levels (tenant_token_wallets overrides) over the platform defaults. */
export function walletLevels(program: Pick<ProgramPolicy, 'lowBalanceCents' | 'criticalBalanceCents'>, w?: { low_balance_cents_override?: unknown; critical_balance_cents_override?: unknown } | null): Pick<ProgramPolicy, 'lowBalanceCents' | 'criticalBalanceCents'> {
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const low = num(w?.low_balance_cents_override), crit = num(w?.critical_balance_cents_override);
  const lowBalanceCents = low ?? program.lowBalanceCents;
  return { lowBalanceCents, criticalBalanceCents: Math.min(crit ?? program.criticalBalanceCents, lowBalanceCents) };
}
export function alertLevel(availableCents: number, program: Pick<ProgramPolicy, 'lowBalanceCents' | 'criticalBalanceCents'>): AlertLevel {
  if (availableCents <= 0) return 'empty';
  if (availableCents <= program.criticalBalanceCents) return 'critical';
  if (availableCents <= program.lowBalanceCents) return 'low';
  return 'ok';
}

// ── display helpers (exact, no floats) ──────────────────────────────────────────────────────────────────────────
/** 5 → "0.5", 100 → "10", 15 → "1.5" */
export const tenthsLabel = (t: number): string => { const n = Math.trunc(t); const s = n < 0 ? '-' : ''; const a = Math.abs(n); return `${s}${Math.floor(a / 10)}${a % 10 ? '.' + (a % 10) : ''}`; };
/** token cents → "0.05", "125.75" (tokenValueCents = 100) */
export const tokensLabel = (cents: number, tokenValueCents = 100): string => {
  if (tokenValueCents !== 100) return (cents / tokenValueCents).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const n = Math.trunc(cents); const s = n < 0 ? '-' : ''; const a = Math.abs(n); return `${s}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
export const dollarsLabel = (cents: number): string => `$${tokensLabel(cents, 100)}`;
/** "$10.00 eligible = 1 point" */
export const rateLabel = (r: Pick<EarningRate, 'spendIncrementCents' | 'pointTenthsPerIncrement'>): string => {
  const p = tenthsLabel(r.pointTenthsPerIncrement); return `${dollarsLabel(r.spendIncrementCents)} = ${p} ${p === '1' ? 'point' : 'points'}`;
};

// ── purchases (guide §5.3, §5.4) ────────────────────────────────────────────────────────────────────────────────
export const PURCHASE_STATUSES = ['REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING', 'FUNDS_VERIFIED',
  'FAILED', 'DECLINED', 'REVERSED', 'CHARGED_BACK', 'CANCELED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
/** Spendable ONLY at FUNDS_VERIFIED — confirmed payment ≠ settled bank funds (addendum rec. 4, guide §5.4). */
export const isSpendable = (s: string): boolean => s === 'FUNDS_VERIFIED';
export const isPending = (s: string): boolean => ['REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING'].includes(s);
/** Validate a purchase quantity (whole tokens) against the program. */
export function purchaseQuantity(tokens: unknown, program: ProgramPolicy): { tokenCents: number; amountCents: number } {
  const n = typeof tokens === 'number' ? tokens : Number(tokens);
  if (!Number.isInteger(n) || n < 1) throw new GlobalRewardsError('Choose a whole number of tokens (at least 1).', 'VALIDATION_FAILED', 400, { field: 'tokens' });
  if (n > program.maxPurchaseTokens) throw new GlobalRewardsError(`One purchase can be at most ${program.maxPurchaseTokens} tokens.`, 'VALIDATION_FAILED', 400, { field: 'tokens', max: program.maxPurchaseTokens });
  return { tokenCents: n * program.tokenValueCents, amountCents: n * program.tokenValueCents };
}

// Final Completion guide §05 (SPEC_CONFLICT_RESOLVED C-2): an owed payable is never PAID without verified provider settlement
export const REIMBURSEMENT_STATUSES = ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];
/** money still owed to the salon (not yet settled by a provider) */
export const isOwed = (s: string): boolean => ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAYOUT_FAILED', 'ON_HOLD'].includes(s);
export const HOLD_STATUSES = ['CREATED', 'HELD', 'CONFIRMED_REDEEMED', 'RELEASED', 'EXPIRED', 'REVERSED'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

/** extras GLOBAL LOYALTY REWARDS 03 (round 10) — Smart Wallet Funding Alert: an ESTIMATE from verified use only. dailyCents =
 *  the wallet's earn_allocation debits over the last `basisDays` ÷ basisDays (integer cents, rounded up so it never flatters);
 *  daysLeft = how many days the available balance lasts at that pace (rounded down) and daysToLow = until the low-balance
 *  level; fundingNeededCents = what would cover the next `basisDays` at that pace beyond what is available and already being
 *  purchased (pending). No use in the window → every estimate null (never invented). Nothing is ever bought automatically. */
export const FORECAST_BASIS_DAYS = 30;
/** extras GLOBAL LOYALTY REWARDS 04: the earning rule's expected effect is replayed over this many days of the salon's own earnings */
export const IMPACT_BASIS_DAYS = 30;
export function walletFundingForecast(availableCents: number, pendingCents: number, usedInBasisCents: number, basisDays: number, lowBalanceCents: number) {
  if (!(usedInBasisCents > 0) || !(basisDays > 0)) return { basisDays, usedCents: Math.max(0, usedInBasisCents), dailyCents: null, daysLeft: null, daysToLow: null, fundingNeededCents: null, automaticPurchase: false as const };
  const daily = Math.ceil(usedInBasisCents / basisDays);
  const avail = Math.max(0, availableCents);
  return { basisDays, usedCents: usedInBasisCents, dailyCents: daily, daysLeft: Math.floor(avail / daily), daysToLow: Math.max(0, Math.floor((avail - Math.max(0, lowBalanceCents)) / daily)),
    fundingNeededCents: Math.max(0, daily * basisDays - avail - Math.max(0, pendingCents)), automaticPurchase: false as const };
}

/** extras GLOBAL LOYALTY REWARDS 14 (round 10) — Readiness Control Center: one honest state per feature, from what is really
 *  configured (never "ready" by default). CODE_READY = built but switched off / paused here; SANDBOX_READY = runs against a
 *  sandbox provider only; PRODUCTION_READY = on, and needs no outside provider (or a real one is connected);
 *  BLOCKED_EXTERNAL = needs an outside provider that is not connected. Each carries coded evidence (the facts it was read from). */
export type ReadinessState = 'CODE_READY' | 'SANDBOX_READY' | 'PRODUCTION_READY' | 'BLOCKED_EXTERNAL';
export interface FeatureReadiness { feature: 'earning' | 'redemption' | 'custom_earning' | 'token_purchases' | 'salon_payouts'; state: ReadinessState; evidence: string[] }
export function networkReadiness(x: { flags: { engine: boolean; earn: boolean; redemption: boolean; purchases: boolean; customEarning: boolean }; program: { earnPaused: boolean; redeemPaused: boolean; purchasesPaused: boolean };
  enrolled: boolean; funding: { provider: string | null; sandbox: boolean }; payoutProvider: string | null }): FeatureReadiness[] {
  const onOff = (feature: FeatureReadiness['feature'], flag: boolean, paused: boolean, flagCode: string, pauseCode: string): FeatureReadiness => {
    const ev: string[] = [];
    if (!x.flags.engine) ev.push('engine_off');
    if (!flag) ev.push(flagCode);
    if (paused) ev.push(pauseCode);
    if (!x.enrolled) ev.push('not_enrolled');
    return { feature, state: ev.length ? 'CODE_READY' : 'PRODUCTION_READY', evidence: ev.length ? ev : ['enabled_no_external_dependency'] };
  };
  const purchases = (): FeatureReadiness => {
    if (!x.funding.provider) return { feature: 'token_purchases', state: 'BLOCKED_EXTERNAL', evidence: ['no_funding_provider_connected'] };
    const base = onOff('token_purchases', x.flags.purchases, x.program.purchasesPaused, 'purchases_flag_off', 'purchases_paused');
    if (base.state === 'CODE_READY') return base;
    return x.funding.sandbox ? { feature: 'token_purchases', state: 'SANDBOX_READY', evidence: ['sandbox_funding_provider'] } : { feature: 'token_purchases', state: 'PRODUCTION_READY', evidence: ['funding_provider_connected'] };
  };
  return [
    onOff('earning', x.flags.earn, x.program.earnPaused, 'earn_flag_off', 'earn_paused'),
    onOff('redemption', x.flags.redemption, x.program.redeemPaused, 'redemption_flag_off', 'redeem_paused'),
    onOff('custom_earning', x.flags.customEarning, false, 'custom_earning_flag_off', 'custom_earning_paused'),
    purchases(),
    x.payoutProvider ? { feature: 'salon_payouts', state: 'PRODUCTION_READY', evidence: ['payout_provider_connected'] } : { feature: 'salon_payouts', state: 'BLOCKED_EXTERNAL', evidence: ['no_payout_provider_connected'] },
  ];
}
