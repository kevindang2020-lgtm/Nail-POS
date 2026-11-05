// mobile-attempt-recovery.ts — mandate §74–§78 / §129–§131 / §159: the durable recovery of Tap to Pay attempts whose result
// was lost (the customer tapped, the network dropped, the app was killed). payment-attempt-sweep.ts (Phase 11) explicitly
// excluded method 'tap_to_pay' because no capture was wired; the capture bridge now records money, so these attempts
// need the same discipline: ask the PROVIDER, act only on its answer, never charge again, never void blindly.
//
//   approved at the provider (reference known)             → confirm: record the money (idempotent) + attempt confirmed
//   declined at the provider                                → declined (the key is spent; the customer may re-attempt)
//   nothing at the provider, past the release window        → release: it never reached the processor (FD22's rule)
//   nothing at the provider, still inside the window        → wait
//   no inquiry API / unreachable                            → wait, then (after the review factor) hand it to a human:
//                                                              the attempt stays 'reconciliation_required' and the owner
//                                                              + platform are alerted — nothing is decided automatically
//
// The worker runs from the API's scheduler next to the Phase 11 sweep (apps/api), under a per-tenant system context,
// and is idempotent: every move is conditional on the row still being in the state it read.
import { systemContext } from '@aipowersalon/tenant-context';
import type { TapToPayLookup } from './tap-to-pay-session';
import type { MobilePaymentAttemptPort, UnresolvedAttempt } from './mobile-payment-attempt.repository';
import type { Ctx } from '@aipowersalon/permissions';

/** Functional Decision 22: a "no record at the processor" answer releases the claim only after this long. */
export const NOT_FOUND_RELEASE_MS = 5 * 60_000;
/** After this many unanswered ticks (× the stale threshold) an unreachable / no-inquiry attempt goes to a human. */
export const UNREACHABLE_REVIEW_FACTOR = 4;
export const DEFAULT_STALE_MS = 2 * 60_000;

export type RecoveryDecision =
  | { action: 'confirm'; processorRef: string; capturedAmountCents?: number; cardBrand?: string; cardLast4?: string }
  | { action: 'decline'; processorRef?: string }
  | { action: 'release'; reason: 'not_found' }
  | { action: 'wait'; reason: string }
  | { action: 'review'; reason: 'no_inquiry' | 'unreachable'; detail: string };

/** Pure: what the provider's answer means for an unresolved attempt. */
export function decideRecovery(lookup: TapToPayLookup, a: { ageMs: number; notFoundReleaseMs?: number; staleMs?: number }): RecoveryDecision {
  const release = a.notFoundReleaseMs ?? NOT_FOUND_RELEASE_MS;
  const stale = a.staleMs ?? DEFAULT_STALE_MS;
  switch (lookup.kind) {
    case 'approved': return { action: 'confirm', processorRef: lookup.processorRef, capturedAmountCents: lookup.capturedAmountCents, cardBrand: lookup.cardBrand, cardLast4: lookup.cardLast4 };
    case 'declined': return { action: 'decline', processorRef: lookup.processorRef };
    case 'not_found': return a.ageMs >= release ? { action: 'release', reason: 'not_found' } : { action: 'wait', reason: `no record at the provider yet (${Math.round((release - a.ageMs) / 1000)} s before release)` };
    case 'no_inquiry': return a.ageMs >= stale * UNREACHABLE_REVIEW_FACTOR ? { action: 'review', reason: 'no_inquiry', detail: 'The Tap to Pay provider has no transaction lookup — check the processor portal and resolve this attempt by hand.' } : { action: 'wait', reason: 'no inquiry API — waiting for a webhook / manual reconcile' };
    case 'unreachable': return a.ageMs >= stale * UNREACHABLE_REVIEW_FACTOR ? { action: 'review', reason: 'unreachable', detail: `The provider could not be reached for ${Math.round(a.ageMs / 60_000)} minutes: ${lookup.error}` } : { action: 'wait', reason: 'provider unreachable — ask again next tick' };
  }
}

export interface MobileRecoveryReport { checked: number; confirmed: number; declined: number; released: number; waiting: number; review: number; expired: number; errors: number }

/** What the worker needs from the service (MobileCheckoutService.verifyAttempt) and from the alert sink. */
export interface MobileRecoveryVerifier { verifyAttempt(ctx: Ctx, idempotencyKey: string, opts?: { notFoundReleaseMs?: number }): Promise<{ status: string; decision: RecoveryDecision; paymentId?: string }> }
export interface MobileRecoveryAlerts { raise(a: { tenantId: string; branchId: string | null; ticketId: string; idempotencyKey: string; amountCents: number; detail: string }): Promise<void> }

export class MobileAttemptRecoveryWorker {
  constructor(
    private readonly attempts: MobilePaymentAttemptPort,
    private readonly verifier: MobileRecoveryVerifier,
    private readonly alerts: MobileRecoveryAlerts | null = null,
    private readonly opts: { staleMs?: number; batch?: number; now?: () => Date; log?: (m: string) => void } = {},
  ) {}

  private now(): Date { return this.opts.now ? this.opts.now() : new Date(); }

  /** One tick: expire unused intents (§132), then verify every stale unresolved attempt. Idempotent. */
  async run(): Promise<MobileRecoveryReport> {
    const r: MobileRecoveryReport = { checked: 0, confirmed: 0, declined: 0, released: 0, waiting: 0, review: 0, expired: 0, errors: 0 };
    const now = this.now();
    try { r.expired = await this.attempts.expireStale(now, this.opts.batch ?? 200); } catch (e) { r.errors++; this.opts.log?.(`mobile recovery: expireStale failed: ${(e as Error)?.message}`); }
    const staleMs = this.opts.staleMs ?? DEFAULT_STALE_MS;
    let rows: UnresolvedAttempt[] = [];
    try { rows = await this.attempts.listUnresolved(new Date(now.getTime() - staleMs), this.opts.batch ?? 100); } catch (e) { r.errors++; this.opts.log?.(`mobile recovery: list failed: ${(e as Error)?.message}`); return r; }
    for (const a of rows) {
      r.checked++;
      // §72 systemContext (role SYSTEM, actor named). userId stays EMPTY: the recorded payment's created_by_user_id is a UUID
      // column, and the helper's 'system:<actor>' id is not one — no person made this write.
      const ctx = { ...systemContext({ tenantId: a.tenantId, branchId: a.branchId, actor: 'mobile-payment-recovery' }), userId: undefined } as unknown as Ctx;
      try {
        const out = await this.verifier.verifyAttempt(ctx, a.idempotencyKey);
        switch (out.decision.action) {
          case 'confirm': r.confirmed++; break;
          case 'decline': r.declined++; break;
          case 'release': r.released++; break;
          case 'wait': r.waiting++; break;
          case 'review': {
            r.review++;
            await this.attempts.updateStatusIf(a.tenantId, a.idempotencyKey, a.status, 'reconciliation_required').catch(() => false);
            if (this.alerts) await this.alerts.raise({ tenantId: a.tenantId, branchId: a.branchId, ticketId: a.ticketId, idempotencyKey: a.idempotencyKey, amountCents: a.amountCents, detail: out.decision.detail }).catch(() => undefined);
            break;
          }
        }
      } catch (e) { r.errors++; this.opts.log?.(`mobile recovery: attempt ${a.idempotencyKey} (tenant ${a.tenantId}): ${(e as Error)?.message}`); }
    }
    return r;
  }
}
