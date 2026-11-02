/**
 * nail-showcase.service.ts — NailShowcase rules: verified vs manual posts + eligibility, visibility-scoped feed with
 * trending re-rank, single-reaction toggle/switch, comments with privacy-safe display names, reporting, and
 * tenant-safe moderation (manager = own tenant only; super admin = platform-wide). Author identity = the customer's
 * user id; verified posts attach a paid ticket's service line. No private customer data is exposed in any view.
 */
import {
  NSCreatePostInput, NSFeedQuery, NSPostView, NSPhotoView, NSCommentView, NSEligibility, NSFeedResult, NSReactionType, NSPostStatus,
  nsValidateCreate, nsNormalizeTags, nsDisplayName, nsTrendingScore, nsIsOwnPlatformMediaUrl, NS_MAX_COMMENT, NS_MAX_PHOTOS,
} from './nail-showcase.dto';
import { NailShowcasePort, NailShowcaseContext, NSPostRecord, NSNewPost } from './nail-showcase.repository';
import type { NailShowcaseRankingService } from './nail-showcase-ranking.service';
import type { PushService } from '@aipowersalon/communications';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class NailShowcaseError extends Error {
  constructor(public code: 'not_customer' | 'invalid' | 'not_found' | 'forbidden' | 'not_eligible' | 'rate_limited', message: string) { super(message); this.name = 'NailShowcaseError'; }
}

export interface NailShowcasePolicy { autoApproveVerified: boolean; requireApprovalForManual: boolean; allowComments: boolean; allowDislikes: boolean; allowPublicFeed: boolean; reactionRateLimit?: { max: number; windowSeconds: number } }
// requireApprovalForManual is TRUE by default (Technician Profile merge, mandate §45/§46): an unverified upload is
// reviewed before it goes live. A salon relaxes that for its own feed through nail_showcase_tenant_policy.auto_publish_manual (576).
export const DEFAULT_POLICY: NailShowcasePolicy = { autoApproveVerified: true, requireApprovalForManual: true, allowComments: true, allowDislikes: true, allowPublicFeed: true, reactionRateLimit: { max: 50, windowSeconds: 60 } };

// (push is optional so the service still runs anywhere it's constructed without it)
export class NailShowcaseService {
  // ranking is OPTIONAL: unit tests/harness construct the service with just the repo (no-op). The module injects the
  // ranking service so engagement-score recomputes fire on reactions/comments/moderation/profile changes.
  constructor(private readonly repo: NailShowcasePort, private readonly policy: NailShowcasePolicy = DEFAULT_POLICY, private readonly ranking?: NailShowcaseRankingService, private readonly push?: PushService) {}

  private customer(ctx: NailShowcaseContext): string {
    if (!ctx?.userId) throw withCode(new NailShowcaseError('not_customer', 'You must be signed in as a customer.'), 'CUSTOMER_SIGN_IN_REQUIRED');
    return ctx.userId;
  }
  // Recompute the post author's NailShowcase score after any event that changes their eligible engagement. Best-effort.
  private async recompute(post: { tenantId: string | null; customerId: string } | null | undefined): Promise<void> {
    if (!post || !this.ranking) return;
    try { await this.ranking.recomputeCustomer(post.tenantId, post.customerId); } catch { /* best-effort */ }
  }
  // Analytics + notifications are best-effort: a failure here must never break the user action.
  private async audit(ctx: NailShowcaseContext, actionType: string, entityId: string, metadata?: unknown): Promise<void> {
    try { await this.repo.writeAudit({ tenantId: ctx.tenantId ?? null, branchId: ctx.branchId || null, userId: ctx.userId, role: ctx.role ?? null, actionType, entityType: 'nail_showcase_post', entityId, metadata }); } catch { /* best-effort */ }
  }
  private async notify(tenantId: string | null, userId: string, type: string, title: string, body: string | null, reference: string | null, pushBody: string | null = body): Promise<void> {
    try { await this.repo.notifyUser({ tenantId, userId, type, title, body, reference }); } catch { /* best-effort */ }
    // Technician Profile §46: a technician-authored post (her salon login is the author) — her notification lives in technician_notifications
    try { await this.repo.notifyTechnicianAuthor?.({ tenantId, userId, type, title, body, reference }); } catch { /* best-effort */ }
    if (this.push) { try { await this.push.dispatchToUser(tenantId, userId, { title, body: pushBody ?? undefined, reference: reference ?? undefined, category: 'COMMUNITY' }); } catch { /* best-effort */ } }
  }

  // ---- Posts ----
  async createManualPost(ctx: NailShowcaseContext, input: NSCreatePostInput): Promise<NSPostView> {
    const customerId = this.customer(ctx);
    const v = nsValidateCreate(input); if (!v.ok) throw new NailShowcaseError('invalid', v.reason!);
    const displayName = await this.deriveDisplay(ctx, input);
    this.assertOwnPhotos(ctx, input.photos);
    // Salon and branch are SERVER-DERIVED from the session. The client's salonTenantId / branchId are ignored: a post
    // cannot be filed under a salon the customer is not signed in to.
    const tenantId = ctx.tenantId ?? null;
    const branchId = ctx.branchId || null;
    // Attribution: a manual post may name a technician / service ONLY when this customer actually had a paid ticket at
    // this salon with a service line served by that technician. Anything else is stored UNATTRIBUTED — never refused,
    // never trusted. (A verified post derives attribution from the ticket itself; see createVerifiedPost.)
    const wantTech = input.technicianId ?? null;
    const wantService = input.serviceId ?? null;
    const served = wantTech ? await this.repo.customerServedBy(ctx, wantTech, wantService) : false;
    const technicianId = served ? wantTech : null;
    const serviceId = served ? wantService : null;
    const requireApproval = this.policy.requireApprovalForManual && !(await this.repo.tenantAutoPublishManual(tenantId));
    const status: NSPostStatus = requireApproval ? 'pending_review' : 'published';
    const post = await this.repo.createPost({
      tenantId, branchId, customerId, technicianId, serviceId,
      appointmentId: null, ticketId: null, ticketServiceLineId: null, caption: (input.caption ?? '').trim(), tags: nsNormalizeTags(input.tags),
      visibility: this.coerceVisibility(input.visibility), postType: 'manual_upload', status, isVerifiedService: false,
      allowComments: input.allowComments ?? this.policy.allowComments, displayName, isAnonymous: !!input.isAnonymous,
    });
    if (input.photos?.length) await this.repo.addPhotos(ctx, post.id, input.photos.slice(0, NS_MAX_PHOTOS));
    await this.audit(ctx, 'nail_showcase_post_created', post.id, { postType: 'manual_upload', status, attributionRequested: !!wantTech, attributionVerified: served });
    if (status === 'published') await this.recompute(post);
    return this.view(ctx, post);
  }

  /** Every photo descriptor must point at platform media THIS customer uploaded — external URLs are refused outright. */
  private assertOwnPhotos(ctx: NailShowcaseContext, photos: NSCreatePostInput['photos'] | undefined) {
    for (const p of photos ?? []) {
      if (!nsIsOwnPlatformMediaUrl(p?.imageUrl, ctx.userId)) throw withCode(new NailShowcaseError('invalid', 'Photos must be uploaded through the app — external image links are not accepted.'), 'PHOTO_UPLOAD_IN_APP');
      if (p?.thumbnailUrl && !nsIsOwnPlatformMediaUrl(p.thumbnailUrl, ctx.userId)) throw withCode(new NailShowcaseError('invalid', 'Photos must be uploaded through the app — external image links are not accepted.'), 'PHOTO_UPLOAD_IN_APP');
    }
  }

  async eligibility(ctx: NailShowcaseContext, ticketId: string): Promise<NSEligibility> {
    this.customer(ctx);
    const customerRecordId = await this.repo.resolveCustomerRecordId(ctx);
    const t = await this.repo.ticketEligibility(ctx, ticketId);
    if (!t) return { eligible: false, reason: 'Service not found' };
    if (t.status !== 'paid') return { eligible: false, reason: 'Service is not completed yet', ticketId };
    if (!customerRecordId || t.customerRecordId !== customerRecordId) return { eligible: false, reason: 'This service is not on your account', ticketId };
    const already = await this.repo.hasPublishedPostForTicket(ctx, ticketId);
    return { eligible: !already, reason: already ? 'You already shared this service' : undefined, ticketId, appointmentId: t.appointmentId, technicianId: t.technicianId, serviceId: t.serviceId, alreadyPosted: already };
  }

  async createVerifiedPost(ctx: NailShowcaseContext, ticketId: string, input: NSCreatePostInput): Promise<NSPostView> {
    const customerId = this.customer(ctx);
    const elig = await this.eligibility(ctx, ticketId);
    if (!elig.eligible) throw new NailShowcaseError('not_eligible', elig.reason ?? 'Not eligible for a verified post');
    const t = (await this.repo.ticketEligibility(ctx, ticketId))!;
    const v = nsValidateCreate(input); if (!v.ok) throw new NailShowcaseError('invalid', v.reason!);
    this.assertOwnPhotos(ctx, input.photos);
    const displayName = await this.deriveDisplay(ctx, input);
    const status: NSPostStatus = this.policy.autoApproveVerified ? 'published' : 'pending_review';
    const post = await this.repo.createPost({
      tenantId: t.tenantId, branchId: t.branchId, customerId, technicianId: t.technicianId, serviceId: t.serviceId,
      appointmentId: t.appointmentId, ticketId: t.ticketId, ticketServiceLineId: t.ticketServiceLineId, caption: (input.caption ?? '').trim(),
      tags: nsNormalizeTags(input.tags), visibility: this.coerceVisibility(input.visibility), postType: 'verified_service', status,
      isVerifiedService: true, allowComments: input.allowComments ?? this.policy.allowComments, displayName, isAnonymous: !!input.isAnonymous,
    });
    if (input.photos?.length) await this.repo.addPhotos(ctx, post.id, input.photos.slice(0, NS_MAX_PHOTOS));
    await this.audit(ctx, 'nail_showcase_post_created', post.id, { postType: 'verified_service', ticketId });
    await this.recompute(post);
    return this.view(ctx, post);
  }

  async getPost(ctx: NailShowcaseContext, postId: string): Promise<NSPostView> {
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (!this.canView(ctx, post)) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    return this.view(ctx, post);
  }

  async feed(ctx: NailShowcaseContext, q: NSFeedQuery): Promise<NSFeedResult> {
    this.customer(ctx);
    const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 50);
    let rows = await this.repo.feed(ctx, q);
    if ((q.sort ?? 'newest') === 'trending') {
      const now = new Date();
      rows = rows.map((p) => ({ p, s: nsTrendingScore(p, now) })).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
    }
    const views = await this.viewMany(ctx, rows);
    // Keyset pagination is only coherent for 'newest' (the query orders by created_at). most_liked / most_commented /
    // trending are ranked single-page "top" views — a created_at cursor there would skip or duplicate rows, so none.
    const last = rows[rows.length - 1];
    const nextCursor = (q.sort ?? 'newest') === 'newest' && rows.length >= limit && last ? last.createdAt : null;
    return { posts: views, nextCursor };
  }

  async updatePost(ctx: NailShowcaseContext, postId: string, patch: { caption?: string; tags?: string[]; visibility?: any; allowComments?: boolean }): Promise<NSPostView> {
    const customerId = this.customer(ctx);
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (post.customerId !== customerId) throw withCode(new NailShowcaseError('forbidden', 'You can only edit your own posts'), 'OWN_CONTENT_ONLY');
    await this.repo.updatePost(postId, { caption: patch.caption?.trim(), tags: patch.tags ? nsNormalizeTags(patch.tags) : undefined, visibility: patch.visibility ? this.coerceVisibility(patch.visibility) : undefined, allowComments: patch.allowComments });
    await this.recompute(post);
    return this.view(ctx, (await this.repo.postById(postId))!);
  }

  async deletePost(ctx: NailShowcaseContext, postId: string): Promise<{ deleted: true }> {
    const customerId = this.customer(ctx);
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (post.customerId !== customerId) throw withCode(new NailShowcaseError('forbidden', 'You can only delete your own posts'), 'OWN_CONTENT_ONLY');
    await this.repo.softDeletePost(postId);
    await this.recompute(post);
    return { deleted: true };
  }

  // ---- Reactions (one per customer; tap same = remove, switch = update) ----
  async setReaction(ctx: NailShowcaseContext, postId: string, type: NSReactionType): Promise<{ myReaction: NSReactionType | null; likeCount: number; dislikeCount: number }> {
    const customerId = this.customer(ctx);
    if (type === 'dislike' && !this.policy.allowDislikes) throw withCode(new NailShowcaseError('invalid', 'Dislikes are disabled'), 'DISLIKES_OFF');
    const post = await this.repo.postById(postId);
    if (!post || post.status !== 'published') throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    // Spam guard: throttle how many reaction actions one customer can record in a short window, so a single account
    // can't script-like across many posts to pump a creator's score. Toggling one post is already idempotent (unique
    // (post, customer) row), so this targets the cross-post spam vector; the generous default never trips a real person.
    const rl = this.policy.reactionRateLimit;
    if (rl && rl.max > 0) {
      const since = new Date(Date.now() - rl.windowSeconds * 1000).toISOString();
      const recent = await this.repo.recentReactionActionCount(customerId, since);
      if (recent >= rl.max) throw withCode(new NailShowcaseError('rate_limited', 'You are reacting too quickly. Please slow down and try again in a moment.'), 'REACTING_TOO_FAST');
    }
    const current = await this.repo.reactionOf(postId, customerId);
    let myReaction: NSReactionType | null;
    if (current === type) { await this.repo.deleteReaction(postId, customerId); myReaction = null; }
    else { await this.repo.upsertReaction(postId, customerId, type); myReaction = type; }
    const counts = await this.repo.syncReactionCounts(postId);
    if (myReaction) await this.audit(ctx, myReaction === 'like' ? 'nail_showcase_post_liked' : 'nail_showcase_post_disliked', postId);
    if (myReaction === 'like' && post.customerId !== ctx.userId) await this.notify(post.tenantId, post.customerId, 'nail_showcase', 'Someone liked your nail post', null, postId);
    await this.recompute(post);
    return { myReaction, ...counts };
  }
  async removeReaction(ctx: NailShowcaseContext, postId: string): Promise<{ myReaction: null; likeCount: number; dislikeCount: number }> {
    const customerId = this.customer(ctx);
    await this.repo.deleteReaction(postId, customerId);
    const counts = await this.repo.syncReactionCounts(postId);
    await this.recompute(await this.repo.postById(postId));
    return { myReaction: null, ...counts };
  }

  // ---- Comments ----
  async addComment(ctx: NailShowcaseContext, postId: string, text: string): Promise<NSCommentView> {
    const customerId = this.customer(ctx);
    const body = (text ?? '').trim();
    if (!body) throw withCode(new NailShowcaseError('invalid', 'Comment cannot be empty'), 'COMMENT_REQUIRED');
    if (body.length > NS_MAX_COMMENT) throw withCode(new NailShowcaseError('invalid', 'Comment is too long'), 'COMMENT_TOO_LONG');
    const post = await this.repo.postById(postId);
    if (!post || post.status !== 'published') throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (!post.allowComments) throw withCode(new NailShowcaseError('forbidden', 'Comments are turned off for this post'), 'COMMENTS_OFF');
    const c = await this.repo.addComment(postId, customerId, body, null);
    await this.repo.syncCommentCount(postId);
    const name = await this.commenterName(customerId);
    if (post.customerId !== ctx.userId) await this.notify(post.tenantId, post.customerId, 'nail_showcase', 'New comment on your nail post', body.slice(0, 120), postId, 'Open the app to read it.');   // §61: the comment text stays in the app
    await this.audit(ctx, 'nail_showcase_comment_created', postId);
    await this.recompute(post);
    return { id: c.id, postId, displayName: name, commentText: c.commentText, status: c.status, isMine: true, createdAt: c.createdAt };
  }
  async listComments(ctx: NailShowcaseContext, postId: string): Promise<NSCommentView[]> {
    const customerId = this.customer(ctx);
    const rows = await this.repo.comments(postId);
    const cache = new Map<string, string>();
    const out: NSCommentView[] = [];
    for (const c of rows) {
      let name = cache.get(c.customerId);
      if (name === undefined) { name = await this.commenterName(c.customerId); cache.set(c.customerId, name); }
      out.push({ id: c.id, postId, displayName: name, commentText: c.commentText, status: c.status, isMine: c.customerId === customerId, createdAt: c.createdAt });
    }
    return out;
  }
  async deleteComment(ctx: NailShowcaseContext, commentId: string): Promise<{ deleted: true }> {
    const customerId = this.customer(ctx);
    const c = await this.repo.commentById(commentId);
    if (!c) throw withCode(new NailShowcaseError('not_found', 'Comment not found'), 'COMMENT_NOT_FOUND');
    if (c.customerId !== customerId) throw withCode(new NailShowcaseError('forbidden', 'You can only delete your own comments'), 'OWN_CONTENT_ONLY');
    await this.repo.softDeleteComment(commentId);
    await this.repo.syncCommentCount(c.postId);
    await this.recompute(await this.repo.postById(c.postId));
    return { deleted: true };
  }

  // ---- Reports ----
  async reportPost(ctx: NailShowcaseContext, postId: string, reason: string, details?: string): Promise<{ reported: true }> {
    this.customer(ctx);
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    const customerRecordId = await this.repo.resolveCustomerRecordId(ctx).catch(() => null);
    await this.repo.addReport({ postId, commentId: null, tenantId: post.tenantId, reportedByCustomerId: customerRecordId, reportedByUserId: ctx.userId, reason: (reason ?? 'other').slice(0, 80), details: details?.slice(0, 1000) ?? null });
    await this.repo.bumpPostReportCount(postId);
    await this.audit(ctx, 'nail_showcase_post_reported', postId);
    return { reported: true };
  }
  async reportComment(ctx: NailShowcaseContext, commentId: string, reason: string, details?: string): Promise<{ reported: true }> {
    this.customer(ctx);
    const c = await this.repo.commentById(commentId);
    if (!c) throw withCode(new NailShowcaseError('not_found', 'Comment not found'), 'COMMENT_NOT_FOUND');
    const post = await this.repo.postById(c.postId);
    const customerRecordId = await this.repo.resolveCustomerRecordId(ctx).catch(() => null);
    await this.repo.addReport({ postId: c.postId, commentId, tenantId: post?.tenantId ?? null, reportedByCustomerId: customerRecordId, reportedByUserId: ctx.userId, reason: (reason ?? 'other').slice(0, 80), details: details?.slice(0, 1000) ?? null });
    await this.repo.bumpCommentReportCount(commentId);
    return { reported: true };
  }

  // ---- Moderation (POS manager = own tenant; super admin = platform-wide) ----
  async hidePost(ctx: NailShowcaseContext, postId: string): Promise<{ status: NSPostStatus }> {
    const post = await this.repoTenantPost(ctx, postId);
    await this.repo.setPostStatus(postId, 'hidden');
    await this.notify(post.tenantId, post.customerId, 'nail_showcase', 'Your nail post was hidden', 'A manager hid your post from the salon feed.', postId);
    await this.audit(ctx, 'nail_showcase_post_hidden', postId);
    await this.recompute(post);
    return { status: 'hidden' };
  }
  async approvePost(ctx: NailShowcaseContext, postId: string): Promise<{ status: NSPostStatus }> {
    const post = await this.repoTenantPost(ctx, postId);
    await this.repo.setPostStatus(postId, 'published');
    await this.notify(post.tenantId, post.customerId, 'nail_showcase', 'Your nail post was approved', 'Your nail design is now live in the salon feed.', postId);
    await this.audit(ctx, 'nail_showcase_post_approved', postId);
    await this.recompute(post);
    return { status: 'published' };
  }
  async hideComment(ctx: NailShowcaseContext, commentId: string): Promise<{ status: string }> {
    const c = await this.repo.commentById(commentId);
    if (!c) throw withCode(new NailShowcaseError('not_found', 'Comment not found'), 'COMMENT_NOT_FOUND');
    const post = await this.repo.postById(c.postId);
    if (!post || post.tenantId !== ctx.tenantId) throw withCode(new NailShowcaseError('forbidden', 'Not in your salon'), 'NOT_IN_YOUR_SALON');
    await this.repo.setCommentStatus(commentId, 'hidden');
    await this.repo.syncCommentCount(c.postId);
    await this.recompute(post);
    return { status: 'hidden' };
  }
  async listModeration(ctx: NailShowcaseContext, opts: { status?: NSPostStatus; reportedOnly?: boolean }): Promise<NSPostView[]> {
    const rows = await this.repo.moderationPosts(ctx, opts);
    return this.viewMany(ctx, rows);
  }
  async listReports(ctx: NailShowcaseContext, platformWide = false) { return this.repo.reportsList(ctx, platformWide); }
  async resolveReport(ctx: NailShowcaseContext, reportId: string, status: string, platformWide = false): Promise<{ resolved: true }> {
    if (!platformWide) {
      const tid = await this.repo.reportTenantId(reportId);
      if (tid === undefined) throw withCode(new NailShowcaseError('not_found', 'Report not found'), 'REPORT_NOT_FOUND');
      if (tid !== ctx.tenantId) throw withCode(new NailShowcaseError('forbidden', 'Not in your salon'), 'NOT_IN_YOUR_SALON');
    }
    await this.repo.resolveReport(reportId, status, ctx.userId);
    return { resolved: true };
  }
  // super admin platform-wide removal
  async removePostPlatform(ctx: NailShowcaseContext, postId: string): Promise<{ status: NSPostStatus }> { const post = await this.repo.postById(postId); await this.repo.setPostStatus(postId, 'removed'); await this.audit(ctx, 'nail_showcase_post_removed', postId); await this.recompute(post); return { status: 'removed' }; }
  async removeCommentPlatform(ctx: NailShowcaseContext, commentId: string): Promise<{ status: string }> {
    const c = await this.repo.commentById(commentId); if (c) { await this.repo.setCommentStatus(commentId, 'removed'); await this.repo.syncCommentCount(c.postId); await this.recompute(await this.repo.postById(c.postId)); }
    return { status: 'removed' };
  }

  // ---- internals ----
  async addPhotosToPost(ctx: NailShowcaseContext, postId: string, photos: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null; metadata?: unknown }[]): Promise<NSPhotoView[]> {
    const customerId = this.customer(ctx);
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (post.customerId !== customerId) throw withCode(new NailShowcaseError('forbidden', 'You can only add photos to your own posts'), 'OWN_CONTENT_ONLY');
    this.assertOwnPhotos(ctx, photos);
    const recs = await this.repo.addPhotos(ctx, postId, (photos ?? []).slice(0, NS_MAX_PHOTOS));
    await this.audit(ctx, 'nail_showcase_photo_uploaded', postId, { count: recs.length });
    return recs.map((x) => ({ id: x.id, imageUrl: x.imageUrl, thumbnailUrl: x.thumbnailUrl, sortOrder: x.sortOrder, caption: x.caption }));
  }
  private async repoTenantPost(ctx: NailShowcaseContext, postId: string): Promise<NSPostRecord> {
    const post = await this.repo.postById(postId);
    if (!post) throw withCode(new NailShowcaseError('not_found', 'Post not found'), 'POST_NOT_FOUND');
    if (post.tenantId !== ctx.tenantId) throw withCode(new NailShowcaseError('forbidden', 'You can only moderate posts in your salon'), 'NOT_IN_YOUR_SALON');
    return post;
  }
  private coerceVisibility(v?: string) {
    const vis = (v as any) ?? 'salon_only';
    if (vis === 'public_platform' && !this.policy.allowPublicFeed) return 'salon_only';
    return vis === 'public_platform' || vis === 'private' ? vis : 'salon_only';
  }
  private async deriveDisplay(ctx: NailShowcaseContext, input: NSCreatePostInput): Promise<string> {
    if (input.isAnonymous) return nsDisplayName({ isAnonymous: true });
    const u = await this.repo.userName(ctx.userId).catch(() => null);
    return nsDisplayName({ displayName: input.displayName, firstName: u?.firstName, lastName: u?.lastName });
  }
  private async commenterName(userId: string): Promise<string> {
    const u = await this.repo.userName(userId).catch(() => null);
    return nsDisplayName({ firstName: u?.firstName, lastName: u?.lastName });
  }
  private canView(ctx: NailShowcaseContext, p: NSPostRecord): boolean {
    if (p.customerId === ctx.userId) return true;               // author always sees own
    if (p.status !== 'published') return false;                 // pending/hidden/removed not public
    if (p.visibility === 'private') return false;
    if (p.visibility === 'public_platform') return true;
    return p.tenantId === ctx.tenantId;                          // salon_only
  }
  private async view(ctx: NailShowcaseContext, p: NSPostRecord): Promise<NSPostView> { return (await this.viewMany(ctx, [p]))[0]; }
  private async viewMany(ctx: NailShowcaseContext, rows: NSPostRecord[]): Promise<NSPostView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [photos, myReactions, names] = await Promise.all([
      this.repo.photosFor(ids),
      this.repo.reactionsOf(ids, ctx.userId),
      this.repo.resolveNames({
        tenantIds: rows.map((r) => r.tenantId).filter((x): x is string => !!x),
        technicianIds: rows.map((r) => r.technicianId).filter((x): x is string => !!x),
        serviceIds: rows.map((r) => r.serviceId).filter((x): x is string => !!x),
      }),
    ]);
    return rows.map((p) => {
      const ph: NSPhotoView[] = (photos.get(p.id) ?? []).map((x) => ({ id: x.id, imageUrl: x.imageUrl, thumbnailUrl: x.thumbnailUrl, sortOrder: x.sortOrder, caption: x.caption }));
      return {
        id: p.id, caption: p.caption, tags: p.tags, visibility: p.visibility, postType: p.postType, status: p.status,
        isVerifiedService: p.isVerifiedService, allowComments: p.allowComments, displayName: p.displayName,
        salonTenantId: p.tenantId, branchId: p.branchId, technicianId: p.technicianId, serviceId: p.serviceId,
        salonName: p.tenantId ? names.salons.get(p.tenantId) ?? null : null,
        technicianName: p.technicianId ? names.technicians.get(p.technicianId) ?? null : null,
        serviceName: p.serviceId ? names.services.get(p.serviceId) ?? null : null,
        likeCount: p.likeCount, dislikeCount: p.dislikeCount, commentCount: p.commentCount, reportCount: p.reportCount,
        myReaction: myReactions.get(p.id) ?? null, isMine: p.customerId === ctx.userId, photos: ph, createdAt: p.createdAt,
      };
    });
  }
}
