// ai-review-reputation.integrations.ts — the real dispatch adapter for post-visit review requests. It creates a
// communications thread with the customer and posts an OUTBOUND message (the actual SMS/email send is the communications
// module's Twilio/SendGrid integration). This is the only place review requests leave the system; the caller (the
// scheduler) must supply a principal that carries `pos.communications.send`, and the eligibility/opt-out/quiet-hours
// checks in ReviewRequestService have already passed before send is called.
import type { DispatchPort, ReqCtx } from './ai-review-reputation-requests.service';
import { systemContext } from '@aipowersalon/tenant-context';

// The communications surface this adapter needs (structural — the real CommunicationsService satisfies it).
export interface CommunicationsLike {
  createThread(ctx: any, req: { customerId?: string; channel?: string; subject?: string }): Promise<{ id: string }>;
  reply(ctx: any, threadId: string, body: string): Promise<unknown>;
}

/** Build the review-request message. The public review destination/link is tenant-configured (settings.reviewRequest);
 *  callers pass it in so the body isn't hard-coded. Kept short and neutral — never gates who may leave a public review. */
export function reviewRequestBody(brandName: string, link: string | null, _customerLanguage?: string | null): string {
  // English only (Kevin, Nov 9 2026): customers are Americans — the language argument does not change the words
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
    const thread = await this.comm.createThread(commCtx, { customerId: msg.customerId, channel, subject: 'How was your visit?' });
    await this.comm.reply(commCtx, thread.id, reviewRequestBody(this.opts?.brandName ?? '', this.opts?.link ?? null, language));
    return { dispatchId: thread.id };
  }
}

/** The salon's public Google review page for a branch (branches.google_place_id). */
export function googleReviewLink(placeId: string | null | undefined): string | null {
  const id = String(placeId ?? '').trim();
  return id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : null;
}

/** The reminder wording (policy.oneReminder): one short nudge, same destination, same language rule. */
export function reviewReminderBody(brandName: string, link: string | null, _customerLanguage?: string | null): string {
  const base = `${brandName ? `${brandName}: ` : ''}If you have a minute, we'd still love to hear how your visit went.`;
  return link ? `${base} ${link}` : base;
}

/** The salon's one send path (packages/notifications TenantMessenger), declared narrowly so the ai module does not depend
 *  on the notifications package for one interface. */
export interface ReviewMessenger {
  sendSms(req: { tenantId: string | null; branchId?: string | null; to: string; body: string; purpose: 'followup'; customerId?: string | null; source?: { type: 'follow_up'; id: string } | null }): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string; notificationId?: string }>;
  sendEmail?(req: { tenantId: string; branchId?: string | null; to: string; subject: string; body: string; purpose: 'followup'; customerId?: string | null; source?: { type: 'follow_up'; id: string } | null; idempotencyKey?: string | null }): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string; notificationId?: string }>;
}
/** What the message needs to know about the salon and the customer (bound to the database in the module). */
export interface ReviewRequestProfilePort {
  salon(tenantId: string, branchId: string | null): Promise<{ brandName: string; link: string | null }>;
  customer(tenantId: string, customerId: string): Promise<{ phone: string | null; email: string | null; language: string | null } | null>;
}

/**
 * G8 (Nov 6 2026): the REAL dispatch. Before this the only adapter (CommunicationsDispatchAdapter above) wrote an inbox
 * thread whose message row said "sent" — nothing reached Twilio/SendGrid, and its author column could not take a system
 * principal. This one goes through the salon's messenger: the salon's own number/account, the opt-out list, the
 * notification ledger and its delivery callbacks. A send the messenger did not hand to a provider THROWS, so the request
 * is marked failed, never sent.
 */
export class MessengerDispatchAdapter implements DispatchPort {
  constructor(private readonly messenger: ReviewMessenger, private readonly profile: ReviewRequestProfilePort, private readonly brandOverride?: (tenantId: string, branchId: string | null) => Promise<string | null>) {}
  async send(ctx: ReqCtx, msg: { customerId: string; appointmentId: string | null; channel: string; requestId?: string; reminder?: boolean }): Promise<{ dispatchId: string }> {
    const branchId = ctx.branchId || null;
    const who = await this.profile.customer(ctx.tenantId, msg.customerId);
    if (!who) throw new Error('CUSTOMER_NOT_FOUND');
    const salon = await this.profile.salon(ctx.tenantId, branchId);
    const brand = (this.brandOverride ? await this.brandOverride(ctx.tenantId, branchId) : null) || salon.brandName;
    const body = msg.reminder ? reviewReminderBody(brand, salon.link, who.language) : reviewRequestBody(brand, salon.link, who.language);
    const source = msg.requestId ? { type: 'follow_up' as const, id: msg.requestId } : null;
    let r;
    if (msg.channel === 'email') {
      if (!who.email) throw new Error('NO_CONTACT');
      if (!this.messenger.sendEmail) throw new Error('EMAIL_NOT_AVAILABLE');
      r = await this.messenger.sendEmail({ tenantId: ctx.tenantId, branchId, to: who.email, subject: 'How was your visit?', body, purpose: 'followup', customerId: msg.customerId, source,
        idempotencyKey: msg.requestId ? `review-request:${msg.requestId}${msg.reminder ? ':reminder' : ''}` : null });
    } else {
      // app / in_app requests have no push template yet: SMS is the deliverable channel (as before)
      if (!who.phone) throw new Error('NO_CONTACT');
      r = await this.messenger.sendSms({ tenantId: ctx.tenantId, branchId, to: who.phone, body, purpose: 'followup', customerId: msg.customerId, source });
    }
    if (!r.sent) throw new Error(`SEND_${String(r.status || 'failed').toUpperCase()}:${r.reason ?? 'unknown'}`);
    return { dispatchId: r.notificationId ?? r.providerId ?? '' };
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
  // timeZoneOf: the salon's IANA zone, so quiet hours are the salon's local hours (Review & Reputation Settings guide, Nov 2 2026)
  constructor(private readonly requests: ReviewRequestService, private readonly settings: SettingsPort, private readonly timeZoneOf?: (tenantId: string, branchId: string | null) => Promise<string | null>) {}
  async onVisitCompleted(ctx: { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[] }, visit: { ticketId: string; customerId: string; branchId: string | null; visitValueCents: number; completedAt: string }): Promise<void> {
    try {
      const repCtx: any = systemContext({ tenantId: ctx.tenantId, branchId: visit.branchId ?? ctx.branchId ?? null, actor: 'review-request-on-checkout' });
      const rows = await this.settings.load(repCtx);
      const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as any, { branchId: repCtx.branchId ?? undefined }) });
      if (!eff.enabled || !eff.config.reviewRequest.enabled) return;   // honor disabled — no request
      await this.requests.scheduleForCompletedVisit(repCtx, {
        tenantId: ctx.tenantId, branchId: visit.branchId, customerId: visit.customerId, ticketId: visit.ticketId,
        completedAt: visit.completedAt, visitValueCents: visit.visitValueCents,
        timeZone: this.timeZoneOf ? await this.timeZoneOf(ctx.tenantId, visit.branchId ?? null) : null,
      }, eff.config.reviewRequest);
    } catch { /* defensive: scheduling must never surface to checkout */ }
  }
}
