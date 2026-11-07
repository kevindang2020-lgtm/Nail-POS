// customerNailShowcaseApi.ts — Customer app client for the @Controller('customer') NailShowcase routes (feed, posts,
// reactions, comments, reports, verified-from-ticket, and the real multipart photo upload). Same-origin, session cookie;
// the server derives the customer from the session. Reads are server-truth — screens render empty states, never mocks.
import type { NSCommentStatus, NSEligibility, NSFeedResult, NSFeedScope, NSFeedSort, NSPhotoView, NSPostStatus, NSPostType, NSPostView, NSReactionType, NSVisibility } from '@aipowersalon/api-contracts/customer';
export type { NSCommentStatus, NSEligibility, NSFeedResult, NSFeedScope, NSFeedSort, NSPhotoView, NSPostStatus, NSPostType, NSPostView, NSReactionType, NSVisibility };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';

export interface NSComment { id: string; postId: string; displayName: string; commentText: string; status: NSCommentStatus; isMine: boolean; createdAt: string }

export interface NSFeedParams {
  scope?: NSFeedScope; salonId?: string; branchId?: string; serviceId?: string; technicianId?: string;
  tag?: string; sort?: NSFeedSort; cursor?: string; limit?: number;
}
export interface NSCreatePostBody {
  caption?: string; tags?: string[]; visibility?: NSVisibility; allowComments?: boolean; isAnonymous?: boolean;
  displayName?: string | null; technicianId?: string | null; serviceId?: string | null; salonTenantId?: string | null; branchId?: string | null;
  photos?: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null }[];
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const customerNailShowcaseApi = {
  feed: (p: NSFeedParams = {}) => api.get<NSFeedResult>('/customer/nail-showcase/feed', clean(p as Record<string, unknown>)),
  post: (postId: string) => api.get<NSPostView>(`/customer/nail-showcase/posts/${postId}`),
  createPost: (body: NSCreatePostBody) => api.post<NSPostView>('/customer/nail-showcase/posts', clean(body as Record<string, unknown>)),
  deletePost: (postId: string) => api.del<{ ok: boolean }>(`/customer/nail-showcase/posts/${postId}`),

  react: (postId: string, reactionType: NSReactionType) => api.post<NSPostView>(`/customer/nail-showcase/posts/${postId}/reaction`, { reactionType }),

  comments: (postId: string) => api.get<{ comments: NSComment[] } | NSComment[]>(`/customer/nail-showcase/posts/${postId}/comments`),
  addComment: (postId: string, commentText: string) => api.post<NSComment>(`/customer/nail-showcase/posts/${postId}/comments`, { commentText }),
  deleteComment: (commentId: string) => api.del<{ ok: boolean }>(`/customer/nail-showcase/comments/${commentId}`),

  reportPost: (postId: string, reason: string, details?: string) => api.post<{ ok: boolean }>(`/customer/nail-showcase/posts/${postId}/report`, clean({ reason, details })),
  reportComment: (commentId: string, reason: string, details?: string) => api.post<{ ok: boolean }>(`/customer/nail-showcase/comments/${commentId}/report`, clean({ reason, details })),

  // Verified-from-ticket: eligibility + create a verified post tied to a completed (paid) ticket.
  eligibility: (ticketId: string) => api.get<NSEligibility>(`/customer/tickets/${ticketId}/nail-showcase-eligibility`),
  createVerifiedPost: (ticketId: string, body: NSCreatePostBody) => api.post<NSPostView>(`/customer/tickets/${ticketId}/nail-showcase-post`, clean(body as Record<string, unknown>)),

  // Real multipart photo upload (FormData; the shared JSON client can't carry files). Field name 'files'.
  uploadPhotos: async (postId: string, files: File[], caption?: string): Promise<{ photos?: NSPhotoView[]; videos?: NSPhotoView[] } | NSPhotoView[]> => {
    // Developer (Sep 2026): uploads go to the configured API base with the native bearer token, so the Capacitor
    // build (no cookie) can post photos too; the browser keeps its session cookie via credentials: 'include'.
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    if (caption) form.append('caption', caption);
    return api.upload<{ photos?: NSPhotoView[]; videos?: NSPhotoView[] } | NSPhotoView[]>(`/customer/nail-showcase/posts/${postId}/photos`, form);   // BUILD_PLAN Phase 13: the one transport
  },
};
