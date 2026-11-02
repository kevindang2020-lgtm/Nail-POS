// superAdminTechProfileApi.ts — typed client for Super Admin oversight of the global technician profile:
// verification decisions and the DM abuse-report queue. Reads the real /super-admin/tech-profiles/* endpoints.
import { api } from './client';

const enc = encodeURIComponent;

export interface SaTechVerification { profileId: string; publicSlug: string; displayName: string; avatarUrl: string | null; rating: number; reviewCount: number; portfolioCount: number; completedServices: number; requestedAt: string | null }
export interface SaTechDmReport { reportId: string; threadId: string; reportedBy: string; reason: string | null; createdAt: string; threadStatus: string | null; technicianName: string | null; technicianSlug: string | null }

export const superAdminTechProfileApi = {
  verifications: () => api.get<{ verifications: SaTechVerification[] }>('/super-admin/tech-profiles/verifications'),
  setVerification: (profileId: string, status: 'verified' | 'unverified', note?: string) =>
    api.patch<{ ok: true; profileId: string; verificationStatus: string }>(`/super-admin/tech-profiles/verifications/${enc(profileId)}`, { status, note }),
  dmReports: () => api.get<{ reports: SaTechDmReport[] }>('/super-admin/tech-profiles/dm-reports'),
  resolveDmReport: (reportId: string, action: 'dismiss' | 'block_thread') =>
    api.patch<{ ok: true; reportId: string; action: string }>(`/super-admin/tech-profiles/dm-reports/${enc(reportId)}`, { action }),
};
