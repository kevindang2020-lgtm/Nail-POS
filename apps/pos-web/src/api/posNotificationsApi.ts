// posNotificationsApi.ts — tenant SMS/email notifications: send + recent activity log + opt-out
// (unsubscribe) compliance. Reuses the pos/notifications backend (tenant derived from the session).
import { api } from "./client";
import type { OptOutRow, NotificationChannel } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
import type { SendNotificationResult } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)


export interface NotifLogRow {
  id: string;
  channel: NotificationChannel;
  toAddress: string;
  subject: string | null;
  body: string;
  customerId?: string | null;
  status: string;
  providerId?: string | null;
  failureReason: string | null;
  createdAt: string;
}



export interface SendMessageInput {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
  customerId?: string;
}

export const posNotificationsApi = {
  recent: (limit = 50) => api.get<{ items: NotifLogRow[] }>(`/pos/notifications`, { limit }),
  optOuts: (limit = 100) => api.get<{ items: OptOutRow[] }>(`/pos/notifications/opt-outs`, { limit }),
  optIn: (channel: NotificationChannel, address: string) => api.post(`/pos/notifications/opt-in`, { channel, address }),
  optOut: (channel: NotificationChannel, address: string, reason?: string) => api.post(`/pos/notifications/opt-out`, { channel, address, reason }),
  send: (input: SendMessageInput) => api.post<SendNotificationResult>(`/pos/notifications/send`, input as unknown as Record<string, unknown>),
};
export type { OptOutRow, NotificationChannel };
export type { SendNotificationResult };
