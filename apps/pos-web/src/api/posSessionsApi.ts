// posSessionsApi.ts — POS access to the signed-in user's own recent sign-in sessions.
// Backed by GET /pos/me/sessions (profile.controller, TenantAuthGuard, scoped to the user's session id).
// Used by the Account "Recent Sign-ins" panel and the Security & 2FA screen.
import { api } from './client';
import type { SignInSession } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)


export const posSessionsApi = {
  list: () => api.get<{ sessions: SignInSession[] }>('/pos/me/sessions'),
  revoke: (id: string) => api.post<{ ok: boolean; revoked: boolean }>(`/pos/me/sessions/${encodeURIComponent(id)}/revoke`, {}),
  revokeAll: () => api.post<{ ok: boolean; count: number }>('/pos/me/sessions/revoke-all', {}),
};
export type { SignInSession };
