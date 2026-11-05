import { api } from './client';

// superAdminTechniciansApi — the GLOBAL technician account, not any salon's copy of it.
//
// This is the only surface on the platform that can suspend, merge or erase a technician's account. A salon can
// end its own relationship with her; it cannot touch the account. That asymmetry is the whole feature, and it is
// enforced on the server (SuperAdminGuard) — this client just talks to it.

export interface SATechRow {
  profileId: string; techCode: string; displayName: string; status: string;
  mergedInto: string | null;
  overallRating: number | null; ratingCount: number; portfolioPhotoCount: number;
  activeSalonCount: number; createdAt: string | null;
}

export interface SATechSalon {
  membershipId: string; tenantId: string; salonName: string; salonCode: string | null;
  branchName: string | null; status: string; roleLabel: string | null;
  startedAt: string | null; endedAt: string | null; endedReason: string | null;
}

export interface SATechDeleteRequest {
  requestId: string; profileId: string; status: string; reason: string; legalHold: boolean;
}

export interface SATechStatusEvent { fromStatus: string | null; toStatus: string; action: string; scope: string; reason: string | null; expiresAt: string | null; createdAt: string }
export interface SATechSupportTicket { ticketId: string; subject: string; status: string; tenantId: string; createdAt: string | null }
export interface SATechSupport {
  accountStatus: string;
  security: { profileHidden: boolean; messagingPaused: boolean; dealsFrozen: boolean; suspendedAt: string | null; pausedAt: string | null };
  activeSessions: number;
  openTicketCount: number;
  openTickets: SATechSupportTicket[];
  elevatedForDangerousActions: boolean;
}

export interface SATechDetail {
  profile: {
    profileId: string; techCode: string; displayName: string; status: string; mergedInto: string | null;
    publicSlug: string; overallRating: number | null; ratingCount: number; portfolioPhotoCount: number;
    isPublic: boolean; suspendedAt: string | null; suspendReason: string | null;
    anonymizedAt: string | null; createdAt: string | null;
  };
  salons: SATechSalon[];
  openDeleteRequest: SATechDeleteRequest | null;
}

export interface SATechDuplicateGroup {
  profileId: string; techCode: string; displayName: string; status: string; createdAt: string | null;
}

export const superAdminTechniciansApi = {
  search: (q: string) => api.get(`/super-admin/technicians`, { q }) as Promise<{ technicians: SATechRow[] }>,
  detail: (profileId: string) => api.get(`/super-admin/technicians/${profileId}`) as Promise<SATechDetail>,
  duplicates: () => api.get(`/super-admin/technicians/duplicates`) as Promise<{ groups: SATechDuplicateGroup[][] }>,

  suspend: (profileId: string, reason: string) =>
    api.post(`/super-admin/technicians/${profileId}/suspend`, { reason }) as Promise<{ ok: boolean; status: string }>,
  restore: (profileId: string) =>
    api.post(`/super-admin/technicians/${profileId}/restore`, {}) as Promise<{ ok: boolean; status: string }>,

  // Erasure is a workflow, not a button: request → decision → act. Three calls, on purpose.
  requestDeletion: (profileId: string, body: { reason: string; requesterKind: string; legalHold?: boolean }) =>
    api.post(`/super-admin/technicians/${profileId}/delete-request`, body) as Promise<{ ok: boolean; requestId: string; status: string }>,
  decideDeletion: (requestId: string, decision: 'approve' | 'reject', note?: string) =>
    api.post(`/super-admin/technicians/delete-requests/${requestId}/decision`, { decision, note }) as Promise<{ ok: boolean; status: string }>,
  anonymize: (profileId: string) =>
    api.post(`/super-admin/technicians/${profileId}/anonymize`, {}) as Promise<{ ok: boolean; status: string; techCode: string }>,

  merge: (canonicalId: string, duplicateId: string, reason: string) =>
    api.post(`/super-admin/technicians/${canonicalId}/merge`, { duplicateId, reason }) as Promise<{ ok: boolean; canonicalId: string; duplicateId: string }>,
  myElevation: () =>
    api.get(`/super-admin/technicians/my-elevation`) as Promise<{ elevated: boolean }>,

  // Phase 1–6 account controls
  pause: (profileId: string, reason: string) =>
    api.post(`/super-admin/technicians/${profileId}/pause`, { reason }) as Promise<{ ok: boolean; status: string }>,
  reactivate: (profileId: string) =>
    api.post(`/super-admin/technicians/${profileId}/reactivate`, {}) as Promise<{ ok: boolean; status: string }>,
  lock: (profileId: string, reason: string) =>
    api.post(`/super-admin/technicians/${profileId}/lock`, { reason }) as Promise<{ ok: boolean; status: string }>,
  unlock: (profileId: string) =>
    api.post(`/super-admin/technicians/${profileId}/unlock`, {}) as Promise<{ ok: boolean; status: string }>,
  scopedPause: (profileId: string, scope: 'profile' | 'messaging' | 'deals', paused: boolean, reason?: string) =>
    api.post(`/super-admin/technicians/${profileId}/scoped-pause`, { scope, paused, reason }) as Promise<{ ok: boolean; scope: string; paused: boolean }>,
  statusHistory: (profileId: string) =>
    api.get(`/super-admin/technicians/${profileId}/status-history`) as Promise<{ events: SATechStatusEvent[] }>,
  support: (profileId: string) =>
    api.get(`/super-admin/technicians/${profileId}/support`) as Promise<SATechSupport>,
  revokeSessions: (profileId: string) =>
    api.post(`/super-admin/technicians/${profileId}/revoke-sessions`, {}) as Promise<{ ok: boolean; sessionsRevoked: number }>,
  pauseMembership: (membershipId: string, reason: string) =>
    api.patch(`/super-admin/technician-memberships/${membershipId}`, { action: 'pause', reason }) as Promise<{ ok: boolean; status: string }>,
  reactivateMembership: (membershipId: string) =>
    api.patch(`/super-admin/technician-memberships/${membershipId}`, { action: 'reactivate' }) as Promise<{ ok: boolean; status: string }>,
  approveDestination: (membershipId: string) =>
    api.patch(`/super-admin/technician-memberships/${membershipId}`, { action: 'approve_destination' }) as Promise<{ ok: boolean; status: string }>,
  rejectDestination: (membershipId: string, reason?: string) =>
    api.patch(`/super-admin/technician-memberships/${membershipId}`, { action: 'reject_destination', reason }) as Promise<{ ok: boolean; status: string }>,
};
