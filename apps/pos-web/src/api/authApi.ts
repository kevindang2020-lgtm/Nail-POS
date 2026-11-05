// authApi.ts — auth endpoints (real backend @Controller('auth')). Shared cookie client (credentials: include); throws
// on 401/403 with the server's message, returns the body for 200 outcomes (SUCCESS / MFA_REQUIRED /
// BRANCH_SELECTION_REQUIRED) so the login screen can branch on `outcome`.
import { api } from './client';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null; email?: string | null;
  /** Constitution 7 §19 — 'SUSPENDED_BILLING_ONLY': the owner of a suspended salon, limited to billing server-side */
  restriction?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal }
export interface BranchOption { id: string; name?: string; isActive: boolean; city?: string | null }

export const authApi = {
  login: async (body: Record<string, unknown>) => {
    localStorage.removeItem('pos_locked');
    return api.post<LoginResultBody>('/auth/login', body);
  },
  logout: () => api.post<{ ok: boolean }>('/auth/logout', {}),
  me: () => api.get<Principal | null>('/auth/me'),
  branches: () => api.get<{ ok: boolean; branches: BranchOption[] }>('/auth/branches'),
  selectBranch: (branchId: string) => api.post<{ ok: boolean; principal?: Principal }>('/auth/select-branch', { branchId }),
};
