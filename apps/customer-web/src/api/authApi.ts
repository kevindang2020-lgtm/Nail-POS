import { transport } from './client';
import { deviceIdentity } from '@aipowersalon/mobile-sdk';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal; token?: string; accessToken?: string }

// BUILD_PLAN Phase 13: sign-in calls ride the ONE transport (client headers, timeout, bearer on native). A 401 here is an
// answer ("wrong password", "no session yet"), not a dead session — so it never announces aps:unauthorized.
function http<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return transport.request<T>(init?.method ?? 'GET', path, { body: init?.body, notifyUnauthorized: false });
}

export const authApi = {
  // Constitution 12 §144: every login names its device, so the sessions list is readable and a lost phone is revocable by name.
  login: async (body: Record<string, unknown>) => http<LoginResultBody>('/auth/login', { method: 'POST', body: { ...body, device: await deviceIdentity('Customer app') } }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST', body: {} }),
  me: () => http<Principal | null>('/auth/me'),
  register: (body: Record<string, unknown>) => http<{ ok: boolean; message?: string }>('/customer/auth/register', { method: 'POST', body: body }),
  passwordResetRequest: (body: Record<string, unknown>) => http<{ ok?: boolean; message?: string }>('/auth/password-reset/request', { method: 'POST', body: body }),
  passwordResetTempLogin: (body: Record<string, unknown>) => http<{ ok?: boolean; resetSessionToken?: string; message?: string }>('/auth/password-reset/temp-login', { method: 'POST', body: body }),
  /** Security Deep Scan C1: no session comes back — { ok, mustSignIn: true }; the screen sends the person to sign in. */
  passwordResetComplete: (body: Record<string, unknown>) => http<{ ok?: boolean; mustSignIn?: boolean; message?: string }>('/auth/password-reset/complete', { method: 'POST', body: body }),
};
