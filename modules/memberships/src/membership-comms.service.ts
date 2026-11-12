// membership-comms.service.ts — composes + delivers member comms in-app (idempotent via reference). The renewal-reminder
// sweep is the engine behind the POS "Send Reminder" action; payment-failed / welcome are exposed for event wiring (e.g.
// the billing dunning path or enrollment) but are decoupled and safe to call more than once.
import type { CommsContext, MembershipCommsRepositoryPort } from './membership-comms.repository';
import { systemContext } from '@aipowersalon/tenant-context';
import { composeMemberComm, composeMemberSms, renewalReminderReference, expiryReminderReference, welcomeReference, paymentFailedReference, type MemberCommEvent } from './membership-comms-core';
import type { DueMember } from './membership-comms.repository';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { withCode, estimateSmsSegments } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ValidationError extends Error {}

export class MembershipCommsService {
  /** §151 (Kevin's decision, Oct 28 2026): `messenger` = the salon messenger; present → the renewal / expiry reminders are
   *  also texted (English, transactional 'reminder', opt-outs honoured, never metered). Absent → in-app only, as before. */
  constructor(private readonly repo: MembershipCommsRepositoryPort, private readonly messenger: TenantMessenger | null = null) {}

  /** The in-app reminder, written at most once per reference (atomically when the store can), then — only when THIS run
   *  wrote it — the text. A crash between the two loses a text, never sends one twice. */
  private async remind(ctx: CommsContext, m: DueMember, event: 'renewal_reminder' | 'expiry_reminder', reference: string): Promise<{ sent: boolean; texted: boolean; textBlocked: boolean }> {
    const comm = composeMemberComm(event, { customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt });
    const row = { type: comm.type, title: comm.title, body: comm.body, reference };
    let inserted: boolean;
    if (this.repo.insertNotificationOnce) inserted = await this.repo.insertNotificationOnce(ctx, m.customerId, row);
    else { if (await this.repo.notificationExists(ctx, m.customerId, reference)) return { sent: false, texted: false, textBlocked: false }; await this.repo.insertNotification(ctx, m.customerId, row); inserted = true; }
    if (!inserted) return { sent: false, texted: false, textBlocked: false };
    if (!this.messenger || !m.phone) return { sent: true, texted: false, textBlocked: false };
    try {
      const r = await this.messenger.sendSms({ tenantId: ctx.tenantId, branchId: m.branchId ?? null, to: m.phone, body: composeMemberSms(event, { customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt, salonName: m.salonName }), purpose: 'reminder', customerId: m.customerId, meter: false });
      return { sent: true, texted: r.sent, textBlocked: !r.sent };
    } catch (e) {
      console.warn('[membership-comms] reminder text not sent', (e as Error)?.message ?? e);   // the in-app reminder stands
      return { sent: true, texted: false, textBlocked: true };
    }
  }

  private async deliver(ctx: CommsContext, membershipId: string, event: MemberCommEvent, reference: string): Promise<{ sent: boolean; skipped: boolean }> {
    const info = await this.repo.memberCommInfo(ctx, membershipId);
    if (!info) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    if (await this.repo.notificationExists(ctx, info.customerId, reference)) return { sent: false, skipped: true };
    const comm = composeMemberComm(event, { customerName: info.customerName, planName: info.planName, nextBillingAt: info.nextBillingAt });
    await this.repo.insertNotification(ctx, info.customerId, { type: comm.type, title: comm.title, body: comm.body, reference });
    return { sent: true, skipped: false };
  }

  async sendRenewalReminder(ctx: CommsContext, membershipId: string) {
    if (!membershipId) throw new ValidationError('membershipId is required');
    const info = await this.repo.memberCommInfo(ctx, membershipId);
    if (!info) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    return this.deliver(ctx, membershipId, 'renewal_reminder', renewalReminderReference(membershipId, info.nextBillingAt));
  }

  async sendWelcome(ctx: CommsContext, membershipId: string) {
    if (!membershipId) throw new ValidationError('membershipId is required');
    return this.deliver(ctx, membershipId, 'welcome', welcomeReference(membershipId));
  }

  async notifyPaymentFailed(ctx: CommsContext, membershipId: string) {
    if (!membershipId) throw new ValidationError('membershipId is required');
    return this.deliver(ctx, membershipId, 'payment_failed', paymentFailedReference(membershipId, new Date().toISOString()));
  }

  /** Membership Overview mandate (Oct 29 2026) §11 action 3: the REVIEW step before Send Reminder — who is due, who was
   *  already reminded for that billing date (skipped by the run), who has no phone (in-app only). Sends nothing. */
  async previewRenewalReminders(ctx: CommsContext, withinDays = 7) {
    const days = Math.min(60, Math.max(1, Math.round(withinDays) || 7));
    const due = await this.repo.membersDueForReminder(ctx, days);
    // Membership Overview 10 (Nov 12 2026): consent-aware — a member whose phone is opted out of SMS here gets the in-app
    // reminder only (the messenger refuses the text anyway); the estimate counts the texts and segments that WOULD go out.
    const optedOut = this.repo.smsOptedOut ? await this.repo.smsOptedOut(ctx, due.map((m) => m.phone).filter((p): p is string => !!p)) : null;
    const rows = [] as { membershipId: string; customerId: string; customerName: string | null; planName: string | null; nextBillingAt: string | null; alreadyReminded: boolean; hasPhone: boolean; textOptedOut: boolean | null; segments: number }[];
    for (const m of due) {
      const textOptedOut = m.phone ? (optedOut ? optedOut.has(m.phone) : null) : false;
      const willText = !!this.messenger && !!m.phone && textOptedOut !== true;
      rows.push({ membershipId: m.membershipId, customerId: m.customerId, customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt,
        alreadyReminded: await this.repo.notificationExists(ctx, m.customerId, renewalReminderReference(m.membershipId, m.nextBillingAt)), hasPhone: !!m.phone, textOptedOut,
        segments: willText ? estimateSmsSegments(composeMemberSms('renewal_reminder', { customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt, salonName: m.salonName })).segments : 0 });
    }
    const pending = rows.filter((r) => !r.alreadyReminded);
    const texts = pending.filter((r) => r.segments > 0);
    return { withinDays: days, due: rows.length, toRemind: pending.length, alreadyReminded: rows.filter((r) => r.alreadyReminded).length,
      inAppOnly: pending.filter((r) => !r.hasPhone).length, texting: !!this.messenger, members: rows.slice(0, 200),
      // null = this server cannot read the opt-out list (never shown as "0 opted out")
      textOptedOut: optedOut ? pending.filter((r) => r.textOptedOut === true).length : null,
      textEstimate: { texts: texts.length, segments: texts.reduce((n, r) => n + r.segments, 0), metered: false as const } };
  }

  /** Engine behind the POS "Send Reminder" action: notify every active/trial auto-renewing member whose next billing is
   * within `withinDays`. Idempotent — members already reminded for that billing date are skipped. */
  async runRenewalReminders(ctx: CommsContext, withinDays = 7) {
    const days = Math.min(60, Math.max(1, Math.round(withinDays) || 7));
    const due = await this.repo.membersDueForReminder(ctx, days);
    let sent = 0; let skipped = 0; let texted = 0;
    for (const m of due) {
      const r = await this.remind(ctx, m, 'renewal_reminder', renewalReminderReference(m.membershipId, m.nextBillingAt));
      if (r.sent) sent++; else skipped++;
      if (r.texted) texted++;
    }
    return { due: due.length, sent, skipped, texted, withinDays: days };
  }

  // System/scheduler entry point: sweep reminders across ALL tenants in one call (for an external cron). The read is
  // cross-tenant; every write is scoped to the member's own tenant via a per-row CommsContext, so no tenant can ever
  // receive another tenant's notification. Idempotent per (customer, reference), exactly like the per-tenant sweep.
  async runRenewalRemindersDue(now: Date = new Date(), withinDays = 7, limit = 500) {
    const days = Math.min(60, Math.max(1, Math.round(withinDays) || 7));
    const cap = Math.min(2000, Math.max(1, Math.round(limit) || 500));
    const due = await this.repo.membersDueForReminderAllTenants(now, days, cap);
    let sent = 0; let skipped = 0; let texted = 0;
    for (const m of due) {
      const ctx = systemContext({ tenantId: m.tenantId, actor: 'membership-comms' }) as unknown as CommsContext;
      const r = await this.remind(ctx, m, 'renewal_reminder', renewalReminderReference(m.membershipId, m.nextBillingAt));
      if (r.sent) sent++; else skipped++;
      if (r.texted) texted++;
    }
    // §151: memberships that END (no renewal) inside the window — "your membership ends on …", once per end date
    const ending = this.repo.membersExpiringAllTenants ? await this.repo.membersExpiringAllTenants(now, days, cap) : [];
    let expirySent = 0;
    for (const m of ending) {
      const ctx = systemContext({ tenantId: m.tenantId, actor: 'membership-comms' }) as unknown as CommsContext;
      const r = await this.remind(ctx, m, 'expiry_reminder', expiryReminderReference(m.membershipId, m.nextBillingAt));
      if (r.sent) expirySent++; else skipped++;
      if (r.texted) texted++;
    }
    return { due: due.length, sent, skipped, texted, expiring: ending.length, expirySent, withinDays: days };
  }
}
