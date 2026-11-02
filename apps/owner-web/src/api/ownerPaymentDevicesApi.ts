// ownerPaymentDevicesApi.ts — the owner's payment-device health (Owner & Manager Payment App mandate §12–§17, §137–§145):
// the salon's registered Tap to Pay phones, their trust state, the user each is bound to, online / last payment / last
// error, and the owner's trust decisions (approve, disable, revoke, mark compromised — reason kept and audited). The
// SAME endpoints the Payment App's More screen uses; tenant from the session, never sent.
import type { MobilePayDeviceView } from '@aipowersalon/api-contracts/tenant';
import type { PaymentDeviceSecuritySummary } from '@aipowersalon/api-contracts';
export type { MobilePayDeviceView, PaymentDeviceSecuritySummary };
import { api } from './client';

type Action = 'approve' | 'disable' | 'revoke' | 'compromised';
export const ownerPaymentDevicesApi = {
  list: () => api.get<MobilePayDeviceView[]>('/mobile-checkout/devices'),
  /** Secure Tap to Pay §51 (Oct 27): this salon's payment-phone security counts (owner only — pos.devices.manage). */
  securitySummary: () => api.get<PaymentDeviceSecuritySummary>('/mobile-checkout/devices/security-summary'),
  act: (deviceId: string, action: Action, reason?: string) =>
    api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/${action}`, action === 'approve' ? {} : { reason }),
};
