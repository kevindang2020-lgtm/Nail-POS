// ai-review-reputation.integrations.ts — the real dispatch adapter for post-visit review requests. It creates a
// communications thread with the customer and posts an OUTBOUND message (the actual SMS/email send is the communications
// module's Twilio/SendGrid integration). This is the only place review requests leave the system; the caller (the
// scheduler) must supply a principal that carries `pos.communications.send`, and the eligibility/opt-out/quiet-hours
// checks in ReviewRequestService have already passed before send is called.
import type { DispatchPort, ReqCtx } from './ai-review-reputation-requests.service';
import { systemContext } from '@aipowersalon/tenant-context';
import { customerMessageLanguage } from '@aipowersalon/api-contracts';

// The communications surface this adapter needs (structural — the real CommunicationsService satisfies it).
export interface CommunicationsLike {
  createThread(ctx: any, req: { customerId?: string; channel?: string; subject?: string }): Promise<{ id: string }>;
  reply(ctx: any, threadId: string, body: string): Promise<unknown>;
}

/** Build the review-request message. The public review destination/link is tenant-configured (settings.reviewRequest);
 *  callers pass it in so the body isn't hard-coded. Kept short and neutral — never gates who may leave a public review. */
export function reviewRequestBody(brandName: string, link: string | null, customerLanguage?: string | null): string {
  // VietnamesePOS §54 / §119 (Oct 28 2026): the customer's language (customers.preferred_language; unknown → English)
  if (customerMessageLanguage(customerLanguage) === 'vi') {
    const viBase = `Cảm ơn quý khách đã ghé${brandName ? ` ${brandName}` : ' tiệm'}! Chúng tôi rất mong nhận được góp ý chân thành của quý khách.`;
    return link ? `${viBase} Viết đánh giá tại đây: ${link}` : `${viBase} Hãy trả lời tin nhắn này để cho chúng tôi biết.`;
  }
  const base = `Thanks for visiting${brandName ? ` ${brandName}` : ''}! We'd love your honest feedback.`;
  return link ? `${base} Share a review here: ${link}` : `${base} Reply to let us know how we did.`;
}

export class CommunicationsDispatchAdapter implements DispatchPort {
  /** `languageOf`: the customer's preferred language (customers.preferred_language) — the module binds it with a database */
  constructor(private readonly comm: CommunicationsLike, private readonly opts?: { brandName?: string; link?: string | null; senderName?: string; languageOf?: (tenantId: string, customerId: string) => Promise<string | null> }) {}
  async send(ctx: ReqCtx, msg: { customerId: string; appointmentId: string | null; channel: string }): Promise<{ dispatchId: string }> {
    // communications channels are sms|email|call; map app/in_app requests to sms as the deliverable fallback
    const channel = msg.channel === 'email' ? 'email' : 'sms';
    const commCtx: any = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: this.opts?.senderName ?? 'Review Assistant', role: ctx.role, permissions: ctx.permissions };
    const language = this.opts?.languageOf ? await this.opts.languageOf(ctx.tenantId, msg.customerId).catch((e: unknown) => { console.warn('[review-request] customer language read failed — sending English:', (e as Error)?.message); return null; }) : null;   // a failed read sends English, never blocks the request
    const vi = customerMessageLanguage(language) === 'vi';
    const thread = await this.comm.createThread(commCtx, { customerId: msg.customerId, channel, subject: vi ? 'Quý khách thấy dịch vụ thế nào?' : 'How was your visit?' });
    await this.comm.reply(commCtx, thread.id, reviewRequestBody(this.opts?.brandName ?? '', this.opts?.link ?? null, language));
    return { dispatchId: thread.id };
  }
}

// --- checkout completion trigger adapter ---
import { ReviewRequestService } from './ai-review-reputation-requests.service';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS } from './ai-review-reputation-settings';
import type { SettingsPort } from './ai-review-reputation.service';

/** Implements the checkout ReviewRequestHook. Resolves the tenant's review-request policy and, if enabled, SCHEDULES a
 *  request (writes a row) for the completed visit. It never dispatches here and never throws to the caller — checkout
 *  wraps this in its own isolation, and this adapter is defensive on top of that. */
export class CheckoutReviewRequestHook {
  constructor(private readonly requests: ReviewRequestService, private readonly settings: SettingsPort) {}
  async onVisitCompleted(ctx: { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[] }, visit: { ticketId: string; customerId: string; branchId: string | null; visitValueCents: number; completedAt: string }): Promise<void> {
    try {
      const repCtx: any = systemContext({ tenantId: ctx.tenantId, branchId: visit.branchId ?? ctx.branchId ?? null, actor: 'review-request-on-checkout' });
      const rows = await this.settings.load(repCtx);
      const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as any, { branchId: repCtx.branchId ?? undefined }) });
      if (!eff.enabled || !eff.config.reviewRequest.enabled) return;   // honor disabled — no request
      await this.requests.scheduleForCompletedVisit(repCtx, {
        tenantId: ctx.tenantId, branchId: visit.branchId, customerId: visit.customerId, ticketId: visit.ticketId,
        completedAt: visit.completedAt, visitValueCents: visit.visitValueCents,
      }, eff.config.reviewRequest);
    } catch { /* defensive: scheduling must never surface to checkout */ }
  }
}
