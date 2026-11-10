// me-prefs.ts — the signed-in user's own notification + login-alert preferences (GET/PATCH pos/me/notification-prefs,
// pos/me/login-alerts). Realm: tenant. Types only — the ONE definition, read by the API and the POS (Constitution 13 §13).
export interface NotificationPrefs {
  smsNotifications: boolean; emailNotifications: boolean; pushNotifications: boolean; missedCallAlerts: boolean;
  bookingAlerts: boolean; lowStockAlerts: boolean; payrollApprovals: boolean; weeklyReportSummaries: boolean;
}
export interface LoginAlertPrefs {
  enabled: boolean; newDevice: boolean; newLocation: boolean; passwordChanged: boolean; emailChanged: boolean;
  phoneChanged: boolean; twofaChanged: boolean; recoveryCodesChanged: boolean; sessionRevoked: boolean; suspiciousBlocked: boolean;
}
/** batch 8 decision 7 (Nov 9 2026): the signed-in user's own alert deliveries (notification_delivery_logs), newest first */
export interface NotificationDelivery { id: string; channel: 'sms' | 'email' | 'push'; targetMasked: string; template: string; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed' | 'blocked'; error: string | null; createdAt: string }
export interface NotificationDeliveryPage { items: NotificationDelivery[]; page: number; pageSize: number; total: number; totalPages: number }
