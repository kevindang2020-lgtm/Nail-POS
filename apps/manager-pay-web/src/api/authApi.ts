// authApi.ts — minimal auth calls for the Payment App. Uses the shared client (session cookie, no tenant/branch in
// bodies). me() resolves the signed-in principal or null when not authenticated.
import { deviceIdentity } from '@aipowersalon/mobile-sdk';
import { api } from './client';
import { DEVICE_ID } from '../util/session';

export interface Principal {
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  role: string;
  permissions: string[];
  fullName?: string | null;
  subscriptionStatus?: string;
}

export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal }
/** One location this person may enter (GET /auth/branches — the server already narrows it to their allowed branches, §121). */
export interface BranchOption { id: string; isActive: boolean; name?: string; city?: string | null }
export interface SelectBranchBody { ok: boolean; principal?: Principal; accessToken?: string; refreshToken?: string }

export const authApi = {
  me: () => api.get<Principal | null>('/auth/me').catch(() => null),
  logout: () => api.post<{ ok: boolean }>('/auth/logout', {}),
  // Reuses the shared /auth/login. Manager Pay users are salon staff (tenant portal): the tenant is resolved from
  // the salon code, and the backend enforces role + payment permission + branch + device — the app never assigns
  // its own role. Returns the outcome body so the screen can branch on SUCCESS / MFA_REQUIRED / etc.
  // Constitution 12 §144: every login names its device, so the sessions list is readable and a lost phone is revocable by name.
  // Secure Tap to Pay M6-4: device.id is THIS phone's one id (util/session DEVICE_ID) — the same id its payment key is
  // registered under, so revoking the phone ends exactly the sessions signed in on it (sessions.device_id).
  login: async (body: Record<string, unknown>) => api.post<LoginResultBody>('/auth/login', { ...body, device: { ...(await deviceIdentity('Manager Pay')), id: DEVICE_ID } }),
  // Reuses the real password-reset workflow (same endpoints the POS/tech apps use; OWNER/MANAGER/FRONT_DESK/RECEPTION are allowed to reset).
  /** Mandate §17 / §184: re-confirm the password (+ 2FA code when enrolled) before a high-value charge — POST /auth/step-up
   *  stamps THIS session's step-up time (apps/api common/step-up.ts); no new session, no new token. */
  stepUp: (password: string, code?: string) => api.post<{ ok: boolean }>('/auth/step-up', code ? { password, code } : { password }),
  /** Mandate §121: the locations this person may enter (the platform's branch picker list, server-filtered). */
  branches: () => api.get<{ ok: boolean; branches: BranchOption[] }>('/auth/branches').then((r) => (Array.isArray(r?.branches) ? r.branches : [])),
  /** Mandate §120: the platform's ONE branch switch. The phone names itself so the server can refuse while a payment on it is
   *  active (409 PAYMENT_IN_PROGRESS); on success the session is re-signed for the new location (native: a new token). */
  selectBranch: (branchId: string, deviceId: string) => api.post<SelectBranchBody>('/auth/select-branch', { branchId, deviceId }),
  requestPasswordReset: (salonCode: string, phone: string) =>
    api.post<{ ok: boolean; message?: string }>('/auth/password-reset/request', { salonCode, phone }),
};
