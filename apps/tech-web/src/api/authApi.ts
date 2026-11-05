import { apiBase } from './client';
import { authHeader } from '../auth/native-auth';

export interface Principal {
  userId: string; tenantId: string | null; branchId: string | null; role: string;
  permissions: string[]; subscriptionStatus?: string; needsBranchSelection?: boolean; fullName?: string | null;
}
export interface LoginResultBody { ok: boolean; outcome: string; message?: string; principal?: Principal; token?: string; accessToken?: string }
export interface BranchOption { id: string; name?: string; isActive: boolean; city?: string | null }

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase().replace(/\/+$/, '');
  const url = base + (path.startsWith('/') ? path : '/' + path);
  const bearer = await authHeader();
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...bearer,
    },
    ...init,
  });
  let json: any = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const m = (json && json.message) || (res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'Not permitted.' : 'Request failed.'); throw Object.assign(new Error(m), { status: res.status }); }
  return json as T;
}

export const authApi = {
  login: (body: Record<string, unknown>) => http<LoginResultBody>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  requestPasswordReset: (salonCode: string, phone: string) => http<{ ok: boolean; message?: string }>('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ salonCode, phone }) }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
  me: () => http<Principal | null>('/auth/me'),
  branches: () => http<{ ok: boolean; branches: BranchOption[] }>('/auth/branches'),
  selectBranch: (branchId: string) => http<{ ok: boolean; principal?: Principal }>('/auth/select-branch', { method: 'POST', body: JSON.stringify({ branchId }) }),
};
