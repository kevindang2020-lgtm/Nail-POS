// ai-review-reputation-requests.service.ts — schedules and sends post-visit review requests. Idempotent per visit;
// re-checks opt-out at send time (a customer who opts out after scheduling is never messaged); dispatch is delegated to
// the communications module (Twilio/SendGrid). No gating anywhere — eligibility never considers the visit's rating.
import { evaluateRequestEligibility, computeSendTime, reviewRequestIdempotencyKey, type CompletedVisit, type EligibilityChecks } from './ai-review-reputation-requests';
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
}
export interface ConsentPort { isOptedOut(ctx: ReqCtx, customerId: string, channel: string): Promise<boolean>; hasContact(ctx: ReqCtx, customerId: string, channel: string): Promise<boolean>; recordOptOut(ctx: ReqCtx, customerId: string, channel: string): Promise<void>; }
export interface DispatchPort { send(ctx: ReqCtx, msg: { customerId: string; appointmentId: string | null; channel: string }): Promise<{ dispatchId: string }>; }
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

    const scheduledFor = computeSendTime(visit.completedAt, config).toISOString();
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
      try {
        const { dispatchId } = await this.dispatch.send(ctx, { customerId: r.customerId, appointmentId: r.appointmentId, channel: r.channel });
        await this.store.markStatus(ctx, r.id, 'sent', now.toISOString());
        await this.store.recordEvent(ctx, r.id, 'sent', { dispatchId }); res.sent++;
      } catch (e: any) { await this.store.markStatus(ctx, r.id, 'failed'); await this.store.recordEvent(ctx, r.id, 'failed', { error: String(e?.message || 'error') }); res.failed++; }
    }
    this.audit(ctx, 'review_requests_sent', { ...res }); return res;
  }

  /** Customer-initiated opt-out — recorded in the shared opt-out store and honored everywhere. */
  async optOut(ctx: ReqCtx, customerId: string, channel: string): Promise<{ optedOut: true }> {
    await this.consent.recordOptOut(ctx, customerId, channel);
    this.audit(ctx, 'review_request_opt_out', { channel }); return { optedOut: true };
  }
}
