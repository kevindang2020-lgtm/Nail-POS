// posPublicApi.ts — unauthenticated endpoints a tenant invitee hits before they have a session. Same cookie-credentialed
// fetch client (no session is required here). The accept endpoint is origin-agnostic, so hosting the accept page on the
// POS origin works identically to hosting it on the admin origin.
import { api } from './client';

export const posPublicApi = {
  acceptInvitation: (b: { token: string; password: string; fullName?: string }) =>
    api.post<{ ok: boolean; userId: string; email: string; role: string }>('/public/website/invitations/accept', b),
};
