// posMePrefsApi.ts — the signed-in user's OWN notification + login-alert preferences (pos/me/notification-prefs,
// pos/me/login-alerts; tables user_notification_prefs / user_login_alert_prefs). Session-scoped server-side: no user id is sent.
import { api } from './client';
import type { NotificationPrefs, LoginAlertPrefs } from '@aipowersalon/api-contracts/tenant';
export type { NotificationPrefs, LoginAlertPrefs };

export const posMePrefsApi = {
  notifications: () => api.get<NotificationPrefs>('/pos/me/notification-prefs'),
  setNotifications: (patch: Partial<NotificationPrefs>) => api.patch<NotificationPrefs>('/pos/me/notification-prefs', patch as Record<string, unknown>),
  loginAlerts: () => api.get<LoginAlertPrefs>('/pos/me/login-alerts'),
};
