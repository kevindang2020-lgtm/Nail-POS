// authApi.ts — auth endpoints (real backend: @Controller('auth')). The shared client sends the httpOnly session cookie
// (credentials: include) and throws on 401/403 (carrying the server's message); 200 outcomes (SUCCESS / MFA_REQUIRED /
// BRANCH_SELECTION_REQUIRED) are returned as the response body so the login screen can branch on `outcome`.
import { api } from './client';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null; avatarUrl?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal; }

export const authApi = {
  login: (body: Record<string, unknown>) => api.post<LoginResultBody>('/auth/login', body),
  logout: () => api.post<{ ok: boolean }>('/auth/logout', {}),
  // /auth/me echoes the session-derived context (req.ctx). The tenant-context middleware is applied on the backend,
  // so a valid session cookie returns the principal (and no cookie → 401, handled as logged-out).
  me: () => api.get<Principal | null>('/auth/me'),
  // security settings (Settings screen): TOTP enrollment + self password change — real backend routes
  mfaStatus: () => api.get<{ enrolled: boolean; confirmed: boolean }>('/auth/mfa/status'),
  mfaEnroll: () => api.post<{ ok: boolean; secret: string; otpauthUri: string }>('/auth/mfa/enroll', {}),
  mfaConfirm: (mfaCode: string) => api.post<{ ok: boolean; confirmed: boolean }>('/auth/mfa/confirm', { code: mfaCode }),
  changePassword: (b: { currentPassword: string; newPassword: string; confirmPassword: string; mfaCode?: string }) => api.post<{ ok: boolean }>('/auth/change-password', b),
  uploadAvatar: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.upload<{ ok: boolean; avatarUrl: string | null }>('/auth/avatar', formData);
  },
  removeAvatar: () => api.del<{ ok: boolean; avatarUrl: null }>('/auth/avatar'),
};
