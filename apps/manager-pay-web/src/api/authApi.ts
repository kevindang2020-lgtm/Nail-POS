// authApi.ts — minimal auth calls for the Payment App. Uses the shared client (session cookie, no tenant/branch in
// bodies). me() resolves the signed-in principal or null when not authenticated.
import { api } from './client';

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

export interface BranchOption { id: string; name?: string; isActive: boolean; city?: string | null }

export const authApi = {
  me: () => api.get<Principal | null>('/auth/me').catch(() => null),
  logout: () => api.post<{ ok: boolean }>('/auth/logout', {}),
  // Reuses the shared /auth/login. Manager Pay users are salon staff (tenant portal): the tenant is resolved from
  // the salon code, and the backend enforces role + payment permission + branch + device — the app never assigns
  // its own role. Returns the outcome body so the screen can branch on SUCCESS / MFA_REQUIRED / etc.
  login: (body: Record<string, unknown>) => api.post<LoginResultBody>('/auth/login', body),
  branches: () => api.get<{ ok: boolean; branches: BranchOption[] }>('/auth/branches'),
  selectBranch: (branchId: string) => api.post<{ ok: boolean; principal?: Principal }>('/auth/select-branch', { branchId }),
  // Reuses the real password-reset workflow (same endpoints the POS/tech apps use; OWNER/MANAGER/FRONT_DESK/RECEPTION are allowed to reset).
  requestPasswordReset: (salonCode: string, phone: string) =>
    api.post<{ ok: boolean; message?: string }>('/auth/password-reset/request', { salonCode, phone }),
};
