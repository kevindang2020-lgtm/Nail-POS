// superAdminNailShowcaseApi.ts — platform-wide NailShowcase moderation client for the real
// @Controller('super-admin/nail-showcase') routes (SuperAdminGuard). The reports queue spans every tenant (and manual
// posts with no tenant); remove is a hard platform takedown. Shared root-relative `api` client (credentials: include).
import { api } from './client';

export interface SaNSReport { id: string; postId: string | null; commentId: string | null; reason: string; details: string | null; status: string; createdAt: string }
export interface SaNSReportedProfile {
  customerId: string; displayName: string; avatarUrl: string | null;
  reportCount: number; lastReportedAt: string | null;
  isSuspended: boolean; isPublic: boolean; rank: number | null; score: number;
}
type SuspendResult = { customerId: string; suspended: boolean; rank: number | null; displayName: string };

export const superAdminNailShowcaseApi = {
  reports: () => api.get<SaNSReport[]>('/super-admin/nail-showcase/reports'),
  removePost: (postId: string) => api.patch<{ status: string }>(`/super-admin/nail-showcase/posts/${encodeURIComponent(postId)}/remove`, {}),
  removeComment: (commentId: string) => api.patch<{ status: string }>(`/super-admin/nail-showcase/comments/${encodeURIComponent(commentId)}/remove`, {}),
  resolveReport: (reportId: string, status: string) => api.patch<{ resolved: boolean }>(`/super-admin/nail-showcase/reports/${encodeURIComponent(reportId)}`, { status }),
  reportedProfiles: () => api.get<SaNSReportedProfile[]>('/super-admin/nail-showcase/reported-profiles'),
  suspendProfile: (customerId: string) => api.patch<SuspendResult>(`/super-admin/nail-showcase/profiles/${encodeURIComponent(customerId)}/suspend`, {}),
  unsuspendProfile: (customerId: string) => api.patch<SuspendResult>(`/super-admin/nail-showcase/profiles/${encodeURIComponent(customerId)}/unsuspend`, {}),
};
