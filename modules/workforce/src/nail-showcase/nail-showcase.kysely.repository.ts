/**
 * nail-showcase.kysely.repository.ts — live Postgres adapter for NailShowcase. Tenant/branch scoping and visibility
 * filtering live here; the service owns the rules. Verified-post eligibility resolves the customer's CRM record
 * (customers.user_id) and the ticket's paid status + first service line (service/technician attribution).
 */
import { runAcrossTenants } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import {
  NailShowcasePort, NailShowcaseContext, NSPostRecord, NSPhotoRecord, NSCommentRecord, NSTicketEligibility, NSNewPost, NSNewReport,
} from './nail-showcase.repository';
import type { NSVisibility, NSPostType, NSPostStatus, NSCommentStatus, NSReactionType, NSFeedQuery } from './nail-showcase.dto';
import { transitionStatus } from '@aipowersalon/database';
import { NAIL_SHOWCASE_POST, NAIL_SHOWCASE_COMMENT, NAIL_SHOWCASE_REPORT } from '../workforce-lifecycles';

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } }
  return [];
}
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));

export class KyselyNailShowcaseRepository implements NailShowcasePort {
  constructor(private readonly db: Kysely<DB>) {}

  private mapPost = (r: any): NSPostRecord => ({
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, customerId: r.customer_id,
    technicianId: r.technician_id, serviceId: r.service_id, appointmentId: r.appointment_id, ticketId: r.ticket_id, ticketServiceLineId: r.ticket_service_line_id,
    caption: r.caption ?? '', tags: parseTags(r.tags), visibility: r.visibility, postType: r.post_type, status: r.status,
    isVerifiedService: !!r.is_verified_service, allowComments: !!r.allow_comments, displayName: r.display_name ?? 'Customer', isAnonymous: !!r.is_anonymous,
    likeCount: Number(r.like_count) || 0, dislikeCount: Number(r.dislike_count) || 0, commentCount: Number(r.comment_count) || 0, reportCount: Number(r.report_count) || 0,
    createdAt: iso(r.created_at),
  });
  private mapPhoto = (r: any): NSPhotoRecord => ({ id: r.id, imageUrl: r.image_url, thumbnailUrl: r.thumbnail_url ?? null, sortOrder: Number(r.sort_order) || 0, caption: r.caption ?? null });
  private mapComment = (r: any): NSCommentRecord => ({ id: r.id, postId: r.post_id, customerId: r.customer_id, commentText: r.comment_text, status: r.status, createdAt: iso(r.created_at) });

  async resolveCustomerRecordId(ctx: NailShowcaseContext): Promise<string | null> {
    const r: any = await this.db.selectFrom('customers').select('id').where('user_id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return r?.id ?? null;
  }
  async userName(userId: string) {
    const r: any = await this.db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', userId).executeTakeFirst().catch(() => null);
    return r ? { firstName: r.first_name ?? null, lastName: r.last_name ?? null } : null;
  }
  async ticketEligibility(ctx: NailShowcaseContext, ticketId: string): Promise<NSTicketEligibility | null> {
    const t: any = await this.db.selectFrom('tickets').select(['id', 'status', 'customer_id', 'branch_id', 'tenant_id', 'primary_technician_id'])
      .where('id', '=', ticketId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    if (!t) return null;
    const line: any = await this.db.selectFrom('ticket_service_lines').select(['id', 'service_id', 'technician_id'])
      .where('ticket_id', '=', ticketId).where('removed_at', 'is', null).orderBy('created_at', 'asc').executeTakeFirst();
    return {
      ticketId: t.id, status: t.status, customerRecordId: t.customer_id ?? null, branchId: t.branch_id ?? null, tenantId: t.tenant_id ?? null,
      appointmentId: null, technicianId: line?.technician_id ?? t.primary_technician_id ?? null, serviceId: line?.service_id ?? null, ticketServiceLineId: line?.id ?? null,
    };
  }
  async hasPublishedPostForTicket(ctx: NailShowcaseContext, ticketId: string): Promise<boolean> {
    const r: any = await this.db.selectFrom('nail_showcase_posts').select('id').where('ticket_id', '=', ticketId).where('deleted_at', 'is', null).executeTakeFirst();
    return !!r;
  }

  async customerServedBy(ctx: NailShowcaseContext, technicianId: string, serviceId: string | null): Promise<boolean> {
    if (!ctx.tenantId || !technicianId) return false;
    const customerRecordId = await this.resolveCustomerRecordId(ctx);
    if (!customerRecordId) return false;
    let q = this.db.selectFrom('tickets as k').innerJoin('ticket_service_lines as l', 'l.ticket_id', 'k.id')
      .where('k.tenant_id', '=', ctx.tenantId).where('k.customer_id', '=', customerRecordId).where('k.paid_at', 'is not', null)
      .where('l.technician_id', '=', technicianId).where('l.removed_at', 'is', null);
    if (serviceId) q = q.where('l.service_id', '=', serviceId);
    const r: any = await q.select('l.id').executeTakeFirst().catch(() => null);
    return !!r;
  }
  async tenantAutoPublishManual(tenantId: string | null): Promise<boolean> {
    if (!tenantId) return false;
    const r: any = await this.db.selectFrom('nail_showcase_tenant_policy').select('auto_publish_manual').where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => null);
    return !!r?.auto_publish_manual;
  }

  async createPost(row: NSNewPost): Promise<NSPostRecord> {
    const r: any = await this.db.insertInto('nail_showcase_posts').values({
      tenant_id: row.tenantId, branch_id: row.branchId, customer_id: row.customerId, technician_id: row.technicianId, service_id: row.serviceId,
      appointment_id: row.appointmentId, ticket_id: row.ticketId, ticket_service_line_id: row.ticketServiceLineId, caption: row.caption,
      tags: JSON.stringify(row.tags) as any, visibility: row.visibility, post_type: row.postType, status: row.status,
      is_verified_service: row.isVerifiedService, allow_comments: row.allowComments, display_name: row.displayName, is_anonymous: row.isAnonymous,
    } as any).returningAll().executeTakeFirstOrThrow();
    return this.mapPost(r);
  }
  async addPhotos(ctx: NailShowcaseContext, postId: string, photos: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null; metadata?: unknown }[]): Promise<NSPhotoRecord[]> {
    if (!photos.length) return [];
    const post: any = await this.db.selectFrom('nail_showcase_posts').select(['tenant_id', 'branch_id', 'customer_id']).where('id', '=', postId).executeTakeFirst();
    const base = await this.db.selectFrom('nail_showcase_photos').select((eb) => eb.fn.max('sort_order').as('m')).where('post_id', '=', postId).executeTakeFirst().catch(() => null);
    let order = (Number((base as any)?.m) || 0) + (photos.length && (base as any)?.m != null ? 1 : 0);
    const out: NSPhotoRecord[] = [];
    for (const p of photos) {
      const r: any = await this.db.insertInto('nail_showcase_photos').values({
        post_id: postId, tenant_id: post?.tenant_id ?? null, branch_id: post?.branch_id ?? null, customer_id: post?.customer_id ?? ctx.userId,
        image_url: p.imageUrl, thumbnail_url: p.thumbnailUrl ?? null, sort_order: order++, caption: p.caption ?? null, metadata: (p.metadata ?? null) as any,
      } as any).returningAll().executeTakeFirstOrThrow();
      out.push(this.mapPhoto(r));
    }
    return out;
  }
  async postById(postId: string): Promise<NSPostRecord | null> {
    const r: any = await this.db.selectFrom('nail_showcase_posts').selectAll().where('id', '=', postId).where('deleted_at', 'is', null).executeTakeFirst();
    return r ? this.mapPost(r) : null;
  }
  async photosFor(postIds: string[]): Promise<Map<string, NSPhotoRecord[]>> {
    const m = new Map<string, NSPhotoRecord[]>();
    if (!postIds.length) return m;
    const rows: any[] = await this.db.selectFrom('nail_showcase_photos').selectAll().where('post_id', 'in', postIds).orderBy('sort_order', 'asc').execute();
    for (const r of rows) { const k = r.post_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(this.mapPhoto(r)); }
    return m;
  }

  async feed(ctx: NailShowcaseContext, q: NSFeedQuery): Promise<NSPostRecord[]> {
    let qb = this.db.selectFrom('nail_showcase_posts').selectAll().where('deleted_at', 'is', null);
    const scope = q.scope ?? 'for_you';
    if (scope === 'mine') {
      qb = qb.where('customer_id', '=', ctx.userId).where('status', '!=', 'removed');
    } else {
      qb = qb.where('status', '=', 'published');
      if (scope === 'public') qb = qb.where('visibility', '=', 'public_platform');
      else if (scope === 'salon') qb = qb.where((eb) => eb.and([eb('tenant_id', '=', ctx.tenantId), eb('visibility', 'in', ['salon_only', 'public_platform'])]));
      else qb = qb.where((eb) => eb.or([eb('visibility', '=', 'public_platform'), eb.and([eb('tenant_id', '=', ctx.tenantId), eb('visibility', '=', 'salon_only')])])); // for_you
    }
    if (q.salonId) qb = qb.where('tenant_id', '=', q.salonId);
    if (q.branchId) qb = qb.where('branch_id', '=', q.branchId);
    if (q.serviceId) qb = qb.where('service_id', '=', q.serviceId);
    if (q.technicianId) qb = qb.where('technician_id', '=', q.technicianId);
    if (q.tag) qb = qb.where(sql<boolean>`tags @> ${JSON.stringify([q.tag])}::jsonb`);
    if (q.cursor) qb = qb.where('created_at', '<', q.cursor as any);
    const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 50);
    const sort = q.sort ?? 'newest';
    if (sort === 'most_liked') qb = qb.orderBy('like_count', 'desc').orderBy('created_at', 'desc');
    else if (sort === 'most_commented') qb = qb.orderBy('comment_count', 'desc').orderBy('created_at', 'desc');
    else qb = qb.orderBy('created_at', 'desc'); // newest + trending (trending re-ranked in service over a recent window)
    qb = qb.limit(sort === 'trending' ? Math.min(limit * 4, 200) : limit);
    const rows: any[] = await qb.execute();
    return rows.map(this.mapPost);
  }

  async updatePost(postId: string, patch: { caption?: string; tags?: string[]; visibility?: NSVisibility; allowComments?: boolean }): Promise<void> {
    const set: any = { updated_at: sql`now()` };
    if (patch.caption !== undefined) set.caption = patch.caption;
    if (patch.tags !== undefined) set.tags = JSON.stringify(patch.tags);
    if (patch.visibility !== undefined) set.visibility = patch.visibility;
    if (patch.allowComments !== undefined) set.allow_comments = patch.allowComments;
    await this.db.updateTable('nail_showcase_posts').set(set).where('id', '=', postId).execute();
  }
  async setPostStatus(postId: string, status: NSPostStatus): Promise<void> {
    await transitionStatus(this.db as any, NAIL_SHOWCASE_POST, { where: { id: postId }, to: status, set: { updated_at: sql`now()` } });   // Phase 12 (#27): a removed post is never re-published
  }
  async softDeletePost(postId: string): Promise<void> {
    await transitionStatus(this.db as any, NAIL_SHOWCASE_POST, { where: { id: postId }, to: 'removed', set: { deleted_at: sql`now()`, updated_at: sql`now()` } });
  }

  async reactionOf(postId: string, customerId: string): Promise<NSReactionType | null> {
    const r: any = await this.db.selectFrom('nail_showcase_reactions').select('reaction_type').where('post_id', '=', postId).where('customer_id', '=', customerId).executeTakeFirst();
    return (r?.reaction_type as NSReactionType) ?? null;
  }
  async upsertReaction(postId: string, customerId: string, type: NSReactionType): Promise<void> {
    await this.db.insertInto('nail_showcase_reactions').values({ post_id: postId, customer_id: customerId, reaction_type: type } as any)
      .onConflict((oc) => oc.columns(['post_id', 'customer_id']).doUpdateSet({ reaction_type: type, updated_at: sql`now()` } as any)).execute();
  }
  async deleteReaction(postId: string, customerId: string): Promise<void> {
    await this.db.deleteFrom('nail_showcase_reactions').where('post_id', '=', postId).where('customer_id', '=', customerId).execute();
  }
  async syncReactionCounts(postId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const rows: any[] = await this.db.selectFrom('nail_showcase_reactions').select((eb) => ['reaction_type', eb.fn.countAll().as('c')]).where('post_id', '=', postId).groupBy('reaction_type').execute();
    let likeCount = 0, dislikeCount = 0;
    for (const r of rows) { if (r.reaction_type === 'like') likeCount = Number(r.c) || 0; else if (r.reaction_type === 'dislike') dislikeCount = Number(r.c) || 0; }
    await this.db.updateTable('nail_showcase_posts').set({ like_count: likeCount, dislike_count: dislikeCount, updated_at: sql`now()` } as any).where('id', '=', postId).execute();
    return { likeCount, dislikeCount };
  }

  async recentReactionActionCount(customerId: string, sinceIso: string): Promise<number> {
    // Current reaction rows for this customer touched within the window. Reacting across many distinct posts leaves a
    // row per post (counted); toggling one post nets ~0 rows, so this measures the cross-post spam rate, not churn.
    const row: any = await this.db.selectFrom('nail_showcase_reactions').select((eb) => eb.fn.countAll().as('c'))
      .where('customer_id', '=', customerId).where('updated_at', '>=', sinceIso as any).executeTakeFirst();
    return Number(row?.c) || 0;
  }
  async reactionsOf(postIds: string[], customerId: string): Promise<Map<string, NSReactionType>> {
    const m = new Map<string, NSReactionType>();
    if (!postIds.length) return m;
    const rows: any[] = await this.db.selectFrom('nail_showcase_reactions').select(['post_id', 'reaction_type']).where('post_id', 'in', postIds).where('customer_id', '=', customerId).execute();
    for (const r of rows) m.set(r.post_id, r.reaction_type);
    return m;
  }

  // Batch-resolve display names for the linkage IDs carried on posts (salon = tenant display_name, technician full_name,
  // service catalog name). Cheap: one query per kind over the distinct IDs in the current page. Soft-fails to empty.
  async resolveNames(input: { tenantIds: string[]; technicianIds: string[]; serviceIds: string[] }): Promise<{ salons: Map<string, string>; technicians: Map<string, string>; services: Map<string, string> }> {
    const salons = new Map<string, string>(), technicians = new Map<string, string>(), services = new Map<string, string>();
    const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));
    const [t, te, sv] = [uniq(input.tenantIds), uniq(input.technicianIds), uniq(input.serviceIds)];
    await Promise.all([
      t.length ? this.db.selectFrom('tenants').select(['id', 'display_name']).where('id', 'in', t).execute().then((rs: any[]) => rs.forEach((r) => salons.set(r.id, r.display_name))).catch(() => {}) : Promise.resolve(),
      te.length ? this.db.selectFrom('technicians').select(['id', 'full_name']).where('id', 'in', te).execute().then((rs: any[]) => rs.forEach((r) => technicians.set(r.id, r.full_name))).catch(() => {}) : Promise.resolve(),
      sv.length ? this.db.selectFrom('services').select(['id', 'name']).where('id', 'in', sv).execute().then((rs: any[]) => rs.forEach((r) => services.set(r.id, r.name))).catch(() => {}) : Promise.resolve(),
    ]);
    return { salons, technicians, services };
  }

  // Platform analytics/audit sink (the same audit_logs every module writes; surfaces in the Super Admin Audit Logs).
  async writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    await this.db.insertInto('audit_logs' as any).values({
      tenant_id: input.tenantId, branch_id: input.branchId, user_id: input.userId, role: input.role,
      action_type: input.actionType, entity_type: input.entityType, entity_id: input.entityId,
      metadata_json: input.metadata != null ? JSON.stringify(input.metadata) : null,
    } as any).execute();
  }

  // Customer bell/feed notification. Posts carry the author's userId, so resolve their customers.id; tenant-scoped only
  // (the customer_notifications feed requires a tenant), and a no-op when no salon/customer mapping exists.
  async notifyUser(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void> {
    // Crosses salons by design (notify a showcase author at THEIR salon when a customer at another salon reacts) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not silently drop it.
    return runAcrossTenants("notify a showcase author at THEIR salon when a customer at another salon reacts", () => this.__notifyUserUnscoped(input));
  }
  private async __notifyUserUnscoped(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void> {
    if (!input.tenantId) return;
    const c: any = await this.db.selectFrom('customers').select('id').where('user_id', '=', input.userId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!c) return;
    await this.db.insertInto('customer_notifications').values({
      tenant_id: input.tenantId, customer_id: c.id, type: input.type, title: input.title, body: input.body, reference: input.reference,
    } as any).execute();
  }

  async notifyTechnicianAuthor(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void> {
    if (!input.tenantId) return;
    const t: any = await this.db.selectFrom('technicians').select('id').where('user_id', '=', input.userId).where('tenant_id', '=', input.tenantId).where('archived_at', 'is', null).executeTakeFirst();
    if (!t) return;
    await this.db.insertInto('technician_notifications').values({ tenant_id: input.tenantId, technician_id: t.id, type: input.type, title: input.title, body: input.body, reference: input.reference } as any).execute();
  }

  async addComment(postId: string, customerId: string, text: string, parentId: string | null): Promise<NSCommentRecord> {
    const r: any = await this.db.insertInto('nail_showcase_comments').values({ post_id: postId, customer_id: customerId, comment_text: text, parent_comment_id: parentId, status: 'published' } as any).returningAll().executeTakeFirstOrThrow();
    return this.mapComment(r);
  }
  async comments(postId: string): Promise<NSCommentRecord[]> {
    const rows: any[] = await this.db.selectFrom('nail_showcase_comments').selectAll().where('post_id', '=', postId).where('status', '=', 'published').where('deleted_at', 'is', null).orderBy('created_at', 'asc').execute();
    return rows.map(this.mapComment);
  }
  async commentById(commentId: string): Promise<NSCommentRecord | null> {
    const r: any = await this.db.selectFrom('nail_showcase_comments').selectAll().where('id', '=', commentId).executeTakeFirst();
    return r ? this.mapComment(r) : null;
  }
  async setCommentStatus(commentId: string, status: NSCommentStatus): Promise<void> {
    await transitionStatus(this.db as any, NAIL_SHOWCASE_COMMENT, { where: { id: commentId }, to: status, set: { updated_at: sql`now()` } });
  }
  async softDeleteComment(commentId: string): Promise<void> {
    await transitionStatus(this.db as any, NAIL_SHOWCASE_COMMENT, { where: { id: commentId }, to: 'removed', set: { deleted_at: sql`now()`, updated_at: sql`now()` } });
  }
  async syncCommentCount(postId: string): Promise<number> {
    const r: any = await this.db.selectFrom('nail_showcase_comments').select((eb) => eb.fn.countAll().as('c')).where('post_id', '=', postId).where('status', '=', 'published').where('deleted_at', 'is', null).executeTakeFirst();
    const count = Number(r?.c) || 0;
    await this.db.updateTable('nail_showcase_posts').set({ comment_count: count, updated_at: sql`now()` } as any).where('id', '=', postId).execute();
    return count;
  }

  async addReport(row: NSNewReport): Promise<{ id: string }> {
    const r: any = await this.db.insertInto('nail_showcase_reports').values({
      post_id: row.postId, comment_id: row.commentId, tenant_id: row.tenantId, reported_by_customer_id: row.reportedByCustomerId,
      reported_by_user_id: row.reportedByUserId, reason: row.reason, details: row.details, status: 'open',
    } as any).returning('id').executeTakeFirstOrThrow();
    return { id: r.id };
  }
  async bumpPostReportCount(postId: string): Promise<void> {
    await this.db.updateTable('nail_showcase_posts').set({ report_count: sql`report_count + 1`, updated_at: sql`now()` } as any).where('id', '=', postId).execute();
  }
  async bumpCommentReportCount(commentId: string): Promise<void> {
    await this.db.updateTable('nail_showcase_comments').set({ report_count: sql`report_count + 1`, updated_at: sql`now()` } as any).where('id', '=', commentId).execute();
  }

  async moderationPosts(ctx: NailShowcaseContext, opts: { status?: NSPostStatus; reportedOnly?: boolean }): Promise<NSPostRecord[]> {
    let qb = this.db.selectFrom('nail_showcase_posts').selectAll().where('tenant_id', '=', ctx.tenantId).where('deleted_at', 'is', null);
    if (opts.status) qb = qb.where('status', '=', opts.status);
    if (opts.reportedOnly) qb = qb.where('report_count', '>', 0);
    const rows: any[] = await qb.orderBy('created_at', 'desc').limit(200).execute();
    return rows.map(this.mapPost);
  }
  async reportsList(ctx: NailShowcaseContext, platformWide: boolean) {
    let qb = this.db.selectFrom('nail_showcase_reports').selectAll().where('status', '=', 'open');
    if (!platformWide) qb = qb.where('tenant_id', '=', ctx.tenantId);
    const rows: any[] = await qb.orderBy('created_at', 'desc').limit(200).execute();
    return rows.map((r) => ({ id: r.id, postId: r.post_id ?? null, commentId: r.comment_id ?? null, reason: r.reason, details: r.details ?? null, status: r.status, createdAt: iso(r.created_at) }));
  }
  async resolveReport(reportId: string, status: string, resolvedByUserId: string): Promise<void> {
    await transitionStatus(this.db as any, NAIL_SHOWCASE_REPORT, { where: { id: reportId }, to: status as any, set: { resolved_by_user_id: resolvedByUserId, resolved_at: sql`now()`, updated_at: sql`now()` } });   // a decided report is not reopened
  }
  async reportTenantId(reportId: string): Promise<string | null | undefined> {
    const r: any = await this.db.selectFrom('nail_showcase_reports').select('tenant_id').where('id', '=', reportId).executeTakeFirst();
    return r ? r.tenant_id : undefined;
  }
}
