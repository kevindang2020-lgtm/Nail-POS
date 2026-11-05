// notifications.service.ts — tenant-facing send path. Reuses the auth SmsSender/EmailSender ports, meters
// sms_credits/email_credits (always enforced — you can't send without credits), and logs every attempt.
import { type SmsSender, type EmailSender, type TenantMessenger, type TenantSmsRequest, type TenantSendResult, type MessagePurpose, isSimulatedSender, isNotConfiguredSender } from '@aipowersalon/notifications';
import type { NotificationsRepositoryPort } from './notifications.repository';
import type { SendNotificationRequest, SendNotificationResult } from './notifications.dto';
import { validateSendRequest, creditMetricForChannel, resolveSubject, normalizeAddress, type SendNotificationInput, type NotificationChannel } from './notifications-core';
import type { SenderNumberResolver } from './notifications.sender-numbers';
import type { TenantSmsSenderResolver } from './notifications.tenant-sender';
import type { OptOutPort, OptOutRow } from './notifications.optout.repository';
import { renderBrandedEmail } from '@aipowersalon/tenants';
import { isStaffPrincipal } from '@aipowersalon/permissions';   // BUILD_PLAN Phase 9: the plane check, one place
import { recordMessagingEvent } from '@aipowersalon/observability';   // wave 3 PAYI §105 messaging business counters

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

    // Opt-out / unsubscribe enforcement (compliance): never message an opted-out recipient.
    if (this.optOut && await this.optOut.isOptedOut(ctx.tenantId, input.channel, addr)) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'opted_out' });
      return { sent: false, status: 'blocked', reason: 'opted_out' };
    }

    // Capacity gate (always on for credits): no credits → block, do not send.
    if (this.meter && !(await this.meter.hasCapacity(ctx.tenantId, metric, 1))) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'over_limit' });
      return { sent: false, status: 'blocked', reason: 'over_limit' };
    }

    if (input.channel === 'sms') {
      const r = await this.deliverSms(ctx.tenantId, input.to, input.body, { customerId: req.customerId ?? null, purpose: 'notification', meterMetric: null });
      if (!r.sent) return { sent: false, status: r.reason === 'not_configured' ? 'blocked' : 'failed', reason: r.reason ?? 'send_failed' };
      if (r.simulated) return { sent: true, status: 'simulated', id: r.logId, providerId: r.providerId, simulated: true };   // P-11: never metered
      if (this.meter) { try { await this.meter.adjust(ctx.tenantId, metric, 1); } catch { /* best-effort */ } }   // charged only on a successful handoff
      return { sent: true, status: 'sent', id: r.logId, providerId: r.providerId };
    }

    // Email: via the provider. P-11 (wave 4 pilot): production without SendGrid → not_configured (never sent, never
    // charged); the development mock → recorded as 'simulated', never charged.
    if (isNotConfiguredSender(this.email)) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'not_configured' });
      return { sent: false, status: 'blocked', reason: 'not_configured' };
    }
    const emailSimulated = isSimulatedSender(this.email);
    let providerId: string;
    try {
      providerId = (await this.email.send(input.to, subject || resolveSubject(input, ctx.salonName), renderBrandedEmail(input.body, { salonName: ctx.salonName }))).id;
    } catch (e: any) {
      await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'failed', providerId: null, failureReason: String(e?.message || 'send_failed').slice(0, 200) });
      return { sent: false, status: 'failed', reason: String(e?.message || 'send_failed') };
    }

    if (emailSimulated) {
      const row = await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'simulated', providerId, failureReason: null });
      return { sent: true, status: 'simulated', id: row.id, providerId, simulated: true };
    }
    // Charge one credit only on a successful handoff to the provider.
    if (this.meter) { try { await this.meter.adjust(ctx.tenantId, metric, 1); } catch { /* best-effort */ } }

    const row = await this.repo.log({ tenantId: ctx.tenantId, channel: input.channel, toAddress: input.to, subject, body: input.body, customerId: req.customerId ?? null, status: 'sent', providerId, failureReason: null });
    return { sent: true, status: 'sent', id: row.id, providerId };
  }

  /**
   * The ONE text path for a salon (and the platform's fallback) — tenant Twilio account, else the shared sender with the
   * salon's registered number, else the shared default; every attempt in the ledger with its outcome, and the ledger
   * writes communication.sms_sent / communication.sms_delivery_failed in the same transaction (Kysely repository).
   */
  private async deliverSms(tenantId: string, to: string, body: string, opts: { customerId: string | null; purpose: MessagePurpose; meterMetric: string | null }):
    Promise<{ sent: boolean; reason?: string; providerId?: string; logId?: string; simulated: boolean }> {
    let providerId: string; let simulated = false; let segments: number | null = null;
    try {
      const tenantSms = this.tenantSender ? await this.tenantSender.resolveSender(tenantId).catch(() => null) : null;
      let sent: { sid: string; segments?: number };
      if (tenantSms) {
        sent = await tenantSms.send(to, body);
      } else {
        // P-11 (wave 4 pilot): production with no provider — refused, recorded as not configured, never metered.
        if (isNotConfiguredSender(this.sms)) {
          await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: 'blocked', providerId: null, failureReason: 'not_configured' }, { purpose: opts.purpose });
          return { sent: false, reason: 'not_configured', simulated: false };
        }
        const fromNumber = this.senderNumbers ? (await this.senderNumbers.resolveFrom(tenantId).catch(() => null)) ?? undefined : undefined;
        simulated = isSimulatedSender(this.sms);
        sent = await this.sms.send(to, body, fromNumber);
      }
      providerId = sent.sid;
      // §77: the provider's segment count, never guessed — and a simulated text has none (nothing left, nothing to bill)
      segments = simulated ? null : sent.segments ?? null;
      if (segments != null) recordMessagingEvent('segments_sent', segments);   // §105 (an unsized send is not guessed as 1)
    } catch (e: any) {
      recordMessagingEvent('failed');
      const reason = String(e?.message || 'send_failed').slice(0, 200);
      await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: 'failed', providerId: null, failureReason: reason }, { purpose: opts.purpose });
      return { sent: false, reason, simulated: false };
    }
    // P-11: a simulated text (development mock) is labelled 'simulated' in the ledger and never metered.
    if (!simulated && opts.meterMetric && this.meter) { try { await this.meter.adjust(tenantId, opts.meterMetric, 1); } catch { /* best-effort */ } }
    const row = await this.repo.log({ tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: opts.customerId, status: simulated ? 'simulated' : 'sent', providerId, failureReason: null, segmentCount: segments }, { purpose: opts.purpose, simulated });
    return { sent: true, providerId, logId: row.id, simulated };
  }

  /** TenantMessenger — system texts (receipts, reminders, follow-ups, account codes). No staff actor is involved. */
  async sendSms(req: TenantSmsRequest): Promise<TenantSendResult> {
    const to = normalizeAddress('sms', String(req.to ?? ''));
    const body = String(req.body ?? '');
    if (!to || !body.trim()) return { sent: false, status: 'failed', reason: 'invalid_message' };
    if (!req.tenantId) {
      // A platform text: no salon is involved yet (e.g. a customer proving their phone before picking a salon).
      if (isNotConfiguredSender(this.sms)) return { sent: false, status: 'blocked', reason: 'not_configured' };   // P-11
      try {
        const sid = (await this.sms.send(to, body)).sid;
        return { sent: true, status: 'sent', providerId: sid, simulated: isSimulatedSender(this.sms) };
      } catch (e: any) { return { sent: false, status: 'failed', reason: String(e?.message || 'send_failed').slice(0, 200) }; }
    }
    // Account and security texts are not marketing: an opt-out does not stop them (the person asked for this code).
    if (req.purpose !== 'account' && this.optOut && await this.optOut.isOptedOut(req.tenantId, 'sms', to)) {
      await this.repo.log({ tenantId: req.tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'opted_out' });
      return { sent: false, status: 'blocked', reason: 'opted_out' };
    }
    if (req.meter && this.meter && !(await this.meter.hasCapacity(req.tenantId, creditMetricForChannel('sms'), 1))) {
      await this.repo.log({ tenantId: req.tenantId, channel: 'sms', toAddress: to, subject: null, body, customerId: req.customerId ?? null, status: 'blocked', providerId: null, failureReason: 'over_limit' });
      return { sent: false, status: 'blocked', reason: 'over_limit' };
    }
    const r = await this.deliverSms(req.tenantId, to, body, { customerId: req.customerId ?? null, purpose: req.purpose, meterMetric: req.meter ? creditMetricForChannel('sms') : null });
    return r.sent ? { sent: true, status: 'sent', providerId: r.providerId, simulated: r.simulated } : { sent: false, status: r.reason === 'not_configured' ? 'blocked' : 'failed', reason: r.reason };
  }

  async recent(ctx: NotificationsContext, limit = 50): Promise<{ items: Awaited<ReturnType<NotificationsRepositoryPort['listForTenant']>> }> {
    this.assert(ctx);
    const items = await this.repo.listForTenant(ctx.tenantId, Math.min(200, Math.max(1, limit)));
    return { items };
  }

  // ---- opt-out / unsubscribe management ----
  async recordOptOut(ctx: NotificationsContext, channel: NotificationChannel, address: string, reason?: string): Promise<{ ok: boolean }> {
    this.assert(ctx);
    if (channel !== 'sms' && channel !== 'email') throw new ValidationError("Channel must be 'sms' or 'email'");
    const addr = normalizeAddress(channel, address);
    if (!addr) throw new ValidationError('An address is required');
    if (!this.optOut) return { ok: false };
    await this.optOut.optOut(ctx.tenantId, channel, addr, reason);
    return { ok: true };
  }
  async recordOptIn(ctx: NotificationsContext, channel: NotificationChannel, address: string): Promise<{ ok: boolean }> {
    this.assert(ctx);
    if (channel !== 'sms' && channel !== 'email') throw new ValidationError("Channel must be 'sms' or 'email'");
    const addr = normalizeAddress(channel, address);
    if (!addr) throw new ValidationError('An address is required');
    if (!this.optOut) return { ok: false };
    await this.optOut.optIn(ctx.tenantId, channel, addr);
    return { ok: true };
  }

  // Delivery status from a provider callback (Twilio MessageStatus). Keyed by the globally-unique provider sid — no
  // tenant context needed. Maps carrier statuses onto our log states; only terminal/meaningful states are recorded.
  /** wave 3 PAYI §87: the status callback also carries the provider's error code and segment count — recorded beside
   *  the normalized status (support-only; never shown to a customer, §136). */
  async recordDeliveryStatus(providerId: string, providerStatus: string, facts?: { errorCode?: string | null; segments?: number | null }): Promise<{ updated: number }> {
    if (!providerId) return { updated: 0 };
    const s = String(providerStatus || '').toLowerCase();
    let status: 'sent' | 'failed' | 'delivered';
    let deliveredAt: string | null = null;
    if (s === 'delivered') { status = 'delivered'; deliveredAt = new Date().toISOString(); }
    else if (s === 'failed' || s === 'undelivered') status = 'failed';
    else if (s === 'sent') status = 'sent';
    else return { updated: 0 };   // queued/sending/etc. — nothing to record yet
    const reason = status === 'failed' ? `provider_${s}` : null;
    const seg = facts?.segments != null && Number.isFinite(Number(facts.segments)) && Number(facts.segments) > 0 ? Number(facts.segments) : null;
    const out = await this.repo.updateDeliveryByProvider(providerId, status, reason, deliveredAt, { providerStatus: s, errorCode: facts?.errorCode ? String(facts.errorCode).slice(0, 40) : null, segments: seg });
    if (out.updated > 0 && status !== 'sent') recordMessagingEvent(status === 'delivered' ? 'delivered' : 'failed', out.updated);   // §105 — only rows that actually moved
    return out;
  }
  async optOuts(ctx: NotificationsContext, limit = 100): Promise<{ items: OptOutRow[] }> {
    this.assert(ctx);
    if (!this.optOut) return { items: [] };
    return { items: await this.optOut.list(ctx.tenantId, Math.min(500, Math.max(1, limit))) };
  }
}
