// sla-breach-notifier.ts — opt-in (SLA_BREACH_NOTIFY, default off) delivery for SLA breaches. Notifies the
// tenant's owners/managers (the people who must respond) — NOT the customer — through the existing metered,
// opt-out-aware NotificationsService. Fail-soft per recipient. Imports NotificationsService, so it lives apart
// from the dependency-light job/pure logic.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { NotificationsService } from '@aipowersalon/communications';
import { breachNotifyEnabled, composeBreachNotice, type BreachNotifier } from './sla-breach-sweep';

export class SlaBreachNotifier implements BreachNotifier {
  constructor(private readonly db: Kysely<DB> | null, private readonly notifications: NotificationsService) {}

  async notify(args: { ticketId: string; tenantId: string; ticketNumber: string; subject: string }): Promise<void> {
    if (!breachNotifyEnabled() || !this.db || !args.tenantId) return;
    try {
      const res = await sql<any>`
        SELECT id, email, role FROM users
        WHERE tenant_id = ${args.tenantId} AND email IS NOT NULL AND email <> ''
          AND lower(role) IN ('owner','manager')
        ORDER BY (lower(role) = 'owner') DESC LIMIT 5`.execute(this.db);
      const recipients = (res as any).rows || [];
      const { subject, body } = composeBreachNotice(args.ticketNumber, args.subject);
      for (const u of recipients) {
        try {
          await this.notifications.send(
            { tenantId: args.tenantId, userId: u.id, role: u.role || 'OWNER' },
            { channel: 'email', to: String(u.email), subject, body },
          );
        } catch { /* one recipient failing must not stop the others */ }
      }
    } catch { /* best-effort */ }
  }
}
