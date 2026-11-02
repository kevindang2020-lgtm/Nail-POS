// posRemindersApi.ts — owner-facing appointment-reminder config. Reads/updates GET/PATCH /pos/reminders.
import { api } from './client';
import type { ReminderConfig } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)


export const posRemindersApi = {
  get: () => api.get<ReminderConfig>('/pos/reminders'),
  update: (patch: { enabled?: boolean; leadMinutes?: number; windowMinutes?: number; channel?: 'sms' | 'email' }) => api.patch<ReminderConfig>('/pos/reminders', patch),
};
export type { ReminderConfig };
