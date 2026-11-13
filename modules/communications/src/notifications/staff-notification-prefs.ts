// staff-notification-prefs.ts (modules/communications) — extras round 11 (Nov 13 2026): the ONE server reader of a staff member's own notification
// switches (user_notification_prefs, migration 134 + quiet hours). Every staff send path (the push dispatcher, the owner /
// manager alert texts and e-mails) asks staffSendDecision() before handing a message to a provider; the decision itself is
// the pure rule in @aipowersalon/api-contracts (tenant/me-prefs.ts staffNotificationAllowed) that the POS panel also reads.
//   • no saved row → the column defaults (every switch on) → send
//   • the row cannot be read → SEND (a broken read must never silence an alert — same as quiet hours), and say so via onUnreadable
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import {
  rowToNotificationPrefs, staffNotificationAllowed, type NotificationPrefs, type StaffNotifyChannel, type StaffNotifyCategory, type StaffNotifyDecision,
} from '@aipowersalon/api-contracts/tenant';

export interface StaffPrefsRead { state: 'saved' | 'default' | 'unreadable'; prefs: NotificationPrefs | null; error?: string }

/** Read one person's saved switches in one salon. Never throws: an error comes back as state 'unreadable'. */
export async function readStaffNotificationPrefs(db: unknown, tenantId: string | null | undefined, userId: string | null | undefined): Promise<StaffPrefsRead> {
  if (!db || !tenantId || !userId) return { state: 'default', prefs: null };
  try {
    const r = (await sql<Record<string, unknown>>`select p.sms_notifications, p.email_notifications, p.push_notifications, p.missed_call_alerts, p.booking_alerts,
        p.low_stock_alerts, p.payroll_approvals, p.weekly_report_summaries, p.quiet_start, p.quiet_end
      from user_notification_prefs p where p.tenant_id = ${String(tenantId)} and p.user_id = ${String(userId)} limit 1`.execute(db as Kysely<DB>)).rows[0];
    return r ? { state: 'saved', prefs: rowToNotificationPrefs(r) } : { state: 'default', prefs: null };
  } catch (e) {
    return { state: 'unreadable', prefs: null, error: String((e as Error)?.message ?? e).slice(0, 160) };
  }
}

export type StaffSendDecision = StaffNotifyDecision & { prefsState: StaffPrefsRead['state'] };
/** May this staff member be sent this message on this channel? Reads the switches (above) and applies the shared rule. An
 *  unreadable row sends and calls onUnreadable (the caller logs it). */
export async function staffSendDecision(db: unknown, tenantId: string | null | undefined, userId: string | null | undefined, channel: StaffNotifyChannel,
  category: StaffNotifyCategory, onUnreadable?: (message: string) => void): Promise<StaffSendDecision> {
  const read = await readStaffNotificationPrefs(db, tenantId, userId);
  if (read.state === 'unreadable') onUnreadable?.(`staff notification preferences unreadable; sending: ${read.error ?? 'unknown error'}`);
  return { ...staffNotificationAllowed(read.prefs, channel, category), prefsState: read.state };
}
