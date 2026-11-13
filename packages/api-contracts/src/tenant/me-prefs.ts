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
export interface LoginAlertPrefs {
  enabled: boolean; newDevice: boolean; newLocation: boolean; passwordChanged: boolean; emailChanged: boolean;
  phoneChanged: boolean; twofaChanged: boolean; recoveryCodesChanged: boolean; sessionRevoked: boolean; suspiciousBlocked: boolean;
}
/** batch 8 decision 7 (Nov 9 2026): the signed-in user's own alert deliveries (notification_delivery_logs), newest first */
export interface NotificationDelivery { id: string; channel: 'sms' | 'email' | 'push'; targetMasked: string; template: string; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed' | 'blocked'; error: string | null; createdAt: string }
export interface NotificationDeliveryPage { items: NotificationDelivery[]; page: number; pageSize: number; total: number; totalPages: number }
