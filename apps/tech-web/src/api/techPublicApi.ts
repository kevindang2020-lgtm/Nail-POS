// techPublicApi.ts — unauthenticated invitee endpoint (no session required). Origin-agnostic accept endpoint, so the
// accept page works on the tech origin where a TECHNICIAN invitee lands.
import { api } from './client';

export const techPublicApi = {
  acceptInvitation: (b: { token: string; password: string; fullName?: string }) =>
    api.post<{ ok: boolean; userId: string; email: string; role: string }>('/public/website/invitations/accept', b),
};
