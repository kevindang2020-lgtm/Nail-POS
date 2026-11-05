/**
 * nail-showcase.repository.ts — persistence port for NailShowcase + the request context. The Kysely implementation
 * (nail-showcase.kysely.repository.ts) is the live adapter; the stub below keeps the DI graph valid on a DB-less
 * deployment (NailShowcase requires persistence, so it throws rather than silently returning empty).
 */
import type { NSVisibility, NSPostType, NSPostStatus, NSCommentStatus, NSReactionType, NSFeedQuery } from './nail-showcase.dto';

export interface NailShowcaseContext { tenantId: string; branchId: string; userId: string; role?: string; permissions: string[] }

export interface NSPostRecord {
  id: string; tenantId: string | null; branchId: string | null; customerId: string;
  technicianId: string | null; serviceId: string | null; appointmentId: string | null; ticketId: string | null; ticketServiceLineId: string | null;
  caption: string; tags: string[]; visibility: NSVisibility; postType: NSPostType; status: NSPostStatus;
  isVerifiedService: boolean; allowComments: boolean; displayName: string; isAnonymous: boolean;
  likeCount: number; dislikeCount: number; commentCount: number; reportCount: number; createdAt: string;
}
export interface NSPhotoRecord { id: string; imageUrl: string; thumbnailUrl: string | null; sortOrder: number; caption: string | null }
export interface NSCommentRecord { id: string; postId: string; customerId: string; commentText: string; status: NSCommentStatus; createdAt: string }
export interface NSTicketEligibility {
  ticketId: string; status: string; customerRecordId: string | null; branchId: string | null; tenantId: string | null;
  appointmentId: string | null; technicianId: string | null; serviceId: string | null; ticketServiceLineId: string | null;
}
export interface NSNewPost {
  tenantId: string | null; branchId: string | null; customerId: string; technicianId: string | null; serviceId: string | null;
  appointmentId: string | null; ticketId: string | null; ticketServiceLineId: string | null; caption: string; tags: string[];
  visibility: NSVisibility; postType: NSPostType; status: NSPostStatus; isVerifiedService: boolean; allowComments: boolean;
  displayName: string; isAnonymous: boolean;
}
export interface NSNewReport {
  postId: string | null; commentId: string | null; tenantId: string | null; reportedByCustomerId: string | null;
  reportedByUserId: string | null; reason: string; details: string | null;
}

export interface NailShowcasePort {
  resolveCustomerRecordId(ctx: NailShowcaseContext): Promise<string | null>;
  userName(userId: string): Promise<{ firstName: string | null; lastName: string | null } | null>;
  ticketEligibility(ctx: NailShowcaseContext, ticketId: string): Promise<NSTicketEligibility | null>;
  hasPublishedPostForTicket(ctx: NailShowcaseContext, ticketId: string): Promise<boolean>;
  /** Did THIS customer (ctx.userId → customers row in ctx.tenantId) have a PAID ticket at ctx.tenantId with a service
   *  line served by `technicianId` (and, when given, for `serviceId`)? The only thing that lets a manual post name a technician. */
  customerServedBy(ctx: NailShowcaseContext, technicianId: string, serviceId: string | null): Promise<boolean>;
  /** Salon-level relaxation of the manual-post approval default (nail_showcase_tenant_policy, migration 576). */
  tenantAutoPublishManual(tenantId: string | null): Promise<boolean>;
  createPost(row: NSNewPost): Promise<NSPostRecord>;
  addPhotos(ctx: NailShowcaseContext, postId: string, photos: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null; metadata?: unknown }[]): Promise<NSPhotoRecord[]>;
  postById(postId: string): Promise<NSPostRecord | null>;
  photosFor(postIds: string[]): Promise<Map<string, NSPhotoRecord[]>>;
  feed(ctx: NailShowcaseContext, q: NSFeedQuery): Promise<NSPostRecord[]>;
  updatePost(postId: string, patch: { caption?: string; tags?: string[]; visibility?: NSVisibility; allowComments?: boolean }): Promise<void>;
  setPostStatus(postId: string, status: NSPostStatus): Promise<void>;
  softDeletePost(postId: string): Promise<void>;
  reactionOf(postId: string, customerId: string): Promise<NSReactionType | null>;
  upsertReaction(postId: string, customerId: string, type: NSReactionType): Promise<void>;
  deleteReaction(postId: string, customerId: string): Promise<void>;
  syncReactionCounts(postId: string): Promise<{ likeCount: number; dislikeCount: number }>;
  recentReactionActionCount(customerId: string, sinceIso: string): Promise<number>;
  reactionsOf(postIds: string[], customerId: string): Promise<Map<string, NSReactionType>>;
  resolveNames(input: { tenantIds: string[]; technicianIds: string[]; serviceIds: string[] }): Promise<{ salons: Map<string, string>; technicians: Map<string, string>; services: Map<string, string> }>;
  writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void>;
  notifyUser(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void>;
  /** §46: the author is a TECHNICIAN's salon login → technician_notifications (optional; the in-memory repo omits it). */
  notifyTechnicianAuthor?(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void>;
  addComment(postId: string, customerId: string, text: string, parentId: string | null): Promise<NSCommentRecord>;
  comments(postId: string): Promise<NSCommentRecord[]>;
  commentById(commentId: string): Promise<NSCommentRecord | null>;
  setCommentStatus(commentId: string, status: NSCommentStatus): Promise<void>;
  softDeleteComment(commentId: string): Promise<void>;
  syncCommentCount(postId: string): Promise<number>;
  addReport(row: NSNewReport): Promise<{ id: string }>;
  bumpPostReportCount(postId: string): Promise<void>;
  bumpCommentReportCount(commentId: string): Promise<void>;
  moderationPosts(ctx: NailShowcaseContext, opts: { status?: NSPostStatus; reportedOnly?: boolean }): Promise<NSPostRecord[]>;
  reportsList(ctx: NailShowcaseContext, platformWide: boolean): Promise<{ id: string; postId: string | null; commentId: string | null; reason: string; details: string | null; status: string; createdAt: string }[]>;
  resolveReport(reportId: string, status: string, resolvedByUserId: string): Promise<void>;
  reportTenantId(reportId: string): Promise<string | null | undefined>;
}

const NO_DB = () => { throw new Error('NailShowcase requires a database connection'); };
export class StubNailShowcaseRepository implements NailShowcasePort {
  resolveCustomerRecordId() { return NO_DB(); }
  userName() { return NO_DB(); }
  ticketEligibility() { return NO_DB(); }
  hasPublishedPostForTicket() { return NO_DB(); }
  customerServedBy() { return Promise.resolve(false); }
  tenantAutoPublishManual() { return Promise.resolve(false); }
  createPost() { return NO_DB(); }
  addPhotos() { return NO_DB(); }
  postById() { return NO_DB(); }
  photosFor() { return NO_DB(); }
  feed() { return NO_DB(); }
  updatePost() { return NO_DB(); }
  setPostStatus() { return NO_DB(); }
  softDeletePost() { return NO_DB(); }
  reactionOf() { return NO_DB(); }
  upsertReaction() { return NO_DB(); }
  deleteReaction() { return NO_DB(); }
  syncReactionCounts() { return NO_DB(); }
  recentReactionActionCount() { return Promise.resolve(0); }
  reactionsOf() { return NO_DB(); }
  resolveNames() { return NO_DB(); }
  writeAudit() { return Promise.resolve(); }
  notifyUser() { return Promise.resolve(); }
  addComment() { return NO_DB(); }
  comments() { return NO_DB(); }
  commentById() { return NO_DB(); }
  setCommentStatus() { return NO_DB(); }
  softDeleteComment() { return NO_DB(); }
  syncCommentCount() { return NO_DB(); }
  addReport() { return NO_DB(); }
  bumpPostReportCount() { return NO_DB(); }
  bumpCommentReportCount() { return NO_DB(); }
  moderationPosts() { return NO_DB(); }
  reportsList() { return NO_DB(); }
  resolveReport() { return NO_DB(); }
  reportTenantId() { return NO_DB(); }
}
