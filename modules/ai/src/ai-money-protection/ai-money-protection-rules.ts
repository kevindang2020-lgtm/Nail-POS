// ai-money-protection-rules.ts — PURE deterministic financial-integrity rules (Layer 1, spec §7/§10/§12).
// No AI, no DB, no baselines: these detect states that should never depend on probability. Fully unit-testable.
// Every candidate carries non-accusatory evidence and a stable dedup fingerprint. Money is integer cents.
import type { AlertCandidate, Severity, RelatedEntities } from './ai-money-protection.dto';
import { NONACCUSATORY } from './ai-money-protection.dto';

// Normalized inputs (built by the repository from authoritative tables — never card data).
export interface NormalizedPayment {
  id: string;
  branchId: string | null;
  ticketId: string | null;
  amountCents: number;         // captured/charged amount
  method: string;              // 'card' | 'cash' | 'gift_card' | ...
  status: string;              // authoritative payment status
  idempotencyKey: string | null;
  processorTxnId: string | null;
  createdByUserId: string | null;
  createdAtMs: number;
}
export interface NormalizedRefund {
  id: string;
  branchId: string | null;
  ticketId: string | null;
  amountCents: number;         // positive magnitude of the refund
  method?: string;             // refund method (card/cash/...), when known
  byUserId?: string | null;    // who recorded the reversal, when known (for fairness-gated baselines)
  status: string;
  createdAtMs: number;
}
export interface NormalizedTicket {
  id: string;
  branchId: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  status: string;
}
export interface NormalizedAttempt {
  id: string;
  branchId: string | null;
  ticketId: string | null;
  status: string;              // 'declined' | 'approved' | ...
  method: string;
  createdAtMs: number;
}

// Which payment statuses count as "money actually captured". Aligned with the repo's REVENUE_BEARING_STATUSES
// (checkout writes 'approved'; split captures 'partial') plus defensive processor-driven variants.
const CAPTURED = new Set(['approved', 'partial', 'paid', 'captured', 'settled', 'success', 'succeeded', 'completed']);
export function isCaptured(status: string): boolean { return CAPTURED.has((status || '').toLowerCase()); }

const LIKELY_DUP_WINDOW_MS = 120_000; // 2 minutes (spec §70 default)

function candidate(
  ruleId: string, alertType: string, severity: Severity, riskScore: number, amountCents: number,
  entityFingerprint: string, branchId: string | null, summary: string,
  triggeredRules: string[], related: RelatedEntities, recommendedReview: string[],
  alternativeExplanations: string[], extra?: Partial<AlertCandidate>,
): AlertCandidate {
  return {
    ruleId, alertType, severity, confidence: 'high', riskScore, amountCents,
    entityFingerprint, evaluationWindow: '', branchId,
    evidence: { summary, triggeredRules, recommendedReview, alternativeExplanations, dataFreshness: 'realtime' },
    related, ...extra,
  };
}

// ── Duplicate charge (spec §10/§11) ────────────────────────────────────────────
// EXACT: two captured payments share a non-null processor_transaction_id OR idempotency_key.
// LIKELY: same branch+ticket+amount+method, 2+ captured payments within 2 minutes, SAME method (a different
// method would be a legitimate split payment and is excluded).
export function detectDuplicateCharge(payments: NormalizedPayment[], likelyWindowMs: number = LIKELY_DUP_WINDOW_MS): AlertCandidate[] {
  const captured = payments.filter((p) => isCaptured(p.status));
  const out: AlertCandidate[] = [];
  const seenExact = new Set<string>();

  // EXACT — shared processor txn id or idempotency key.
  const byKey = new Map<string, NormalizedPayment[]>();
  for (const p of captured) {
    for (const key of [p.processorTxnId ? `ptx:${p.processorTxnId}` : null, p.idempotencyKey ? `idem:${p.idempotencyKey}` : null]) {
      if (!key) continue;
      const g = byKey.get(key) ?? [];
      g.push(p); byKey.set(key, g);
    }
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    if (seenExact.has(key)) continue;
    seenExact.add(key);
    const amount = group[0].amountCents;
    out.push(candidate(
      'MP_DUP_CHARGE_EXACT', 'duplicate_charge_exact', 'CRITICAL', 95, amount,
      `dup:exact:${key}`, group[0].branchId,
      `${NONACCUSATORY.potentialDuplicate} The same ${key.startsWith('ptx') ? 'processor transaction' : 'idempotency key'} is attached to ${group.length} captured payments.`,
      ['MP_DUP_CHARGE_EXACT'],
      { transactionIds: group.map((p) => p.id), ticketIds: uniq(group.map((p) => p.ticketId)), processorReferences: uniq(group.map((p) => p.processorTxnId)) },
      ['Open both transactions and compare processor state, ticket state, and receipts.', 'Verify whether one should be voided/refunded through the authorized workflow.'],
      ['A single legitimate payment recorded twice by a duplicate webhook.', 'A processor retry that was correctly de-duplicated downstream.'],
    ));
  }

  // LIKELY — same ticket+amount+method within the window, same method (split payments excluded).
  const byTam = new Map<string, NormalizedPayment[]>();
  for (const p of captured) {
    if (!p.ticketId) continue;
    const k = `${p.branchId ?? ''}|${p.ticketId}|${p.amountCents}|${p.method}`;
    const g = byTam.get(k) ?? []; g.push(p); byTam.set(k, g);
  }
  for (const [k, group] of byTam) {
    if (group.length < 2) continue;
    const sorted = group.slice().sort((a, b) => a.createdAtMs - b.createdAtMs);
    let clustered = false;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].createdAtMs - sorted[i - 1].createdAtMs <= likelyWindowMs) clustered = true;
    if (!clustered) continue;
    // skip if already captured as EXACT (shared key)
    const alreadyExact = group.some((p) => (p.processorTxnId && seenExact.has(`ptx:${p.processorTxnId}`)) || (p.idempotencyKey && seenExact.has(`idem:${p.idempotencyKey}`)));
    if (alreadyExact) continue;
    out.push(candidate(
      'MP_DUP_CHARGE_LIKELY', 'duplicate_charge_likely', 'HIGH', 78, group[0].amountCents,
      `dup:likely:${k}`, group[0].branchId,
      `${NONACCUSATORY.potentialDuplicate} ${group.length} payments of the same amount and method were captured on one ticket within a short interval.`,
      ['MP_DUP_CHARGE_LIKELY'],
      { transactionIds: group.map((p) => p.id), ticketIds: [group[0].ticketId!] },
      ['Confirm whether these are one charge captured twice or genuinely separate purchases.', 'Check for a valid split-payment or separate retail sale before any reversal.'],
      ['A legitimate split payment (would use different methods).', 'Two genuine separate purchases on the same ticket.', 'A customer paying twice intentionally.'],
    ));
  }
  return out;
}

// ── Refund exceeds captured (spec §12 / §91) ───────────────────────────────────
// Per ticket: total refunded must never exceed total captured. This is a hard invariant, not a probability.
export function detectRefundExceedsCapture(payments: NormalizedPayment[], refunds: NormalizedRefund[]): AlertCandidate[] {
  const capturedByTicket = new Map<string, { cents: number; ids: string[]; branchId: string | null }>();
  for (const p of payments) {
    if (!p.ticketId || !isCaptured(p.status)) continue;
    const e = capturedByTicket.get(p.ticketId) ?? { cents: 0, ids: [], branchId: p.branchId };
    e.cents += p.amountCents; e.ids.push(p.id); capturedByTicket.set(p.ticketId, e);
  }
  const refundedByTicket = new Map<string, { cents: number; ids: string[] }>();
  for (const r of refunds) {
    if (!r.ticketId) continue;
    const e = refundedByTicket.get(r.ticketId) ?? { cents: 0, ids: [] };
    e.cents += Math.abs(r.amountCents); e.ids.push(r.id); refundedByTicket.set(r.ticketId, e);
  }
  const out: AlertCandidate[] = [];
  for (const [ticketId, refunded] of refundedByTicket) {
    const captured = capturedByTicket.get(ticketId);
    const capturedCents = captured?.cents ?? 0;
    if (refunded.cents <= capturedCents) continue;
    const over = refunded.cents - capturedCents;
    out.push(candidate(
      'MP_REFUND_EXCEEDS_CAPTURE', 'refund_exceeds_capture', 'HIGH', 88, over,
      `refund_over:${ticketId}`, captured?.branchId ?? null,
      `${NONACCUSATORY.policyMismatch} Refunds on this ticket total more than was captured (refunded exceeds captured by the amount under review).`,
      ['MP_REFUND_EXCEEDS_CAPTURE'],
      { ticketIds: [ticketId], transactionIds: [...(captured?.ids ?? []), ...refunded.ids] },
      ['Reconcile refunds against captured payments for this ticket.', 'Check for a processor refund not reflected in POS, or a duplicate refund.'],
      ['A processor refund recorded twice (POS + webhook).', 'A refund attached to the wrong ticket.', 'A partial capture that is not reflected in POS.'],
    ));
  }
  return out;
}

// ── Refund method mismatch (spec §12/§14) ──────────────────────────────────────
// A refund issued via a method that was never used to capture on that ticket (e.g. a card sale refunded as cash)
// is a policy mismatch and a classic skimming vector. Deterministic when refund method + capture methods are known.
export function detectRefundMethodMismatch(payments: NormalizedPayment[], refunds: NormalizedRefund[]): AlertCandidate[] {
  const methodsByTicket = new Map<string, Set<string>>();
  for (const p of payments) {
    if (!p.ticketId || !isCaptured(p.status) || !p.method) continue;
    const s = methodsByTicket.get(p.ticketId) ?? new Set(); s.add(p.method.toLowerCase()); methodsByTicket.set(p.ticketId, s);
  }
  const out: AlertCandidate[] = [];
  for (const r of refunds) {
    if (!r.ticketId || !r.method) continue;
    const captureMethods = methodsByTicket.get(r.ticketId);
    if (!captureMethods || captureMethods.size === 0) continue; // no-capture case is handled by refund_exceeds_capture
    if (captureMethods.has(r.method.toLowerCase())) continue;
    out.push(candidate(
      'MP_REFUND_METHOD_MISMATCH', 'refund_method_mismatch', 'HIGH', 80, Math.abs(r.amountCents),
      `refund_method:${r.ticketId}:${r.id}`, r.branchId,
      `${NONACCUSATORY.policyMismatch} A refund was issued by a method not used to pay this ticket.`,
      ['MP_REFUND_METHOD_MISMATCH'],
      { ticketIds: [r.ticketId], transactionIds: [r.id] },
      ['Confirm the refund method matches the original capture, or that a manager approved an exception.'],
      ['A documented manager-approved exception.', 'Original captured on a card no longer available; refunded another way per policy.'],
    ));
  }
  return out;
}

// ── Discount exceeds subtotal (spec §14) ───────────────────────────────────────
// A discount larger than the ticket subtotal is impossible under normal policy — a data/config integrity issue.
export function detectExcessiveDiscount(tickets: NormalizedTicket[]): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const t of tickets) {
    if (t.discountCents <= t.subtotalCents) continue;
    out.push(candidate(
      'MP_DISCOUNT_EXCEEDS_SUBTOTAL', 'discount_exceeds_subtotal', 'HIGH', 82, t.discountCents - t.subtotalCents,
      `discount_over:${t.id}`, t.branchId,
      `${NONACCUSATORY.policyMismatch} The discount recorded on this ticket is larger than its subtotal.`,
      ['MP_DISCOUNT_EXCEEDS_SUBTOTAL'],
      { ticketIds: [t.id] },
      ['Review how the discount was applied and whether it reflects an intended promotion.'],
      ['A stacked promotion misconfiguration.', 'A manual discount entered in the wrong field.'],
    ));
  }
  return out;
}

// ── Non-positive captured amount (data integrity) ──────────────────────────────
export function detectNonPositiveCapture(payments: NormalizedPayment[]): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const p of payments) {
    if (!isCaptured(p.status) || p.amountCents >= 0) continue; // negative captured amount only
    out.push(candidate(
      'MP_NEGATIVE_CAPTURE', 'negative_capture_amount', 'MEDIUM', 60, Math.abs(p.amountCents),
      `neg_capture:${p.id}`, p.branchId,
      `${NONACCUSATORY.possibleAnomaly} A captured payment has a negative amount.`,
      ['MP_NEGATIVE_CAPTURE'],
      { transactionIds: [p.id], ticketIds: p.ticketId ? [p.ticketId] : [] },
      ['Verify whether this row should be a refund/reversal rather than a captured payment.'],
      ['A reversal miscategorized as a captured payment.', 'A data-entry or import error.'],
    ));
  }
  return out;
}

// ── Multiple reversals on one ticket (possible double reversal) ────────────────
export function detectMultipleReversals(refunds: NormalizedRefund[]): AlertCandidate[] {
  const byTicket = new Map<string, NormalizedRefund[]>();
  for (const r of refunds) { if (!r.ticketId) continue; const g = byTicket.get(r.ticketId) ?? []; g.push(r); byTicket.set(r.ticketId, g); }
  const out: AlertCandidate[] = [];
  for (const [ticketId, group] of byTicket) {
    if (group.length < 2) continue;
    out.push(candidate(
      'MP_MULTIPLE_REVERSALS', 'multiple_reversals', 'MEDIUM', 65, group.reduce((s, r) => s + Math.abs(r.amountCents), 0),
      `multi_reversal:${ticketId}`, group[0].branchId,
      `${NONACCUSATORY.potentialDuplicate} This ticket has ${group.length} refund/void records.`,
      ['MP_MULTIPLE_REVERSALS'],
      { ticketIds: [ticketId], transactionIds: group.map((r) => r.id) },
      ['Confirm each reversal is intended and not a duplicate refund of the same charge.'],
      ['Multiple partial refunds of distinct line items.', 'A void followed by a corrected refund.'],
    ));
  }
  return out;
}

// ── Failed-payment retry loop (spec §13) ───────────────────────────────────────
// Repeated declined attempts on one ticket in a short window can indicate a stuck terminal or card testing.
// Deterministic count/window — not a probability. Threshold kept conservative to avoid flagging normal retries.
const RETRY_WINDOW_MS = 15 * 60 * 1000;
const RETRY_MIN = 4;
export function detectFailedPaymentRetryLoop(attempts: NormalizedAttempt[], opts: { minDeclines?: number; windowMinutes?: number; highSeverityAt?: number } = {}): AlertCandidate[] {
  const windowMs = (opts.windowMinutes != null ? opts.windowMinutes * 60_000 : RETRY_WINDOW_MS);
  const minDeclines = opts.minDeclines ?? RETRY_MIN;
  const highAt = opts.highSeverityAt ?? 8;
  const declinedByTicket = new Map<string, NormalizedAttempt[]>();
  for (const a of attempts) {
    if (!a.ticketId || (a.status || '').toLowerCase() !== 'declined') continue;
    const g = declinedByTicket.get(a.ticketId) ?? []; g.push(a); declinedByTicket.set(a.ticketId, g);
  }
  const out: AlertCandidate[] = [];
  for (const [ticketId, group] of declinedByTicket) {
    const sorted = group.slice().sort((a, b) => a.createdAtMs - b.createdAtMs);
    let maxInWindow = 0;
    for (let i = 0; i < sorted.length; i++) {
      let c = 1;
      for (let j = i + 1; j < sorted.length && sorted[j].createdAtMs - sorted[i].createdAtMs <= windowMs; j++) c++;
      maxInWindow = Math.max(maxInWindow, c);
    }
    if (maxInWindow < minDeclines) continue;
    out.push(candidate(
      'MP_FAILED_PAYMENT_RETRY_LOOP', 'failed_payment_retry_loop', maxInWindow >= highAt ? 'HIGH' : 'MEDIUM', maxInWindow >= highAt ? 75 : 55, 0,
      `retry_loop:${ticketId}`, group[0].branchId,
      `${NONACCUSATORY.possibleAnomaly} ${maxInWindow} declined payment attempts occurred on this ticket within a short window.`,
      ['MP_FAILED_PAYMENT_RETRY_LOOP'],
      { ticketIds: [ticketId], transactionIds: sorted.map((a) => a.id) },
      ['Check whether the terminal or card reader is functioning, and whether the card is being re-tried.'],
      ['A customer re-entering a valid card after typos.', 'A flaky terminal or network causing legitimate retries.'],
    ));
  }
  return out;
}

const PAID_STATUSES = new Set(['paid', 'closed', 'completed']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'voided', 'void']);

function capturedByTicket(payments: NormalizedPayment[]): Map<string, { cents: number; ids: string[]; branchId: string | null }> {
  const m = new Map<string, { cents: number; ids: string[]; branchId: string | null }>();
  for (const p of payments) {
    if (!p.ticketId || !isCaptured(p.status)) continue;
    const e = m.get(p.ticketId) ?? { cents: 0, ids: [], branchId: p.branchId };
    e.cents += p.amountCents; e.ids.push(p.id); m.set(p.ticketId, e);
  }
  return m;
}

// ── Paid ticket with no captured payment (spec §91 reconciliation) ─────────────
// A ticket marked paid with a non-zero total but zero captured money is a hard reconciliation gap.
// (Fully-comped/100%-discount tickets have total 0 and are excluded; gift-card/cash captures are payment rows.)
export function detectPaidTicketNoCapture(payments: NormalizedPayment[], tickets: NormalizedTicket[]): AlertCandidate[] {
  const cap = capturedByTicket(payments);
  const out: AlertCandidate[] = [];
  for (const t of tickets) {
    if (!PAID_STATUSES.has((t.status || '').toLowerCase())) continue;
    if (t.totalCents <= 0) continue;
    if ((cap.get(t.id)?.cents ?? 0) > 0) continue;
    out.push(candidate(
      'MP_PAID_NO_CAPTURE', 'paid_ticket_no_capture', 'HIGH', 85, t.totalCents,
      `paid_no_capture:${t.id}`, t.branchId,
      `${NONACCUSATORY.processorSyncIssue} This ticket is marked paid but no captured payment is recorded against it.`,
      ['MP_PAID_NO_CAPTURE'],
      { ticketIds: [t.id] },
      ['Reconcile the ticket against the processor and cash drawer to locate the payment or correct the status.'],
      ['A captured payment not yet synced from the processor.', 'A cash payment recorded outside the ticket.', 'A manual status change.'],
    ));
  }
  return out;
}

// ── Captured money on a cancelled/voided ticket (spec §91) ─────────────────────
// A cancelled ticket should have no net captured money; if captured exceeds refunded, funds are unaccounted.
export function detectCaptureOnCancelledTicket(payments: NormalizedPayment[], refunds: NormalizedRefund[], tickets: NormalizedTicket[]): AlertCandidate[] {
  const cap = capturedByTicket(payments);
  const refByTicket = new Map<string, number>();
  for (const r of refunds) { if (!r.ticketId) continue; refByTicket.set(r.ticketId, (refByTicket.get(r.ticketId) ?? 0) + Math.abs(r.amountCents)); }
  const out: AlertCandidate[] = [];
  for (const t of tickets) {
    if (!CANCELLED_STATUSES.has((t.status || '').toLowerCase())) continue;
    const net = (cap.get(t.id)?.cents ?? 0) - (refByTicket.get(t.id) ?? 0);
    if (net <= 0) continue;
    out.push(candidate(
      'MP_CAPTURE_ON_CANCELLED', 'capture_on_cancelled_ticket', 'HIGH', 86, net,
      `capture_cancelled:${t.id}`, t.branchId,
      `${NONACCUSATORY.policyMismatch} This ticket is cancelled/voided but still has net captured money not refunded.`,
      ['MP_CAPTURE_ON_CANCELLED'],
      { ticketIds: [t.id], transactionIds: cap.get(t.id)?.ids ?? [] },
      ['Confirm whether a refund/void is owed for the captured amount on this cancelled ticket.'],
      ['A refund in progress not yet recorded.', 'A ticket cancelled after payment where a refund is pending.'],
    ));
  }
  return out;
}

// Run all Layer-1 deterministic rules over a tenant's normalized recent activity.
export function runDeterministicRules(
  payments: NormalizedPayment[],
  refunds: NormalizedRefund[],
  tickets: NormalizedTicket[] = [],
  attempts: NormalizedAttempt[] = [],
  overrides: Record<string, Record<string, number>> = {},
): AlertCandidate[] {
  const dup = overrides['MP_DUP_CHARGE_LIKELY'];
  const retry = overrides['MP_FAILED_PAYMENT_RETRY_LOOP'] ?? {};
  return [
    ...detectDuplicateCharge(payments, dup?.windowSeconds != null ? dup.windowSeconds * 1000 : undefined),
    ...detectRefundExceedsCapture(payments, refunds),
    ...detectRefundMethodMismatch(payments, refunds),
    ...detectExcessiveDiscount(tickets),
    ...detectNonPositiveCapture(payments),
    ...detectMultipleReversals(refunds),
    ...detectFailedPaymentRetryLoop(attempts, { minDeclines: retry.minDeclines, windowMinutes: retry.windowMinutes, highSeverityAt: retry.highSeverityAt }),
    ...detectPaidTicketNoCapture(payments, tickets),
    ...detectCaptureOnCancelledTicket(payments, refunds, tickets),
  ];
}

function uniq<T>(xs: (T | null)[]): T[] { return [...new Set(xs.filter((x): x is T => x != null))]; }

