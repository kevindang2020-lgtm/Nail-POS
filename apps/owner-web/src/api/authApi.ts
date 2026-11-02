import { transport } from './client';
import { deviceIdentity } from '@aipowersalon/mobile-sdk';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null;
  /** Constitution 7 §19 — 'SUSPENDED_BILLING_ONLY': limited to billing routes server-side */
  restriction?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal; token?: string; accessToken?: string }
export interface BranchOption { id: string; name?: string; isActive: boolean; city?: string | null }

// BUILD_PLAN Phase 13: sign-in calls ride the ONE transport (client headers, timeout, bearer on native). A 401 here is an
// answer ("wrong password", "no session yet"), not a dead session — so it never announces aps:unauthorized.
function http<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return transport.request<T>(init?.method ?? 'GET', path, { body: init?.body, notifyUnauthorized: false });
}

export const authApi = {
  // Constitution 12 §144: every login names its device, so the sessions list is readable and a lost phone is revocable by name.
  login: async (body: Record<string, unknown>) => http<LoginResultBody>('/auth/login', { method: 'POST', body: { ...body, device: await deviceIdentity('Owner app') } }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST', body: {} }),
  me: () => http<Principal | null>('/auth/me'),
  branches: () => http<{ ok: boolean; branches: BranchOption[] }>('/auth/branches'),

  // ── PASSWORD RESET ────────────────────────────────────────────────────────────────────────────────────
  //
  // These three endpoints have been live the whole time. `RESET_ALLOWED_ROLES` is
  //
  //     ["OWNER", "MANAGER", "FRONT_DESK", "RECEPTION"]
  //
  // — OWNER is first on the list. The POS staff can reset. Technicians' apps have the button. Customers can
  // reset. And owner-web had NO forgot-password link anywhere, and no screen called Super Admin's
  // `resetOwnerPassword` either.
  //
  // So a salon owner who forgot their password was locked out of their own business, permanently, with no
  // self-serve path and no support path. The person who pays for the platform was the one person who could not
  // get back in.
  //
  // The request always returns the same generic message whether or not the account exists — that is deliberate
  // (no user enumeration), and the UI must not pretend to know more than it does.
  requestPasswordReset: (salonCode: string, phone: string) =>
    http<{ ok: boolean; message?: string }>('/auth/password-reset/request', { method: 'POST', body: { salonCode, phone } }),

  /** The 6-digit code from the SMS is the password. Returns a short-lived token that authorises the change. */
  tempLogin: (salonCode: string, emailOrPhone: string, code: string) =>
    http<{ ok: boolean; resetSessionToken?: string; message?: string }>('/auth/password-reset/temp-login', {
      method: 'POST', body: { tenantCodeOrSlug: salonCode, emailOrPhone, password: code },
    }),

  completePasswordReset: (resetSessionToken: string, newPassword: string, confirmPassword: string) =>
    // Security Deep Scan C1: completing a reset never signs anyone in — { ok, mustSignIn: true }; the owner signs in next.
    http<{ ok: boolean; mustSignIn?: boolean; message?: string }>('/auth/password-reset/complete', {
      method: 'POST', body: { resetSessionToken, newPassword, confirmPassword },
    }),
};
