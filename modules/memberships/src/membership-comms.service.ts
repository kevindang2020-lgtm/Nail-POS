// membership-comms.service.ts — composes + delivers member comms in-app (idempotent via reference). The renewal-reminder
// sweep is the engine behind the POS "Send Reminder" action; payment-failed / welcome are exposed for event wiring (e.g.
// the billing dunning path or enrollment) but are decoupled and safe to call more than once.
import type { CommsContext, MembershipCommsRepositoryPort } from './membership-comms.repository';
import { systemContext } from '@aipowersalon/tenant-context';
import { composeMemberComm, renewalReminderReference, welcomeReference, paymentFailedReference, type MemberCommEvent } from './membership-comms-core';

export class ValidationError extends Error {}

export class MembershipCommsService {
  constructor(private readonly repo: MembershipCommsRepositoryPort) {}

  private async deliver(ctx: CommsContext, membershipId: string, event: MemberCommEvent, reference: string): Promise<{ sent: boolean; skipped: boolean }> {
    const info = await this.repo.memberCommInfo(ctx, membershipId);
    if (!info) throw new ValidationError('Membership not found');
    if (await this.repo.notificationExists(ctx, info.customerId, reference)) return { sent: false, skipped: true };
    const comm = composeMemberComm(event, { customerName: info.customerName, planName: info.planName, nextBillingAt: info.nextBillingAt });
    await this.repo.insertNotification(ctx, info.customerId, { type: comm.type, title: comm.title, body: comm.body, reference });
    return { sent: true, skipped: false };
  }

  async sendRenewalReminder(ctx: CommsContext, membershipId: string) {
    if (!membershipId) throw new ValidationError('membershipId is required');
    const info = await this.repo.memberCommInfo(ctx, membershipId);
    if (!info) throw new ValidationError('Membership not found');
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

  /** Engine behind the POS "Send Reminder" action: notify every active/trial auto-renewing member whose next billing is
   * within `withinDays`. Idempotent — members already reminded for that billing date are skipped. */
  async runRenewalReminders(ctx: CommsContext, withinDays = 7) {
    const days = Math.min(60, Math.max(1, Math.round(withinDays) || 7));
    const due = await this.repo.membersDueForReminder(ctx, days);
    let sent = 0; let skipped = 0;
    for (const m of due) {
      const reference = renewalReminderReference(m.membershipId, m.nextBillingAt);
      if (await this.repo.notificationExists(ctx, m.customerId, reference)) { skipped++; continue; }
      const comm = composeMemberComm('renewal_reminder', { customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt });
      await this.repo.insertNotification(ctx, m.customerId, { type: comm.type, title: comm.title, body: comm.body, reference });
      sent++;
    }
    return { due: due.length, sent, skipped, withinDays: days };
  }

  // System/scheduler entry point: sweep reminders across ALL tenants in one call (for an external cron). The read is
  // cross-tenant; every write is scoped to the member's own tenant via a per-row CommsContext, so no tenant can ever
  // receive another tenant's notification. Idempotent per (customer, reference), exactly like the per-tenant sweep.
  async runRenewalRemindersDue(now: Date = new Date(), withinDays = 7, limit = 500) {
    const days = Math.min(60, Math.max(1, Math.round(withinDays) || 7));
    const cap = Math.min(2000, Math.max(1, Math.round(limit) || 500));
    const due = await this.repo.membersDueForReminderAllTenants(now, days, cap);
    let sent = 0; let skipped = 0;
    for (const m of due) {
      const ctx = systemContext({ tenantId: m.tenantId, actor: 'membership-comms' }) as unknown as CommsContext;
      const reference = renewalReminderReference(m.membershipId, m.nextBillingAt);
      if (await this.repo.notificationExists(ctx, m.customerId, reference)) { skipped++; continue; }
      const comm = composeMemberComm('renewal_reminder', { customerName: m.customerName, planName: m.planName, nextBillingAt: m.nextBillingAt });
      await this.repo.insertNotification(ctx, m.customerId, { type: comm.type, title: comm.title, body: comm.body, reference });
      sent++;
    }
    return { due: due.length, sent, skipped, withinDays: days };
  }
}
