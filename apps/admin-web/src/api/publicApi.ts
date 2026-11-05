// publicApi.ts — unauthenticated endpoints an invitee hits before they have a session. Same typed fetch client
// (cookie-credentialed, but none is required here). Kept separate from superAdminApi so it never implies auth.
import { api } from './client';

export const publicApi = {
  // Redeem a single-use invitation token and set your own password. Backed by POST public/website/invitations/accept.
  acceptInvitation: (b: { token: string; password: string; fullName?: string }) =>
    api.post<{ ok: boolean; userId: string; email: string; role: string }>('/public/website/invitations/accept', b),
};
