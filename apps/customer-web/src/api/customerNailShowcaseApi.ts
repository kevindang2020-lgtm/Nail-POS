// customerNailShowcaseApi.ts — Customer app client for the @Controller('customer') NailShowcase routes (feed, posts,
// reactions, comments, reports, verified-from-ticket, and the real multipart photo upload). Same-origin, session cookie;
// the server derives the customer from the session. Reads are server-truth — screens render empty states, never mocks.
import { api } from './client';

export type NSVisibility = 'public_platform' | 'salon_only' | 'private';
export type NSPostType = 'verified_service' | 'manual_upload';
export type NSPostStatus = 'draft' | 'pending_review' | 'published' | 'hidden' | 'removed' | 'reported';
export type NSCommentStatus = 'published' | 'hidden' | 'removed' | 'reported';
export type NSReactionType = 'like' | 'dislike';
export type NSFeedSort = 'newest' | 'most_liked' | 'most_commented' | 'trending';
export type NSFeedScope = 'for_you' | 'salon' | 'public' | 'mine';

export interface NSPhoto { id: string; imageUrl: string; thumbnailUrl: string | null; sortOrder: number; caption: string | null }
export interface NSPost {
  id: string; caption: string; tags: string[]; visibility: NSVisibility; postType: NSPostType; status: NSPostStatus;
  isVerifiedService: boolean; allowComments: boolean; displayName: string;
  salonTenantId: string | null; branchId: string | null; technicianId: string | null; serviceId: string | null;
  salonName: string | null; technicianName: string | null; serviceName: string | null;
  likeCount: number; dislikeCount: number; commentCount: number; reportCount: number;
  myReaction: NSReactionType | null; isMine: boolean; photos: NSPhoto[]; createdAt: string;
}
export interface NSFeedResult { posts: NSPost[]; nextCursor: string | null }
export interface NSComment { id: string; postId: string; displayName: string; commentText: string; status: NSCommentStatus; isMine: boolean; createdAt: string }
export interface NSEligibility { eligible: boolean; reason?: string; ticketId?: string; appointmentId?: string | null; technicianId?: string | null; serviceId?: string | null; alreadyPosted?: boolean }

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
  post: (postId: string) => api.get<NSPost>(`/customer/nail-showcase/posts/${postId}`),
  createPost: (body: NSCreatePostBody) => api.post<NSPost>('/customer/nail-showcase/posts', clean(body as Record<string, unknown>)),
  updatePost: (postId: string, body: Partial<NSCreatePostBody>) => api.patch<NSPost>(`/customer/nail-showcase/posts/${postId}`, clean(body as Record<string, unknown>)),
  deletePost: (postId: string) => api.del<{ ok: boolean }>(`/customer/nail-showcase/posts/${postId}`),

  react: (postId: string, reactionType: NSReactionType) => api.post<NSPost>(`/customer/nail-showcase/posts/${postId}/reaction`, { reactionType }),
  removeReaction: (postId: string) => api.del<NSPost>(`/customer/nail-showcase/posts/${postId}/reaction`),

  comments: (postId: string) => api.get<{ comments: NSComment[] } | NSComment[]>(`/customer/nail-showcase/posts/${postId}/comments`),
  addComment: (postId: string, commentText: string) => api.post<NSComment>(`/customer/nail-showcase/posts/${postId}/comments`, { commentText }),
  deleteComment: (commentId: string) => api.del<{ ok: boolean }>(`/customer/nail-showcase/comments/${commentId}`),

  reportPost: (postId: string, reason: string, details?: string) => api.post<{ ok: boolean }>(`/customer/nail-showcase/posts/${postId}/report`, clean({ reason, details })),
  reportComment: (commentId: string, reason: string, details?: string) => api.post<{ ok: boolean }>(`/customer/nail-showcase/comments/${commentId}/report`, clean({ reason, details })),

  // Verified-from-ticket: eligibility + create a verified post tied to a completed (paid) ticket.
  eligibility: (ticketId: string) => api.get<NSEligibility>(`/customer/tickets/${ticketId}/nail-showcase-eligibility`),
  createVerifiedPost: (ticketId: string, body: NSCreatePostBody) => api.post<NSPost>(`/customer/tickets/${ticketId}/nail-showcase-post`, clean(body as Record<string, unknown>)),

  // Real multipart photo upload (FormData; the shared JSON client can't carry files). Field name 'files'.
  // uploadPhotos: async (postId: string, files: File[], caption?: string): Promise<{ photos?: NSPhoto[] } | NSPhoto[]> => {
  //   const { apiBase } = await import('./client');
  //   const { authHeader } = await import('../auth/native-auth');
  //   const form = new FormData();
  //   for (const f of files) form.append('files', f, f.name);
  //   if (caption) form.append('caption', caption);
  //   const bearer = await authHeader();
  //   const res = await fetch(`${apiBase()}/customer/nail-showcase/posts/${postId}/photos`, {
  //     method: 'POST',
  //     credentials: 'include',
  //     headers: { ...bearer },
  //     body: form,
  //   });
  //   let json: unknown = null; try { json = await res.json(); } catch { /* empty */ }
  //   if (!res.ok) { const m = (json as { message?: string })?.message || 'Upload failed.'; throw Object.assign(new Error(m), { status: res.status }); }
  //   return json as { photos?: NSPhoto[] } | NSPhoto[];
  // },
  uploadPhotos: async (
  postId: string,
  files: File[],
  caption?: string
): Promise<{ photos?: NSPhoto[]; videos?: NSPhoto[] } | NSPhoto[]> => {
  const { apiBase } = await import('./client');
  const { authHeader } = await import('../auth/native-auth');

  const form = new FormData();

  for (const f of files) {
    form.append('files', f, f.name);
  }

  if (caption) {
    form.append('caption', caption);
  }

  const bearer = await authHeader();

  const res = await fetch(
    `${apiBase()}/customer/nail-showcase/posts/${postId}/photos`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { ...bearer },
      body: form,
    }
  );

  let json: unknown = null;

  try {
    json = await res.json();
  } catch {
    // empty response
  }

  if (!res.ok) {
    const m =
      (json as { message?: string })?.message ||
      'Upload failed.';

    throw Object.assign(new Error(m), {
      status: res.status,
    });
  }

  return json as
    | { photos?: NSPhoto[]; videos?: NSPhoto[] }
    | NSPhoto[];
},
};
