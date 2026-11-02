// expense-matching.ts — PURE verdicts for the three "link, never fabricate" rules of the Receipt / Expense mandate:
//   §142  a receipt that arrives later is matched to an EXISTING expense (vendor, date, amount, reference) and the link is
//         SUGGESTED to a person — an uncertain match is never auto-linked;
//   §62/§63 an expense is matched to a payment / bank transaction the platform already holds, with the same vocabulary
//         MATCHED / POSSIBLE_MATCH / UNMATCHED — and no match is ever invented;
//   §83   an owner's low-risk auto-approval rule (a trusted vendor under a threshold) decides whether an OCR-posted expense
//         may land approved without a tap. The OWNER's rule is the authority; the AI alone never approves.
// Everything here is deterministic over integer cents and normalised vendor names; nothing reads the database.
import { normalizeVendorName, vendorSimilarity } from './vendor-normalize';

export type MatchVerdict = 'matched' | 'possible_match' | 'unmatched';

export interface ReceiptSubject { vendor: string | null; documentDate: string | null; totalCents: number | null; documentNumber: string | null }
export interface ExpenseCandidate { id: string; vendor: string | null; vendorName?: string | null; incurredOn: string; amountCents: number; invoiceNumber: string | null; receiptNumber: string | null; referenceNumber: string | null; receiptDocumentId: string | null; status: string }
export interface ReceiptMatch { verdict: MatchVerdict; expenseId: string | null; reason: string | null; candidates: Array<{ expenseId: string; score: number; reasons: string[] }> }

const dayDiff = (a: string | null, b: string | null): number | null => {
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
  return Math.abs(Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000));
};
const refKey = (v: string | null | undefined) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * §142. Scores every candidate; MATCHED needs the same total AND (the same reference number, or the same normalised vendor
 * within ±2 days). A same-total-same-window hit with a different / unknown vendor is only POSSIBLE_MATCH. A candidate that
 * already carries a receipt is never MATCHED (it has its evidence) — at most POSSIBLE_MATCH, for the reviewer to decide.
 */
export function matchReceiptToExpenses(r: ReceiptSubject, candidates: ExpenseCandidate[]): ReceiptMatch {
  const vendorNorm = normalizeVendorName(r.vendor);
  const ref = refKey(r.documentNumber);
  const scored = candidates.filter((c) => c.status !== 'voided').map((c) => {
    const reasons: string[] = []; let score = 0;
    const sameTotal = r.totalCents != null && c.amountCents === r.totalCents;
    if (sameTotal) { score += 50; reasons.push('same_total'); }
    const dd = dayDiff(r.documentDate, c.incurredOn);
    if (dd != null && dd <= 2) { score += dd === 0 ? 20 : 10; reasons.push(dd === 0 ? 'same_date' : 'date_within_2_days'); }
    const cv = normalizeVendorName(c.vendorName ?? c.vendor);
    const sim = vendorNorm && cv ? vendorSimilarity(vendorNorm, cv) : 0;
    if (vendorNorm && cv && (vendorNorm === cv || sim >= 0.9)) { score += 30; reasons.push('same_vendor'); }
    else if (vendorNorm && cv && sim >= 0.7) { score += 10; reasons.push('similar_vendor'); }
    if (ref && (refKey(c.invoiceNumber) === ref || refKey(c.receiptNumber) === ref || refKey(c.referenceNumber) === ref)) { score += 40; reasons.push('same_reference'); }
    if (c.receiptDocumentId) { score = Math.min(score, 60); reasons.push('already_has_receipt'); }
    return { expenseId: c.id, score, reasons };
  }).filter((c) => c.score >= 50).sort((a, b) => b.score - a.score);
  if (!scored.length) return { verdict: 'unmatched', expenseId: null, reason: null, candidates: [] };
  const top = scored[0];
  const strong = top.reasons.includes('same_total') && (top.reasons.includes('same_reference') || (top.reasons.includes('same_vendor') && (top.reasons.includes('same_date') || top.reasons.includes('date_within_2_days'))));
  const unique = scored.length === 1 || scored[1].score < top.score;
  if (strong && unique && !top.reasons.includes('already_has_receipt')) return { verdict: 'matched', expenseId: top.expenseId, reason: top.reasons.join(','), candidates: scored.slice(0, 5) };
  return { verdict: 'possible_match', expenseId: top.expenseId, reason: top.reasons.join(','), candidates: scored.slice(0, 5) };
}

// ── §62/§63 expense ↔ payment / bank transaction ───────────────────────────────────────────────────────────────────────
export interface PaymentCandidate { id: string; amountCents: number; occurredOn: string; last4?: string | null; reference?: string | null; counterparty?: string | null }
export interface PaymentMatch { verdict: MatchVerdict; paymentId: string | null; reason: string | null }

/**
 * A payment MATCHES when the amount is identical, the date is within ±3 days and at least one more fact agrees (card last4,
 * a reference, or the counterparty name resembling the vendor) — and only one payment qualifies. Same amount + date alone is
 * POSSIBLE_MATCH (a person decides). Nothing else is a match: an expense with no candidate stays UNMATCHED.
 */
export function matchExpenseToPayments(e: { amountCents: number; incurredOn: string; cardLast4: string | null; referenceNumber: string | null; vendor: string | null }, payments: PaymentCandidate[]): PaymentMatch {
  const vendorNorm = normalizeVendorName(e.vendor);
  const scored = payments.filter((p) => p.amountCents === e.amountCents).map((p) => {
    const dd = dayDiff(e.incurredOn, p.occurredOn);
    if (dd == null || dd > 3) return null;
    const reasons = ['same_amount', dd === 0 ? 'same_date' : 'date_within_3_days'];
    if (e.cardLast4 && p.last4 && e.cardLast4 === p.last4) reasons.push('same_last4');
    if (e.referenceNumber && p.reference && refKey(e.referenceNumber) === refKey(p.reference)) reasons.push('same_reference');
    const cp = normalizeVendorName(p.counterparty ?? null);
    if (vendorNorm && cp && vendorSimilarity(vendorNorm, cp) >= 0.8) reasons.push('same_counterparty');
    return { id: p.id, reasons, strong: reasons.length >= 3 };
  }).filter((x): x is { id: string; reasons: string[]; strong: boolean } => !!x);
  if (!scored.length) return { verdict: 'unmatched', paymentId: null, reason: null };
  const strong = scored.filter((s) => s.strong);
  if (strong.length === 1) return { verdict: 'matched', paymentId: strong[0].id, reason: strong[0].reasons.join(',') };
  return { verdict: 'possible_match', paymentId: scored[0].id, reason: scored[0].reasons.join(',') };
}

// ── §83 owner-defined low-risk auto-approval ───────────────────────────────────────────────────────────────────────────
export interface AutoApprovalRule { vendorNorm: string; maxCents: number; categoryKey?: string | null; enabled?: boolean }

/** stored jsonb → typed rules; a malformed entry is dropped, never guessed */
export function autoApprovalRulesOf(v: unknown): AutoApprovalRule[] {
  return (Array.isArray(v) ? v : []).filter((x: any) => x && typeof x.vendorNorm === 'string' && x.vendorNorm && Number.isInteger(x.maxCents) && x.maxCents > 0)
    .map((x: any) => ({ vendorNorm: String(x.vendorNorm), maxCents: Number(x.maxCents), categoryKey: typeof x.categoryKey === 'string' && x.categoryKey ? x.categoryKey : null, enabled: x.enabled !== false }));
}

/**
 * An OCR-posted expense may auto-approve ONLY when: an enabled owner rule names its normalised vendor, the total is at or
 * under that rule's threshold, the rule's category (if any) is the one chosen, the money reconciles, nothing is flagged for
 * review and it is not a suspected duplicate. The rule is the owner's standing decision; the AI contributed only the reading.
 */
export function autoApprovalDecision(x: { vendor: string | null; amountCents: number; category: string; reconciles: boolean; reviewFlags: string[]; duplicate: boolean; hasReceipt: boolean }, rules: AutoApprovalRule[]): { approve: boolean; rule: AutoApprovalRule | null; reason: string } {
  if (!x.hasReceipt) return { approve: false, rule: null, reason: 'only an expense with receipt evidence is auto-approved by rule' };
  const vn = normalizeVendorName(x.vendor);
  if (!vn) return { approve: false, rule: null, reason: 'no vendor' };
  const rule = rules.find((r) => r.enabled !== false && r.vendorNorm === vn && (!r.categoryKey || r.categoryKey === x.category)) ?? null;
  if (!rule) return { approve: false, rule: null, reason: 'no rule for this vendor' };
  if (x.amountCents > rule.maxCents) return { approve: false, rule, reason: 'over the rule threshold' };
  if (!x.reconciles) return { approve: false, rule, reason: 'amounts do not reconcile' };
  if (x.duplicate) return { approve: false, rule, reason: 'possible duplicate' };
  if (x.reviewFlags.length) return { approve: false, rule, reason: `flagged: ${x.reviewFlags.join(',')}` };
  return { approve: true, rule, reason: 'owner rule' };
}
