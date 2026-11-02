// checkInDevicesApi.ts — Super Admin Go Check-In device management, wired to the real, tested backend routes on
// go-check-in.admin.controller.ts (@Controller('super-admin/tenants/:tenantId/go-check-in'), SuperAdminGuard).
// Per-tenant: list devices + settings, create a device (token minted ONCE), update status, regenerate token, disable,
// patch settings, and read recent logs. Reads via the shared root-relative `api` (credentials: include).
import { api } from './client';
import type { GoCheckInSettings, GoCheckInDeviceStatus, GoCheckInDeviceView, GoCheckInDevicesState } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

const enc = encodeURIComponent;
const base = (tenantId: string) => `/super-admin/tenants/${enc(tenantId)}/go-check-in`;

export type CheckInLog = {
  id: string; branchId: string | null; deviceId: string | null; sessionId: string | null;
  eventType: string; safeMessage: string | null; createdAt: string;
};
export type CreatedDevice = { deviceId: string; checkinSlug: string; publicUrl: string; deviceToken: string; tokenExpiresAt: string | null };

export const checkInDevicesApi = {
  state: (tenantId: string) => api.get<GoCheckInDevicesState>(base(tenantId)),
  createDevice: (tenantId: string, body: { deviceName: string; branchId?: string | null; deviceType?: string; baseUrl?: string; allowedBranchIds?: string[] }) =>
    api.post<CreatedDevice>(base(tenantId), body),
  setBranches: (tenantId: string, deviceId: string, patch: { branchId?: string | null; allowedBranchIds?: string[] }) =>
    api.patch<GoCheckInDeviceView>(`${base(tenantId)}/${enc(deviceId)}`, patch),
  updateSettings: (tenantId: string, patch: Partial<GoCheckInSettings>) =>
    api.patch<GoCheckInSettings>(`${base(tenantId)}/settings`, patch),
  setStatus: (tenantId: string, deviceId: string, status: GoCheckInDeviceStatus) =>
    api.patch<GoCheckInDeviceView>(`${base(tenantId)}/${enc(deviceId)}`, { status }),
  regenerateToken: (tenantId: string, deviceId: string) =>
    api.post<{ deviceToken: string; tokenExpiresAt: string | null }>(`${base(tenantId)}/${enc(deviceId)}/regenerate-token`, {}),
  disableDevice: (tenantId: string, deviceId: string) =>
    api.post<GoCheckInDeviceView>(`${base(tenantId)}/${enc(deviceId)}/disable`, {}),
  logs: (tenantId: string, limit = 100) =>
    api.get<{ logs: CheckInLog[] }>(`${base(tenantId)}/logs`, { limit }),
};
export type { GoCheckInSettings, GoCheckInDeviceStatus, GoCheckInDeviceView, GoCheckInDevicesState };
