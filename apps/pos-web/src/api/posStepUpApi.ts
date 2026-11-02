// posStepUpApi.ts — re-prove the password (and the authenticator code when the account has one) for THIS session, so a
// step-up route (role / branch / override changes, ownership transfer, access-review decisions) can run. POST /auth/step-up
// stamps sessions.last_step_up_at; no new session, no new token (apps/api/src/common/step-up.ts).
import { api } from './client';

export const posStepUpApi = {
  stepUp: (body: { password: string; code?: string }) => api.post<{ ok: boolean; strength?: string }>('/auth/step-up', body as Record<string, unknown>),
};
