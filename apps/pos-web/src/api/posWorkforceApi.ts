// posWorkforceApi.ts — the technician workforce surfaces a manager uses from the POS (merge Oct 12 2026; other chat's
// Technician Profile phase 3, adapted to OUR routes + vocabulary):
//   • operational state: GET /pos/workforce-status[/:technicianId], POST /:technicianId/unavailable { on }
//   • time off:          GET /pos/technicians/time-off/pending, GET|POST /pos/technicians/:id/time-off,
//                        POST /pos/technicians/:id/time-off/:requestId/decision { decision: approved|rejected, note? }
//   • certifications:    GET /pos/technician-certifications/:id, POST /:id/:certId/verify { status, reason? }
// Tenant / branch / actor are server-derived from the session; permissions are enforced server-side. Types are the wire
// contract (@aipowersalon/api-contracts) — never re-declared here.
import { api } from './client';
import type {
  TechnicianWorkforceStateView, TimeOffEntry, TimeOffKind, TimeOffCreateBody, TechCertificationView,
} from '@aipowersalon/api-contracts/tenant';

export type { TechnicianWorkforceStateView, TimeOffEntry, TimeOffKind, TechCertificationView };
const enc = encodeURIComponent;

export const posWorkforceApi = {
  branchStates: () => api.get<TechnicianWorkforceStateView[]>('/pos/workforce-status'),
  state: (technicianId: string) => api.get<TechnicianWorkforceStateView>(`/pos/workforce-status/${enc(technicianId)}`),
  setUnavailable: (technicianId: string, on: boolean) => api.post<TechnicianWorkforceStateView>(`/pos/workforce-status/${enc(technicianId)}/unavailable`, { on }),

  pendingTimeOff: () => api.get<TimeOffEntry[]>('/pos/technicians/time-off/pending'),
  timeOff: (technicianId: string) => api.get<TimeOffEntry[]>(`/pos/technicians/${enc(technicianId)}/time-off`),
  createTimeOff: (technicianId: string, body: TimeOffCreateBody) => api.post<TimeOffEntry>(`/pos/technicians/${enc(technicianId)}/time-off`, body as unknown as Record<string, unknown>),
  decideTimeOff: (technicianId: string, requestId: string, decision: 'approved' | 'rejected', note?: string) =>
    api.post<TimeOffEntry>(`/pos/technicians/${enc(technicianId)}/time-off/${enc(requestId)}/decision`, { decision, ...(note ? { note } : {}) }),

  certifications: (technicianId: string) => api.get<TechCertificationView[]>(`/pos/technician-certifications/${enc(technicianId)}`),
  verifyCertification: (technicianId: string, certificationId: string, status: 'VERIFIED' | 'REVOKED', reason?: string) =>
    api.post<TechCertificationView>(`/pos/technician-certifications/${enc(technicianId)}/${enc(certificationId)}/verify`, { status, ...(reason ? { reason } : {}) }),
};
