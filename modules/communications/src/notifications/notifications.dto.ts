// notifications.dto.ts
import type { NotificationChannel } from './notifications-core';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { SendNotificationResult } from '@aipowersalon/api-contracts/tenant';
import type { SendNotificationResult } from '@aipowersalon/api-contracts/tenant';

export interface SendNotificationRequest {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
  customerId?: string; // optional link to a customer record
}

export interface NotificationLogRow {
  id: string;
  tenantId: string;
  channel: NotificationChannel;
  toAddress: string;
  subject: string | null;
  body: string;
  customerId: string | null;
  /** 'simulated' (P-11): the development mock "sent" it — nothing left the process, never metered or billed. */
  status: 'sent' | 'failed' | 'blocked' | 'delivered' | 'simulated';
  providerId: string | null;
  failureReason: string | null;
  createdAt: string;  /** wave 3 PAYI §77 / §87: provider segment count + the provider's own status / error code (support only, never a customer) */
  segmentCount?: number | null;
  providerStatus?: string | null;
  providerErrorCode?: string | null;
  /** migration 678 (mandate §65): the sending path (the salon's own Twilio account / the platform account with the salon's
   *  number / the platform default) and the From or Messaging Service used — addresses, never credentials. */
  senderRoute?: 'tenant_account' | 'shared_salon_number' | 'shared_default' | null;
  senderFrom?: string | null;
}

