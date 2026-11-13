// me-prefs.ts — the signed-in user's own notification + login-alert preferences (GET/PATCH pos/me/notification-prefs,
// pos/me/login-alerts). Realm: tenant. Types only — the ONE definition, read by the API and the POS (Constitution 13 §13).
export interface NotificationPrefs {
  smsNotifications: boolean; emailNotifications: boolean; pushNotifications: boolean; missedCallAlerts: boolean;
  bookingAlerts: boolean; lowStockAlerts: boolean; payrollApprovals: boolean; weeklyReportSummaries: boolean;
  /** extras Customer Notifications 08 (round 10): personal quiet hours, salon local time 'HH:MM' (both set, or both null = off).
   *  During them a push that is not a required notice (security) is held — not sent to this person's devices. */
  quietHoursStart?: string | null; quietHoursEnd?: string | null;
}
/** 'HH:MM', 00:00–23:59 */
export function isQuietHoursTime(v: unknown): v is string { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
/** Is minute-of-day `m` (0–1439) inside the window start → end? An overnight window (22:00 → 07:00) wraps midnight; the end
 *  minute is outside; start === end or either missing = no window. The ONE rule the API and the POS use. */
export function inQuietHours(m: number, start: string | null | undefined, end: string | null | undefined): boolean {
  if (!isQuietHoursTime(start) || !isQuietHoursTime(end) || start === end) return false;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const a = toMin(start), b = toMin(end);
  return a < b ? m >= a && m < b : m >= a || m < b;
}
/** The eight saved switches (everything in NotificationPrefs but the quiet-hours window). */
export type NotificationSwitch = Exclude<keyof NotificationPrefs, 'quietHoursStart' | 'quietHoursEnd'>;
/** user_notification_prefs column for each switch — the ONE mapping the API's reader and writer use. */
export const NOTIFICATION_PREF_COLUMNS: ReadonlyArray<readonly [NotificationSwitch, string]> = [
  ['smsNotifications', 'sms_notifications'], ['emailNotifications', 'email_notifications'], ['pushNotifications', 'push_notifications'],
  ['missedCallAlerts', 'missed_call_alerts'], ['bookingAlerts', 'booking_alerts'], ['lowStockAlerts', 'low_stock_alerts'],
  ['payrollApprovals', 'payroll_approvals'], ['weeklyReportSummaries', 'weekly_report_summaries'],
];
/** No saved row = every switch on, no quiet hours (migration 134's column defaults). */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  smsNotifications: true, emailNotifications: true, pushNotifications: true, missedCallAlerts: true,
  bookingAlerts: true, lowStockAlerts: true, payrollApprovals: true, weeklyReportSummaries: true, quietHoursStart: null, quietHoursEnd: null,
};
/** A user_notification_prefs row (snake_case columns) → NotificationPrefs. Missing / null column → default (on); quiet
 *  hours are both read or neither. */
export function rowToNotificationPrefs(row: Record<string, unknown>): NotificationPrefs {
  const out: NotificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const [field, col] of NOTIFICATION_PREF_COLUMNS) if (row[col] != null) out[field] = !!row[col];
  const qs = isQuietHoursTime(row['quiet_start']) ? row['quiet_start'] : null, qe = isQuietHoursTime(row['quiet_end']) ? row['quiet_end'] : null;
  out.quietHoursStart = qs && qe ? qs : null; out.quietHoursEnd = qs && qe ? qe : null;
  return out;
}

// ── extras round 11 (Nov 13 2026): staff notification preferences are ENFORCED, through this one rule ─────────────────
/** The channel a staff-directed message travels on. (The in-app feed is not a send: it always lands, like quiet hours.) */
export type StaffNotifyChannel = 'sms' | 'email' | 'push';
/** What a staff-directed message is about.
 *  • 'security' — sign-in, MFA, password, new-device notices: ALWAYS sent (never held by a switch).
 *  • 'account_urgent' — a HIGH / CRITICAL Super Admin warning about the salon's own account: ALWAYS sent.
 *  • 'account_notice' — a LOW / MEDIUM Super Admin warning: follows the owner's SMS / e-mail switch (it still shows on the
 *    salon dashboard when the admin chose that). Decision Nov 13 2026 (Kevin: "pick and do it").
 *  • a category with its own switch (booking, missed_call, low_stock, payroll_approval, weekly_report): channel switch AND
 *    category switch must both be on.
 *  • 'general' — every other staff alert (queue, payment, business alerts…): only the channel switch applies. */
export const STAFF_NOTIFY_CATEGORIES = ['security', 'account_urgent', 'account_notice', 'booking', 'missed_call', 'low_stock', 'payroll_approval', 'weekly_report', 'general'] as const;
export type StaffNotifyCategory = (typeof STAFF_NOTIFY_CATEGORIES)[number];
/** The reason a held staff send is recorded with, wherever that send path already records outcomes. */
export const STAFF_PREF_HOLD_REASON = 'staff_pref_off' as const;
const CHANNEL_SWITCH: Record<StaffNotifyChannel, NotificationSwitch> = { sms: 'smsNotifications', email: 'emailNotifications', push: 'pushNotifications' };
const CATEGORY_SWITCH: Partial<Record<StaffNotifyCategory, NotificationSwitch>> = {
  booking: 'bookingAlerts', missed_call: 'missedCallAlerts', low_stock: 'lowStockAlerts', payroll_approval: 'payrollApprovals', weekly_report: 'weeklyReportSummaries',
};
export interface StaffNotifyDecision { allowed: boolean; reason: typeof STAFF_PREF_HOLD_REASON | null; switchOff: NotificationSwitch | null }
/** THE rule: may this staff member be sent this message on this channel? `prefs` null/undefined = no saved row (defaults:
 *  all on) — the caller decides what "unreadable" means (every send path: send, and log). Pure; the API and the POS read it. */
export function staffNotificationAllowed(prefs: Partial<NotificationPrefs> | null | undefined, channel: StaffNotifyChannel, category: StaffNotifyCategory): StaffNotifyDecision {
  const ok: StaffNotifyDecision = { allowed: true, reason: null, switchOff: null };
  if (category === 'security' || category === 'account_urgent' || !prefs) return ok;
  const ch = CHANNEL_SWITCH[channel];
  if (!ch) return ok;
  if (prefs[ch] === false) return { allowed: false, reason: STAFF_PREF_HOLD_REASON, switchOff: ch };
  const cat = CATEGORY_SWITCH[category];
  if (cat && prefs[cat] === false) return { allowed: false, reason: STAFF_PREF_HOLD_REASON, switchOff: cat };
  return ok;
}
const PAYROLL_APPROVAL_KINDS = new Set(['payroll_ready_for_review', 'payroll_submitted', 'payroll_returned', 'payroll_rejected']);
/** A Super Admin warning's severity → its category: high / critical always go; low / medium (and anything unknown —
 *  the send form defaults to medium) follow the owner's channel switch. */
export const ACCOUNT_URGENT_SEVERITIES = ['high', 'critical'] as const;
export function accountNoticeCategory(severity: string | null | undefined): 'account_urgent' | 'account_notice' {
  return (ACCOUNT_URGENT_SEVERITIES as readonly string[]).includes(String(severity ?? '').toLowerCase()) ? 'account_urgent' : 'account_notice';
}
/** A typed push (mobile-push PUSH_CATEGORIES name + the payload's data.kind) → what it is about, for staffNotificationAllowed. */
export function staffCategoryForPush(pushCategory: string | null | undefined, kind?: unknown): StaffNotifyCategory {
  const k = typeof kind === 'string' ? kind : '';
  if (pushCategory === 'SECURITY') return 'security';
  if (pushCategory === 'APPOINTMENT_CONFIRMATION' || pushCategory === 'BOOKING_CHANGE' || pushCategory === 'NEW_CUSTOMER') return 'booking';
  if (pushCategory === 'BUSINESS_ALERT' && k.startsWith('appointment_')) return 'booking';   // owner/manager "new / moved / cancelled booking"
  if (pushCategory === 'APPROVAL_REQUIRED' && k === 'schedule_proposal') return 'booking';  // a customer answered a proposed new appointment time
  if (pushCategory === 'PAYROLL' && PAYROLL_APPROVAL_KINDS.has(k)) return 'payroll_approval';
  return 'general';
}
/** Which switches a real send path obeys today ('enforced') and which have no sender in the product yet ('no_sender' — no
 *  missed-call, low-stock or weekly-summary message is sent to staff today; the rule already covers them for when one is).
 *  Kept beside the rule so the My Account panel never claims more than the server does. */
export const NOTIFICATION_SWITCH_EFFECT: Record<NotificationSwitch, 'enforced' | 'no_sender'> = {
  smsNotifications: 'enforced', emailNotifications: 'enforced', pushNotifications: 'enforced', bookingAlerts: 'enforced', payrollApprovals: 'enforced',
  missedCallAlerts: 'no_sender', lowStockAlerts: 'no_sender', weeklyReportSummaries: 'no_sender',
};
export interface LoginAlertPrefs {
  enabled: boolean; newDevice: boolean; newLocation: boolean; passwordChanged: boolean; emailChanged: boolean;
  phoneChanged: boolean; twofaChanged: boolean; recoveryCodesChanged: boolean; sessionRevoked: boolean; suspiciousBlocked: boolean;
}
/** batch 8 decision 7 (Nov 9 2026): the signed-in user's own alert deliveries (notification_delivery_logs), newest first */
export interface NotificationDelivery { id: string; channel: 'sms' | 'email' | 'push'; targetMasked: string; template: string; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed' | 'blocked'; error: string | null; createdAt: string }
export interface NotificationDeliveryPage { items: NotificationDelivery[]; page: number; pageSize: number; total: number; totalPages: number }
