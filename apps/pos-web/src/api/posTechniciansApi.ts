// posTechniciansApi.ts — STEP 2 module client (pattern: posCheckoutApi). No mock data; use isEmptyState() for empties.
import { api } from "./client";
import type { QualifiedTechnician, EmploymentHistoryResponse, TechnicianImportResult, ProfileChangeRequestList, ProfileChangeDecisionResult, TechnicianProfilePolicy } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// Eligibility-derived roster for a service, with live working/shift status (GET /pos/technicians/qualified).
export const posTechniciansApi = {
  // Portable tech-profile (P3 manager surfaces)
  techProfile: (id: string) => api.get(`/pos/technicians/${id}/profile`),
  updateTechProfile: (id: string, body: Record<string, unknown>) => api.patch(`/pos/technicians/${id}/profile`, body),
  setTechFeatured: (id: string, featured: boolean) => api.patch(`/pos/technicians/${id}/feature`, { featured }),
  moderatePhoto: (id: string, photoId: string, action: 'approve' | 'hide') => api.patch(`/pos/technicians/${id}/portfolio-photos/${photoId}/${action}`, {}),
  profileRatings: (id: string) => api.get(`/pos/technicians/${id}/ratings`),
  setRatingHidden: (id: string, ratingId: string, hidden: boolean, reason?: string) => api.patch(`/pos/technicians/${id}/ratings/${ratingId}/hide`, { hidden, reason }),
  deactivateMembership: (id: string) => api.post(`/pos/technicians/${id}/membership/deactivate`, {}),
  membershipRequests: () => api.get(`/pos/technician-membership/requests`),
  decideMembershipRequest: (requestId: string, decision: 'approve' | 'reject') => api.post(`/pos/technician-membership/requests/${requestId}/${decision}`, {}),
  // App Access · Permissions · Skills.
  //
  // These three endpoints have existed the whole time and NOTHING HAS EVER CALLED THEM. The backend accepted
  // writes and stored nothing (migration 377 fixed that) — and there was no screen to write from either, so the
  // fix landed somewhere nobody could reach. Built, tested, never wired: the pattern this codebase's own checkers
  // were written to catch, and `check:crosswire` cannot, because it looks for calls with no route and this was a
  // route with no call.
  appAccess: (id: string) => api.get(`/pos/technicians/${id}/app-access`),
  setAppAccess: (id: string, body: Record<string, unknown>) => api.patch(`/pos/technicians/${id}/app-access`, body),
  permissions: (id: string) => api.get(`/pos/technicians/${id}/permissions`),
  setPermissions: (id: string, matrix: { permission: string; allowed: boolean }[]) => api.patch(`/pos/technicians/${id}/permissions`, { matrix }),
  commission: (id: string) => api.get(`/pos/technicians/${id}/commission`),
  setCommission: (id: string, body: Record<string, unknown>) => api.patch(`/pos/technicians/${id}/commission`, body),
  commissionHistory: (id: string) => api.get(`/pos/technicians/${id}/commission-history`),
  getSalonBaselineCommission: () => api.get<{ defaultCommissionPercent: number }>(`/pos/technicians/salon-commission`),
  updateSalonBaselineCommission: (body: { defaultCommissionPercent: number; adminAuthCode?: string }) => api.patch<{ ok: boolean; defaultCommissionPercent: number }>(`/pos/technicians/salon-commission`, body),
  skills: (id: string) => api.get(`/pos/technicians/${id}/skills`),
  setSkills: (id: string, skillGroups: string[]) => api.patch(`/pos/technicians/${id}/skills`, { skillGroups }),
  list: (q?: { page?: number; pageSize?: number; search?: string; status?: string }) => api.get(`/pos/technicians`, q),
  /** 200-technician mandate §34/§62 (Oct 23 2026): every technician's id + name (a names directory for pickers and labels).
   *  The list endpoint is paged (20 by default, 100 at most) — list() alone silently showed the first 20 of 200. This follows
   *  the server's own page count, so the directory always holds the whole team. */
  directory: async (): Promise<{ id: string; technicianId: string; fullName: string }[]> => {
    const first: any = await api.get(`/pos/technicians`, { page: 1, pageSize: 100 });
    const pages = Math.max(1, Number(first?.pagination?.totalPages) || 1);
    const rest: any[] = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.get(`/pos/technicians`, { page: i + 2, pageSize: 100 }))) : [];
    return [first, ...rest].flatMap((r: any) => (Array.isArray(r?.items) ? r.items : [])).map((t: any) => ({ id: String(t.technicianId ?? t.id), technicianId: String(t.technicianId ?? t.id), fullName: String(t.fullName ?? t.displayName ?? t.name ?? '') }));
  },
  // The full manager detail (POSTechnicianDetail: row + schedule, shift, skills, services, pay-projected commission/payroll,
  // app access, permissions, audit summary) — the Technician Profile page's overview source.
  detail: (id: string) => api.get<any>(`/pos/technicians/${encodeURIComponent(id)}`),
  // Technician Profile mandate §128: this salon's employment history (hired / role / branch / suspended / terminated / transferred / leave)
  employmentHistory: (id: string) => api.get<EmploymentHistoryResponse>(`/pos/technicians/${encodeURIComponent(id)}/employment-history`),
  // §112 technician import — CSV text; dryRun previews every row (create / invite existing / already here / invalid), commit hires
  importTechnicians: (csv: string, dryRun: boolean) => api.post<TechnicianImportResult>(`/pos/technicians/import`, { csv, dryRun }),
  // §95 publicProfileChangesRequireApproval — the salon switch and the held public-profile edits to decide (optimistic version)
  profilePolicy: () => api.get<TechnicianProfilePolicy>(`/pos/technician-profile-policy`),
  setProfilePolicy: (on: boolean) => api.patch<TechnicianProfilePolicy>(`/pos/technician-profile-policy`, { publicProfileChangesRequireApproval: on }),
  profileChanges: () => api.get<ProfileChangeRequestList>(`/pos/technician-profile-changes`),
  decideProfileChange: (requestId: string, decision: 'approve' | 'reject', version: number, note?: string) =>
    api.post<ProfileChangeDecisionResult>(`/pos/technician-profile-changes/${encodeURIComponent(requestId)}/${decision}`, { version, ...(note ? { note } : {}) }),
  // Technicians qualified for a service, with live availability (skill search / coverage lookup). Eligibility is server-derived.
  qualified: (serviceId: string) => api.get<QualifiedTechnician[]>(`/pos/technicians/qualified`, { serviceId }),
  // "Does this technician already have an AIPowerSalon account?" — asked BEFORE create, so the manager invites a
  // person instead of minting a duplicate. Returns her PUBLIC identity and a salon COUNT — never the salon names.
  lookup: (body: { phone?: string; email?: string }) => api.post(`/pos/technicians/lookup`, body),
  // create — backend: @Post '/pos/technicians' (CreateTechnicianRequest: firstName, lastName, status, serviceIds?)
  create: (body: Record<string, unknown>) => api.post(`/pos/technicians`, body),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/pos/technicians/${id}`, body),
  setServices: (id: string, body: Record<string, unknown>) => api.patch(`/pos/technicians/${id}/services`, body),
  // status changes — backend: @Post 'technicianId/{activate,suspend,archive,reactivate}'
  activate: (id: string) => api.post(`/pos/technicians/${id}/activate`),
  suspend: (id: string, body: Record<string, unknown>) => api.post(`/pos/technicians/${id}/suspend`, body),
  archive: (id: string) => api.post(`/pos/technicians/${id}/archive`),
  reactivate: (id: string) => api.post(`/pos/technicians/${id}/reactivate`),
};
export type { QualifiedTechnician };
// Wire types are the API's own contract (Constitution 13 §15) — never re-declared here.
export type { EmploymentHistoryRow, TechnicianImportRow, TechnicianImportResult, ProfileChangeRequest } from '@aipowersalon/api-contracts/tenant';
