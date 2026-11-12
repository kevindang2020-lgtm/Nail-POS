// notifications.service.ts — tenant-facing send path. Reuses the auth SmsSender/EmailSender ports, meters
// sms_credits/email_credits (always enforced — you can't send without credits), and logs every attempt.
import { smsStopExempt } from './consent-boundary';
import { type SmsSender, type EmailSender, type TenantMessenger, type TenantSmsRequest, type TenantEmailRequest, type TenantSendResult, type MessagePurpose, isSimulatedSender, isNotConfiguredSender } from '@aipowersalon/notifications';
import { type EmailPolicyPort, EMAIL_RE } from '../email/email-policy';
import type { NotificationsRepositoryPort } from './notifications.repository';
import type { NotificationLogRow, SendNotificationRequest, SendNotificationResult } from './notifications.dto';
import { validateSendRequest, creditMetricForChannel, resolveSubject, normalizeAddress, type SendNotificationInput, type NotificationChannel } from './notifications-core';
import type { SenderNumberResolver } from './notifications.sender-numbers';
import type { TenantSmsSenderResolver } from './notifications.tenant-sender';
import type { OptOutPort, OptOutRow, ConsentMeta } from './notifications.optout.repository';
import { renderBrandedEmail } from '@aipowersalon/tenants';
import { isStaffPrincipal } from '@aipowersalon/permissions';   // BUILD_PLAN Phase 9: the plane check, one place
import { recordMessagingEvent, logException } from '@aipowersalon/observability';   // wave 3 PAYI §105 messaging business counters
import { isE164, sanitizeProviderText } from './notification-failures';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }

export interface NotificationsContext { tenantId: string; userId: string; role: string; branchId?: string; salonName?: string }

/** Capacity-aware meter (satisfied by UsageLimitsService). Credits are always enforced regardless of the
 *  record-cap enforcement env flag. */
export interface NotificationMeter {
  hasCapacity(tenantId: string, metric: string, amount?: number): Promise<boolean>;
  adjust(tenantId: string, metric: string, delta: number): Promise<void>;
}


export class NotificationsService implements TenantMessenger {
  constructor(
    private readonly repo: NotificationsRepositoryPort,
    private readonly sms: SmsSender,
    private readonly email: EmailSender,
    private readonly meter?: NotificationMeter,
    private readonly optOut?: OptOutPort,
    private readonly senderNumbers?: SenderNumberResolver,
    private readonly tenantSender?: TenantSmsSenderResolver,
    /** Email guide (Oct 31 2026): the salon's email settings, claim-before-send keys and marketing compliance */
    private readonly emailPolicy?: EmailPolicyPort,
  ) {}

  private assert(ctx: NotificationsContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Messaging is not available for this role');
  }

  async send(ctx: NotificationsContext, req: SendNotificationRequest): Promise<SendNotificationResult> {
    this.assert(ctx);
    const v = validateSendRequest(req);
    if (!v.ok) throw new ValidationError(v.error || 'Invalid message');

    const input = req as SendNotificationInput;
    const metric = creditMetricForChannel(input.channel);
    const subject = input.channel === 'email' ? resolveSubject(input, ctx.salonName) : null;
    const addr = normalizeAddress(input.channel, input.to);
    // 741: the branch, the purpose and what produced the message ride on every ledger row this send writes
    const extra = req as SendNotificationRequest & { purpose?: MessagePurpose; source?: TenantSmsRequest['source'] };
    const facts = { purpose: extra.purpose, branchId: ctx.branchId ?? null, source: extra.source ?? (ctx.userId && !String(ctx.userId).startsWith('system:') ? { type: 'manual' as const, id: String(ctx.userId) } : null) };

    // Opt-out / unsubscribe enforcement (compliance): never message an opted-out recipient.
    if (this.optOut && await this.optOut.isOptedOut(ctx.tenantId, input.channel, addr, extra.purpose)) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'opted_out' }, facts);
      return { sent: false, status: 'blocked', reason: 'opted_out' };
    }

    // Capacity gate (always on for credits): no credits → block, do not send.
    if (this.meter && !(await this.meter.hasCapacity(ctx.tenantId, metric, 1))) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'over_limit' }, facts);
      return { sent: false, status: 'blocked', reason: 'over_limit' };
    }

    if (input.channel === 'sms') {
      const r = await this.deliverSms(ctx.tenantId, input.to, input.body, { customerId: req.customerId ?? null, purpose: extra.purpose ?? 'notification', meterMetric: null, branchId: ctx.branchId ?? null, source: facts.source });
      if (!r.sent) return { sent: false, status: r.reason === 'not_configured' ? 'blocked' : 'failed', reason: r.reason ?? 'send_failed' };
      if (r.simulated) return { sent: true, status: 'simulated', id: r.logId, providerId: r.providerId, simulated: true };   // P-11: never metered
      if (this.meter) { try { await this.meter.adjust(ctx.tenantId, metric, 1); } catch { /* best-effort */ } }   // charged only on a successful handoff
      return { sent: true, status: 'sent', id: r.logId, providerId: r.providerId };
    }

    // Email (Email guide, Oct 31 2026): the staff send goes through the ONE email path below — the salon's sender name and
    // reply-to, suppression by purpose, marketing compliance, the branded HTML with a plain-text alternative, the ledger.
    const r = await this.sendEmail({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, to: input.to, subject: subject || resolveSubject(input, ctx.salonName),
      body: input.body, purpose: extra.purpose ?? 'notification', category: extra.purpose === 'marketing' ? 'marketing' : 'manual', customerId: req.customerId ?? null,
      source: facts.source, meter: true, salonName: ctx.salonName } as TenantEmailRequest & { salonName?: string });
    if (!r.sent) return { sent: false, status: r.status === 'blocked' ? 'blocked' : 'failed', reason: r.reason ?? 'send_failed' };
    return r.simulated ? { sent: true, status: 'simulated', id: r.notificationId, providerId: r.providerId, simulated: true } : { sent: true, status: 'sent', id: r.notificationId, providerId: r.providerId };
  }

  /**
   * TenantMessenger.sendEmail — THE email path (Email Complete Build Guide §05 / §09). Receipts, booking confirmations, staff
   * emails, test sends, retries and campaigns all land here, so every one is in the ledger with its outcome:
   *   1. a valid recipient (else blocked invalid_destination — never handed to the provider)
   *   2. the salon's setting for the category (booking confirmations / receipts switched off → blocked, nothing sent)
   *   3. claim-before-send on the idempotency key (a replay, retry or second worker gets the first attempt's answer)
   *   4. suppression by purpose (a marketing unsubscribe never blocks a receipt; a bounce or complaint blocks everything)
   *   5. credits (metered sends only), the provider configured, marketing compliance (address + one-click unsubscribe)
   *   6. the provider, with the salon's display name + reply-to beside the verified from-address; then the ledger row.
   * "Sent" means the provider ACCEPTED it — delivered only ever comes from a verified provider event (webhook).
   */
  async sendEmail(req: TenantEmailRequest & { salonName?: string }): Promise<TenantSendResult & { duplicate?: boolean }> {
    const tenantId = req.tenantId;
    const to = normalizeAddress('email', String(req.to ?? ''));
    const subject = String(req.subject ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'A message from your salon';
    const body = String(req.body ?? '');
    const facts = { purpose: req.purpose, branchId: req.branchId ?? null, source: req.source ?? null, retryOf: req.retryOf ?? null };
    const log = async (status: 'blocked' | 'failed' | 'sent' | 'simulated', providerId: string | null, failureReason: string | null) =>
      this.repo.log({ tenantId, channel: 'email', toAddress: to || String(req.to ?? '').slice(0, 320), subject, body, customerId: req.customerId ?? null, status, providerId, failureReason }, { ...facts, simulated: status === 'simulated' });
    if (!body.trim()) return { sent: false, status: 'failed', reason: 'invalid_message' };
    if (!EMAIL_RE.test(to)) { const row = await log('blocked', null, 'invalid_destination'); return { sent: false, status: 'blocked', reason: 'invalid_destination', notificationId: row?.id }; }
    const settings = this.emailPolicy ? await this.emailPolicy.settings(tenantId, req.branchId ?? null) : null;
    if (settings && req.category === 'booking_confirmation' && !settings.bookingConfirmations) { const row = await log('blocked', null, 'booking_email_disabled'); return { sent: false, status: 'blocked', reason: 'booking_email_disabled', notificationId: row?.id }; }
    if (settings && req.category === 'receipt' && !settings.receipts) { const row = await log('blocked', null, 'receipt_email_disabled'); return { sent: false, status: 'blocked', reason: 'receipt_email_disabled', notificationId: row?.id }; }
    const key = req.idempotencyKey ? String(req.idempotencyKey).trim() : '';
    if (key && this.emailPolicy) {
      const c = await this.emailPolicy.claim(tenantId, key, req.category ?? 'other');
      if (!c.claimed) {
        const prior = c.notificationId ? await this.emailPolicy.attemptOf(tenantId, c.notificationId) : null;
        const ok = prior?.status === 'sent' || prior?.status === 'delivered' || prior?.status === 'simulated';
        return { sent: ok, status: ok ? 'sent' : prior?.status === 'blocked' ? 'blocked' : 'failed', reason: prior ? (prior.reason ?? undefined) : 'in_progress_or_unknown',
          providerId: prior?.providerId ?? undefined, simulated: prior?.status === 'simulated', notificationId: c.notificationId ?? undefined, duplicate: true };
      }
    }
    const finish = async (row: { id: string } | undefined) => { if (key && row?.id && this.emailPolicy) await this.emailPolicy.attach(tenantId, key, row.id); return row?.id; };
    if (this.optOut && await this.optOut.isOptedOut(tenantId, 'email', to, req.purpose)) { const id = await finish(await log('blocked', null, 'opted_out')); return { sent: false, status: 'blocked', reason: 'opted_out', notificationId: id }; }
    if (req.meter && this.meter && !(await this.meter.hasCapacity(tenantId, creditMetricForChannel('email'), 1))) { const id = await finish(await log('blocked', null, 'over_limit')); return { sent: false, status: 'blocked', reason: 'over_limit', notificationId: id }; }
    if (isNotConfiguredSender(this.email)) { const id = await finish(await log('blocked', null, 'not_configured')); return { sent: false, status: 'blocked', reason: 'not_configured', notificationId: id }; }
    let text = body; let headers: Record<string, string> | undefined;
    if (req.purpose === 'marketing') {
      const m = this.emailPolicy ? await this.emailPolicy.marketing(tenantId, req.branchId ?? null, to) : { ok: false as const, reason: 'unsubscribe_not_configured' as const };
      if (!m.ok) { const id = await finish(await log('blocked', null, m.reason)); return { sent: false, status: 'blocked', reason: m.reason, notificationId: id }; }
      text = body + m.footer; headers = m.headers;
    }
    const salonName = settings?.senderName ?? req.salonName;
    const simulated = isSimulatedSender(this.email);
    let providerId: string;
    try {
      providerId = (await this.email.send(to, subject, renderBrandedEmail(text, { salonName }), { fromName: settings?.senderName ?? salonName, replyTo: settings?.replyTo ?? undefined, text, headers })).id;
    } catch (e: any) {
      const id = await finish(await log('failed', null, sanitizeProviderText(String(e?.message || 'send_failed'), 200) ?? 'send_failed'));
      return { sent: false, status: 'failed', reason: String(e?.message || 'send_failed'), notificationId: id };
    }
    if (!simulated && req.meter && this.meter) { try { await this.meter.adjust(tenantId, creditMetricForChannel('email'), 1); } catch { /* best-effort: charged only on a successful handoff */ } }
    const id = await finish(await log(simulated ? 'simulated' : 'sent', providerId, null));
    return { sent: true, status: 'sent', providerId, simulated, notificationId: id };
  }

  /**
   * The ONE text path for a salon (and the platform's fallback) — tenant Twilio account, else the shared sender with the
   * salon's registered number, else the shared default; every attempt in the ledger with its outcome, and the ledger
   * writes communication.sms_sent / communication.sms_delivery_failed in the same transaction (Kysely repository).
   */
  private async deliverSms(tenantId: string, to: string, body: string, opts: { customerId: string | null; purpose: MessagePurpose; meterMetric: string | null; branchId?: string | null; requireOwnAccount?: boolean; source?: TenantSmsRequest['source']; retryOf?: string | null }):
    Promise<{ sent: boolean; reason?: string; providerId?: string; logId?: string; simulated: boolean }> {
    let providerId: string; let simulated = false; let segments: number | null = null;
    // mandate §65: which path carried the text, recorded on its ledger row (failed attempts too)
    let senderRoute: NotificationLogRow['senderRoute'] = null; let senderFrom: string | null = null;
    try {
      const tenantSms = this.tenantSender ? await this.tenantSender.resolveSender(tenantId, opts.branchId ?? null).catch(() => null) : null;
      let sent: { sid: string; segments?: number; senderFrom?: string };
      if (tenantSms) {
        senderRoute = 'tenant_account'; senderFrom = tenantSms.senderFrom ?? null;
        sent = await tenantSms.send(to, body);
      } else if (opts.requireOwnAccount) {
        // Communications guide §10.1 + owner rule: an inbox reply never borrows the platform's shared sender
        const row = await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: 'blocked', providerId: null, failureReason: 'not_configured' }, { purpose: opts.purpose, branchId: opts.branchId ?? null, source: opts.source ?? null, retryOf: opts.retryOf ?? null });
        return { sent: false, reason: 'not_configured', simulated: false, logId: row?.id };
      } else {
        // P-11 (wave 4 pilot): production with no provider — refused, recorded as not configured, never metered.
        if (isNotConfiguredSender(this.sms)) {
          await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: 'blocked', providerId: null, failureReason: 'not_configured' }, { purpose: opts.purpose, branchId: opts.branchId ?? null, source: opts.source ?? null, retryOf: opts.retryOf ?? null });
          return { sent: false, reason: 'not_configured', simulated: false };
        }
        const fromNumber = this.senderNumbers ? (await this.senderNumbers.resolveFrom(tenantId).catch(() => null)) ?? undefined : undefined;
        simulated = isSimulatedSender(this.sms);
        senderRoute = fromNumber ? 'shared_salon_number' : 'shared_default'; senderFrom = fromNumber ?? null;
        sent = await this.sms.send(to, body, fromNumber);
      }
      providerId = sent.sid;
      // P2-2 (Oct 23 2026): the address the sender reports it used wins — the platform default From is no longer NULL
      if (sent.senderFrom) senderFrom = sent.senderFrom;
      // §77: the provider's segment count, never guessed — and a simulated text has none (nothing left, nothing to bill)
      segments = simulated ? null : sent.segments ?? null;
      if (segments != null) recordMessagingEvent('segments_sent', segments);   // §105 (an unsized send is not guessed as 1)
    } catch (e: any) {
      recordMessagingEvent('failed');
      // 741 (guide §09): the stored failure text is sanitized (no phone numbers / account SIDs in the ledger or logs) and the
      // provider's own error code is kept beside it (SmsProviderError.providerCode) — support classifies by the code
      const reason = (sanitizeProviderText(String(e?.message || 'send_failed'), 200) ?? 'send_failed');
      const providerErrorCode = e?.providerCode != null ? String(e.providerCode).slice(0, 40) : null;
      const row = await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: 'failed', providerId: null, failureReason: reason, providerErrorCode, senderRoute, senderFrom }, { purpose: opts.purpose, branchId: opts.branchId ?? null, source: opts.source ?? null, retryOf: opts.retryOf ?? null });
      return { sent: false, reason, simulated: false, logId: row?.id };
    }
    // P-11: a simulated text (development mock) is labelled 'simulated' in the ledger and never metered.
    if (!simulated && opts.meterMetric && this.meter) { try { await this.meter.adjust(tenantId, opts.meterMetric, 1); } catch { /* best-effort */ } }
    const row = await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: simulated ? 'simulated' : 'sent', providerId, failureReason: null, segmentCount: segments, senderRoute, senderFrom }, { purpose: opts.purpose, simulated, branchId: opts.branchId ?? null, source: opts.source ?? null, retryOf: opts.retryOf ?? null });
    return { sent: true, providerId, logId: row.id, simulated };
  }

  /** TenantMessenger — system texts (receipts, reminders, follow-ups, account codes). No staff actor is involved. */
  async sendSms(req: TenantSmsRequest): Promise<TenantSendResult> {
    const to = normalizeAddress('sms', String(req.to ?? ''));
    const body = String(req.body ?? '');
    if (!to || !body.trim()) return { sent: false, status: 'failed', reason: 'invalid_message' };
    const facts = { purpose: req.purpose, branchId: req.branchId ?? null, source: req.source ?? null };
    // Customer Notifications guide §08 (P0): a national number with no "+country code" (e.g. 7876299624) used to go to the
    // provider, which read the leading digits as a country code (+7 …) and refused the region. The number is never guessed
    // or rewritten here: the attempt is recorded as blocked (invalid_destination) and nothing reaches the provider.
    if (!isE164(to)) {
      if (!req.tenantId) return { sent: false, status: 'blocked', reason: 'invalid_destination' };
      const row = await this.repo.log({ tenantId: req.tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'invalid_destination' }, facts);
      return { sent: false, status: 'blocked', reason: 'invalid_destination', notificationId: row?.id };
    }
    if (!req.tenantId) {
      // A platform text: no salon is involved yet (e.g. a customer proving their phone before picking a salon).
      if (isNotConfiguredSender(this.sms)) return { sent: false, status: 'blocked', reason: 'not_configured' };   // P-11
      try {
        const sid = (await this.sms.send(to, body)).sid;
        return { sent: true, status: 'sent', providerId: sid, simulated: isSimulatedSender(this.sms) };
      } catch (e: any) { return { sent: false, status: 'failed', reason: String(e?.message || 'send_failed').slice(0, 200) }; }
    }
    // Account and security texts are not marketing: an opt-out does not stop them (the person asked for this code).
    // The rule lives in consent-boundary.ts (the Consent Boundary Checker reads the same function).
    if (!smsStopExempt(req.purpose) && this.optOut && await this.optOut.isOptedOut(req.tenantId, 'sms', to)) {
      const row = await this.repo.log({ tenantId: req.tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'opted_out' }, facts);
      return { sent: false, status: 'blocked', reason: 'opted_out', notificationId: row?.id };
    }
    if (req.meter && this.meter && !(await this.meter.hasCapacity(req.tenantId, creditMetricForChannel('sms'), 1))) {
      const row = await this.repo.log({ tenantId: req.tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'over_limit' }, facts);
      return { sent: false, status: 'blocked', reason: 'over_limit', notificationId: row?.id };
    }
    const r = await this.deliverSms(req.tenantId, to, body, { customerId: req.customerId ?? null, purpose: req.purpose, meterMetric: req.meter ? creditMetricForChannel('sms') : null, branchId: req.branchId ?? null, requireOwnAccount: req.requireOwnAccount === true, source: req.source ?? null, retryOf: req.retryOf ?? null });
    return r.sent ? { sent: true, status: 'sent', providerId: r.providerId, simulated: r.simulated, notificationId: r.logId } : { sent: false, status: r.reason === 'not_configured' ? 'blocked' : 'failed', reason: r.reason, notificationId: r.logId };
  }

  async recent(ctx: NotificationsContext, limit = 50): Promise<{ items: Awaited<ReturnType<NotificationsRepositoryPort['listForTenant']>> }> {
    this.assert(ctx);
    const items = await this.repo.listForTenant(ctx.tenantId, Math.min(200, Math.max(1, limit)));
    return { items };
  }

  // ---- opt-out / unsubscribe management ----
  // 741 (Customer Notifications guide §07): every change is recorded in notification_consent_events with WHO / HOW. A customer's
  // own STOP (the carrier keyword) can only be undone by the customer texting START — staff cannot override it; a staff
  // re-opt-in of anything else needs a consent note saying how the customer agreed (never inferred from a booking code,
  // a checkout or a receipt).
  private consentSource(ctx: NotificationsContext, staffSource: 'staff', systemWord: 'inbound_stop' | 'inbound_start'): ConsentMeta['source'] {
    const actor = String((ctx as { actor?: string }).actor ?? '');
    if (String(ctx.userId ?? '').startsWith('system:')) return actor === 'twilio-inbound' ? systemWord : 'system';
    return staffSource;
  }
  async recordOptOut(ctx: NotificationsContext, channel: NotificationChannel, address: string, reason?: string): Promise<{ ok: boolean }> {
    this.assert(ctx);
    if (channel !== 'sms' && channel !== 'email') throw withCode(new ValidationError("Channel must be 'sms' or 'email'"), 'CHANNEL_SMS_OR_EMAIL');
    const addr = normalizeAddress(channel, address);
    if (!addr) throw withCode(new ValidationError('An address is required'), 'ADDRESS_REQUIRED');
    if (!this.optOut) return { ok: false };
    const source = this.consentSource(ctx, 'staff', 'inbound_stop');
    await this.optOut.optOut(ctx.tenantId, channel, addr, reason, { source, actorUserId: source === 'staff' ? ctx.userId : null });
    return { ok: true };
  }
  async recordOptIn(ctx: NotificationsContext, channel: NotificationChannel, address: string, consentNote?: string | null): Promise<{ ok: boolean }> {
    this.assert(ctx);
    if (channel !== 'sms' && channel !== 'email') throw withCode(new ValidationError("Channel must be 'sms' or 'email'"), 'CHANNEL_SMS_OR_EMAIL');
    const addr = normalizeAddress(channel, address);
    if (!addr) throw withCode(new ValidationError('An address is required'), 'ADDRESS_REQUIRED');
    if (!this.optOut) return { ok: false };
    const source = this.consentSource(ctx, 'staff', 'inbound_start');
    if (source === 'staff') {
      const how = this.optOut.currentOptOutSource ? await this.optOut.currentOptOutSource(ctx.tenantId, channel, addr) : null;
      if (channel === 'sms' && (how === 'inbound_stop' || how === 'phone_change')) {
        throw withCode(new ForbiddenError('This customer texted STOP. Only the customer can opt back in, by texting START to the salon number.'), 'NOTIFICATION_OPTIN_CUSTOMER_STOP');
      }
      const note = String(consentNote ?? '').trim();
      if (note.length < 5) throw withCode(new ValidationError('Say how the customer agreed to receive messages again (at least 5 characters).'), 'NOTIFICATION_OPTIN_NOTE_REQUIRED');
      await this.optOut.optIn(ctx.tenantId, channel, addr, { source, actorUserId: ctx.userId, consentNote: note.slice(0, 300) });
      return { ok: true };
    }
    await this.optOut.optIn(ctx.tenantId, channel, addr, { source });
    return { ok: true };
  }

  // Delivery status from a provider callback (Twilio MessageStatus). Keyed by the globally-unique provider sid — no
  // tenant context needed. Maps carrier statuses onto our log states; only terminal/meaningful states are recorded.
  /** wave 3 PAYI §87: the status callback also carries the provider's error code and segment count — recorded beside
   *  the normalized status (support-only; never shown to a customer, §136). */
  async recordDeliveryStatus(providerId: string, providerStatus: string, facts?: { errorCode?: string | null; segments?: number | null }, scope?: { tenantId: string }): Promise<{ updated: number }> {
    if (!providerId) return { updated: 0 };
    const s = String(providerStatus || '').toLowerCase();
    let status: 'sent' | 'failed' | 'delivered';
    let deliveredAt: string | null = null;
    if (s === 'delivered') { status = 'delivered'; deliveredAt = new Date().toISOString(); }
    else if (s === 'failed' || s === 'undelivered') status = 'failed';
    else if (s === 'sent') status = 'sent';
    else {   // queued/sending/accepted — nothing moves; the callback itself is kept as freshness evidence (741)
      if (this.repo.recordDeliveryEvent && s) await this.repo.recordDeliveryEvent(providerId, s, facts?.errorCode ? String(facts.errorCode).slice(0, 40) : null, scope?.tenantId ?? null).catch((e) => logException(e, { where: 'notifications.recordDeliveryEvent' }));
      return { updated: 0 };
    }
    const reason = status === 'failed' ? `provider_${s}` : null;
    const seg = facts?.segments != null && Number.isFinite(Number(facts.segments)) && Number(facts.segments) > 0 ? Number(facts.segments) : null;
    const out = await this.repo.updateDeliveryByProvider(providerId, status, reason, deliveredAt, { providerStatus: s, errorCode: facts?.errorCode ? String(facts.errorCode).slice(0, 40) : null, segments: seg }, scope?.tenantId ?? null);
    if (out.updated > 0 && status !== 'sent') recordMessagingEvent(status === 'delivered' ? 'delivered' : 'failed', out.updated);   // §105 — only rows that actually moved
    return out;
  }
  async optOuts(ctx: NotificationsContext, limit = 100): Promise<{ items: OptOutRow[] }> {
    this.assert(ctx);
    if (!this.optOut) return { items: [] };
    return { items: await this.optOut.list(ctx.tenantId, Math.min(500, Math.max(1, limit))) };
  }
}
