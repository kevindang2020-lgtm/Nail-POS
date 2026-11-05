// posTeamScheduleSkillsApi.ts — Technician Profile & Team Management guide (Nov 5 2026, G3, migration 816):
// repeating weekly days off (/pos/weekly-days-off) and the Skills Catalog (/pos/skills-catalog).
import { api } from './client';

const enc = encodeURIComponent;
export interface WeeklyOffBody { technicianId: string; weekdays: number[]; effectiveFrom: string; effectiveTo?: string | null; reason?: string | null; expectedVersion?: number | null; acknowledgeConflicts?: boolean | null }
export const posWeeklyDaysOffApi = {
  list: (technicianId: string, month?: string) => api.get<any>(`/pos/weekly-days-off?technicianId=${enc(technicianId)}${month ? `&month=${enc(month)}` : ''}`),
  preview: (b: WeeklyOffBody) => api.post<any>(`/pos/weekly-days-off/preview`, b as unknown as Record<string, unknown>),
  save: (b: WeeklyOffBody) => api.put<any>(`/pos/weekly-days-off`, b as unknown as Record<string, unknown>),
  end: (b: { technicianId: string; ruleId: string; endFrom: string; reason?: string | null; expectedVersion?: number | null }) => api.post<any>(`/pos/weekly-days-off/end`, b),
};
export const posSkillsCatalogApi = {
  list: (q: { q?: string; status?: string; category?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v != null && v !== '') p.set(k, String(v));
    return api.get<any>(`/pos/skills-catalog${p.toString() ? `?${p}` : ''}`);
  },
  save: (b: { id?: string | null; name: string; category?: string | null; description?: string | null; requiredCertification?: string | null; serviceIds?: string[]; expectedVersion?: number | null }) => api.post<any>(`/pos/skills-catalog`, b),
  archive: (id: string, archived: boolean, reason?: string | null) => api.post<any>(`/pos/skills-catalog/${enc(id)}/archive`, { archived, reason: reason ?? null }),
  technician: (technicianId: string) => api.get<any>(`/pos/skills-catalog/technician/${enc(technicianId)}`),
  assign: (b: { technicianId: string; skillIds: string[]; proficiency?: string | null; effectiveFrom?: string | null; expiresOn?: string | null }) => api.post<any>(`/pos/skills-catalog/assign`, b),
  revokePreview: (technicianId: string, assignmentId: string) => api.get<any>(`/pos/skills-catalog/technician/${enc(technicianId)}/removal-impact/${enc(assignmentId)}`),
  revoke: (b: { technicianId: string; assignmentId: string; reason: string; expectedVersion?: number | null; acknowledgeBookings?: boolean | null }) => api.post<any>(`/pos/skills-catalog/revoke`, b),
};
