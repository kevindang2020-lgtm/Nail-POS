// posMobilePaymentsApi.ts — the POS side of the Owner & Manager Payment App (mandate §45, §149–§151): which payment phones
// are online in this branch, which tickets a phone is processing right now (the claim), and "Send Checkout To → phone".
// Tenant / branch come from the session; the POS never names them. Safe fields only (labels, names, ids — no card data).
import { api } from './client';

import type { MobilePaymentPhoneStatus, MobileActiveClaim, MobileSendToDeviceResult, MobilePayDeviceView, MobileDevicePairingResult, MobileDeviceBranchesResult, MobileDeviceStatusResult, MobileDeviceActivity, MobileDeviceRenameResult } from '@aipowersalon/api-contracts/tenant';   // the API's own contract (Constitution 13 §15)
export type MobilePaymentPhone = MobilePaymentPhoneStatus;
export type MobilePaymentClaim = MobileActiveClaim;
export type TapToPayDevice = MobilePayDeviceView;
export type TapToPayPairing = MobileDevicePairingResult;
export type TapToPayDeviceActivity = MobileDeviceActivity;

export const posMobilePaymentsApi = {
  /** §149: the branch's active payment phones (● Online / Offline, Tap to Pay capable). */
  phones: () => api.get<MobilePaymentPhone[]>('/mobile-checkout/devices/status'),
  /** §45: tickets a phone holds right now ("Payment in progress on …"). */
  claims: () => api.get<MobilePaymentClaim[]>('/mobile-checkout/claims'),
  /** §150: push this checkout to one phone; the phone still has to claim it (§151: only one may). */
  sendToPhone: (ticketId: string, deviceId: string) => api.post<MobileSendToDeviceResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/send-to-device`, { deviceId }),

  // ── Secure Tap to Pay M6-4: the salon's Tap to Pay phones, managed from the POS (every trust change is a step-up route) ──
  /** Every registered payment phone of this salon (status, user, allowed locations, last seen). */
  devices: () => api.get<TapToPayDevice[]>('/mobile-checkout/devices'),
  /** §7: a single-use, 5-minute pairing code for a NEW phone at the signed-in location (shown as a QR). Step-up. */
  createPairing: (body: { label?: string; shared?: boolean }) => api.post<TapToPayPairing>('/mobile-checkout/devices/pairings', body),
  /** §9: the locations this phone may take payments in (effective = the employee's ∩ the phone's). Step-up. */
  setBranches: (deviceId: string, branchIds: string[]) => api.post<MobileDeviceBranchesResult>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/branches`, { branchIds }),
  /** §15: rename a phone (the name the POS, reports and the dashboard show). Step-up; the server cleans it (≤ 80). */
  rename: (deviceId: string, label: string) => api.post<MobileDeviceRenameResult>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/rename`, { label }),
  /** §13 trust decisions (step-up): approve, suspend (switch off, re-approvable), revoke (final — the phone's sessions end). */
  approve: (deviceId: string) => api.post<MobileDeviceStatusResult>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/approve`, {}),
  suspend: (deviceId: string, reason: string) => api.post<MobileDeviceStatusResult>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/disable`, { reason }),
  revoke: (deviceId: string, reason: string) => api.post<MobileDeviceStatusResult>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/revoke`, { reason }),
  /** M6-6 §15 / §62: one phone's sign-ins (who / when / live or ended) and its audit history. Owner-only. */
  activity: (deviceId: string) => api.get<TapToPayDeviceActivity>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/activity`),
};
