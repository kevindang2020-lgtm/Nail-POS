// ai-review-reputation-requests.service.ts — schedules and sends post-visit review requests. Idempotent per visit;
// re-checks opt-out at send time (a customer who opts out after scheduling is never messaged); dispatch is delegated to
// the communications module (Twilio/SendGrid). No gating anywhere — eligibility never considers the visit's rating.
import { evaluateRequestEligibility, computeSendTime, reviewRequestIdempotencyKey, shouldSendReminder, type CompletedVisit, type EligibilityChecks } from './ai-review-reputation-requests';
import type { ReviewRequestPolicy } from './ai-review-reputation-settings';

export class RequestForbiddenError extends Error { constructor(m: string) { super(m); this.name = 'RequestForbiddenError'; } }

export interface ReqCtx { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[]; }

export interface RequestStorePort {
  findByIdem(ctx: ReqCtx, idempotencyKey: string): Promise<{ id: string } | null>;
  create(ctx: ReqCtx, row: { customerId: string; appointmentId: string | null; channel: string; idempotencyKey: string; scheduledFor: string }): Promise<{ id: string }>;
  listDue(ctx: ReqCtx, nowIso: string): Promise<{ id: string; customerId: string; appointmentId: string | null; channel: string }[]>;
  markStatus(ctx: ReqCtx, id: string, status: string, at?: string | null): Promise<void>;
  recordEvent(ctx: ReqCtx, id: string, event: string, detail?: Record<string, unknown>): Promise<void>;
  countInPeriod(ctx: ReqCtx, customerId: string, sinceIso: string): Promise<number>;
  lastRequestAt(ctx: ReqCtx, customerId: string): Promise<string | null>;
  /** G8 sender (Nov 6 2026): move one due row scheduled -> sending; false when another run already took it. Claim BEFORE
   *  the send, so a crash after the send can never text the customer twice (a stuck 'sending' row is never retried). */
  claim?(ctx: ReqCtx, id: string): Promise<boolean>;
  /** Due rows that waited past the freshness window are expired, never sent late. Returns how many. */
  expireStale?(ctx: ReqCtx, olderThanIso: string): Promise<number>;
  /** Sent requests eligible for the one controlled reminder (sent before `sentBeforeIso`, after `sentAfterIso`, none yet). */
  listReminderDue?(ctx: ReqCtx, sentBeforeIso: string, sentAfterIso: string): Promise<{ id: string; customerId: string; appointmentId: string | null; channel: string; sentAt: string }[]>;
  /** Claim the reminder (reminder_sent_at null -> now); false when already taken. */
  claimReminder?(ctx: ReqCtx, id: string, atIso: string): Promise<boolean>;
  /** The customer left a review (linked to them) after `sinceIso` — a reminder would only nag. */
  reviewedSince?(ctx: ReqCtx, customerId: string, sinceIso: string): Promise<boolean>;
}
export interface ConsentPort { isOptedOut(ctx: ReqCtx, customerId: string, channel: string): Promise<boolean>; hasContact(ctx: ReqCtx, customerId: string, channel: string): Promise<boolean>; recordOptOut(ctx: ReqCtx, customerId: string, channel: string): Promise<void>; }
export interface DispatchPort { send(ctx: ReqCtx, msg: { customerId: string; appointmentId: string | null; channel: string; requestId?: string; reminder?: boolean }): Promise<{ dispatchId: string }>; }
export interface ReqAuditPort { record(who: { tenantId: string; userId: string; role: string }, ev: { action: string; metadata?: Record<string, unknown> }): void; }

export class ReviewRequestService {
  constructor(private readonly store: RequestStorePort, private readonly consent: ConsentPort, private readonly dispatch: DispatchPort, private readonly auditSvc?: ReqAuditPort) {}
  private audit(ctx: ReqCtx, action: string, metadata?: Record<string, unknown>) { this.auditSvc?.record({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role }, { action, metadata }); }

  /** Schedule a request for a completed visit. System-invoked from checkout pay-success. Idempotent per visit. */
  async scheduleForCompletedVisit(ctx: ReqCtx, visit: CompletedVisit, config: ReviewRequestPolicy, now: Date = new Date()): Promise<{ scheduled: boolean; requestId?: string; reason: string }> {
    if (!ctx?.tenantId) throw new RequestForbiddenError('TENANT_REQUIRED');
    if (!visit.customerId) return { scheduled: false, reason: 'no_customer' };
    const channel = config.channel === 'in_app' ? 'app' : config.channel;
    const checks: EligibilityChecks = {
      optedOut: await this.consent.isOptedOut(ctx, visit.customerId, channel),
      hasContact: await this.consent.hasContact(ctx, visit.customerId, channel),
      lastRequestAt: await this.store.lastRequestAt(ctx, visit.customerId),
      requestsInPeriod: await this.store.countInPeriod(ctx, visit.customerId, new Date(now.getTime() - config.cooldownDays * 86_400_000).toISOString()),
    };
    const elig = evaluateRequestEligibility(visit, config, checks, now);   // no rating passed — gating impossible
    if (!elig.eligible) { this.audit(ctx, 'review_request_skipped', { reason: elig.reason }); return { scheduled: false, reason: elig.reason }; }

    const idem = reviewRequestIdempotencyKey({ tenantId: ctx.tenantId, appointmentId: visit.appointmentId, ticketId: visit.ticketId, customerId: visit.customerId, channel });
    const existing = await this.store.findByIdem(ctx, idem);
    if (existing) return { scheduled: false, requestId: existing.id, reason: 'already_requested' };   // idempotent

    const scheduledFor = computeSendTime(visit.completedAt, config, now, visit.timeZone ?? null).toISOString();
    const { id } = await this.store.create(ctx, { customerId: visit.customerId, appointmentId: visit.appointmentId ?? null, channel, idempotencyKey: idem, scheduledFor });
    await this.store.recordEvent(ctx, id, 'scheduled', { scheduledFor });
    this.audit(ctx, 'review_request_scheduled', { requestId: id, scheduledFor });
    return { scheduled: true, requestId: id, reason: 'ok' };
  }

  /** Send all due requests. Re-checks opt-out at send time — a late opt-out is honored. */
  async sendDue(ctx: ReqCtx, now: Date = new Date()): Promise<{ sent: number; skippedOptOut: number; failed: number }> {
    if (!ctx?.tenantId) throw new RequestForbiddenError('TENANT_REQUIRED');
    const due = await this.store.listDue(ctx, now.toISOString());
    const res = { sent: 0, skippedOptOut: 0, failed: 0 };
    for (const r of due) {
      if (await this.consent.isOptedOut(ctx, r.customerId, r.channel)) {   // opt-out re-check at send time
        await this.store.markStatus(ctx, r.id, 'opted_out'); await this.store.recordEvent(ctx, r.id, 'opted_out'); res.skippedOptOut++; continue;
      }
      if (this.store.claim && !(await this.store.claim(ctx, r.id))) continue;   // another run took it
      try {
        const { dispatchId } = await this.dispatch.send(ctx, { customerId: r.customerId, appointmentId: r.appointmentId, channel: r.channel, requestId: r.id });
        await this.store.markStatus(ctx, r.id, 'sent', now.toISOString());
        await this.store.recordEvent(ctx, r.id, 'sent', { dispatchId }); res.sent++;
      } catch (e: any) { await this.store.markStatus(ctx, r.id, 'failed'); await this.store.recordEvent(ctx, r.id, 'failed', { error: String(e?.message || 'error') }); res.failed++; }
    }
    this.audit(ctx, 'review_requests_sent', { ...res }); return res;
  }

  /** Due requests that waited longer than `freshnessHours` past their send time are expired, never sent late. */
  async expireStale(ctx: ReqCtx, now: Date = new Date(), freshnessHours = 48): Promise<number> {
    if (!ctx?.tenantId) throw new RequestForbiddenError('TENANT_REQUIRED');
    return this.store.expireStale ? this.store.expireStale(ctx, new Date(now.getTime() - freshnessHours * 3_600_000).toISOString()) : 0;
  }

  /** The one controlled reminder (policy.oneReminder): a request sent at least `afterHours` ago (and not more than
   *  `windowHours` ago), not opted out since, no review from that customer since the first send, no reminder yet.
   *  Claimed before the send, like the first message. */
  async sendReminders(ctx: ReqCtx, config: ReviewRequestPolicy, now: Date = new Date(), opts: { afterHours?: number; windowHours?: number } = {}): Promise<{ reminded: number; skipped: number; failed: number }> {
    if (!ctx?.tenantId) throw new RequestForbiddenError('TENANT_REQUIRED');
    const res = { reminded: 0, skipped: 0, failed: 0 };
    if (!config.oneReminder || !this.store.listReminderDue || !this.store.claimReminder) return res;
    const after = opts.afterHours ?? 72, window = opts.windowHours ?? 7 * 24;
    const due = await this.store.listReminderDue(ctx, new Date(now.getTime() - after * 3_600_000).toISOString(), new Date(now.getTime() - window * 3_600_000).toISOString());
    for (const r of due) {
      if (!shouldSendReminder({ status: 'sent', sentAt: r.sentAt, reminderSent: false, converted: false, optedOut: false }, after, now, config)) { res.skipped++; continue; }
      if (await this.consent.isOptedOut(ctx, r.customerId, r.channel)) { res.skipped++; continue; }
      if (this.store.reviewedSince && await this.store.reviewedSince(ctx, r.customerId, r.sentAt)) { res.skipped++; continue; }
      if (!(await this.store.claimReminder(ctx, r.id, now.toISOString()))) continue;
      try {
        const { dispatchId } = await this.dispatch.send(ctx, { customerId: r.customerId, appointmentId: r.appointmentId, channel: r.channel, requestId: r.id, reminder: true });
        await this.store.recordEvent(ctx, r.id, 'reminder_sent', { dispatchId }); res.reminded++;
      } catch (e: any) { await this.store.recordEvent(ctx, r.id, 'reminder_failed', { error: String(e?.message || 'error') }); res.failed++; }
    }
    if (res.reminded || res.failed) this.audit(ctx, 'review_request_reminders_sent', { ...res });
    return res;
  }

  /** Customer-initiated opt-out — recorded in the shared opt-out store and honored everywhere. */
  async optOut(ctx: ReqCtx, customerId: string, channel: string): Promise<{ optedOut: true }> {
    await this.consent.recordOptOut(ctx, customerId, channel);
    this.audit(ctx, 'review_request_opt_out', { channel }); return { optedOut: true };
  }
}
