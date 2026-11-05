// posSecurityApi.ts — self-service security actions for the signed-in user, over the existing auth endpoints:
//   GET  /auth/mfa/status        → { enrolled, confirmed }
//   POST /auth/mfa/enroll        → { secret, otpauthUri }  (show once; add to an authenticator app)
//   POST /auth/mfa/confirm {code}→ { confirmed }
//   POST /auth/change-password   → { ok } | throws { code, message }
import { api } from './client';

export interface MfaStatus { enrolled: boolean; confirmed: boolean }
export interface MfaEnroll { ok: boolean; secret: string; otpauthUri: string }

export const posSecurityApi = {
  mfaStatus: () => api.get<MfaStatus>('/auth/mfa/status'),
  /** currentCode: required when replacing a confirmed authenticator (403 CURRENT_MFA_REQUIRED otherwise) */
  mfaEnroll: (currentCode?: string) => api.post<MfaEnroll>('/auth/mfa/enroll', currentCode ? { currentCode } : {}),
  mfaConfirm: (code: string) => api.post<{ ok: boolean; confirmed: boolean }>('/auth/mfa/confirm', { code }),
  changePassword: (b: { currentPassword: string; newPassword: string; confirmPassword: string; mfaCode?: string }) =>
    api.post<{ ok: boolean }>('/auth/change-password', b as Record<string, unknown>),
  // Constitution 3 Step 8: recovery codes, trusted devices, sign-in activity
  recoveryCodesRemaining: () => api.get<{ remaining: number }>('/auth/mfa/recovery-codes'),
  generateRecoveryCodes: (code: string) => api.post<{ ok: boolean; codes: string[]; message?: string }>('/auth/mfa/recovery-codes', { code }),
  devices: () => api.get<{ devices: AuthDeviceRow[]; canTrust: boolean }>('/auth/devices'),
  deviceAction: (id: string, action: 'trust' | 'revoke' | 'block' | 'unblock') => api.post<{ ok: boolean; sessionsEnded?: number }>(`/auth/devices/${encodeURIComponent(id)}/${action}`, {}),
  activity: () => api.get<{ events: AuthActivityRow[] }>('/auth/activity'),
  // Constitution 3 Step 9: the salon's sign-in policy (owners)
  signInPolicy: () => api.get<SignInPolicy>('/pos/settings/security'),
  saveSignInPolicy: (p: Partial<SignInPolicy>) => api.patch<SignInPolicy>('/pos/settings/security', p as Record<string, unknown>),
  // Constitution 3 Step 10d: apps connected to the salon over OAuth
  connectedApps: () => api.get<{ apps: { id: string; name: string; scopes: string[]; connectedAt: string }[] }>('/pos/connected-apps'),
  disconnectApp: (id: string) => api.post<{ ok: boolean }>(`/pos/connected-apps/${encodeURIComponent(id)}/revoke`, {}),
};
export interface SignInPolicy { mfaForOwner: boolean; rememberTrustedDevices: boolean; passkeyEnabled: boolean; pinLogin: boolean; auditRetention: '30d' | '90d' | '1y' | 'forever';
  /** Oct 12 2026: the POS auto-lock (server-enforced); absent on a policy saved before — then on, 60 */
  autoLockEnabled?: boolean; autoLockMinutes?: number }
export interface AuthDeviceRow { id: string; name: string | null; platform: string | null; trustState: 'new' | 'recognized' | 'trusted' | 'suspicious' | 'blocked' | 'revoked'; trustedUntil: string | null; lastSeenAt: string; signInCount: number; current: boolean }
export interface AuthActivityRow { type: string; outcome: 'success' | 'failure' | 'info'; occurredAt: string; ip: string | null; reason: string | null }
