// payment-attempt-sweep.ts — BUILD_PLAN Phase 11 (Constitution 4 §116, payment provider failure): stranded card attempts.
//
// A card charge has two halves: the processor call, and the database write that records its answer. When the process
// dies between them (deploy, crash, a dropped connection) the attempt sits in 'processing' for ever: the ticket looks
// half-paid, a retry is refused ("already being processed"), and nobody is told. Two populations exist:
//
//   • payments rows, method 'card', status 'processing' — the straight card path's claim (Functional Decision 22). The
//     cashier's "Verify" button resolves one, but only if someone presses it. The sweep presses it for them, through the
//     SAME code (CheckoutService.reconcileStrandedCard → verifyCardPayment, under the ticket's checkout lock).
//   • payment_attempts rows, status 'processing' — the split checkout's card reservation (checkout.service paySplit).
//     Its outcome is decided here, from the processor's answer only (decideSplitAttempt, pure).
//
// MONEY RULES — the sweep never charges, never voids, never refunds:
//   • only the processor's own answer (inquire by order id = the ticket id the charge was sent with, through the existing
//     adapter) moves an attempt; no answer → no money decision.
//   • "charged but nothing here recorded it" is NOT auto-voided: the owner and the Super Admin are alerted and the attempt
//     becomes 'needs_review' (it keeps its idempotency key, so a retry still cannot charge the card twice).
//   • every transition is conditional on the row still being 'processing' (two sweepers, or a sweeper and a cashier,
//     can never both resolve one attempt — and only the winner raises the alert). Idempotent: a re-run finds nothing.
//
// Mobile Tap-to-Pay attempts (method 'tap_to_pay') are excluded: no real capture is wired yet (mobile-payment-attempt
// repository header), so there is no processor charge to strand.

export const DEFAULT_STRANDED_MINUTES = 15;
/** Functional Decision 22 releases a "no record at the processor" claim after five minutes; a stranded threshold below
 *  that would let the sweep race a charge that is still legitimately in flight, so it is clamped up to it. */
export const MIN_STRANDED_MINUTES = 5;
/** How long a processor may stay unreachable before the attempt is handed to a human (a multiple of the threshold). */
export const UNREACHABLE_REVIEW_FACTOR = 4;

export function strandedMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PAYMENT_ATTEMPT_STRANDED_MINUTES);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STRANDED_MINUTES;
  return Math.max(MIN_STRANDED_MINUTES, Math.floor(n));
}

export type Resolution =
  | 'provider_approved_recorded' | 'provider_declined' | 'provider_not_found'
  | 'provider_approved_unrecorded' | 'provider_ambiguous' | 'provider_no_inquiry' | 'processor_not_connected' | 'provider_unreachable';

export interface InquiryTxn { retref?: string; approved: boolean; declined: boolean; amountCents?: number }
/** What asking the tenant's processor produced. Built by CheckoutService.inquireProcessor from the existing adapters. */
export type ProcessorAnswer =
  | { kind: 'answer'; processor: string; transactions: InquiryTxn[] }
  | { kind: 'no_inquiry'; processor: string }          // the adapter has no status lookup (never guessed)
  | { kind: 'not_connected' }                          // the salon has no active gateway now
  | { kind: 'unreachable'; processor: string; error: string };

export interface StrandedSplitAttempt { id: string; tenantId: string; branchId: string; ticketId: string; amountCents: number; idempotencyKey: string; createdAt: string }
export interface StrandedCardPayment { paymentId: string; tenantId: string; branchId: string; ticketId: string; amountCents: number; createdAt: string; strandedAt: string | null }

export type SplitDecision =
  | { action: 'wait'; reason: string }
  | { action: 'settle'; resolution: 'provider_approved_recorded'; retref?: string }
  | { action: 'release'; resolution: 'provider_declined' | 'provider_not_found' }
  | { action: 'review'; resolution: Exclude<Resolution, 'provider_approved_recorded' | 'provider_declined' | 'provider_not_found'>; retref?: string; detail: string };

/**
 * Pure: what the processor's answer means for one stranded split reservation.
 *   approved, and a payments row holds that reference      → settle  (the split DID record; only the reservation's
 *                                                                       'settled' write was lost)
 *   approved, and NO payments row holds it                  → review  (the customer was charged and nothing here shows
 *                                                                       it — a human voids or records it; never auto-void)
 *   declined only                                           → release (nothing was charged; the key is freed so the
 *                                                                       cashier can run the split again)
 *   no record at all (the attempt is past the threshold)    → release (it never reached the processor — FD22's rule)
 *   no inquiry API / gateway not connected                  → review
 *   unreachable                                             → wait, then review once it has been unreachable for
 *                                                             UNREACHABLE_REVIEW_FACTOR × the threshold
 * Only transactions for THIS amount count (the order id is the ticket, so other charges on the ticket also come back).
 */
export function decideSplitAttempt(a: { amountCents: number; ageMs: number }, answer: ProcessorAnswer, recordedRetrefs: ReadonlySet<string>, strandedMs: number): SplitDecision {
  if (answer.kind === 'not_connected') return { action: 'review', resolution: 'processor_not_connected', detail: 'The salon\'s card processor is not connected, so the charge cannot be checked automatically.' };
  if (answer.kind === 'no_inquiry') return { action: 'review', resolution: 'provider_no_inquiry', detail: `${answer.processor} has no transaction lookup — check the processor portal.` };
  if (answer.kind === 'unreachable') {
    if (a.ageMs >= strandedMs * UNREACHABLE_REVIEW_FACTOR) return { action: 'review', resolution: 'provider_unreachable', detail: `${answer.processor} could not be reached for ${Math.round(a.ageMs / 60_000)} minutes.` };
    return { action: 'wait', reason: 'processor unreachable — ask again next tick' };
  }
  const mine = answer.transactions.filter((t) => t.amountCents == null || t.amountCents === a.amountCents);
  const approved = mine.filter((t) => t.approved);
  const unrecorded = approved.filter((t) => !(t.retref && recordedRetrefs.has(t.retref)));
  if (unrecorded.length > 1) return { action: 'review', resolution: 'provider_ambiguous', detail: `The processor holds ${unrecorded.length} approved charges of this amount that nothing here recorded.` };
  if (unrecorded.length === 1) return { action: 'review', resolution: 'provider_approved_unrecorded', retref: unrecorded[0].retref, detail: 'The processor approved this charge but the checkout never recorded it. Void it in the processor portal or record it — nothing was done automatically.' };
  if (approved.length) return { action: 'settle', resolution: 'provider_approved_recorded', retref: approved[0].retref };
  if (mine.some((t) => t.declined)) return { action: 'release', resolution: 'provider_declined' };
  return { action: 'release', resolution: 'provider_not_found' };
}

/** Outcome of the straight-card reconcile (CheckoutService.reconcileStrandedCard); 'busy' = a cashier holds the ticket. */
export type CardReconcileStatus = 'approved' | 'declined' | 'failed' | 'pending' | 'unknown' | 'none' | 'busy';

export interface SweepAlert {
  kind: 'split_attempt' | 'card_payment' | 'refund'; id: string; tenantId: string; branchId: string; ticketId: string; amountCents: number;
  resolution: Resolution | 'unverified' | 'needs_review'; detail: string; retref?: string;
}

// ---- Mandate P0 §228 (Oct 20 2026): card refunds whose processor answer was lost (payment_refunds.status = 'processing') ----
export interface StrandedRefund { refundId: string; tenantId: string; branchId: string; ticketId: string; paymentId: string; amountCents: number; originalRetref: string | null; createdAt: string; strandedAt: string | null; reviewReason: string | null;
  /** the ORIGINAL payment's surface — a Tap to Pay refund was sent to CommerceHub, not the card gateway this sweep asks */
  surface?: string | null }
export type RefundDecision =
  | { action: 'wait'; detail: string }
  | { action: 'refunded'; retref: string; detail: string }
  | { action: 'release'; detail: string }
  | { action: 'review'; detail: string; retref?: string };

/** Pure. The processor's record of the ORIGINAL order decides, and only an unambiguous record moves money:
 *   • one approved transaction that is not the original charge, of exactly the refund amount, not already recorded as a
 *     refund here → the refund DID happen → settle it with that retref;
 *   • an answer that holds the original charge and no such transaction → the refund did NOT happen → release the hold
 *     (the cashier may refund again); but only once the attempt is older than the stranded window — a refund the host is
 *     still processing must not be released under it;
 *   • more than one candidate, or an answer that does not even show the original charge (inquiry shape / order id
 *     mismatch — never guess) → a human settles it (review + alert);
 *   • processor unreachable → wait, then review after UNREACHABLE_REVIEW_FACTOR × the stranded window;
 *   • not connected / no inquiry support → review at once (nothing here can ever learn the answer by itself). */
export function decideRefundAttempt(a: { amountCents: number; originalRetref: string | null; ageMs: number }, answer: ProcessorAnswer, recordedRefundRetrefs: ReadonlySet<string>, strandedMs: number): RefundDecision {
  if (answer.kind === 'not_connected' || answer.kind === 'no_inquiry') return { action: 'review', detail: answer.kind === 'not_connected' ? 'The card processor is no longer connected for this salon; the refund must be checked in the processor portal.' : `${answer.processor} cannot be asked for a transaction by order id; check the processor portal.` };
  if (answer.kind === 'unreachable') {
    if (a.ageMs < strandedMs * UNREACHABLE_REVIEW_FACTOR) return { action: 'wait', detail: 'processor unreachable: ' + answer.error };
    return { action: 'review', detail: `The card processor could not be reached for ${Math.round(a.ageMs / 60_000)} minutes; check the refund in the processor portal.` };
  }
  const txns = answer.transactions;
  const sawOriginal = !!a.originalRetref && txns.some((t) => t.retref === a.originalRetref);
  const candidates = txns.filter((t) => t.approved && t.retref && t.retref !== a.originalRetref && !recordedRefundRetrefs.has(t.retref) && t.amountCents === a.amountCents);
  if (candidates.length === 1) return { action: 'refunded', retref: candidates[0].retref!, detail: `The processor holds an approved transaction ${candidates[0].retref} of exactly this amount.` };
  if (candidates.length > 1) return { action: 'review', detail: `The processor holds ${candidates.length} approved transactions of this amount that are not recorded here; a person must match them.`, retref: candidates[0].retref };
  if (!sawOriginal) return { action: 'review', detail: 'The processor answer does not show the original charge for this order id, so it cannot prove the refund did not happen; check the processor portal.' };
  if (a.ageMs < strandedMs) return { action: 'wait', detail: 'no refund in the processor record yet; the attempt is younger than the stranded window' };
  return { action: 'release', detail: 'The processor shows the original charge and no refund of this amount: the refund never happened. The hold is released; the cashier may refund again.' };
}

/** Persistence the sweep needs. KyselyPaymentAttemptSweepStore (payment-attempt-sweep.kysely.ts) is the real one. */
export interface PaymentAttemptSweepStore {
  strandedSplitAttempts(cutoff: Date, limit: number): Promise<StrandedSplitAttempt[]>;
  strandedCardPayments(cutoff: Date, limit: number): Promise<StrandedCardPayment[]>;
  recordedRetrefs(tenantId: string, ticketId: string): Promise<Set<string>>;
  /** Conditional on status = 'processing'. Returns false when someone else already moved the row. */
  resolveSplitAttempt(a: StrandedSplitAttempt, to: { status: 'settled' | 'failed' | 'needs_review'; resolution: Resolution; releaseKey: boolean }): Promise<boolean>;
  /** Sets payments.stranded_at once (NULL → now). Returns true only for the call that set it. */
  markCardPaymentStranded(p: StrandedCardPayment): Promise<boolean>;
  raiseAlert(alert: SweepAlert): Promise<void>;
  /** Mandate P0 §228: unknown refunds older than the cutoff (status 'processing'), oldest first. */
  strandedRefunds(cutoff: Date, limit: number): Promise<StrandedRefund[]>;
  /** Retrefs already recorded as refund payments on this ticket (so an earlier legitimate refund of the same amount is
   *  never mistaken for this one). */
  recordedRefundRetrefs(tenantId: string, ticketId: string): Promise<Set<string>>;
  /** Sets payment_refunds.stranded_at once and review_reason (conditional on status 'processing'); true only for the call that set the reason. */
  markRefundForReview(r: StrandedRefund, reason: string): Promise<boolean>;
}

export interface PaymentAttemptSweepProcessor {
  inquire(tenantId: string, branchId: string, orderId: string): Promise<ProcessorAnswer>;
  reconcileCard(tenantId: string, branchId: string, ticketId: string): Promise<CardReconcileStatus>;
  /** Mandate P0 §228: CheckoutService.settleUnknownRefund — the one place an unknown refund becomes a fact. */
  settleRefund(tenantId: string, branchId: string, refundId: string, outcome: { kind: 'refunded'; processorRefundId: string | null } | { kind: 'not_refunded' }, note: string): Promise<{ settled: boolean }>;
}

export interface SweepReport {
  cardsChecked: number; cardsResolved: number; cardsUnverified: number; cardsBusy: number;
  splitsChecked: number; splitsSettled: number; splitsReleased: number; splitsNeedReview: number; splitsWaiting: number;
  refundsChecked: number; refundsSettled: number; refundsReleased: number; refundsNeedReview: number; refundsWaiting: number;
  errors: number;
}

export class PaymentAttemptSweep {
  constructor(
    private readonly store: PaymentAttemptSweepStore,
    private readonly proc: PaymentAttemptSweepProcessor,
    private readonly opts: { strandedMs?: number; batch?: number; log?: (msg: string) => void; refundReleaseTrusted?: boolean } = {},
  ) {}

  async run(now: Date = new Date()): Promise<SweepReport> {
    const strandedMs = this.opts.strandedMs ?? strandedMinutes() * 60_000;
    const batch = this.opts.batch ?? 200;
    const cutoff = new Date(now.getTime() - strandedMs);
    const r: SweepReport = { cardsChecked: 0, cardsResolved: 0, cardsUnverified: 0, cardsBusy: 0, splitsChecked: 0, splitsSettled: 0, splitsReleased: 0, splitsNeedReview: 0, splitsWaiting: 0, refundsChecked: 0, refundsSettled: 0, refundsReleased: 0, refundsNeedReview: 0, refundsWaiting: 0, errors: 0 };

    // 1) Straight card payments first: a verify that records an approval also makes that reference "recorded" for a
    //    split reservation on the same ticket below. One reconcile per ticket (verify takes the oldest stuck row).
    const cards = await this.store.strandedCardPayments(cutoff, batch);
    const seen = new Set<string>();
    for (const p of cards) {
      const key = p.tenantId + ':' + p.ticketId;
      if (seen.has(key)) continue;
      seen.add(key);
      r.cardsChecked++;
      try {
        const status = await this.proc.reconcileCard(p.tenantId, p.branchId, p.ticketId);
        if (status === 'approved' || status === 'declined' || status === 'failed') r.cardsResolved++;
        else if (status === 'busy') r.cardsBusy++;
        else if (status === 'unknown') {
          r.cardsUnverified++;
          if (await this.store.markCardPaymentStranded(p)) {
            await this.store.raiseAlert({ kind: 'card_payment', id: p.paymentId, tenantId: p.tenantId, branchId: p.branchId, ticketId: p.ticketId, amountCents: p.amountCents, resolution: 'unverified',
              detail: 'A card charge never received its answer and the processor could not confirm it. Nothing was charged again or voided; it is checked again every few minutes.' });
          }
        }
      } catch (e: any) { r.errors++; this.opts.log?.(`card payment ${p.paymentId}: ${e?.message ?? e}`); }
    }

    // 2) Split reservations.
    const splits = await this.store.strandedSplitAttempts(cutoff, batch);
    for (const a of splits) {
      r.splitsChecked++;
      try {
        const answer = await this.proc.inquire(a.tenantId, a.branchId, a.ticketId);
        const recorded = answer.kind === 'answer' ? await this.store.recordedRetrefs(a.tenantId, a.ticketId) : new Set<string>();
        const d = decideSplitAttempt({ amountCents: a.amountCents, ageMs: now.getTime() - Date.parse(a.createdAt) }, answer, recorded, strandedMs);
        if (d.action === 'wait') { r.splitsWaiting++; continue; }
        if (d.action === 'settle') { if (await this.store.resolveSplitAttempt(a, { status: 'settled', resolution: d.resolution, releaseKey: false })) r.splitsSettled++; continue; }
        if (d.action === 'release') { if (await this.store.resolveSplitAttempt(a, { status: 'failed', resolution: d.resolution, releaseKey: true })) r.splitsReleased++; continue; }
        // review: only the sweeper whose conditional update wins raises the alert
        if (await this.store.resolveSplitAttempt(a, { status: 'needs_review', resolution: d.resolution, releaseKey: false })) {
          r.splitsNeedReview++;
          await this.store.raiseAlert({ kind: 'split_attempt', id: a.id, tenantId: a.tenantId, branchId: a.branchId, ticketId: a.ticketId, amountCents: a.amountCents, resolution: d.resolution, detail: d.detail, retref: d.retref });
        }
      } catch (e: any) { r.errors++; this.opts.log?.(`split attempt ${a.id}: ${e?.message ?? e}`); }
    }

    // 3) Mandate P0 §228: refunds whose processor answer was lost. The sweep never sends a refund; it only asks the
    //    processor what it holds for the ORIGINAL order and settles from that (decideRefundAttempt, pure). A refund it
    //    cannot decide is marked for review once and alerted once (the conditional write picks the one sweeper).
    const refunds = await this.store.strandedRefunds(cutoff, batch);
    for (const f of refunds) {
      r.refundsChecked++;
      try {
        if (f.reviewReason) { r.refundsNeedReview++; continue; }   // already with a human; nothing more to ask
        // Oct 28 2026: a Tap to Pay refund went to the CommerceHub rail. The card gateway this sweep asks knows nothing of it,
        // and "nothing there" must never release it (the cashier could refund twice) — it goes to a person, once.
        if (f.surface === 'tap_to_pay_iphone') {
          const why = 'Tap to Pay refund answer was lost — check the Tap to Pay (CommerceHub) processor portal, then settle it here. Do not refund again.';
          if (await this.store.markRefundForReview(f, why)) { r.refundsNeedReview++; await this.store.raiseAlert({ kind: 'refund', id: f.refundId, tenantId: f.tenantId, branchId: f.branchId, ticketId: f.ticketId, amountCents: f.amountCents, resolution: 'needs_review', detail: why }); }
          continue;
        }
        const answer = await this.proc.inquire(f.tenantId, f.branchId, f.ticketId);
        const recorded = answer.kind === 'answer' ? await this.store.recordedRefundRetrefs(f.tenantId, f.ticketId) : new Set<string>();
        const d = decideRefundAttempt({ amountCents: f.amountCents, originalRetref: f.originalRetref, ageMs: now.getTime() - Date.parse(f.createdAt) }, answer, recorded, strandedMs);
        if (d.action === 'wait') { r.refundsWaiting++; continue; }
        if (d.action === 'refunded') { if ((await this.proc.settleRefund(f.tenantId, f.branchId, f.refundId, { kind: 'refunded', processorRefundId: d.retref }, 'sweep: ' + d.detail)).settled) r.refundsSettled++; continue; }
        // Oct 28 2026 (Remaining Production audit §33): "no refund in the processor's record of the ORIGINAL order" is only proof
        // if the processor lists refunds under that order. That listing shape is NOT confirmed on CardPointe UAT yet (NEXT_STEPS
        // P0-2 / B-23); if refunds are filed under another order, an auto-release would let the cashier refund TWICE. Until
        // PAYMENTS_REFUND_INQUIRY_VERIFIED=1 (set after the UAT run), the release goes to a person instead.
        const trusted = this.opts.refundReleaseTrusted ?? process.env.PAYMENTS_REFUND_INQUIRY_VERIFIED === '1';
        if (d.action === 'release' && trusted) { if ((await this.proc.settleRefund(f.tenantId, f.branchId, f.refundId, { kind: 'not_refunded' }, 'sweep: ' + d.detail)).settled) r.refundsReleased++; continue; }
        const why = d.action === 'release' ? `${d.detail} — not released automatically: the processor's refund listing is not yet confirmed (PAYMENTS_REFUND_INQUIRY_VERIFIED); check the processor portal before refunding again.` : d.detail;
        if (await this.store.markRefundForReview(f, why)) {
          r.refundsNeedReview++;
          await this.store.raiseAlert({ kind: 'refund', id: f.refundId, tenantId: f.tenantId, branchId: f.branchId, ticketId: f.ticketId, amountCents: f.amountCents, resolution: 'needs_review', detail: why, retref: d.action === 'review' ? d.retref : undefined });
        }
      } catch (e: any) { r.errors++; this.opts.log?.(`refund ${f.refundId}: ${e?.message ?? e}`); }
    }
    return r;
  }
}
