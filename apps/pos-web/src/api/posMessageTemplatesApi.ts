// posMessageTemplatesApi.ts — reusable SMS/email message templates (real store via pos/settings).
import { api } from "./client";
import type { MessageTemplate } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export const posMessageTemplatesApi = {
  list: () => api.get<MessageTemplate[]>(`/pos/settings/notifications-reminders/templates`),
  upsert: (t: { id?: string; channel: 'sms' | 'email'; name: string; body: string }) =>
    api.post<MessageTemplate>(`/pos/settings/notifications-reminders/templates`, t as unknown as Record<string, unknown>),
};
export type { MessageTemplate };
