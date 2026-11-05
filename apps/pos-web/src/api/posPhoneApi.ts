// posPhoneApi.ts — read-only phone/A2P status. Real: the salon's registered messaging number + A2P 10DLC
// carrier-registration status. Both come from the existing messaging backend (session-scoped).
import { api } from "./client";
export const posPhoneApi = {
  number: () => api.get<{ configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null }>(`/tenant/messaging/number`),
  a2p: () => api.get<{ senderBrand: string; a2pStatus: string }>(`/pos/settings/notifications-reminders/a2p-status`),
};
