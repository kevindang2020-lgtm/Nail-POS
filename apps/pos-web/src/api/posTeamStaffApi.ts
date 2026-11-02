// posTeamStaffApi.ts — Team Management round 2 (30 Oct 2026): all-role onboarding, optional birthdays, training &
// certification. Routes: /pos/team-onboarding/*, /pos/team-birthdays/*, /pos/team-training/* (tenant / branch from the session).
import { api } from './client';

const e = encodeURIComponent;
const clean = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
export type OnboardRole = { key: string; label: string; base: string; provider: boolean; custom: boolean; allowed: boolean; reason: string | null; flow: 'staff' | 'technician' };
export type OnboardOptions = { canOnboard: boolean; sessionBranchId: string | null; anyBranch: boolean; branches: { id: string; name: string }[]; roles: OnboardRole[] };
export type OnboardRequest = { role: string; fullName: string; email?: string; phone?: string; branchIds?: string[]; idempotencyKey: string; channel?: 'email' | 'sms' };

export const posTeamOnboardingApi = {
  options: () => api.get<OnboardOptions>('/pos/team-onboarding/options'),
  createStaff: (b: OnboardRequest) => api.post<any>('/pos/team-onboarding/staff', b as unknown as Record<string, unknown>),
};
export const posTeamBirthdaysApi = {
  upcoming: (q: { days?: number } = {}) => api.get<any>('/pos/team-birthdays/upcoming', clean(q)),
  get: (memberId: string) => api.get<any>(`/pos/team-birthdays/members/${e(memberId)}`),
  set: (memberId: string, b: { month: number | null; day: number | null; visibleToTeam?: boolean }) => api.put<any>(`/pos/team-birthdays/members/${e(memberId)}`, b as unknown as Record<string, unknown>),
};
export const posTeamTrainingApi = {
  summary: () => api.get<any>('/pos/team-training/summary'),
  courses: (q: { status?: string; page?: number; pageSize?: number } = {}) => api.get<any>('/pos/team-training/courses', clean(q)),
  createCourse: (b: { name: string; category?: string; description?: string; validityMonths?: number | null; certificationName?: string }) => api.post<any>('/pos/team-training/courses', b as unknown as Record<string, unknown>),
  archiveCourse: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`/pos/team-training/courses/${e(id)}/archive`, b),
  member: (memberId: string) => api.get<any>(`/pos/team-training/members/${e(memberId)}`),
  assign: (b: { memberId: string; courseId: string; dueDate?: string | null }) => api.post<any>('/pos/team-training/assignments', b as unknown as Record<string, unknown>),
  start: (id: string, b: { expectedVersion: number }) => api.post<any>(`/pos/team-training/assignments/${e(id)}/start`, b),
  complete: (id: string, b: { expectedVersion: number; completedOn?: string; note?: string }) => api.post<any>(`/pos/team-training/assignments/${e(id)}/complete`, b),
  cancel: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`/pos/team-training/assignments/${e(id)}/cancel`, b),
  addCertification: (b: { memberId: string; name: string; issuer?: string; credentialRef?: string; issuedOn?: string | null; expiresOn?: string | null; assignmentId?: string | null }) =>
    api.post<any>('/pos/team-training/certifications', b as unknown as Record<string, unknown>),
  verifyCertification: (id: string, b: { expectedVersion: number; decision: 'VERIFIED' | 'REJECTED' | 'REVOKED'; note: string }) => api.post<any>(`/pos/team-training/certifications/${e(id)}/verify`, b),
};
