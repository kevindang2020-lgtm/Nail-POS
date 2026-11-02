// ai-money-protection-reconciliation.ts — Layer-3 batch reconciliation (spec §19–§24, §45). PURE + deterministic:
// it reuses authoritative domain data (membership_payments, gift_cards/transactions, cash_drawer_sessions —
// including their already-computed variance) and never recomputes financial truth. All output is non-accusatory
// (a variance/mismatch "requires review", never "theft"). Includes a per-tenant fair-batch helper so one busy
// tenant's reconciliation backlog can never starve others (spec §45).
import type { AlertCandidate } from './ai-money-protection.dto';
import { NONACCUSATORY } from './ai-money-protection.dto';
import { isCaptured } from './ai-money-protection-rules';

// ── Normalized inputs (built by the repo from authoritative tables) ────────────
export interface NormalizedMembershipPayment {
  id: string; branchId: string | null; customerId: string | null; amountCents: number; status: string;
  processorRef: string | null; idempotencyKey: string | null; createdAtMs: number;
}
export interface NormalizedGiftCard { id: string; branchId: string | null; balanceCents: number; status: string; }
export interface NormalizedGiftCardTxn { id: string; giftCardId: string; branchId: string | null; type: string; amountCents: number; balanceAfterCents: number; }
export interface NormalizedCashSession { id: string; branchId: string | null; businessDate: string; varianceCents: number | null; countedCents: number | null; expectedCents: number | null; status: string; }

function base(
  ruleId: string, alertType: string, severity: AlertCandidate['severity'], riskScore: number, amountCents: number,
  fingerprint: string, branchId: string | null, summary: string, related: AlertCandidate['related'],
  recommendedReview: string[], alternativeExplanations: string[],
): AlertCandidate {
  return {
    ruleId, alertType, severity, confidence: 'high', riskScore, amountCents,
    entityFingerprint: fingerprint, evaluationWindow: '', branchId,
    evidence: { summary, triggeredRules: [ruleId], recommendedReview, alternativeExplanations, dataFreshness: 'batch' },
    related,
  };
}

// ── Membership payments: duplicate charge (spec §21) ───────────────────────────
export function reconcileMembershipPayments(payments: NormalizedMembershipPayment[]): AlertCandidate[] {
  const captured = payments.filter((p) => isCaptured(p.status));
  const byKey = new Map<string, NormalizedMembershipPayment[]>();
  for (const p of captured) {
    for (const key of [p.idempotencyKey ? `idem:${p.idempotencyKey}` : null, p.processorRef ? `pref:${p.processorRef}` : null]) {
      if (!key) continue;
      const g = byKey.get(key) ?? []; g.push(p); byKey.set(key, g);
    }
  }
  const out: AlertCandidate[] = [];
  const seen = new Set<string>();
  for (const [key, group] of byKey) {
    if (group.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(base(
      'MP_MEMBERSHIP_DUP_CHARGE', 'duplicate_membership_charge', 'HIGH', 84, group[0].amountCents,
      `membership_dup:${key}`, group[0].branchId,
      `${NONACCUSATORY.potentialDuplicate} The same ${key.startsWith('idem') ? 'idempotency key' : 'processor reference'} is attached to ${group.length} captured membership charges.`,
      { transactionIds: group.map((p) => p.id), customerIds: uniq(group.map((p) => p.customerId)) },
      ['Confirm whether the member was charged more than once and whether a refund is owed.'],
      ['A single charge recorded twice (webhook replay).', 'A retried charge that was correctly de-duplicated downstream.'],
    ));
  }
  return out;
}

// ── Gift cards: negative balance + redemption exceeding balance (spec §20) ──────
export function reconcileGiftCards(cards: NormalizedGiftCard[], txns: NormalizedGiftCardTxn[]): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const c of cards) {
    if (c.balanceCents >= 0) continue;
    out.push(base(
      'MP_GIFTCARD_NEGATIVE_BALANCE', 'giftcard_negative_balance', 'HIGH', 83, Math.abs(c.balanceCents),
      `giftcard_neg:${c.id}`, c.branchId,
      `${NONACCUSATORY.possibleAnomaly} A gift card has a negative balance.`,
      { transactionIds: [c.id] },
      ['Reconcile the gift card\'s transaction history against its balance.'],
      ['A redemption and reload race not yet settled.', 'A manual balance adjustment error.'],
    ));
  }
  const REDEEM = new Set(['redeem', 'redemption', 'redeemed', 'debit']);
  for (const t of txns) {
    if (!REDEEM.has((t.type || '').toLowerCase())) continue;
    if (t.balanceAfterCents >= 0) continue;
    out.push(base(
      'MP_GIFTCARD_REDEEM_EXCEEDS', 'giftcard_redemption_exceeds_balance', 'HIGH', 82, Math.abs(t.balanceAfterCents),
      `giftcard_redeem_over:${t.id}`, t.branchId,
      `${NONACCUSATORY.policyMismatch} A gift-card redemption left the balance negative.`,
      { transactionIds: [t.id, t.giftCardId] },
      ['Verify how a redemption exceeded the available balance.'],
      ['Concurrent redemptions on the same card.', 'A balance not synced before redemption.'],
    ));
  }
  return out;
}

// ── Cash drawer variance (spec §23) ────────────────────────────────────────────
export function reconcileCashDrawers(sessions: NormalizedCashSession[], toleranceCents = 200): AlertCandidate[] {
  const CLOSED = new Set(['reconciled', 'closed', 'counted']);
  const out: AlertCandidate[] = [];
  for (const s of sessions) {
    if (!CLOSED.has((s.status || '').toLowerCase())) continue;
    const variance = s.varianceCents ?? ((s.countedCents ?? 0) - (s.expectedCents ?? 0));
    if (Math.abs(variance) < toleranceCents) continue;
    const dir = variance < 0 ? 'short' : 'over';
    out.push(base(
      'MP_CASH_DRAWER_VARIANCE', 'cash_drawer_variance', Math.abs(variance) >= toleranceCents * 5 ? 'HIGH' : 'MEDIUM',
      Math.abs(variance) >= toleranceCents * 5 ? 70 : 50, Math.abs(variance),
      `cash_variance:${s.id}`, s.branchId,
      `${NONACCUSATORY.possibleAnomaly} The cash drawer for ${s.businessDate} was ${dir} at close (variance under review).`,
      { transactionIds: [s.id] },
      ['Review the drawer count, movements, and cash payments for this business date.'],
      ['Miscount at close.', 'A cash movement recorded late.', 'Change-making rounding across the day.'],
    ));
  }
  return out;
}

export function runReconciliation(data: {
  membershipPayments: NormalizedMembershipPayment[];
  giftCards: NormalizedGiftCard[];
  giftCardTxns: NormalizedGiftCardTxn[];
  cashSessions: NormalizedCashSession[];
}): AlertCandidate[] {
  return [
    ...reconcileMembershipPayments(data.membershipPayments),
    ...reconcileGiftCards(data.giftCards, data.giftCardTxns),
    ...reconcileCashDrawers(data.cashSessions),
  ];
}

// ── Per-tenant fair batching for the reconciliation worker (spec §45) ──────────
// Round-robin across tenants so one tenant's backlog can't monopolize a cycle: at most maxPerTenant items per
// tenant, up to maxTotal overall; the rest are deferred to the next cycle (never dropped).
export function fairBatchByTenant<T>(items: T[], tenantOf: (x: T) => string, opts: { maxPerTenant: number; maxTotal: number }): T[] {
  const maxPerTenant = Math.max(1, opts.maxPerTenant);
  const maxTotal = Math.max(1, opts.maxTotal);
  const byTenant = new Map<string, T[]>();
  const order: string[] = [];
  for (const it of items) {
    const t = tenantOf(it);
    let q = byTenant.get(t); if (!q) { q = []; byTenant.set(t, q); order.push(t); }
    q.push(it);
  }
  const taken: T[] = [];
  const count = new Map<string, number>();
  let progress = true;
  while (taken.length < maxTotal && progress) {
    progress = false;
    for (const t of order) {
      if (taken.length >= maxTotal) break;
      const q = byTenant.get(t)!;
      const c = count.get(t) ?? 0;
      if (q.length > 0 && c < maxPerTenant) { taken.push(q.shift()!); count.set(t, c + 1); progress = true; }
    }
  }
  return taken;
}

function uniq<T>(xs: (T | null)[]): T[] { return [...new Set(xs.filter((x): x is T => x != null))]; }
