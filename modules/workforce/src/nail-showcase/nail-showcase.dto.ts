import type { NSVisibility, NSPostType, NSPostStatus, NSCommentStatus, NSReactionType, NSFeedSort, NSFeedScope, NSPhotoView, NSPostView, NSFeedResult, NSEligibility } from '@aipowersalon/api-contracts/customer';
export type { NSVisibility, NSPostType, NSPostStatus, NSCommentStatus, NSReactionType, NSFeedSort, NSFeedScope, NSPhotoView, NSPostView, NSFeedResult, NSEligibility };   // owned by packages/api-contracts (Constitution 13 §13)
/**
 * nail-showcase.dto.ts — NailShowcase contracts (posts / photos / reactions / comments / reports) and pure helpers
 * (trending score, display-name derivation, input validation). No DB or framework deps so it is unit-testable.
 */

export type NSReportStatus = 'open' | 'reviewed' | 'dismissed' | 'action_taken';

export const NS_VISIBILITIES: NSVisibility[] = ['public_platform', 'salon_only', 'private'];
export const NS_REACTIONS: NSReactionType[] = ['like', 'dislike'];
export const NS_MAX_PHOTOS = 10;
export const NS_MAX_PHOTO_BYTES = 50 * 1024 * 1024; // 50MB for photos/videos
export const NS_ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
export const NS_MAX_CAPTION = 2000;
export const NS_MAX_COMMENT = 1000;
export const NS_MAX_TAGS = 20;

export interface NSCreatePostInput {
  caption?: string;
  tags?: string[];
  visibility?: NSVisibility;
  allowComments?: boolean;
  isAnonymous?: boolean;
  displayName?: string | null;        // explicit custom display name; ignored when anonymous
  technicianId?: string | null;        // manual attribution (verified posts derive these from the ticket)
  serviceId?: string | null;
  salonTenantId?: string | null;
  branchId?: string | null;
  photos?: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null; metadata?: unknown }[];
}

export interface NSFeedQuery {
  scope?: NSFeedScope;
  salonId?: string | null;
  branchId?: string | null;
  serviceId?: string | null;
  technicianId?: string | null;
  tag?: string | null;
  sort?: NSFeedSort;
  cursor?: string | null;             // ISO timestamp cursor (created_at) for keyset pagination
  limit?: number;
}

export interface NSCommentView { id: string; postId: string; displayName: string; commentText: string; status: NSCommentStatus; isMine: boolean; createdAt: string }

// Trending = engagement weighted toward conversation, penalized by dislikes, decayed by age (newer posts boosted).
export function nsTrendingScore(p: { likeCount: number; dislikeCount: number; commentCount: number; createdAt: string | Date }, now: Date = new Date()): number {
  const base = p.likeCount * 2 + p.commentCount * 3 - p.dislikeCount;
  const ageHours = Math.max(0, (now.getTime() - new Date(p.createdAt).getTime()) / 3_600_000);
  const recency = 1 / Math.pow(ageHours + 2, 0.6); // gravity decay
  return base * recency;
}

// Privacy: never expose full customer identity. Anonymous => fixed label; else custom display name; else first name + last initial.
export function nsDisplayName(opts: { isAnonymous?: boolean; displayName?: string | null; firstName?: string | null; lastName?: string | null }): string {
  if (opts.isAnonymous) return 'Anonymous Customer';
  const custom = (opts.displayName ?? '').trim();
  if (custom) return custom.slice(0, 60);
  const first = (opts.firstName ?? '').trim();
  const last = (opts.lastName ?? '').trim();
  if (first && last) return `${first} ${last[0]}.`;
  if (first) return first;
  return 'Customer';
}

export function nsNormalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw ?? '').trim().slice(0, 40);
    const key = t.toLowerCase();
    if (t && !seen.has(key)) { seen.add(key); out.push(t); if (out.length >= NS_MAX_TAGS) break; }
  }
  return out;
}

export interface NSValidation { ok: boolean; reason?: string }
export function nsValidateCreate(input: NSCreatePostInput): NSValidation {
  if ((input.caption ?? '').length > NS_MAX_CAPTION) return { ok: false, reason: 'Caption is too long' };
  if (input.visibility && !NS_VISIBILITIES.includes(input.visibility)) return { ok: false, reason: 'Invalid visibility' };
  const photos = input.photos ?? [];
  if (photos.length > NS_MAX_PHOTOS) return { ok: false, reason: `At most ${NS_MAX_PHOTOS} photos per post` };
  return { ok: true };
}

// File guard for the upload path (used by the upload service / controller before persisting a photo).
export function nsValidatePhotoFile(file: { mimetype?: string; size?: number }): NSValidation {
  const mime = (file.mimetype ?? '').toLowerCase();
  if (!NS_ALLOWED_MIME.includes(mime)) return { ok: false, reason: 'Unsupported file type (use JPG, PNG, WEBP, MP4, or MOV)' };
  if ((file.size ?? 0) > NS_MAX_PHOTO_BYTES) return { ok: false, reason: 'File exceeds 50MB' };
  return { ok: true };
}

/**
 * A showcase photo may only reference PLATFORM media the posting customer uploaded — never an arbitrary external URL
 * (hot-linking, tracking pixels, someone else's private media). Accepts `/media/<key>` or a bare key, or an absolute
 * URL under the configured CDN / bucket base; and the key must sit in this customer's own upload namespace
 * (uploadObjectKey: `tenants/<salon>/nail-showcase/<branch>/<userId>/<post>/…` — or the older `…/customers/<userId>/…`).
 * Technician Profile merge, Oct 12 2026.
 */
export function nsIsOwnPlatformMediaUrl(url: unknown, userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof url !== 'string' || !userId) return false;
  const v = url.trim();
  if (!v || v.length > 1000) return false;
  let key = v;
  if (/^https?:\/\//i.test(v)) {
    let u: URL; try { u = new URL(v); } catch { return false; }
    if (u.search || u.hash) return false;
    const host = u.hostname.toLowerCase();
    const bases = [env.MEDIA_CDN_BASE_URL, env.MEDIA_LIVE_IMAGE_BASE, env.VITE_LIVE_IMAGE_BASE].filter((b): b is string => !!b);
    const baseHosts = bases.map((b) => { try { return new URL(b).hostname.toLowerCase(); } catch { return ''; } }).filter(Boolean);
    const bucketHost = env.MEDIA_S3_BUCKET ? new RegExp(`^${env.MEDIA_S3_BUCKET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.s3[.-][a-z0-9-]+\\.amazonaws\\.com$`) : null;
    if (!baseHosts.includes(host) && !(bucketHost && bucketHost.test(host))) return false; // exact host match — never a suffix trick
    key = u.pathname;
  }
  key = key.replace(/^\/+/, '').replace(/^media\//, '');
  if (key.includes('..') || key.includes('?') || key.includes('#')) return false;
  return key.includes(`/customers/${userId}/`) || new RegExp(`/nail-showcase/[^/]+/${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(key);
}
