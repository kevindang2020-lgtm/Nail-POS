// ownerPublicApi.ts — unauthenticated invitee endpoint (no session required). The accept endpoint is origin-agnostic,
// so hosting the accept page on the owner origin works identically to the admin/POS origins.
import { api } from './client';

export const ownerPublicApi = {
  acceptInvitation: (b: { token: string; password: string; fullName?: string }) =>
    api.post<{ ok: boolean; userId: string; email: string; role: string }>('/public/website/invitations/accept', b),

  // "Request Access / Contact Support" from the Owner login (the owner has no session yet, so this MUST be an
  // unauthenticated endpoint). Routes to the real public lead intake as a 'contact' lead → it lands in Super
  // Admin's Website Leads with status 'new'. Requires an email or phone (backend-enforced), no user enumeration.
  requestAccess: (b: { businessName?: string; ownerName?: string; email?: string; phone?: string; message?: string }) =>
    api.post<{ ok: boolean; id?: string }>('/public/website/leads', {
      kind: 'contact',
      salonName: b.businessName,
      name: b.ownerName,
      email: b.email,
      phone: b.phone,
      message: b.message,
      sourcePage: 'owner_app_request_access',
    }),
};
