// posSkillRequestsApi.ts — manager/owner approval of technician skill-change requests.
// Backend (verified): GET /tech/skills/change-requests/pending and POST /tech/skills/change-requests/:id/decision,
// both gated by the existing `technicians.edit` permission (MANAGER/OWNER). Same shared `api` client / session.
import { api } from './client';
export type SkillReqType = 'add' | 'remove';
export type SkillReqStatus = 'draft' | 'submitted' | 'pending' | 'under_review' | 'more_information_required' | 'approved' | 'rejected';
export interface PendingSkillRequest {
  id: string; serviceId: string; serviceName: string; requestType: SkillReqType;
  note: string | null; status: SkillReqStatus; createdAt: string; decidedAt: string | null;
  technicianId: string; technicianName: string;
  proficiencyLevel?: string | null; experienceYears?: number | null;
  supportingPhotos?: string[]; certificateEvidence?: string | null;
  reviewNotes?: string | null; submittedAt?: string | null;
}
export const posSkillRequestsApi = {
  pending: () => api.get<PendingSkillRequest[]>('/tech/skills/change-requests/pending'),
  decide: (id: string, decision: SkillReqStatus, reviewNotes?: string) => api.post<PendingSkillRequest>(`/tech/skills/change-requests/${encodeURIComponent(id)}/decision`, { decision, reviewNotes }),
};
