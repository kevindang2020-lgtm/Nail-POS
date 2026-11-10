// posMePrefsApi.ts — the signed-in user's OWN notification + login-alert preferences (pos/me/notification-prefs,
// pos/me/login-alerts; tables user_notification_prefs / user_login_alert_prefs). Session-scoped server-side: no user id is sent.
import { api } from './client';
import type { NotificationPrefs, LoginAlertPrefs, NotificationDeliveryPage } from '@aipowersalon/api-contracts/tenant';
export type { NotificationPrefs, LoginAlertPrefs, NotificationDeliveryPage };
export interface DeliveryQuery { q?: string; channel?: string; status?: string; from?: string; to?: string; page: number; pageSize: number }

export const posMePrefsApi = {
  notifications: () => api.get<NotificationPrefs>('/pos/me/notification-prefs'),
  setNotifications: (patch: Partial<NotificationPrefs>) => api.patch<NotificationPrefs>('/pos/me/notification-prefs', patch as Record<string, unknown>),
  loginAlerts: () => api.get<LoginAlertPrefs>('/pos/me/login-alerts'),
  /** batch 8 decision 7: my own alert deliveries, newest first */
  deliveries: (q: DeliveryQuery) => api.get<NotificationDeliveryPage>('/pos/me/notification-deliveries', Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'))),
};
