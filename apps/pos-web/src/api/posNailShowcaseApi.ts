// posNailShowcaseApi.ts — manager moderation client for the real @Controller('pos/nail-showcase') routes (all gated by
// customers.edit, scoped to the manager's own tenant server-side). Shared cookie `api` client; the backend enforces that
// a manager can only touch posts/comments/reports in their own salon.
import { api } from './client';

export type PosNSStatus = 'draft' | 'pending_review' | 'published' | 'hidden' | 'removed' | 'reported';
export interface PosNSPhoto { 
  id: string; 
  imageUrl: string; 
  thumbnailUrl?: string; 
  videoUrl?: string; 
  mimeType?: string; 
  type?: string; 
}
export interface PosNSPost {
  id: string; caption: string; displayName: string; status: PosNSStatus; postType: string; isVerifiedService: boolean; visibility: string;
  salonName: string | null; branchName?: string; technicianName: string | null; serviceName: string | null;
  likeCount: number; dislikeCount: number; commentCount: number; reportCount: number; saveCount?: number; shareCount?: number;
  tags?: string[]; products?: string[];
  photos: PosNSPhoto[]; createdAt: string;
}
export interface PosNSReport { id: string; postId: string | null; commentId: string | null; reason: string; details: string | null; status: string; createdAt: string }

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const posNailShowcaseApi = {
  posts: (params: { status?: string; reportedOnly?: boolean } = {}) =>
    api.get<PosNSPost[]>('/pos/nail-showcase/posts', clean({ status: params.status, reportedOnly: params.reportedOnly ? 'true' : undefined })),
  hidePost: (id: string) => api.patch<{ status: string }>(`/pos/nail-showcase/posts/${id}/hide`, {}),
  approvePost: (id: string) => api.patch<{ status: string }>(`/pos/nail-showcase/posts/${id}/approve`, {}),
  hideComment: (id: string) => api.patch<{ status: string }>(`/pos/nail-showcase/comments/${id}/hide`, {}),
  reports: () => api.get<PosNSReport[]>('/pos/nail-showcase/reports'),
  resolveReport: (id: string, status: string) => api.patch<{ resolved: boolean }>(`/pos/nail-showcase/reports/${id}`, { status }),
};
