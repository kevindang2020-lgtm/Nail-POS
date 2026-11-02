// money-protection-text.ts — Vietnamese POS §21 / §120 (Oct 27 2026): AI Money Protection writes FIXED English into an
// alert's evidence (summary, suggested review, possible benign explanations — modules/ai/src/ai-money-protection/
// ai-money-protection-rules.ts, -reconciliation.ts, -baselines.ts) and a deterministic fallback explanation. This table is
// those sentences as code → English template; mpTextCoded() re-codes a stored sentence (old alerts too) so the POS words
// it in the cashier's language (srv.MP.<code>). The module spec proves every sentence a rule writes is in this table and
// re-renders identically; the POS English catalogue equals this table. A sentence in another shape → null (shown as stored).
import { coded, type CodedText } from '../text/coded-text';

export const MONEY_PROTECTION_TEXT: Readonly<Record<string, string>> = {
  'SUM.DUP_EXACT_PTX': 'Potential duplicate — requires review. The same processor transaction is attached to {n} captured payments.',
  'SUM.DUP_EXACT_IDEM': 'Potential duplicate — requires review. The same idempotency key is attached to {n} captured payments.',
  'SUM.DUP_LIKELY': 'Potential duplicate — requires review. {n} payments of the same amount and method were captured on one ticket within a short interval.',
  'SUM.REFUND_EXCEEDS_CAPTURE': 'Policy mismatch — requires review. Refunds on this ticket total more than was captured (refunded exceeds captured by the amount under review).',
  'SUM.REFUND_METHOD_MISMATCH': 'Policy mismatch — requires review. A refund was issued by a method not used to pay this ticket.',
  'SUM.DISCOUNT_EXCEEDS_SUBTOTAL': 'Policy mismatch — requires review. The discount recorded on this ticket is larger than its subtotal.',
  'SUM.NEGATIVE_CAPTURE': 'Possible anomaly — requires review. A captured payment has a negative amount.',
  'SUM.MULTIPLE_REVERSALS': 'Potential duplicate — requires review. This ticket has {n} refund/void records.',
  'SUM.RETRY_LOOP': 'Possible anomaly — requires review. {n} declined payment attempts occurred on this ticket within a short window.',
  'SUM.PAID_NO_CAPTURE': 'Processor synchronization issue — requires review. This ticket is marked paid but no captured payment is recorded against it.',
  'SUM.CAPTURE_ON_CANCELLED': 'Policy mismatch — requires review. This ticket is cancelled/voided but still has net captured money not refunded.',
  'SUM.MEMBERSHIP_DUP_IDEM': 'Potential duplicate — requires review. The same idempotency key is attached to {n} captured membership charges.',
  'SUM.MEMBERSHIP_DUP_PTX': 'Potential duplicate — requires review. The same processor reference is attached to {n} captured membership charges.',
  'SUM.GIFTCARD_NEGATIVE': 'Possible anomaly — requires review. A gift card has a negative balance.',
  'SUM.GIFTCARD_REDEEM_EXCEEDS': 'Policy mismatch — requires review. A gift-card redemption left the balance negative.',
  'SUM.CASH_SHORT': 'Possible anomaly — requires review. The cash drawer for {date} was short at close (variance under review).',
  'SUM.CASH_OVER': 'Possible anomaly — requires review. The cash drawer for {date} was over at close (variance under review).',
  'SUM.REVERSAL_RATE_OUTLIER': 'Possible anomaly — requires review. This staff member\'s reversal rate is higher than peers over a comparable sample.',
  'REVIEW.DUP_EXACT_1': 'Open both transactions and compare processor state, ticket state, and receipts.',
  'REVIEW.DUP_EXACT_2': 'Verify whether one should be voided/refunded through the authorized workflow.',
  'REVIEW.DUP_LIKELY_1': 'Confirm whether these are one charge captured twice or genuinely separate purchases.',
  'REVIEW.DUP_LIKELY_2': 'Check for a valid split-payment or separate retail sale before any reversal.',
  'REVIEW.REFUND_EXCEEDS_1': 'Reconcile refunds against captured payments for this ticket.',
  'REVIEW.REFUND_EXCEEDS_2': 'Check for a processor refund not reflected in POS, or a duplicate refund.',
  'REVIEW.REFUND_METHOD': 'Confirm the refund method matches the original capture, or that a manager approved an exception.',
  'REVIEW.DISCOUNT': 'Review how the discount was applied and whether it reflects an intended promotion.',
  'REVIEW.NEGATIVE_CAPTURE': 'Verify whether this row should be a refund/reversal rather than a captured payment.',
  'REVIEW.MULTIPLE_REVERSALS': 'Confirm each reversal is intended and not a duplicate refund of the same charge.',
  'REVIEW.RETRY_LOOP': 'Check whether the terminal or card reader is functioning, and whether the card is being re-tried.',
  'REVIEW.PAID_NO_CAPTURE': 'Reconcile the ticket against the processor and cash drawer to locate the payment or correct the status.',
  'REVIEW.CAPTURE_ON_CANCELLED': 'Confirm whether a refund/void is owed for the captured amount on this cancelled ticket.',
  'REVIEW.MEMBERSHIP_DUP': 'Confirm whether the member was charged more than once and whether a refund is owed.',
  'REVIEW.GIFTCARD_NEGATIVE': 'Reconcile the gift card\'s transaction history against its balance.',
  'REVIEW.GIFTCARD_REDEEM': 'Verify how a redemption exceeded the available balance.',
  'REVIEW.CASH_DRAWER': 'Review the drawer count, movements, and cash payments for this business date.',
  'REVIEW.REVERSAL_RATE_1': 'Review a sample of this staff member\'s reversals for legitimate reasons before drawing conclusions.',
  'REVIEW.REVERSAL_RATE_2': 'Consider role/station differences (e.g. returns desk, VIP handling) that raise reversal rates legitimately.',
  'ALT.WEBHOOK_TWICE': 'A single legitimate payment recorded twice by a duplicate webhook.',
  'ALT.RETRY_DEDUPED': 'A processor retry that was correctly de-duplicated downstream.',
  'ALT.SPLIT_PAYMENT': 'A legitimate split payment (would use different methods).',
  'ALT.TWO_PURCHASES': 'Two genuine separate purchases on the same ticket.',
  'ALT.PAID_TWICE_INTENT': 'A customer paying twice intentionally.',
  'ALT.REFUND_RECORDED_TWICE': 'A processor refund recorded twice (POS + webhook).',
  'ALT.REFUND_WRONG_TICKET': 'A refund attached to the wrong ticket.',
  'ALT.PARTIAL_CAPTURE': 'A partial capture that is not reflected in POS.',
  'ALT.MANAGER_EXCEPTION': 'A documented manager-approved exception.',
  'ALT.CARD_UNAVAILABLE': 'Original captured on a card no longer available; refunded another way per policy.',
  'ALT.STACKED_PROMO': 'A stacked promotion misconfiguration.',
  'ALT.DISCOUNT_WRONG_FIELD': 'A manual discount entered in the wrong field.',
  'ALT.REVERSAL_MISCATEGORIZED': 'A reversal miscategorized as a captured payment.',
  'ALT.DATA_ENTRY': 'A data-entry or import error.',
  'ALT.PARTIAL_REFUNDS': 'Multiple partial refunds of distinct line items.',
  'ALT.VOID_THEN_REFUND': 'A void followed by a corrected refund.',
  'ALT.CARD_TYPOS': 'A customer re-entering a valid card after typos.',
  'ALT.FLAKY_TERMINAL': 'A flaky terminal or network causing legitimate retries.',
  'ALT.NOT_YET_SYNCED': 'A captured payment not yet synced from the processor.',
  'ALT.CASH_OUTSIDE_TICKET': 'A cash payment recorded outside the ticket.',
  'ALT.MANUAL_STATUS': 'A manual status change.',
  'ALT.REFUND_IN_PROGRESS': 'A refund in progress not yet recorded.',
  'ALT.CANCELLED_REFUND_PENDING': 'A ticket cancelled after payment where a refund is pending.',
  'ALT.WEBHOOK_REPLAY': 'A single charge recorded twice (webhook replay).',
  'ALT.RETRIED_DEDUPED': 'A retried charge that was correctly de-duplicated downstream.',
  'ALT.REDEEM_RELOAD_RACE': 'A redemption and reload race not yet settled.',
  'ALT.MANUAL_BALANCE': 'A manual balance adjustment error.',
  'ALT.CONCURRENT_REDEEM': 'Concurrent redemptions on the same card.',
  'ALT.BALANCE_NOT_SYNCED': 'A balance not synced before redemption.',
  'ALT.MISCOUNT': 'Miscount at close.',
  'ALT.CASH_MOVEMENT_LATE': 'A cash movement recorded late.',
  'ALT.ROUNDING': 'Change-making rounding across the day.',
  'ALT.MORE_RETURNS': 'This person legitimately handles more returns or exchanges.',
  'ALT.LARGE_REFUNDS_SKEW': 'A few large legitimate refunds skew a small window.',
  'ALT.STATION_DIFFERENCES': 'Station or shift differences not captured here.',
  'FALLBACK.RULES': 'Triggered rule(s): {rules}. Value under review: ${dollars} (not a confirmed loss).',
  'FALLBACK.ALTERNATIVES_1': 'Possible benign explanations: {p0}.',
  'FALLBACK.ALTERNATIVES_2': 'Possible benign explanations: {p0}; {p1}.',
  'FALLBACK.ALTERNATIVES_3': 'Possible benign explanations: {p0}; {p1}; {p2}.',
  'FALLBACK.REVIEW_1': 'Suggested review: {p0}',
  'FALLBACK.REVIEW_2': 'Suggested review: {p0} {p1}',
  'FALLBACK.NOT_PROOF': 'This is a possible anomaly requiring human review — it is not proof of misconduct.',
  'DISCLAIMER': 'Advisory only — possible anomaly requiring human review, not proof of misconduct.',
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let compiled: { code: string; re: RegExp; names: string[] }[] | null = null;
function table() {
  if (compiled) return compiled;
  compiled = Object.entries(MONEY_PROTECTION_TEXT).filter(([c]) => /^(SUM|REVIEW|ALT)\./.test(c)).map(([code, tpl]) => {
    const names: string[] = [];
    const re = new RegExp('^' + tpl.split(/(\{\w+\})/).map((part) => { const m = /^\{(\w+)\}$/.exec(part); if (m) { names.push(m[1]); return '(.+?)'; } return esc(part); }).join('') + '$');
    return { code, re, names };
  });
  return compiled;
}
/** a stored Money Protection evidence sentence → code + vars (srv.MP.<code>), or null */
export function mpTextCoded(sentence: string | null | undefined): CodedText | null {
  const s = String(sentence ?? '');
  for (const t of table()) { const m = t.re.exec(s); if (m) { const vars: Record<string, string> = {}; t.names.forEach((n, i) => { vars[n] = m[i + 1]; }); return coded('MP.' + t.code, vars); } }
  return null;
}
/** the deterministic fallback explanation (ai-money-protection-explain.ts deterministicFallback) as parts; null when a
 *  sentence of the evidence is not in the table (the POS then shows the server's text) */
export function mpFallbackCoded(alert: { amountCents: number; evidence: { summary: string; triggeredRules: string[]; recommendedReview?: string[]; alternativeExplanations?: string[] } }): CodedText[] | null {
  const sum = mpTextCoded(alert.evidence.summary); if (!sum) return null;
  const parts: CodedText[] = [sum, coded('MP.FALLBACK.RULES', { rules: alert.evidence.triggeredRules.join(', '), dollars: (alert.amountCents / 100).toFixed(2) })];
  const list = (code: string, xs: string[]) => { const cs = xs.map(mpTextCoded); if (cs.some((c) => !c)) return null; const v: Record<string, string | number> = {}; cs.forEach((c, i) => { v['p' + i] = '@srv.' + c!.code + '#p' + i; for (const [k, x] of Object.entries(c!.vars ?? {})) if (x != null) v[`p${i}_${k}`] = x; }); return coded(code + '_' + cs.length, v); };
  const alts = (alert.evidence.alternativeExplanations ?? []).slice(0, 3);
  if (alts.length) { const c = list('MP.FALLBACK.ALTERNATIVES', alts); if (!c) return null; parts.push(c); }
  const rev = alert.evidence.recommendedReview ?? [];
  if (rev.length) { if (rev.length > 2) return null; const c = list('MP.FALLBACK.REVIEW', rev); if (!c) return null; parts.push(c); }
  parts.push(coded('MP.FALLBACK.NOT_PROOF'));
  return parts;
}
