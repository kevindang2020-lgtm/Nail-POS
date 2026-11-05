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
  kind: 'split_attempt' | 'card_payment'; id: string; tenantId: string; branchId: string; ticketId: string; amountCents: number;
  resolution: Resolution | 'unverified'; detail: string; retref?: string;
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
}

export interface PaymentAttemptSweepProcessor {
  inquire(tenantId: string, branchId: string, orderId: string): Promise<ProcessorAnswer>;
  reconcileCard(tenantId: string, branchId: string, ticketId: string): Promise<CardReconcileStatus>;
}

export interface SweepReport {
  cardsChecked: number; cardsResolved: number; cardsUnverified: number; cardsBusy: number;
  splitsChecked: number; splitsSettled: number; splitsReleased: number; splitsNeedReview: number; splitsWaiting: number;
  errors: number;
}

export class PaymentAttemptSweep {
  constructor(
    private readonly store: PaymentAttemptSweepStore,
    private readonly proc: PaymentAttemptSweepProcessor,
    private readonly opts: { strandedMs?: number; batch?: number; log?: (msg: string) => void } = {},
  ) {}

  async run(now: Date = new Date()): Promise<SweepReport> {
    const strandedMs = this.opts.strandedMs ?? strandedMinutes() * 60_000;
    const batch = this.opts.batch ?? 200;
    const cutoff = new Date(now.getTime() - strandedMs);
    const r: SweepReport = { cardsChecked: 0, cardsResolved: 0, cardsUnverified: 0, cardsBusy: 0, splitsChecked: 0, splitsSettled: 0, splitsReleased: 0, splitsNeedReview: 0, splitsWaiting: 0, errors: 0 };

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
    return r;
  }
}
