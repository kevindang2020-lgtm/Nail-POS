// refund-root-cause.ts — extras (REFUNDS & VOIDS 10): Exception Root-Cause Advisor. PURE (no I/O): it summarises the
// evidence the shared ledger already holds for ONE reversal — the escalation group the Escalation Inbox put it in (the SAME
// SQL rule, read by the repository, never re-decided here), the raw refund status, the review reason / stranded time / last
// processor error, the processor refund reference, the ledger reversal row, the ticket link and the settlement batch — and
// names the next step a person takes. It never changes a status, never retries, never contacts the processor: the result is
// marked readOnly and every evidence line names the record id it came from. A deterministic summary, not a model guess.

export type RootCauseGroup = 'provider_timeout' | 'stale_pending' | 'broken_link';
export interface RootCauseInput {
  kind: 'refund' | 'void'; id: string; paymentId: string; state: string; rawStatus: string;
  escalation: RootCauseGroup | null;          // from the repository's escalation rule (the Inbox's own CASE)
  reviewReason: string | null; strandedAt: string | null; lastError: string | null;
  providerRef: string | null; reversalPaymentId: string | null; ticketId: string | null; ticketNumber: string | null;
  settlementId: string | null; requestedAt: string | null; nowMs: number;
}
export interface RootCauseEvidence { code: string; value: string | number | null; sourceType: 'payment_refund' | 'payment' | 'ticket' | 'settlement'; sourceId: string | null }
export interface RootCauseSummary {
  exception: boolean;
  cause: RootCauseGroup | 'failed' | null;
  nextStep: 'verify_with_processor' | 'check_reservation' | 'ledger_reversal_missing' | 'ticket_link_missing' | 'review_decline' | null;
  evidence: RootCauseEvidence[];
  readOnly: true;
  basis: string;
}

const BASIS = 'Summarised from the shared ledger rows of this reversal (refund row, original tender, ledger reversal, ticket, settlement). Read only: it never changes a status, retries a refund or contacts the processor.';

export function explainReversalException(x: RootCauseInput): RootCauseSummary {
  const ev: RootCauseEvidence[] = [];
  const refundSrc = x.kind === 'refund' ? x.id : null;
  ev.push({ code: 'raw_status', value: x.rawStatus, sourceType: x.kind === 'refund' ? 'payment_refund' : 'payment', sourceId: x.kind === 'refund' ? x.id : x.paymentId });
  if (x.reviewReason) ev.push({ code: 'review_reason', value: x.reviewReason, sourceType: 'payment_refund', sourceId: refundSrc });
  if (x.strandedAt) ev.push({ code: 'stranded_at', value: x.strandedAt, sourceType: 'payment_refund', sourceId: refundSrc });
  if (x.lastError) ev.push({ code: 'last_error', value: x.lastError, sourceType: 'payment_refund', sourceId: refundSrc });
  if (x.kind === 'refund') ev.push({ code: x.providerRef ? 'provider_ref' : 'provider_ref_missing', value: x.providerRef, sourceType: 'payment_refund', sourceId: x.id });
  if (x.kind === 'refund' && x.state === 'completed') ev.push({ code: x.reversalPaymentId ? 'ledger_reversal' : 'ledger_reversal_missing', value: x.reversalPaymentId, sourceType: 'payment', sourceId: x.reversalPaymentId });
  ev.push({ code: x.ticketNumber ? 'ticket_link' : 'ticket_link_missing', value: x.ticketNumber, sourceType: 'ticket', sourceId: x.ticketId });
  if (x.settlementId) ev.push({ code: 'settlement', value: null, sourceType: 'settlement', sourceId: x.settlementId });
  const req = x.requestedAt ? Date.parse(x.requestedAt) : NaN;
  if ((x.state === 'pending' || x.state === 'processing' || x.state === 'needs_review') && Number.isFinite(req)) {
    ev.push({ code: 'waiting_hours', value: Math.max(0, Math.floor((x.nowMs - req) / 3_600_000)), sourceType: 'payment_refund', sourceId: refundSrc });
  }
  let cause: RootCauseSummary['cause'] = x.escalation;
  let nextStep: RootCauseSummary['nextStep'] = null;
  if (x.escalation === 'provider_timeout') nextStep = 'verify_with_processor';
  else if (x.escalation === 'stale_pending') nextStep = 'check_reservation';
  else if (x.escalation === 'broken_link') nextStep = x.ticketNumber ? 'ledger_reversal_missing' : 'ticket_link_missing';
  else if (x.state === 'failed') { cause = 'failed'; nextStep = 'review_decline'; }
  return { exception: cause !== null, cause, nextStep, evidence: ev, readOnly: true, basis: BASIS };
}
