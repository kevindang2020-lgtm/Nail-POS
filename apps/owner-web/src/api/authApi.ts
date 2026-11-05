import { transport } from './client';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal; token?: string; accessToken?: string }
export interface BranchOption { id: string; name?: string; isActive: boolean; city?: string | null }

// Sign-in calls go through the same transport as every other call (/api/v1, client identity headers, the native bearer).
// A 401 here is an answer ("wrong password", "no session"), not a dead session — so it never announces aps:unauthorized.
async function http<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  try {
    return await transport.request<T>(init?.method ?? 'GET', path, {
      body: init?.body !== undefined ? JSON.parse(init.body) : undefined,
      notifyUnauthorized: false,
    });
  } catch (e: any) {
    const status = Number(e?.status ?? 0);
    const m = e?.serverMessage || e?.message || (status === 401 ? 'Please sign in again.' : status === 403 ? 'Not permitted.' : 'Request failed.');
    throw Object.assign(new Error(m), { status, code: e?.code });
  }
}

export const authApi = {
  login: (body: Record<string, unknown>) => http<LoginResultBody>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
  me: () => http<Principal | null>('/auth/me'),
  branches: () => http<{ ok: boolean; branches: BranchOption[] }>('/auth/branches'),
  selectBranch: (branchId: string) => http<{ ok: boolean; principal?: Principal }>('/auth/select-branch', { method: 'POST', body: JSON.stringify({ branchId }) }),

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
    http<{ ok: boolean; message?: string }>('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ salonCode, phone }) }),

  /** The 6-digit code from the SMS is the password. Returns a short-lived token that authorises the change. */
  tempLogin: (salonCode: string, emailOrPhone: string, code: string) =>
    http<{ ok: boolean; resetSessionToken?: string; message?: string }>('/auth/password-reset/temp-login', {
      method: 'POST', body: JSON.stringify({ tenantCodeOrSlug: salonCode, emailOrPhone, password: code }),
    }),

  completePasswordReset: (resetSessionToken: string, newPassword: string, confirmPassword: string) =>
    http<{ ok: boolean; message?: string }>('/auth/password-reset/complete', {
      method: 'POST', body: JSON.stringify({ resetSessionToken, newPassword, confirmPassword }),
    }),
};
