// superAdminPlatformAnnouncementsApi.ts — Super Admin › Communications › Platform Announcements (POS top bar, Oct 22 2026).
// The server validates everything (plain text, audience, schedule, versions, confirmation); publish / pause / resume /
// archive answer STEP_UP_REQUIRED first and the shared client re-confirms and retries once.
import type {
  PlatformAnnouncementList, PlatformAnnouncementDetail, PlatformAnnouncementWriteRequest, PlatformAnnouncementPublishRequest,
  PlatformAnnouncementTenantPage, PlatformAnnouncementBranchOption,
} from '@aipowersalon/api-contracts/platform';
import { api } from './client';

const base = '/super-admin/communications/platform-announcements';
const id = (x: string) => encodeURIComponent(x);
export const platformAnnouncementsApi = {
  list: (q: { status?: string; q?: string; page?: number; pageSize?: number }) => api.get<PlatformAnnouncementList>(base, q as Record<string, unknown>),
  get: (x: string) => api.get<PlatformAnnouncementDetail>(`${base}/${id(x)}`),
  create: (b: PlatformAnnouncementWriteRequest) => api.post<PlatformAnnouncementDetail>(base, { ...b }),
  update: (x: string, b: PlatformAnnouncementWriteRequest) => api.patch<PlatformAnnouncementDetail>(`${base}/${id(x)}`, { ...b }),
  publish: (x: string, b: PlatformAnnouncementPublishRequest) => api.post<PlatformAnnouncementDetail>(`${base}/${id(x)}/publish`, { ...b }),
  pause: (x: string, expectedVersion: number) => api.post<PlatformAnnouncementDetail>(`${base}/${id(x)}/pause`, { expectedVersion }),
  resume: (x: string, expectedVersion: number) => api.post<PlatformAnnouncementDetail>(`${base}/${id(x)}/resume`, { expectedVersion }),
  archive: (x: string, expectedVersion: number) => api.post<PlatformAnnouncementDetail>(`${base}/${id(x)}/archive`, { expectedVersion }),
  duplicate: (x: string) => api.post<PlatformAnnouncementDetail>(`${base}/${id(x)}/duplicate`),
  tenants: (q: { q?: string; page?: number; pageSize?: number }) => api.get<PlatformAnnouncementTenantPage>(`${base}/audience/tenants`, q as Record<string, unknown>),
  branches: (tenantId: string) => api.get<PlatformAnnouncementBranchOption[]>(`${base}/audience/tenants/${id(tenantId)}/branches`),
};
