// tech-profile.service.ts — portable technician identity (tech-profile spec set, P1).
// Global profile follows the tech across salons; tech_salon_memberships connect it to tenants (a pending row IS the
// join/transfer request); salon business data never moves. Direct-db service in the customer-salons style.
import { runAcrossTenants } from '@aipowersalon/database';
import { readAppFlag, haversineMiles, recomputeTechRatingDenorm } from '@aipowersalon/customers';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { type EventName, EVENTS, REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { MediaStorage } from '@aipowersalon/media';
import { buildMediaUrl, acceptUpload, uploadObjectKey, UPLOAD_POLICIES, type UploadPolicy } from '@aipowersalon/media';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import {
  profileCompletionPercent, reviewerDisplayName, sanitizeProfileLinks, sanitizeRatingTags, sanitizeText, slugify,
  techRankingScore, validateImageUpload, sanitizeLinkVisibility, visibleLinksFor, sanitizePortfolioTaxonomy, sanitizeConsentUses, consentAllowsPublic,
} from './tech-profile-core';
import { computeAvailableSlots, resolveWindow, type ExistingForConflict } from '@aipowersalon/booking';
import { GlobalTechIdentityService, revokeBranchAccessRows } from './global-tech-identity.service';
import { revokeTechnicianAccess } from '../technicians/revoke-technician-access';
import { MediaAccessService } from './media-access.service';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { canMoveToSql, transitionStatus } from '@aipowersalon/database';
import { TECH_SALON_MEMBERSHIP, TECH_PORTFOLIO_PHOTO, TECH_DM_THREAD, TECH_DM_REPORT, NAIL_SHOWCASE_POST } from '../workforce-lifecycles';
import { requireUuidId } from '@aipowersalon/observability';
import {
  approvalTenantsFor, careerHistoryFor, decideProfileChange, holdProfileChanges, listPendingForTenant, myPendingChange,
  publicProfileStatus, sanitizePublicProfilePatch, splitProfilePatch, describeHeldChanges, withdrawPendingChange,
} from './profile-change-approval';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
/** Is this stored reference one of OUR namespaced keys for this profile (`global/tech-profiles/<profile>/<kind>/…`)? */
function ownsOurProfileKey(stored: unknown, profileId: string, kind: 'avatar' | 'cover'): boolean {
  const k = String(stored ?? '').replace(/^\/+/, '').replace(/^media\//, '');
  return !!k && k.startsWith(`global/tech-profiles/${profileId}/${kind}/`);
}
/** The storage key of an image this profile owns, else null — for deletes. Oct 20 2026: deletePhoto / deleteBeforeAfter
 *  still matched the pre-Phase-12 prefix `tech-profiles/<profile>/`, so every delete left the file in storage. One rule now:
 *  only `global/tech-profiles/<profile>/…` (never another profile's key, never a path climbing out). */
function ownedProfileImageKey(stored: unknown, profileId: string): string | null {
  const k = String(stored ?? '').split('?')[0].replace(/^\/+/, '').replace(/^media\//, '');
  return k && !k.includes('..') && k.startsWith(`global/tech-profiles/${profileId}/`) ? k : null;
}

export class TechProfileError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export interface TechProfileCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

const rand = () => Math.random().toString(36).slice(2, 6);

@Injectable()
export class TechProfileService {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase,
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null,
    @Optional() @Inject(REALTIME) private readonly realtime?: RealtimeEmitter,
    @Optional() @Inject(GlobalTechIdentityService) private readonly identity?: GlobalTechIdentityService,
    // Constitution 8: optional and null-safe. When present, the primary write of each flow commits WITH its
    // domain event and the service stops pushing realtime by hand (the projection consumer carries it).
    @Optional() @Inject(OutboxWriter) private readonly outbox?: OutboxWriter | null,
    @Optional() @Inject(MediaAccessService) private readonly media?: MediaAccessService,
  ) {}
  /** Short-lived signed URL for NON-public media (owner / manager views). Public media keeps the plain cacheable URL. */
  private privateUrl(stored: string | null | undefined): string | null {
    if (!stored) return null;
    return (this.media ?? new MediaAccessService(null)).signedUrl(stored) ?? buildMediaUrl(stored);
  }
  /** Self-declared certifications are the technician's own words — the public payload must say so. */
  private publicCertifications(raw: unknown): { name: string; verified: false }[] {
    const list = this.j(raw, []);
    return (Array.isArray(list) ? list : []).map((c: any) => (typeof c === 'string' ? c : c?.name)).filter((n: any) => typeof n === 'string' && n.trim())
      .map((name: string) => ({ name, verified: false as const }));
  }
  private emitsDomainEvents(): boolean { return projectionDeliversRealtime(!!this.outbox); }   // not merely "has an outbox": the publisher must be ON
  private store(): MediaStorage { if (!this.storage) throw withCode(new TechProfileError('unavailable', 'Media storage is not configured.'), 'FEATURE_NOT_AVAILABLE'); return this.storage; }
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new TechProfileError('unavailable', 'Tech profiles require a database.'); return this.db; }

  /** A fact that concerns a whole SALON (a membership request to it, a held edit it must review — no branch of its own).
   *  B-14 (Oct 20 2026): recorded as a domain event on THAT salon's envelope, with its branch ids, on the executor of the
   *  write it belongs to — the projection's salon scope reaches the owner room, the branch-less room and every branch
   *  room. The per-branch direct push is the §343 fallback for a publisher that is off. */
  private async salonWide(exec: any, tenantId: string, ev: { eventType: string; aggregateType: string; aggregateId: string; actorId?: string | null; clientEvent: EventName; payload: Record<string, unknown> }) {
    const branches: any[] = await exec.selectFrom('branches').where('tenant_id', '=', tenantId).select(['id']).execute().catch(() => []);
    const branchIds = branches.map((b) => String(b.id));
    if (this.outbox) await this.outbox.write(exec, createDomainEvent({
      eventType: ev.eventType as any, tenantId, aggregateType: ev.aggregateType, aggregateId: ev.aggregateId,
      actorId: /^[0-9a-f-]{36}$/i.test(ev.actorId || '') ? ev.actorId! : undefined, actorType: ev.actorId ? 'user' : 'system',
      payload: { ...ev.payload, branchIds },
    }));
    if (!this.emitsDomainEvents()) for (const b of branchIds) this.realtime?.toTenant({ tenantId, branchId: b } as any, ev.clientEvent, ev.payload);
  }

  /** Resolve the session user's technician row in the current tenant. */
  private async myTechnician(ctx: TechProfileCtx) {
    const t: any = await (this.need() as any).selectFrom('technicians')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true)
      .select(['id', 'branch_id', 'full_name', 'avatar_url', 'global_tech_profile_id']).executeTakeFirst();
    if (!t) throw withCode(new TechProfileError('not_technician', 'No technician profile is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    return t;
  }

  private async loadProfile(id: string) {
    const p: any = await (this.need() as any).selectFrom('global_tech_profiles').where('id', '=', id).selectAll().executeTakeFirst();
    if (!p) throw withCode(new TechProfileError('not_found', 'Profile not found.'), 'PROFILE_NOT_FOUND');
    return p;
  }

  private j(x: any, fallback: any) { try { return typeof x === 'string' ? JSON.parse(x) : (x ?? fallback); } catch { return fallback; } }

  private async shape(p: any, ctx?: TechProfileCtx, opts?: { membershipsForTenantOnly?: boolean }) {
    const db = this.need() as any;
    const services = ctx ? await db.selectFrom('technician_services as ts').innerJoin('technicians as t', 't.id', 'ts.technician_id')
      .innerJoin('services as s', 's.id', 'ts.service_id')
      .where('t.global_tech_profile_id', '=', p.id).where('t.tenant_id', '=', ctx.tenantId).where('s.status', '=', 'active')
      .orderBy('ts.is_primary', 'desc').orderBy('s.name', 'asc')
      .select(['ts.service_id', 's.name', 'ts.is_primary']).execute().catch(() => []) : [];
    const links = this.j(p.profile_links, {});
    const specialties = this.j(p.specialties, []);
    let mq = db.selectFrom('tech_salon_memberships as m').innerJoin('tenants as tn', 'tn.id', 'm.tenant_id')
      .where('m.global_tech_profile_id', '=', p.id);
    // A manager's projection carries THIS salon's membership only — never the names/ids of the other salons the
    // technician works at (posViewTechProfile reports a count of those, nothing more).
    if (opts?.membershipsForTenantOnly && ctx?.tenantId) mq = mq.where('m.tenant_id', '=', ctx.tenantId);
    const memberships: any[] = await mq.select(['m.id', 'm.tenant_id', 'm.branch_id', 'm.status', 'm.created_at', 'tn.display_name']).execute().catch(() => []);
    
    return {
      profileId: p.id, publicSlug: p.public_slug, displayName: p.display_name, title: p.title, avatarUrl: buildMediaUrl(p.avatar_url),
      coverUrl: buildMediaUrl(p.cover_url), certifications: this.j(p.certifications, []), styleTags: this.j(p.style_tags, []),
      verificationStatus: p.verification_status ?? 'unverified',
      bio: p.bio, yearsExperience: p.years_experience, specialties, languages: this.j(p.languages, []), profileLinks: links,
      profileLinkVisibility: this.j(p.profile_link_visibility, {}),
      isPublic: !!p.is_public, isBookable: !!p.is_bookable, marketplaceDiscoveryEnabled: !!p.marketplace_discovery_enabled, acceptsMessages: p.accepts_messages !== false,
      overallRating: p.overall_rating != null ? Number(p.overall_rating) : null, ratingCount: Number(p.rating_count ?? 0),
      portfolioPhotoCount: Number(p.portfolio_photo_count ?? 0), verifiedCompletedServicesCount: Number(p.verified_completed_services_count ?? 0),
      completionPercent: profileCompletionPercent({ avatarUrl: p.avatar_url, bio: p.bio, portfolioPhotoCount: Number(p.portfolio_photo_count ?? 0), servicesCount: services.length, specialtiesCount: specialties.length, linksCount: Object.keys(links).length }),
      servicesHere: services.map((x: any) => ({ serviceId: x.service_id, name: x.name, isPrimary: !!x.is_primary })),
      memberships: memberships.map((m) => ({ membershipId: m.id, tenantId: m.tenant_id, branchId: m.branch_id, salonName: m.display_name, status: m.status, requestedAt: new Date(m.created_at).toISOString() })),
      // Technician Profile mandate §53 (one status word), §62 (her consent switch), §95 (edits a salon is still reviewing)
      publicProfileStatus: publicProfileStatus(p), careerHistoryPublic: !!p.career_history_public,
      pendingChanges: await myPendingChange(db, p.id),
    };
  }

  /**
   * GET /tech/profile — load or CREATE the portable profile, seeded from the salon technician record.
   *
   * Creation goes THROUGH GlobalTechIdentityService — the one minter. This method used to insert into
   * global_tech_profiles itself: no tech_code (NOT NULL since 376, so it 500'd), no normalized phone/email keys
   * (so the next salon could never recognise her and minted a second account), no lookup for an account she
   * already had. The identity service does all three, and refuses to link a paused/locked/suspended account.
   */
  async getOrCreateMyProfile(ctx: TechProfileCtx) {
    const t = await this.myTechnician(ctx);
    if (t.global_tech_profile_id) return this.shape(await this.loadProfile(t.global_tech_profile_id), ctx);
    if (!this.identity?.available) throw new TechProfileError('unavailable', 'Technician identity is not configured.');
    const row: any = await (this.need() as any).selectFrom('technicians')
      .where('id', '=', t.id).where('tenant_id', '=', ctx.tenantId)
      .select(['normalized_phone', 'email']).executeTakeFirst();
    try {
      const { profileId } = await this.identity.claimProfileForSessionTechnician(ctx as any, {
        id: t.id, branchId: t.branch_id ?? null, fullName: String(t.full_name || 'Nail Tech'), avatarUrl: t.avatar_url ?? null,
        normalizedPhone: row?.normalized_phone ?? null, email: row?.email ?? null,
      });
      return this.shape(await this.loadProfile(profileId), ctx);
    } catch (e: any) {
      if (e?.name === 'GlobalTechIdentityError') throw new TechProfileError(e.code, e.message);
      throw e;
    }
  }

  /** PATCH /tech/profile — tech-editable public fields ONLY (never ratings/payroll/role). */
  async updateMyProfile(ctx: TechProfileCtx, patch: any) {
    const db = this.need() as any;
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) await this.getOrCreateMyProfile(ctx);
    const fresh = await this.myTechnician(ctx);
    // §95: public CONTENT may be held for a manager's approval; her own switches never are. ONE sanitiser for both paths.
    const { publicFields, switches } = splitProfilePatch(patch ?? {});
    let publicSet: Record<string, unknown> = {};
    try { publicSet = sanitizePublicProfilePatch(publicFields); } catch (e: any) { throw new TechProfileError(e?.code === 'invalid' ? 'invalid' : 'invalid', e?.message ?? 'Invalid profile change.'); }
    const set: any = { updated_at: new Date() };
    let held: { requestId: string; changes: Record<string, unknown> } | null = null;
    if (Object.keys(publicSet).length) {
      const reviewers = await approvalTenantsFor(db, fresh.global_tech_profile_id);
      if (reviewers.length) held = await holdProfileChanges(db, { profileId: fresh.global_tech_profile_id, set: publicSet, requestedByUserId: /^[0-9a-f-]{36}$/i.test(ctx.userId || '') ? ctx.userId : null, requestedInTenantId: ctx.tenantId });
      else Object.assign(set, publicSet);
    }
    if (switches.isPublic !== undefined) set.is_public = !!switches.isPublic;
    if (switches.marketplaceDiscoveryEnabled !== undefined) set.marketplace_discovery_enabled = !!switches.marketplaceDiscoveryEnabled;
    if (switches.acceptsMessages !== undefined) set.accepts_messages = !!switches.acceptsMessages;
    if (switches.isBookable !== undefined) set.is_bookable = !!switches.isBookable;
    if (switches.careerHistoryPublic !== undefined) set.career_history_public = !!switches.careerHistoryPublic;   // §62 — hers alone
    if (Object.keys(set).length > 1) await db.updateTable('global_tech_profiles').set(set).where('id', '=', fresh.global_tech_profile_id).execute();
    await this.audit(ctx, held ? 'tech_profile_change_held' : 'tech_profile_updated', fresh.id, { profileId: fresh.global_tech_profile_id, fields: Object.keys(set).filter((k) => k !== 'updated_at'), heldFields: held ? Object.keys(describeHeldChanges(held.changes)) : undefined, requestId: held?.requestId });
    if (held) await this.emitTenantWideToReviewers(fresh.global_tech_profile_id, { profileId: fresh.global_tech_profile_id, requestId: held.requestId }, ctx.userId);
    if (set.profile_links !== undefined || set.profile_link_visibility !== undefined) {
      await this.audit(ctx, 'tech_social_links_updated', fresh.id, {
        profileId: fresh.global_tech_profile_id,
        links: set.profile_links !== undefined ? Object.keys(sanitizeProfileLinks(patch.profileLinks)) : undefined,
        visibility: set.profile_link_visibility !== undefined ? sanitizeLinkVisibility(patch.profileLinkVisibility) : undefined,
      });
    }
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techProfileUpdated as any, { technicianId: fresh.id, profileId: fresh.global_tech_profile_id });
    return this.shape(await this.loadProfile(fresh.global_tech_profile_id), ctx);
  }

  /** POST /tech/profile/membership-request — "Connect to New Salon" by salon code; pending row IS the request. */
  async requestMembership(ctx: TechProfileCtx, salonCode: string, message?: string, opts: { transfer?: boolean } = {}) {
    const db = this.need() as any;
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) await this.getOrCreateMyProfile(ctx);
    const fresh = await this.myTechnician(ctx);
    const code = String(salonCode || '').trim().toUpperCase();
    if (!code) throw withCode(new TechProfileError('invalid', 'Enter the salon code.'), 'SALON_CODE_REQUIRED');
    const target: any = await db.selectFrom('tenants').where('tenant_code', '=', code).where('status', '=', 'active')
      .select(['id', 'display_name']).executeTakeFirst();
    if (!target) throw withCode(new TechProfileError('not_found', 'No active AIPowerSalon salon matches that code.'), 'SALON_CODE_UNKNOWN');
    if (target.id === ctx.tenantId) throw withCode(new TechProfileError('invalid', 'You already work at this salon.'), 'ALREADY_WORK_HERE');
    const existing: any = await db.selectFrom('tech_salon_memberships')
      .where('global_tech_profile_id', '=', fresh.global_tech_profile_id).where('tenant_id', '=', target.id)
      .select(['id', 'status']).executeTakeFirst();
    // §60 "Technician Requests Transfer": the request carries the salon she is LEAVING (the session's salon — never a
    // client-supplied id). Nothing ends at the old salon now; the departure happens when the new salon approves (the
    // technician's own consent is this request), in the same transaction as the new employment.
    const transferFrom = opts.transfer ? ctx.tenantId : null;
    if (existing && (existing.status === 'pending_salon_approval' || existing.status === 'active')) {
      return { ok: true as const, status: existing.status, salonName: target.display_name, message: existing.status === 'pending_salon_approval' ? 'Your request is already waiting for that salon to approve.' : 'You are already connected to that salon.' };
    }
    // B-14: the request row and its technician.membership_requested commit together (on the salon asked, §18/§60)
    await db.transaction().execute(async (trx: any) => {
      let requestId: string;
      if (existing) {
        // Phase 12 (#27): a Super-Admin PAUSED (or platform-suspended) membership is not turned into a request by the technician
        await transitionStatus(trx, TECH_SALON_MEMBERSHIP, { where: { id: existing.id }, from: existing.status, to: 'pending_salon_approval', set: { message: sanitizeText(message, 300), requested_by_user_id: ctx.userId, approved_by_user_id: null, end_date: null, transfer_from_tenant_id: transferFrom, updated_at: new Date() } });
        requestId = String(existing.id);
      } else {
        const ins: any = await trx.insertInto('tech_salon_memberships').values({
          global_tech_profile_id: fresh.global_tech_profile_id, tenant_id: target.id, branch_id: null,
          status: 'pending_salon_approval', message: sanitizeText(message, 300), requested_by_user_id: ctx.userId,
          transfer_from_tenant_id: transferFrom,
        } as any).returning(['id']).executeTakeFirstOrThrow();
        requestId = String(ins.id);
      }
      await this.salonWide(trx, target.id, { eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REQUESTED, aggregateType: 'tech_salon_membership', aggregateId: requestId, actorId: ctx.userId,
        clientEvent: EVENTS.techMembershipRequested, payload: { profileId: fresh.global_tech_profile_id, transfer: !!transferFrom } });
    });
    await this.audit(ctx, transferFrom ? 'tech_transfer_requested' : 'tech_salon_membership_requested', fresh.id, { profileId: fresh.global_tech_profile_id, toTenantId: target.id, transfer: !!transferFrom });
    return { ok: true as const, status: 'pending_salon_approval' as const, salonName: target.display_name, transfer: !!transferFrom,
      message: transferFrom
        ? `Transfer request sent — when ${target.display_name} approves, you move there and your employment here ends. Your profile, portfolio and reviews go with you.`
        : `Request sent — ${target.display_name} must approve before your profile connects.` };
  }

  /** GET /tech/profile/ratings — my public rating summary + recent verified reviews (reviewer privacy applied). */
  async myRatings(ctx: TechProfileCtx) {
    const db = this.need() as any;
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) await this.getOrCreateMyProfile(ctx);
    const fresh = await this.myTechnician(ctx);
    const p = await this.loadProfile(fresh.global_tech_profile_id);
    const rows: any[] = await db.selectFrom('reviews as r')
      .leftJoin('customers as c', 'c.id', 'r.customer_id')
      .where('r.global_tech_profile_id', '=', fresh.global_tech_profile_id)
      .where('r.is_hidden_by_manager', '=', false)
      .select(['r.id', 'r.rating', 'r.comment', 'r.review_tags', 'r.is_public', 'r.created_at', 'c.full_name', 'r.technician_response', 'r.technician_response_at'])
      .orderBy('r.created_at', 'desc').limit(20).execute().catch(() => []);
    const breakdown: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    const dist: any[] = await db.selectFrom('reviews').where('global_tech_profile_id', '=', fresh.global_tech_profile_id)
      .where('is_hidden_by_manager', '=', false).select(['rating', db.fn.count('id').as('n')]).groupBy('rating').execute().catch(() => []);
    for (const r of dist) { const k = String(Math.max(1, Math.min(5, Math.round(Number(r.rating))))); breakdown[k] += Number(r.n); }
    return {
      overallRating: p.overall_rating != null ? Number(p.overall_rating) : null,
      ratingCount: Number(p.rating_count ?? 0),
      breakdown,
      recent: rows.map((r) => ({
        ratingId: r.id, rating: Number(r.rating), comment: r.comment, tags: this.j(r.review_tags, []),
        reviewer: reviewerDisplayName(r.full_name, !r.is_public), createdAt: new Date(r.created_at).toISOString(),
        response: r.technician_response ?? null, respondedAt: r.technician_response_at ? new Date(r.technician_response_at).toISOString() : null,
      })),
    };
  }

  /**
   * POST /tech/profile/ratings/:reviewId/respond — the technician posts (or clears) ONE public response to a review on
   * their own global profile. Ownership is by global_tech_profile_id, so it works across every salon they've worked at.
   * The technician can never touch the customer's rating or comment — only this response field. An empty body clears it.
   */
  async respondToReview(ctx: TechProfileCtx, reviewId: string, responseText: string) {
    const db = this.need() as any;
    const fresh = await this.myTechnician(ctx);
    if (!fresh.global_tech_profile_id) { await this.getOrCreateMyProfile(ctx); }
    const gtp = (await this.myTechnician(ctx)).global_tech_profile_id;
    const row: any = await db.selectFrom('reviews').where('id', '=', reviewId)
      .select(['id', 'global_tech_profile_id']).executeTakeFirst();
    if (!row || row.global_tech_profile_id !== gtp) throw withCode(new TechProfileError('not_found', 'Review not found on your profile.'), 'REVIEW_NOT_FOUND');
    const text = sanitizeText(String(responseText ?? ''), 1000);
    await db.updateTable('reviews').set({
      technician_response: text || null, technician_response_at: text ? (new Date() as any) : null, updated_at: new Date() as any,
    } as any).where('id', '=', reviewId).execute();
    await this.audit(ctx, text ? 'tech_review_response_posted' : 'tech_review_response_cleared', fresh.id, { reviewId });
    return this.myRatings(ctx);
  }

  // ───────────────────────────── P3 — POS / Manager surfaces (tenant-scoped) ─────────────────────────────

  private async audit(ctx: TechProfileCtx, action: string, technicianId: string | null, metadata: Record<string, unknown>) {
    await (this.need() as any).insertInto('technician_audit_logs').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: technicianId, user_id: ctx.userId,
      action, ticket_id: null, metadata: JSON.stringify(metadata),
    } as any).execute().catch(() => {});
  }

  /** Technician row in MY tenant (manager view) — tenant isolation enforced here. */
  private async tenantTechnician(ctx: TechProfileCtx, technicianId: string) {
    const t: any = await (this.need() as any).selectFrom('technicians')
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId)
      .select(['id', 'branch_id', 'full_name', 'avatar_url', 'user_id', 'global_tech_profile_id']).executeTakeFirst();
    if (!t) throw withCode(new TechProfileError('not_found', 'Technician not found in this salon.'), 'TECHNICIAN_NOT_FOUND');
    return t;
  }

  /** Recompute the public rating denorm on the global profile — the ONE shared formula (reviews.kysely.repository). */
  private async recomputeRatingDenorm(profileId: string) {
    await recomputeTechRatingDenorm(this.need() as any, profileId);
  }

  /** GET /pos/technicians/:id/profile — full manager view: profile + ALL photos (any moderation state) + ratings summary. */
  async posViewTechProfile(ctx: TechProfileCtx, technicianId: string) {
    const t = await this.tenantTechnician(ctx, technicianId);
    if (!t.global_tech_profile_id) {
      // Consent before link: an existing technician the salon invited has a membership awaiting HER acceptance, and
      // until she accepts, the salon sees that an invitation is pending — not her portable profile.
      const pending: any = await (this.need() as any).selectFrom('tech_salon_memberships').where('tenant_id', '=', ctx.tenantId)
        .where('technician_id', '=', t.id).where('status', 'in', ['pending_tech_approval', 'pending_invite'])
        .select(['id', 'status', 'created_at']).executeTakeFirst().catch(() => null);
      if (pending) {
        return { hasProfile: false as const, invitationPending: true as const, technicianId: t.id, displayName: t.full_name,
          membershipHereStatus: pending.status, invitedAt: new Date(pending.created_at).toISOString(),
          message: 'Invitation pending — this technician has an AIPowerSalon profile and must accept your salon before it connects here.' };
      }
      return { hasProfile: false as const, invitationPending: false as const, technicianId: t.id, displayName: t.full_name, message: 'This technician has not created an AIPowerSalon profile yet.' };
    }
    const p = await this.loadProfile(t.global_tech_profile_id);
    const db: any = this.need();
    const photos: any[] = await db.selectFrom('tech_portfolio_photos').where('global_tech_profile_id', '=', p.id)
      .orderBy('is_featured', 'desc').orderBy('sort_order', 'asc').orderBy('created_at', 'desc').selectAll().execute();
    // tenant_id + status only — the salon NAMES of the other memberships are never selected here, so they cannot leak
    const memberships: any[] = await db.selectFrom('tech_salon_memberships as m')
      .where('m.global_tech_profile_id', '=', p.id)
      .select(['m.tenant_id', 'm.status', 'm.is_featured']).execute();
    const hides: any[] = await db.selectFrom('tech_portfolio_photo_tenant_hides').where('tenant_id', '=', ctx.tenantId)
      .where('photo_id', 'in', photos.length ? photos.map((x) => x.id) : ['00000000-0000-0000-0000-000000000000'])
      .select(['photo_id', 'reason']).execute().catch(() => []);
    const hiddenHere = new Map<string, string | null>(hides.map((h) => [h.photo_id, h.reason ?? null]));
    await this.audit(ctx, 'tech_profile_viewed', t.id, { profileId: p.id });
    const here = memberships.find((m) => m.tenant_id === ctx.tenantId);
    const shaped = await this.shape(p, ctx, { membershipsForTenantOnly: true });
    return {
      hasProfile: true as const, technicianId: t.id,
      profile: { ...shaped, isFeaturedHere: !!here?.is_featured },
      // The manager sees every photo (any state) — through SIGNED urls, because non-public media is no longer served openly.
      photos: photos.map((ph) => ({
        photoId: ph.id, imageUrl: this.privateUrl(ph.image_url), thumbnailUrl: this.privateUrl(ph.thumbnail_url), caption: ph.caption,
        tags: this.j(ph.tags, []), serviceCategory: ph.service_category, isPublic: !!ph.is_public, isFeatured: !!ph.is_featured,
        moderationStatus: ph.moderation_status, sortOrder: ph.sort_order, createdAt: new Date(ph.created_at).toISOString(),
        hiddenHere: hiddenHere.has(ph.id), hiddenHereReason: hiddenHere.get(ph.id) ?? null,
        nailShape: ph.nail_shape, nailLength: ph.nail_length, designStyle: ph.design_style, complexity: ph.complexity, brand: ph.brand, colorName: ph.color_name,
      })),
      membershipHereStatus: here?.status ?? 'none',
      // A COUNT — never the names. This used to be:
      //
      //     otherActiveSalons: memberships.filter(…).map((m) => m.salon_name)
      //
      // …which handed every manager on the platform the NAMES of the competing salons their technician also
      // works at, and pos-web rendered them: "Also active at: Palace Nails".
      //
      // The spec is explicit — a manager may not "view private data from other salons" — and it is the exact
      // disclosure the new POST /pos/technicians/lookup was built to refuse. Two surfaces answering the same
      // question two different ways is not a policy; it is the absence of one. They agree now: a manager learns
      // THAT she works elsewhere, which is her business and affects their scheduling, and not WHERE, which is
      // hers and the other salon's.
      otherActiveSalonCount: memberships.filter((m) => m.tenant_id !== ctx.tenantId && m.status === 'active').length,
    };
  }

  /**
   * Photo moderation — SCOPED TO THIS SALON. approve = show here again; hidden/rejected = do not show on THIS salon's
   * surfaces. The global moderation_status is never touched by a tenant manager: a portfolio belongs to the
   * technician's global profile, and one salon's decision must not hide a photo on every other salon's page or on
   * the technician's own public profile (migration 456).
   */
  async posModeratePhoto(ctx: TechProfileCtx, technicianId: string, photoId: string, status: 'approved' | 'hidden' | 'rejected', reason?: string) {
    if (!['approved', 'hidden', 'rejected'].includes(status)) throw new TechProfileError('invalid', 'Unknown moderation action.');
    const t = await this.tenantTechnician(ctx, technicianId);
    if (!t.global_tech_profile_id) throw withCode(new TechProfileError('not_found', 'This technician has no profile.'), 'TECHNICIAN_NO_PROFILE');
    const db: any = this.need();
    const ph: any = await db.selectFrom('tech_portfolio_photos').where('id', '=', photoId)
      .where('global_tech_profile_id', '=', t.global_tech_profile_id).select(['id']).executeTakeFirst();
    if (!ph) throw withCode(new TechProfileError('not_found', 'Photo not found for this technician.'), 'PHOTO_NOT_FOUND');
    // PER-TENANT moderation (574; mandate §44): a portfolio photo belongs to the technician's GLOBAL profile. A salon
    // decides what appears on ITS surfaces (tech_portfolio_photo_tenant_hides), never on everybody else's — the global
    // moderation_status is the technician's (publish/unpublish) and the Super Admin's (platform policy).
    if (status === 'approved') {
      await db.deleteFrom('tech_portfolio_photo_tenant_hides').where('photo_id', '=', photoId).where('tenant_id', '=', ctx.tenantId).execute();
    } else {
      await db.insertInto('tech_portfolio_photo_tenant_hides').values({
        photo_id: photoId, tenant_id: ctx.tenantId, hidden_by_user_id: ctx.userId || null, reason: sanitizeText(String(reason ?? ''), 300) || null,
      } as any).onConflict((oc: any) => oc.columns(['photo_id', 'tenant_id']).doUpdateSet({ hidden_by_user_id: ctx.userId || null, reason: sanitizeText(String(reason ?? ''), 300) || null } as any)).execute();
    }
    await this.refreshPhotoCount(t.global_tech_profile_id);
    await this.audit(ctx, status === 'approved' ? 'tech_portfolio_photo_approved' : 'tech_portfolio_photo_hidden', t.id, { photoId, status, scope: 'tenant' });
    return { ok: true as const, photoId, hiddenHere: status !== 'approved' };
  }

  /** GET /pos/technician-membership/requests — pending join/transfer requests into MY salon. */
  async posListMembershipRequests(ctx: TechProfileCtx) {
    const rows: any[] = await (this.need() as any).selectFrom('tech_salon_memberships as m')
      .innerJoin('global_tech_profiles as p', 'p.id', 'm.global_tech_profile_id')
      .where('m.tenant_id', '=', ctx.tenantId).where('m.status', '=', 'pending_salon_approval')
      .select(['m.id', 'm.message', 'm.created_at', 'm.transfer_from_tenant_id', 'p.id as profile_id', 'p.display_name', 'p.public_slug', 'p.avatar_url',
        'p.overall_rating', 'p.rating_count', 'p.portfolio_photo_count', 'p.years_experience']).orderBy('m.created_at', 'asc').execute();
    return {
      requests: rows.map((r) => ({
        requestId: r.id, profileId: r.profile_id, displayName: r.display_name, publicSlug: r.public_slug, avatarUrl: buildMediaUrl(r.avatar_url),
        overallRating: Number(r.overall_rating ?? 0), ratingCount: Number(r.rating_count ?? 0),
        portfolioPhotoCount: Number(r.portfolio_photo_count ?? 0), yearsExperience: r.years_experience,
        message: r.message, requestedAt: new Date(r.created_at).toISOString(),
        // a transfer: approving it ends her employment at her current salon. WHICH salon is not shown (§61 — the new
        // salon learns nothing about the old one).
        isTransfer: !!r.transfer_from_tenant_id,
      })),
    };
  }

  /** Approve/reject a membership request. Approval creates (or links) the technicians row in THIS tenant. */
  async posDecideMembershipRequest(ctx: TechProfileCtx, requestId: string, decision: 'approve' | 'reject') {
    if (decision !== 'approve' && decision !== 'reject') throw new TechProfileError('invalid', 'Decision must be approve or reject.');
    const db: any = this.need();
    const req: any = await db.selectFrom('tech_salon_memberships').where('id', '=', requestId)
      .where('tenant_id', '=', ctx.tenantId).selectAll().executeTakeFirst();
    if (!req) throw withCode(new TechProfileError('not_found', 'Membership request not found.'), 'MEMBERSHIP_REQUEST_NOT_FOUND');
    if (req.status !== 'pending_salon_approval') throw withCode(new TechProfileError('invalid_state', `This request was already ${req.status}.`), 'REQUEST_ALREADY_DECIDED');
    const profile = await this.loadProfile(req.global_tech_profile_id);

    if (decision === 'reject') {
      await db.transaction().execute(async (trx: any) => {
        await transitionStatus(trx, TECH_SALON_MEMBERSHIP, { where: { id: requestId }, from: 'pending_salon_approval', to: 'rejected', set: { approved_by_user_id: ctx.userId, updated_at: new Date() } });
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REJECTED, tenantId: ctx.tenantId, aggregateType: 'tech_salon_membership', aggregateId: requestId,
          actorId: ctx.userId, actorType: 'user', payload: { requestId, profileId: profile.id, status: 'rejected' } }));
      });
      await this.audit(ctx, 'tech_salon_membership_rejected', null, { requestId, profileId: profile.id });
      if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techMembershipRejected as any, { requestId, profileId: profile.id });
      const homes: any[] = await db.selectFrom('technicians').where('global_tech_profile_id', '=', profile.id)
        .where('is_active', '=', true).select(['id', 'tenant_id']).execute();
      for (const h of homes) {
        await db.insertInto('technician_notifications').values({
          tenant_id: h.tenant_id, technician_id: h.id, type: 'membership_rejected',
          title: 'Salon request declined', body: 'Your request to connect to a new salon was declined.', reference: null,
        } as any).execute().catch(() => {});
      }
      return { ok: true as const, status: 'rejected' as const, displayName: profile.display_name };
    }

    // approve: the technician gets a login IN THIS SALON, a technicians row here, and an active membership.
    //
    // == THE DEFECT THIS FIXES ==============================================================================
    //
    // This used to write `user_id: profile.user_id` — the users row from whichever salon the technician FIRST
    // logged in at. Under the per-salon login model that id does not exist in THIS tenant, so the Tech App's
    //
    //     select … from technicians where tenant_id = <this salon> and user_id = <session user id>
    //
    // could never match. An approved transfer produced a technician who could not open the app at the salon
    // that had just approved them — the feature's entire purpose, dead on arrival and silent about it.
    //
    // It then grew its OWN copy of "make the membership real" (find-or-insert the technicians row, 40% commission
    // literal, no branch grant) beside materializeMembership's. One transaction, one implementation: the
    // membership goes active (only from pending — a concurrent reject / cancel wins with a 409) and
    // GlobalTechIdentityService.materializeMembership gives it its login, its roster row (ONE per salon —
    // uq_technicians_tenant_gtp_live, 577) and its branch grant, or none of it happens.
    if (!this.identity?.available) throw new TechProfileError('unavailable', 'Technician identity is not configured.');
    const identity = this.identity;
    const pStatus = String(profile.status ?? 'active');
    if (pStatus !== 'active') throw withCode(new TechProfileError('invalid_state', `This technician’s platform account is ${pStatus}; it cannot be approved into a salon.`), 'TECHNICIAN_ACCOUNT_INACTIVE');

    // §60 a technician-requested TRANSFER: her consent is the request itself (requested_by = her own login at the
    // salon she is leaving). Approval moves her: the new employment and the old one's end commit together. A request
    // that names a source salon but was NOT made by her (never written by this code) is treated as a plain join.
    const transferFrom: string | null = req.transfer_from_tenant_id ? String(req.transfer_from_tenant_id) : null;
    const selfRequestedTransfer = !!transferFrom && transferFrom !== ctx.tenantId && !!req.requested_by_user_id
      && !!(await db.selectFrom('users').where('id', '=', req.requested_by_user_id).where('tenant_id', '=', transferFrom)
        .where('global_tech_profile_id', '=', profile.id).select('id').executeTakeFirst());
    if (selfRequestedTransfer) {
      const blocker = await identity.departureBlocker(db, profile.id, transferFrom!);
      if (blocker) throw new TechProfileError('TRANSFER_NOT_ALLOWED', blocker.message);
    }

    const tech: { id: string } = await db.transaction().execute(async (trx: any) => {
      // Phase 12 (#27): only the pending request is approved (a concurrent reject / cancel wins with a 409, not a lost update)
      await transitionStatus(trx, TECH_SALON_MEMBERSHIP, { where: { id: requestId, tenant_id: ctx.tenantId }, from: 'pending_salon_approval', to: 'active', set: { approved_by_user_id: ctx.userId, start_date: new Date() as any, updated_at: new Date() as any } });
      let made: { technicianId: string } | null;
      try {
        made = await identity.materializeMembership(ctx.tenantId, requestId, trx);
      } catch (e: any) {
        if (e?.name === 'GlobalTechIdentityError') throw new TechProfileError(e.code, e.message);
        throw e;
      }
      if (!made) throw withCode(new TechProfileError('not_found', 'Membership request not found.'), 'MEMBERSHIP_REQUEST_NOT_FOUND');
      if (selfRequestedTransfer) {
        await identity.endEmployment(trx, { profileId: profile.id, tenantId: transferFrom!, reason: 'transferred', requestId,
          actorUserId: req.requested_by_user_id, actorRole: 'TECHNICIAN' });
      }
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_APPROVED, tenantId: ctx.tenantId, aggregateType: 'tech_salon_membership', aggregateId: requestId,
        actorId: ctx.userId, actorType: 'user', payload: { requestId, technicianId: made.technicianId, profileId: profile.id, status: 'active' } }));
      return { id: made.technicianId };
    });
    await db.insertInto('technician_notifications').values({
      tenant_id: ctx.tenantId, technician_id: tech.id, type: 'membership_approved',
      title: 'Salon membership approved', body: 'Your profile is now connected to this salon. Welcome!', reference: null,
    } as any).execute().catch(() => {});
    if (selfRequestedTransfer) {
      await identity.afterDeparture({ profileId: profile.id, tenantId: transferFrom!, reason: 'transferred', actorUserId: req.requested_by_user_id, actorRole: 'TECHNICIAN', source: 'tech_transfer_request_approved' });
    }
    await this.audit(ctx, selfRequestedTransfer ? 'tech_transfer_completed' : 'tech_salon_membership_approved', tech.id, { requestId, profileId: profile.id, transfer: selfRequestedTransfer });
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techMembershipApproved as any, { requestId, technicianId: tech.id, profileId: profile.id });
    return { ok: true as const, status: 'active' as const, technicianId: tech.id, displayName: profile.display_name, transferred: selfRequestedTransfer };
  }

  /** Disconnect the profile from THIS salon (membership → former) — a termination of access at this salon. */
  async posDeactivateMembership(ctx: TechProfileCtx, technicianId: string) {
    const t = await this.tenantTechnician(ctx, technicianId);
    if (!t.global_tech_profile_id) throw withCode(new TechProfileError('not_found', 'This technician has no profile.'), 'TECHNICIAN_NO_PROFILE');
    // Mandate §63/§137: a disconnect is a termination of access at this salon — the shared chain (login inactive,
    // membership former, every session for this tenant revoked, Clock PIN disabled, audited), never just the row.
    const res = await revokeTechnicianAccess(this.need() as any, {
      tenantId: ctx.tenantId, technicianId: t.id, globalTechProfileId: t.global_tech_profile_id, mode: 'terminate',
      actor: { userId: ctx.userId || null, role: (ctx as any).role || null, branchId: ctx.branchId || null }, source: 'membership_deactivate',
    });
    // The branch grants are what let her login SELECT a branch here (identity branch-access); a disconnected membership
    // must leave no user_branch_access row behind, or the next login still lands her on the salon's floor.
    const userIds = new Set<string>([...res.userIds, ...(t.user_id ? [String(t.user_id)] : [])]);
    for (const uid of userIds) await revokeBranchAccessRows(this.need() as any, ctx.tenantId, uid, null);
    await this.audit(ctx, 'tech_salon_membership_deactivated', t.id, { profileId: t.global_tech_profile_id, sessionsRevoked: res.sessionsRevoked, clockPinsDisabled: res.clockPinsDisabled, branchGrantsRevokedFor: [...userIds] });
    return { ok: true as const, deactivated: res.membershipsUpdated > 0, sessionsRevoked: res.sessionsRevoked };
  }

  /** Manager rating list — includes hidden rows (with reasons); reviewer privacy still applied. */
  async posListRatings(ctx: TechProfileCtx, technicianId: string) {
    const t = await this.tenantTechnician(ctx, technicianId);
    const rows: any[] = await (this.need() as any).selectFrom('reviews as r')
      .leftJoin('customers as c', 'c.id', 'r.customer_id')
      .leftJoin('ticket_service_lines as l', 'l.id', 'r.ticket_service_line_id')
      .where('r.tenant_id', '=', ctx.tenantId).where('r.technician_id', '=', t.id)
      .select(['r.id', 'r.rating', 'r.comment', 'r.review_tags', 'r.is_public', 'r.is_hidden_by_manager', 'r.hidden_reason',
        'r.created_at', 'c.first_name', 'c.last_name', 'l.service_name_snapshot', 'r.technician_response']).orderBy('r.created_at', 'desc').limit(100).execute();
    return {
      ratings: rows.map((r) => ({
        ratingId: r.id, rating: Number(r.rating), reviewText: r.comment, tags: this.j(r.review_tags, []),
        reviewer: reviewerDisplayName([r.first_name, r.last_name].filter(Boolean).join(' '), !r.is_public),
        serviceName: r.service_name_snapshot ?? null,
        isPublic: !!r.is_public, isHiddenByManager: !!r.is_hidden_by_manager, hiddenReason: r.hidden_reason,
        response: r.technician_response ?? null,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }

  /** Hide/unhide an abusive review (score itself is never edited). Refreshes the public denorm. */
  async posSetRatingHidden(ctx: TechProfileCtx, technicianId: string, ratingId: string, hidden: boolean, reason?: string) {
    const t = await this.tenantTechnician(ctx, technicianId);
    const db: any = this.need();
    const row: any = await db.selectFrom('reviews').where('id', '=', ratingId)
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', t.id)
      .select(['id', 'global_tech_profile_id']).executeTakeFirst();
    if (!row) throw withCode(new TechProfileError('not_found', 'Rating not found for this technician.'), 'RATING_NOT_FOUND');
    await db.updateTable('reviews').set({
      is_hidden_by_manager: hidden, hidden_reason: hidden ? sanitizeText(String(reason ?? ''), 300) || null : null, updated_at: new Date() as any,
    } as any).where('id', '=', ratingId).execute();
    if (row.global_tech_profile_id) await this.recomputeRatingDenorm(row.global_tech_profile_id);
    await this.audit(ctx, hidden ? 'tech_rating_hidden' : 'tech_rating_unhidden', t.id, { ratingId, reason: reason ?? null });
    return { ok: true as const, ratingId, isHiddenByManager: hidden };
  }

  // ───────────────────────────── P4 — Customer discovery + rating-after-service ─────────────────────────────

  static readonly RATING_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // doc: customer can edit within 7 days

  /** Honest badge derivation — only from data we actually have. */
  private badges(avg: number, count: number, portfolioCount: number): string[] {
    const out: string[] = [];
    if (avg >= 4.8 && count >= 10) out.push('Top Rated');
    else if (avg >= 4.5 && count >= 3) out.push('Rising Talent');
    else if (count === 0 && portfolioCount >= 3) out.push('New Artist');
    return out;
  }

  /** First open slot for a technician at a salon over the next 7 days, using the SAME availability engine the
   *  booking flow uses (window + conflict gate). serviceDuration: explicit (matcher) or the tech's first service. */
  private async nextAvailable(tenantId: string, technicianId: string, serviceDurationMinutes?: number, apptCache?: Map<string, ExistingForConflict[]>): Promise<{ date: string; startTime: string } | null> {
    const db: any = this.need();
    let dur = serviceDurationMinutes;
    if (!dur) {
      const sv: any = await db.selectFrom('technician_services as ts').innerJoin('services as s', 's.id', 'ts.service_id')
        .where('ts.technician_id', '=', technicianId).where('s.status', '=', 'active')
        .orderBy('ts.is_primary', 'desc').select(['s.duration_minutes']).executeTakeFirst();
      dur = Number(sv?.duration_minutes ?? 0);
    }
    if (!dur) return null; // no assigned services → honestly no bookable slot to advertise
    const window = resolveWindow();
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    for (let d = 0; d < 7; d++) {
      const day = new Date(now.getTime() + d * 86_400_000);
      const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      const cacheKey = `${tenantId}:${date}`;
      let existing = apptCache?.get(cacheKey);
      if (!existing) {
        const rows: any[] = await db.selectFrom('pos_tech_appointments').select(['id', 'technician_id', 'start_time', 'end_time', 'status'])
          .where('tenant_id', '=', tenantId).where('appt_date', '=', date).execute().catch(() => []);
        existing = rows.map((a) => ({ appointmentId: a.id, technicianId: a.technician_id, startTime: a.start_time, endTime: a.end_time, status: a.status }));
        apptCache?.set(cacheKey, existing);
      }
      const nowHm = d === 0 ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '00:00';
      const slot = computeAvailableSlots(window, dur, [technicianId], existing).find((x) => x.available && x.startTime > nowHm);
      if (slot) return { date, startTime: slot.startTime };
    }
    return null;
  }

  /** Public technician card for one approved-public profile (never private fields). */
  private async publicCard(p: any, technicianId: string | null, opts?: { tenantId?: string; apptCache?: Map<string, ExistingForConflict[]>; isFeatured?: boolean }) {
    const db: any = this.need();
    let fq = db.selectFrom('tech_portfolio_photos')
      .where('global_tech_profile_id', '=', p.id).where('is_public', '=', true).where('moderation_status', '=', 'approved')
      .where('id', 'not in', (eb: any) => eb.selectFrom('nail_photo_consent').select('photo_id').where('public_blocked', '=', true));
    // a salon's own moderation applies on that salon's surfaces only (migration 456)
    if (opts?.tenantId) fq = fq.where('id', 'not in', (eb: any) => eb.selectFrom('tech_portfolio_photo_tenant_hides').select('photo_id').where('tenant_id', '=', opts.tenantId));
    const featured: any[] = await fq.orderBy('is_featured', 'desc').orderBy('sort_order', 'asc').limit(3)
      .select(['thumbnail_url', 'image_url']).execute();
    return {
      technicianId, publicSlug: p.public_slug, displayName: p.display_name, title: p.title ?? null, avatarUrl: buildMediaUrl(p.avatar_url),
      coverUrl: buildMediaUrl(p.cover_url), certifications: this.publicCertifications(p.certifications), styleTags: this.j(p.style_tags, []),
      verificationStatus: p.verification_status ?? 'unverified',
      averageRating: Number(p.overall_rating ?? 0), reviewCount: Number(p.rating_count ?? 0),
      specialties: this.j(p.specialties, []), yearsExperience: p.years_experience ?? null,
      featuredPortfolioPhotos: featured.map((f) => buildMediaUrl(f.thumbnail_url || f.image_url)),
      isBookable: !!p.is_bookable,
      badges: this.badges(Number(p.overall_rating ?? 0), Number(p.rating_count ?? 0), Number(p.portfolio_photo_count ?? 0)),
      isFeatured: !!opts?.isFeatured,
      nextAvailable: opts?.tenantId && technicianId ? await this.nextAvailable(opts.tenantId, technicianId, undefined, opts.apptCache) : null,
    };
  }

  /** GET /customer/salons/:salonId/technicians — public cards for one listed salon (salonId = branch id). */
  async customerSalonTechnicians(salonId: string) {
    const db: any = this.need();
    const branch: any = await db.selectFrom('branches').where('id', '=', salonId).select(['id', 'tenant_id', 'name']).executeTakeFirst();
    if (!branch || !(await readAppFlag(db, branch.tenant_id, 'public_listing'))) throw withCode(new TechProfileError('not_found', 'Salon not found.'), 'SALON_NOT_FOUND');
    const rows: any[] = await db.selectFrom('technicians as t')
      .innerJoin('global_tech_profiles as p', 'p.id', 't.global_tech_profile_id')
      .innerJoin('tech_salon_memberships as m', (j: any) => j.onRef('m.global_tech_profile_id', '=', 'p.id').on('m.tenant_id', '=', branch.tenant_id))
      .where('t.tenant_id', '=', branch.tenant_id).where('t.branch_id', '=', salonId).where('t.is_active', '=', true)
      .where('m.status', '=', 'active').where('p.is_public', '=', true)
      // a Super-Admin-hidden or non-active (suspended / locked / paused / anonymized / merged) profile is on no public list
      .where('p.admin_profile_hidden', 'is not', true).where('p.status', '=', 'active')
      .selectAll('p').select(['t.id as tech_id', 'm.is_featured as m_featured']).groupBy(['p.id', 't.id', 'm.is_featured']).execute();
    const apptCache = new Map<string, ExistingForConflict[]>();
    const cards = [];
    for (const r of rows) cards.push(await this.publicCard(r, r.tech_id, { tenantId: branch.tenant_id, apptCache, isFeatured: !!r.m_featured }));
    cards.sort((a, b) => (a.isFeatured !== b.isFeatured) ? (a.isFeatured ? -1 : 1) : (b.averageRating * Math.log10(b.reviewCount + 2)) - (a.averageRating * Math.log10(a.reviewCount + 2)));
    return { salonId, technicians: cards };
  }

  /** GET /customer/techs/nearby — cross-salon marketplace discovery (public+marketplace profiles at listed salons only). */
  async customerNearbyTechs(lat: number, lng: number, radiusMiles = 10, q?: string, minRating?: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new TechProfileError('invalid', 'lat and lng are required.');
    const radius = Math.min(Math.max(Number(radiusMiles) || 10, 1), 50);
    const db: any = this.need();
    const rows: any[] = await db.selectFrom('technicians as t')
      .innerJoin('global_tech_profiles as p', 'p.id', 't.global_tech_profile_id')
      .innerJoin('tech_salon_memberships as m', (j: any) => j.onRef('m.global_tech_profile_id', '=', 'p.id').onRef('m.tenant_id', '=', 't.tenant_id'))
      .innerJoin('branches as b', 'b.id', 't.branch_id')
      .innerJoin('tenants as tn', 'tn.id', 't.tenant_id')
      .where('t.is_active', '=', true).where('m.status', '=', 'active')
      .where('p.is_public', '=', true).where('p.marketplace_discovery_enabled', '=', true).where('p.admin_profile_hidden', 'is not', true)
      .where('p.status', '=', 'active')
      .where('b.latitude', 'is not', null).where('b.longitude', 'is not', null)
      .selectAll('p').select(['t.id as tech_id', 't.tenant_id as tenant_id', 'b.id as branch_id', 'b.name as branch_name',
        'b.latitude', 'b.longitude', 'b.city', 'b.state', 'tn.display_name as tenant_name', 'm.is_featured as m_featured']).execute();
    const apptCache = new Map<string, ExistingForConflict[]>();
    const out: any[] = [];
    const needle = (q ?? '').trim().toLowerCase();
    for (const r of rows) {
      if (!(await readAppFlag(db, r.tenant_id, 'public_listing'))) continue;
      const distanceMiles = Math.round(haversineMiles(lat, lng, Number(r.latitude), Number(r.longitude)) * 10) / 10;
      if (distanceMiles > radius) continue;
      if (needle) {
        const hay = `${r.display_name} ${r.title ?? ''} ${JSON.stringify(this.j(r.specialties, []))} ${JSON.stringify(this.j(r.style_tags, []))}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      if (minRating != null && Number(r.overall_rating ?? 0) < minRating) continue;
      const card = await this.publicCard(r, r.tech_id, { tenantId: r.tenant_id, apptCache, isFeatured: !!r.m_featured });
      const salonName = r.branch_name && r.branch_name !== 'Main' ? `${r.tenant_name} — ${r.branch_name}` : r.tenant_name;
      out.push({
        ...card, salonId: r.branch_id, salonName, city: r.city, state: r.state, distanceMiles,
        bookingRoute: `/book/${r.branch_id}`,
        rankScore: techRankingScore({
          ratingAverage: card.averageRating, ratingCount: card.reviewCount,
          verifiedCompletedServices: Number(r.verified_completed_services_count ?? 0),
          portfolioPhotoCount: Number(r.portfolio_photo_count ?? 0),
          hasAvatar: !!r.avatar_url, hasBio: !!r.bio, nextAvailableMinutes: null, distanceMiles,
        }),
      });
    }
    out.sort((a, b) => b.rankScore - a.rankScore);
    return { radiusMiles: radius, results: out.slice(0, 50) };
  }

  /** GET /customer/techs/:publicSlug — the premium public profile page payload. */
  async customerPublicProfile(ctx: TechProfileCtx, slug: string) {
    const db: any = this.need();
    const p: any = await db.selectFrom('global_tech_profiles').where('public_slug', '=', String(slug).toLowerCase()).selectAll().executeTakeFirst();
    if (!p || !p.is_public || p.admin_profile_hidden || p.status !== 'active') throw withCode(new TechProfileError('not_found', 'This profile is not available.'), 'PROFILE_NOT_AVAILABLE');
    const viewer: 'booked' | 'public' = (await this.viewerHasBookingWithProfile(ctx?.userId, p.id)) ? 'booked' : 'public';
    await this.recordProfileEvent(p.id, 'profile_view', ctx?.userId ?? null);
    return this.buildPublicProfilePayload(p, viewer);
  }

  /** Has this viewer (auth user) ever booked an appointment or had a ticket with this technician profile? Gates booked_only links. */
  private async viewerHasBookingWithProfile(userId: string | undefined, profileId: string): Promise<boolean> {
    // Reads ACROSS salons by design (a viewer's bookings with a GLOBAL technician, at any salon) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not empty it. The only sanctioned way to cross salons inside a tenant request.
    return runAcrossTenants("a viewer's bookings with a GLOBAL technician, at any salon", () => this.__viewerHasBookingWithProfileUnscoped(userId, profileId));
  }
  private async __viewerHasBookingWithProfileUnscoped(userId: string | undefined, profileId: string): Promise<boolean> {
    if (!userId) return false;
    const db: any = this.need();
    const custs: any[] = await db.selectFrom('customers').where('user_id', '=', userId).select(['id']).execute().catch(() => []);
    if (!custs.length) return false;
    const custIds = custs.map((c) => c.id);
    const techs: any[] = await db.selectFrom('technicians').where('global_tech_profile_id', '=', profileId).select(['id']).execute().catch(() => []);
    if (!techs.length) return false;
    const techIds = techs.map((t) => t.id);
    const appt: any = await db.selectFrom('pos_tech_appointments').where('customer_id', 'in', custIds).where('technician_id', 'in', techIds).select(['id']).executeTakeFirst().catch(() => null);
    if (appt) return true;
    const tk: any = await db.selectFrom('tickets').where('customer_id', 'in', custIds).where('primary_technician_id', 'in', techIds).select(['id']).executeTakeFirst().catch(() => null);
    return !!tk;
  }

  private async buildPublicProfilePayload(p: any, viewer: 'owner' | 'booked' | 'public' = 'public') {
    const db: any = this.need();
    const photos: any[] = await db.selectFrom('tech_portfolio_photos')
      .where('global_tech_profile_id', '=', p.id).where('is_public', '=', true).where('moderation_status', '=', 'approved')
      .where('id', 'not in', (eb: any) => eb.selectFrom('nail_photo_consent').select('photo_id').where('public_blocked', '=', true))
      .orderBy('is_featured', 'desc').orderBy('sort_order', 'asc').orderBy('created_at', 'desc').limit(60)
      .select(['id', 'image_url', 'thumbnail_url', 'caption', 'tags', 'service_category', 'is_featured', 'nail_shape', 'nail_length', 'design_style', 'complexity', 'brand', 'color_name']).execute();
    const reviews: any[] = await db.selectFrom('reviews as r')
      .leftJoin('customers as c', 'c.id', 'r.customer_id')
      .leftJoin('ticket_service_lines as l', 'l.id', 'r.ticket_service_line_id')
      .where('r.global_tech_profile_id', '=', p.id).where('r.technician_id', 'is not', null)
      .where('r.is_public', '=', true).where('r.is_hidden_by_manager', '=', false)
      .orderBy('r.created_at', 'desc').limit(20)
      .select(['r.rating', 'r.comment', 'r.review_tags', 'r.created_at', 'c.first_name', 'c.last_name', 'l.service_name_snapshot', 'r.technician_response', 'r.technician_response_at']).execute();
    // Distribution over EVERY public, non-hidden review — SQL group by — not the 20 most recent rows rendered above.
    const dist: any[] = await db.selectFrom('reviews').where('global_tech_profile_id', '=', p.id).where('technician_id', 'is not', null)
      .where('is_public', '=', true).where('is_hidden_by_manager', '=', false)
      .select(['rating', db.fn.count('id').as('n')]).groupBy('rating').execute().catch(() => []);
    const distTotal = dist.reduce((a, r) => a + Number(r.n), 0);
    const starCount = (star: number) => dist.filter((r) => Math.max(1, Math.min(5, Math.round(Number(r.rating)))) === star).reduce((a, r) => a + Number(r.n), 0);
    const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, pct: distTotal ? Math.round((starCount(star) / distTotal) * 100) : 0 }));
    const salons: any[] = await db.selectFrom('tech_salon_memberships as m')
      .innerJoin('tenants as tn', 'tn.id', 'm.tenant_id')
      .innerJoin('technicians as t', (j: any) => j.onRef('t.global_tech_profile_id', '=', 'm.global_tech_profile_id').onRef('t.tenant_id', '=', 'm.tenant_id'))
      .innerJoin('branches as b', 'b.id', 't.branch_id')
      .where('m.global_tech_profile_id', '=', p.id).where('m.status', '=', 'active').where('t.is_active', '=', true)
      .select(['b.id as branch_id', 'b.name as branch_name', 'b.address', 'b.city', 'b.state', 'tn.id as tenant_id', 'tn.display_name as tenant_name']).execute();
    const visibleSalons = [];
    const apptCache = new Map<string, ExistingForConflict[]>();
    for (const sRow of salons) {
      if (!(await readAppFlag(db, sRow.tenant_id, 'public_listing'))) continue;
      // "Services I Do" at this salon — active assigned services, with duration/price (doc 3 §Services section)
      const techRow: any = await db.selectFrom('technicians').where('tenant_id', '=', sRow.tenant_id)
        .where('global_tech_profile_id', '=', p.id).where('is_active', '=', true).select(['id']).executeTakeFirst();
      let services: any[] = [];
      let nextAvailableAt: { date: string; startTime: string } | null = null;
      if (techRow) {
        services = await db.selectFrom('technician_services as ts').innerJoin('services as s', 's.id', 'ts.service_id')
          .where('ts.technician_id', '=', (techRow as any).id).where('s.status', '=', 'active')
          .orderBy('ts.is_primary', 'desc').orderBy('s.name', 'asc')
          .select(['s.id as service_id', 's.name', 's.duration_minutes', 's.price_cents', 'ts.is_primary']).execute();
        nextAvailableAt = await this.nextAvailable(sRow.tenant_id, techRow.id, undefined, apptCache);
      }
      visibleSalons.push({
        salonId: sRow.branch_id, technicianId: techRow?.id ?? null,
        salonName: sRow.branch_name && sRow.branch_name !== 'Main' ? `${sRow.tenant_name} — ${sRow.branch_name}` : sRow.tenant_name,
        address: [sRow.address, sRow.city, sRow.state].filter(Boolean).join(', '),
        bookingRoute: `/book/${sRow.branch_id}`,
        nextAvailableAt,
        services: services.map((x: any) => ({ serviceId: x.service_id, name: x.name, durationMinutes: Number(x.duration_minutes), priceCents: Number(x.price_cents), isPrimary: !!x.is_primary })),
      });
    }
    const allPublic: any[] = await db.selectFrom('reviews').where('global_tech_profile_id', '=', p.id)
      .where('technician_id', 'is not', null).where('is_public', '=', true).where('is_hidden_by_manager', '=', false)
      .select(['review_tags']).execute();
    const wouldAgain = allPublic.filter((x) => JSON.stringify(this.j(x.review_tags, [])).includes('Would Book Again')).length;
    const wouldBookAgainPct = allPublic.length ? Math.round((wouldAgain / allPublic.length) * 100) : null;
    const beforeAfterRows: any[] = await db.selectFrom('before_after_sets').where('global_tech_profile_id', '=', p.id)
      .where('is_public', '=', true).where('moderation_status', '=', 'approved')
      .orderBy('sort_order', 'asc').orderBy('created_at', 'desc').limit(20).selectAll().execute();
    // Public showcase posts attributed to this technician, across every salon they've worked at (join technicians by
    // global profile). Reuses the NailShowcase engagement layer wholesale — like/comment counts are its denorm columns;
    // tapping a post opens the existing showcase detail (with its own comments/likes). We never duplicate that here.
    const postRows: any[] = await db.selectFrom('nail_showcase_posts as sp')
      .innerJoin('technicians as t', 't.id', 'sp.technician_id')
      .leftJoin('nail_showcase_photos as ph', (j: any) => j.onRef('ph.post_id', '=', 'sp.id').on('ph.sort_order', '=', 0))
      .select(['sp.id as id', 'sp.caption as caption', 'sp.like_count as like_count', 'sp.comment_count as comment_count', 'sp.created_at as created_at', 'ph.thumbnail_url as thumb', 'ph.image_url as image'])
      .where('t.global_tech_profile_id', '=', p.id)
      .where('sp.deleted_at', 'is', null).where('sp.status', '=', 'published').where('sp.visibility', '=', 'public_platform')
      .orderBy('sp.created_at', 'desc').limit(24).execute().catch(() => []);
    return {
      publicSlug: p.public_slug, displayName: p.display_name, title: p.title ?? null, avatarUrl: buildMediaUrl(p.avatar_url),
      bio: p.bio ?? null, yearsExperience: p.years_experience ?? null, wouldBookAgainPct,
      careerHistory: await careerHistoryFor(db, p.id, !!p.career_history_public),   // §62: salon names + years, only when she opted in
      specialties: this.j(p.specialties, []), languages: this.j(p.languages, []), profileLinks: visibleLinksFor(this.j(p.profile_links, {}), this.j(p.profile_link_visibility, {}), viewer),
      averageRating: Number(p.overall_rating ?? 0), reviewCount: Number(p.rating_count ?? 0), ratingBreakdown: breakdown,
      certifications: this.publicCertifications(p.certifications), // self-declared, never presented as verified
      isBookable: !!p.is_bookable && visibleSalons.length > 0, acceptsMessages: p.accepts_messages !== false,
      badges: this.badges(Number(p.overall_rating ?? 0), Number(p.rating_count ?? 0), Number(p.portfolio_photo_count ?? 0)),
      portfolio: photos.map((ph) => ({ photoId: ph.id, imageUrl: buildMediaUrl(ph.image_url), thumbnailUrl: buildMediaUrl(ph.thumbnail_url), caption: ph.caption, tags: this.j(ph.tags, []), serviceCategory: ph.service_category, isFeatured: !!ph.is_featured, nailShape: ph.nail_shape, nailLength: ph.nail_length, designStyle: ph.design_style, complexity: ph.complexity, brand: ph.brand, colorName: ph.color_name })),
      beforeAfter: beforeAfterRows.map((r) => this.shapeBeforeAfter(r, false)),
      posts: postRows.map((r) => ({ postId: r.id, thumbnailUrl: buildMediaUrl(r.thumb ?? r.image ?? null), caption: r.caption ?? '', likeCount: Number(r.like_count) || 0, commentCount: Number(r.comment_count) || 0, createdAt: new Date(r.created_at).toISOString() })),
      reviews: reviews.map((r) => ({ rating: Number(r.rating), reviewText: r.comment, tags: this.j(r.review_tags, []), reviewer: reviewerDisplayName([r.first_name, r.last_name].filter(Boolean).join(' ')), serviceName: r.service_name_snapshot ?? null, createdAt: new Date(r.created_at).toISOString(), response: r.technician_response ?? null, respondedAt: r.technician_response_at ? new Date(r.technician_response_at).toISOString() : null })),
      availableAt: visibleSalons,
    };
  }

  // ───────────────────────────── P6 — favorites · rating edits · manager edit/feature · cancel ─────────────────────────────

  /** Resolve a public profile by slug OR by a technician id the customer just interacted with. */
  private async resolvePublicProfile(by: { publicSlug?: string; technicianId?: string }) {
    const db: any = this.need();
    let prof: any = null;
    if (by.publicSlug) prof = await db.selectFrom('global_tech_profiles').where('public_slug', '=', String(by.publicSlug).toLowerCase()).selectAll().executeTakeFirst();
    else if (by.technicianId) {
      const t: any = await db.selectFrom('technicians').where('id', '=', by.technicianId).select(['global_tech_profile_id']).executeTakeFirst();
      if (t?.global_tech_profile_id) prof = await db.selectFrom('global_tech_profiles').where('id', '=', t.global_tech_profile_id).selectAll().executeTakeFirst();
    }
    if (!prof || !prof.is_public || prof.admin_profile_hidden || prof.status !== 'active') throw withCode(new TechProfileError('not_found', 'This profile is not available.'), 'PROFILE_NOT_AVAILABLE');
    return prof;
  }

  /** GET /customer/tech-favorites — the customer's hearted techs as public cards. */
  async customerListFavoriteTechs(ctx: TechProfileCtx) {
    const db: any = this.need();
    const rows: any[] = await db.selectFrom('customer_favorite_techs as f')
      .innerJoin('global_tech_profiles as p', 'p.id', 'f.global_tech_profile_id')
      .where('f.user_id', '=', ctx.userId).where('p.is_public', '=', true)
      .where('p.admin_profile_hidden', 'is not', true).where('p.status', '=', 'active')
      .selectAll('p').orderBy('f.created_at', 'desc').execute();
    const techs = [];
    for (const r of rows) techs.push(await this.publicCard(r, null));
    return { slugs: rows.map((r) => r.public_slug), techs };
  }

  /** POST /customer/tech-favorites — heart a tech (idempotent; public profiles only). */
  async customerAddFavoriteTech(ctx: TechProfileCtx, by: { publicSlug?: string; technicianId?: string }) {
    const prof = await this.resolvePublicProfile(by);
    await (this.need() as any).insertInto('customer_favorite_techs')
      .values({ user_id: ctx.userId, global_tech_profile_id: prof.id } as any)
      .onConflict((oc: any) => oc.columns(['user_id', 'global_tech_profile_id']).doNothing()).execute();
    return { ok: true as const, publicSlug: prof.public_slug, displayName: prof.display_name };
  }

  /** DELETE /customer/tech-favorites/:publicSlug */
  async customerRemoveFavoriteTech(ctx: TechProfileCtx, publicSlug: string) {
    const db: any = this.need();
    const prof: any = await db.selectFrom('global_tech_profiles').where('public_slug', '=', String(publicSlug).toLowerCase()).select(['id']).executeTakeFirst();
    if (prof) await db.deleteFrom('customer_favorite_techs').where('user_id', '=', ctx.userId).where('global_tech_profile_id', '=', prof.id).execute();
    return { ok: true as const };
  }

  /** GET /customer/tickets/:ticketId/technician-ratings/mine — for the 7-day edit window UI. */
  async customerMyTechRating(ctx: TechProfileCtx, ticketId: string, technicianId: string) {
    requireUuidId(ticketId); requireUuidId(technicianId);   // SW-21: a missing ?technicianId= is a 400 INVALID_ID before any query
    const customerId = await this.requireCustomer(ctx);
    const row: any = await (this.need() as any).selectFrom('reviews')
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
      .where('technician_id', '=', technicianId).where('customer_id', '=', customerId)
      .select(['id', 'rating', 'comment', 'review_tags', 'is_public', 'created_at']).executeTakeFirst();
    if (!row) return { exists: false as const };
    const editableUntil = new Date(new Date(row.created_at).getTime() + TechProfileService.RATING_EDIT_WINDOW_MS).toISOString();
    return {
      exists: true as const, ratingId: row.id, rating: Number(row.rating), reviewText: row.comment,
      tags: this.j(row.review_tags, []), isPublic: !!row.is_public,
      editable: Date.now() < new Date(editableUntil).getTime(), editableUntil,
    };
  }

  /** PATCH /customer/tickets/:ticketId/technician-ratings/:ratingId — edit within the 7-day window (doc 3 rule). */
  async customerUpdateTechRating(ctx: TechProfileCtx, ticketId: string, ratingId: string, body: any) {
    const customerId = await this.requireCustomer(ctx);
    const db: any = this.need();
    const row: any = await db.selectFrom('reviews').where('id', '=', ratingId)
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('customer_id', '=', customerId)
      .select(['id', 'technician_id', 'global_tech_profile_id', 'created_at']).executeTakeFirst();
    if (!row) throw withCode(new TechProfileError('not_found', 'Rating not found.'), 'RATING_NOT_FOUND');
    if (Date.now() - new Date(row.created_at).getTime() > TechProfileService.RATING_EDIT_WINDOW_MS) {
      throw withCode(new TechProfileError('invalid_state', 'Ratings can be edited within 7 days of your visit.'), 'RATING_EDIT_WINDOW');
    }
    const set: any = { updated_at: new Date() };
    if (body?.rating !== undefined) {
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw withCode(new TechProfileError('invalid', 'Rating must be 1 to 5 stars.'), 'RATING_INVALID');
      set.rating = rating;
    }
    if (body?.reviewText !== undefined) set.comment = sanitizeText(body.reviewText, 1000);
    if (body?.tags !== undefined) set.review_tags = JSON.stringify(sanitizeRatingTags(body.tags));
    if (body?.isPublic !== undefined) set.is_public = !!body.isPublic;
    await db.updateTable('reviews').set(set).where('id', '=', ratingId).execute();
    if (row.global_tech_profile_id) await this.recomputeRatingDenorm(row.global_tech_profile_id);
    await this.audit(ctx, 'tech_rating_updated', row.technician_id, { ratingId, ticketId });
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techRatingSubmitted as any, { technicianId: row.technician_id, ticketId, updated: true });
    return { ok: true as const, message: 'Your rating was updated.' };
  }

  /** PATCH /pos/technicians/:id/profile — salon-assist edits of the PUBLIC fields only (audited; tech can re-edit). */
  async posUpdateTechProfile(ctx: TechProfileCtx, technicianId: string, patch: any) {
    const t = await this.tenantTechnician(ctx, technicianId);
    if (!t.global_tech_profile_id) throw withCode(new TechProfileError('not_found', 'This technician has no profile.'), 'TECHNICIAN_NO_PROFILE');
    const set: any = { updated_at: new Date() };
    if (patch?.displayName !== undefined) { const v = sanitizeText(patch.displayName, 60); if (!v) throw withCode(new TechProfileError('invalid', 'Display name is required.'), 'DISPLAY_NAME_REQUIRED'); set.display_name = v; }
    if (patch?.title !== undefined) set.title = sanitizeText(patch.title, 60);
    if (patch?.bio !== undefined) set.bio = sanitizeText(patch.bio, 1000);
    if (patch?.specialties !== undefined) set.specialties = JSON.stringify(Array.isArray(patch.specialties) ? patch.specialties.map((x: any) => sanitizeText(x, 40)).filter(Boolean).slice(0, 12) : []);
    if (Object.keys(set).length === 1) throw withCode(new TechProfileError('invalid', 'Nothing to update — managers can edit name, title, bio, and specialties.'), 'MANAGER_EDITABLE_FIELDS');
    // §18: the profile edit and technician.profile_updated commit together; the payload names WHICH fields
    // changed, never their values (§95).
    await (this.need() as any).transaction().execute(async (trx: any) => {
      await trx.updateTable('global_tech_profiles').set(set).where('id', '=', t.global_tech_profile_id).execute();
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TECHNICIAN_PROFILE_UPDATED, tenantId: ctx.tenantId, aggregateType: 'technician', aggregateId: t.id,
        actorId: ctx.userId, actorType: 'user',
        payload: { technicianId: t.id, profileId: t.global_tech_profile_id, changedFields: Object.keys(set).filter((k) => k !== 'updated_at'), editedBy: 'manager' },
      }));
    });
    await this.audit(ctx, 'tech_profile_updated_by_manager', t.id, { profileId: t.global_tech_profile_id, fields: Object.keys(set).filter((k) => k !== 'updated_at') });
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techProfileUpdated as any, { technicianId: t.id, profileId: t.global_tech_profile_id, byManager: true });
    return this.posViewTechProfile(ctx, technicianId);
  }

  /** PATCH /pos/technicians/:id/feature — tenant-scoped featuring (doc 3 ranking rule #1). */
  async posSetFeatured(ctx: TechProfileCtx, technicianId: string, featured: boolean) {
    const t = await this.tenantTechnician(ctx, technicianId);
    if (!t.global_tech_profile_id) throw withCode(new TechProfileError('not_found', 'This technician has no profile.'), 'TECHNICIAN_NO_PROFILE');
    const res: any = await (this.need() as any).updateTable('tech_salon_memberships')
      .set({ is_featured: !!featured, updated_at: new Date() as any } as any)
      .where('tenant_id', '=', ctx.tenantId).where('global_tech_profile_id', '=', t.global_tech_profile_id)
      .where('status', '=', 'active').where(canMoveToSql(TECH_SALON_MEMBERSHIP, 'former') as any).executeTakeFirst();
    if (!Number(res?.numUpdatedRows ?? 0)) throw withCode(new TechProfileError('invalid_state', 'This technician has no active membership at this salon.'), 'TECHNICIAN_NO_MEMBERSHIP');
    await this.audit(ctx, featured ? 'tech_featured' : 'tech_unfeatured', t.id, {});
    return { ok: true as const, isFeatured: !!featured };
  }

  /** POST /tech/profile/membership-request/:requestId/cancel — tech withdraws their own pending request. */
  // ───────────── Technician Profile mandate §95 — public-profile change approval (per-salon policy) ─────────────
  /** Nudge every salon that must review her held edit (the ones whose policy requires approval and employ her): one
   *  technician.profile_change_held per reviewing salon (B-14). */
  private async emitTenantWideToReviewers(profileId: string, payload: { profileId: string; requestId: string }, actorId?: string | null) {
    const db: any = this.need();
    for (const tenantId of await approvalTenantsFor(db, profileId)) await this.salonWide(db, tenantId, { eventType: DOMAIN_EVENTS.TECHNICIAN_PROFILE_CHANGE_HELD, aggregateType: 'technician_profile_change', aggregateId: payload.requestId, actorId,
      clientEvent: EVENTS.techProfileUpdated as any, payload: { ...payload, held: true } });
  }

  /** GET /pos/technician-profile-policy — this salon's §95 switch. */
  async posGetProfilePolicy(ctx: TechProfileCtx) {
    const r: any = await (this.need() as any).selectFrom('technician_profile_tenant_policy').where('tenant_id', '=', ctx.tenantId).select(['public_profile_changes_require_approval', 'updated_at']).executeTakeFirst().catch(() => null);
    return { publicProfileChangesRequireApproval: !!r?.public_profile_changes_require_approval, updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null };
  }

  /** PATCH /pos/technician-profile-policy { publicProfileChangesRequireApproval } — owner/manager setting; audited. */
  async posSetProfilePolicy(ctx: TechProfileCtx, on: boolean) {
    const db: any = this.need();
    const actor = /^[0-9a-f-]{36}$/i.test(ctx.userId || '') ? ctx.userId : null;
    await db.insertInto('technician_profile_tenant_policy').values({ tenant_id: ctx.tenantId, public_profile_changes_require_approval: on, updated_by: actor } as any)
      .onConflict((oc: any) => oc.column('tenant_id').doUpdateSet({ public_profile_changes_require_approval: on, updated_by: actor, updated_at: new Date() })).execute();
    await this.audit(ctx, 'tech_profile_policy_updated', null, { publicProfileChangesRequireApproval: on });
    return this.posGetProfilePolicy(ctx);
  }

  /** GET /pos/technician-profile-changes — held edits of technicians employed HERE (never another salon's roster). */
  async posListProfileChanges(ctx: TechProfileCtx) {
    return { requests: await listPendingForTenant(this.need() as any, ctx.tenantId) };
  }

  /** POST /pos/technician-profile-changes/:id/{approve|reject} { version, note? } — optimistic (§104), applied in one transaction. */
  async posDecideProfileChange(ctx: TechProfileCtx, requestId: string, decision: 'approved' | 'rejected', version: number, note?: string) {
    const db: any = this.need();
    let out: { profileId: string; applied: Record<string, unknown> };
    try {
      out = await db.transaction().execute((trx: any) => decideProfileChange(trx, { requestId, tenantId: ctx.tenantId, decision, version: Number(version), decidedByUserId: /^[0-9a-f-]{36}$/i.test(ctx.userId || '') ? ctx.userId : null, note: sanitizeText(note, 300) || null }));
    } catch (e: any) {
      if (e?.code === 'not_found' || e?.code === 'VERSION_CONFLICT' || e?.code === 'invalid') throw new TechProfileError(e.code, e.message);
      throw e;
    }
    const tech: any = await db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('global_tech_profile_id', '=', out.profileId).where('archived_at', 'is', null).select(['id']).executeTakeFirst();
    await this.audit(ctx, decision === 'approved' ? 'tech_profile_change_approved' : 'tech_profile_change_rejected', tech?.id ?? null, { requestId, profileId: out.profileId, fields: Object.keys(describeHeldChanges(out.applied)), note: sanitizeText(note, 300) || null });
    if (tech?.id) await db.insertInto('technician_notifications').values({
      tenant_id: ctx.tenantId, technician_id: tech.id, type: decision === 'approved' ? 'profile_change_approved' : 'profile_change_rejected',
      title: decision === 'approved' ? 'Profile update approved' : 'Profile update not approved',
      body: decision === 'approved' ? 'Your public profile changes are live.' : `Your public profile changes were not approved${note ? `: ${sanitizeText(note, 300)}` : '.'}`, reference: requestId,
    } as any).execute().catch(() => {});
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techProfileUpdated as any, { technicianId: tech?.id ?? null, profileId: out.profileId, decision });
    return { ok: true as const, decision, requestId, applied: describeHeldChanges(out.applied) };
  }

  /** POST /tech/profile/pending-changes/withdraw — she takes her held edit back. */
  async withdrawMyPendingChange(ctx: TechProfileCtx) {
    const db: any = this.need();
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) return { ok: true as const, withdrawn: false };
    const withdrawn = await withdrawPendingChange(db, t.global_tech_profile_id);
    if (withdrawn) await this.audit(ctx, 'tech_profile_change_withdrawn', t.id, { profileId: t.global_tech_profile_id });
    return { ok: true as const, withdrawn };
  }

  async cancelMyMembershipRequest(ctx: TechProfileCtx, requestId: string) {
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) throw withCode(new TechProfileError('not_found', 'No profile.'), 'PROFILE_NOT_FOUND');
    const db: any = this.need();
    const row: any = await db.selectFrom('tech_salon_memberships').where('id', '=', requestId)
      .where('global_tech_profile_id', '=', t.global_tech_profile_id).select(['id', 'status']).executeTakeFirst();
    if (!row) throw withCode(new TechProfileError('not_found', 'Request not found.'), 'REQUEST_NOT_FOUND');
    if (row.status !== 'pending_salon_approval') throw withCode(new TechProfileError('invalid_state', `This request is already ${row.status}.`), 'REQUEST_ALREADY_DECIDED');
    await transitionStatus(db, TECH_SALON_MEMBERSHIP, { where: { id: requestId }, from: 'pending_salon_approval', to: 'cancelled', set: { updated_at: new Date() } });
    return { ok: true as const, status: 'cancelled' as const };
  }

  /** Shared matcher: active bookable technicians at a branch who can perform a service, profile-enriched when public.
   *  Sort: primary skill first, then rating balanced by volume (never raw rating alone).
   *  viewer 'customer': ONLY technicians with a PUBLIC, visible (not admin-hidden, status active) profile — named by their
   *  public display name. The salon roster name (technicians.full_name) of a technician who has not published a
   *  profile is salon-internal and is never handed to a customer. viewer 'pos': the salon's own roster, as before. */
  private async serviceTechnicians(tenantId: string, branchId: string, serviceId: string, viewer: 'customer' | 'pos' = 'customer') {
    const db: any = this.need();
    requireUuidId(serviceId);   // SW-21: a missing ?serviceId= is a 400 INVALID_ID before any query
    const svcRow: any = await db.selectFrom('services').where('id', '=', serviceId).select(['duration_minutes']).executeTakeFirst();
    let q = db.selectFrom('technician_services as ts')
      .innerJoin('technicians as t', 't.id', 'ts.technician_id')
      .leftJoin('global_tech_profiles as p', 'p.id', 't.global_tech_profile_id')
      .leftJoin('tech_salon_memberships as m', (j: any) => j.onRef('m.global_tech_profile_id', '=', 'p.id').on('m.tenant_id', '=', tenantId).on('m.status', '=', 'active'))
      .where('ts.tenant_id', '=', tenantId).where('ts.branch_id', '=', branchId).where('ts.service_id', '=', serviceId)
      .where('t.is_active', '=', true);
    if (viewer === 'customer') {
      q = q.where('p.is_public', '=', true).where('p.admin_profile_hidden', 'is not', true).where('p.status', '=', 'active');
    }
    const rows: any[] = await q.select(['t.id as technician_id', 't.full_name', 't.avatar_url as t_avatar', 'ts.is_primary', 'm.is_featured as m_featured',
        'p.public_slug', 'p.display_name as p_display_name', 'p.avatar_url as p_avatar', 'p.title', 'p.overall_rating', 'p.rating_count', 'p.is_public', 'p.is_bookable']).execute();
    const apptCache = new Map<string, ExistingForConflict[]>();
    const cards = [] as any[];
    for (const r of rows) cards.push({
      technicianId: r.technician_id,
      displayName: viewer === 'customer' ? r.p_display_name : r.full_name,
      avatarUrl: buildMediaUrl(r.p_avatar ?? r.t_avatar ?? null),
      title: r.is_public ? (r.title ?? null) : null,
      averageRating: r.is_public ? Number(r.overall_rating ?? 0) : null,
      reviewCount: r.is_public ? Number(r.rating_count ?? 0) : null,
      publicSlug: r.is_public ? r.public_slug : null,
      isPrimary: !!r.is_primary,
      isFeatured: !!r.m_featured,
      isBookable: r.is_bookable !== false, // techs without a profile remain bookable through the normal flow
      nextAvailable: await this.nextAvailable(tenantId, r.technician_id, Number(svcRow?.duration_minutes ?? 0) || undefined, apptCache),
    });
    cards.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1; // doc: featured technician first
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const score = (c: typeof a) => (c.averageRating ?? 0) * Math.log10((c.reviewCount ?? 0) + 2);
      return score(b) - score(a);
    });
    return cards;
  }

  /** GET /customer/salons/:salonId/services/:serviceId/technicians — public booking-matching (listed salons only). */
  async customerServiceTechnicians(salonId: string, serviceId: string) {
    const db: any = this.need();
    const branch: any = await db.selectFrom('branches').where('id', '=', salonId).select(['id', 'tenant_id']).executeTakeFirst();
    if (!branch || !(await readAppFlag(db, branch.tenant_id, 'public_listing'))) throw withCode(new TechProfileError('not_found', 'Salon not found.'), 'SALON_NOT_FOUND');
    return { salonId, serviceId, technicians: await this.serviceTechnicians(branch.tenant_id, salonId, serviceId) };
  }

  /** GET /customer/booking/service-technicians — authed in-app booking matching (no listed gate; session salon). */
  async customerBookingServiceTechnicians(ctx: TechProfileCtx, serviceId: string, salonId?: string) {
    await this.requireCustomer(ctx);
    // Developer merge (Oct 6 2026): the app books at a chosen salon, but matched the session's DEFAULT salon's
    // technicians. A client-named salon is honoured only when it is one of THIS tenant's own branches.
    let branchId = ctx.branchId;
    const wanted = String(salonId ?? '').trim();
    if (wanted && wanted !== ctx.branchId) {
      const b: any = await (this.need() as any).selectFrom('branches').select('id').where('id', '=', wanted).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      if (!b) throw withCode(new TechProfileError('not_found', 'Salon not found.'), 'SALON_NOT_FOUND');
      branchId = wanted;
    }
    return { serviceId, technicians: await this.serviceTechnicians(ctx.tenantId, branchId, serviceId) };
  }

  /** GET /pos/services/:serviceId/technicians — reception-side matching (session tenant/branch). */
  async posServiceTechnicians(ctx: TechProfileCtx, serviceId: string) {
    return { serviceId, technicians: await this.serviceTechnicians(ctx.tenantId, ctx.branchId, serviceId, 'pos') };
  }

  private async requireCustomer(ctx: TechProfileCtx): Promise<string> {
    const row: any = await (this.need() as any).selectFrom('customers').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null).executeTakeFirst();
    if (!row) throw withCode(new TechProfileError('not_customer', 'No customer profile is linked to this account.'), 'NO_CUSTOMER_PROFILE');
    return row.id;
  }

  /** GET /customer/tech-ratings/pending — paid tickets with a tech the customer hasn't rated yet. */
  async customerPendingTechRatings(ctx: TechProfileCtx) {
    const customerId = await this.requireCustomer(ctx);
    const db: any = this.need();
    const rows: any[] = await db.selectFrom('tickets as k')
      .innerJoin('ticket_service_lines as l', 'l.ticket_id', 'k.id')
      .innerJoin('technicians as t', 't.id', 'l.technician_id')
      .where('k.tenant_id', '=', ctx.tenantId).where('k.customer_id', '=', customerId)
      .where('k.paid_at', 'is not', null).where('l.technician_id', 'is not', null).where('l.removed_at', 'is', null)
      .select(['k.id as ticket_id', 'k.paid_at', 't.id as technician_id', 't.full_name', 'l.service_name_snapshot'])
      .orderBy('k.paid_at', 'desc').limit(60).execute();
    const seen = new Set<string>();
    const prompts: any[] = [];
    for (const r of rows) {
      const key = `${r.ticket_id}:${r.technician_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dupe: any = await db.selectFrom('reviews').select('id')
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', r.ticket_id)
        .where('technician_id', '=', r.technician_id).where('customer_id', '=', customerId).executeTakeFirst();
      if (dupe) continue;
      prompts.push({
        ticketId: r.ticket_id, technicianId: r.technician_id, techName: r.full_name,
        serviceName: r.service_name_snapshot, paidAt: new Date(r.paid_at).toISOString(),
        prompt: `How was your service with ${r.full_name}?`,
      });
      if (prompts.length >= 10) break;
    }
    return { pending: prompts };
  }

  /** POST /customer/tickets/:ticketId/technician-ratings — verified, deduped, denorm-refreshing. */
  async customerSubmitTechRating(ctx: TechProfileCtx, ticketId: string, body: any) {
    const customerId = await this.requireCustomer(ctx);
    const rating = Number(body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw withCode(new TechProfileError('invalid', 'Rating must be 1 to 5 stars.'), 'RATING_INVALID');
    const technicianId = String(body?.technicianId ?? '');
    const db: any = this.need();
    const ticket: any = await db.selectFrom('tickets').where('id', '=', ticketId)
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId)
      .select(['id', 'branch_id', 'paid_at']).executeTakeFirst();
    if (!ticket) throw withCode(new TechProfileError('not_found', 'Ticket not found.'), 'TICKET_NOT_FOUND');
    if (!ticket.paid_at) throw withCode(new TechProfileError('invalid_state', 'You can rate your technician after checkout is completed.'), 'RATE_AFTER_CHECKOUT');
    const served: any = await db.selectFrom('ticket_service_lines').select('id')
      .where('ticket_id', '=', ticketId).where('technician_id', '=', technicianId).where('removed_at', 'is', null).executeTakeFirst();
    if (!served) throw withCode(new TechProfileError('invalid', 'That technician did not serve on this ticket.'), 'TECHNICIAN_DID_NOT_SERVE');
    const dupe: any = await db.selectFrom('reviews').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
      .where('technician_id', '=', technicianId).where('customer_id', '=', customerId).executeTakeFirst();
    if (dupe) throw withCode(new TechProfileError('invalid_state', 'You already rated this technician for this visit.'), 'ALREADY_RATED');
    const tech: any = await db.selectFrom('technicians').where('id', '=', technicianId)
      .where('tenant_id', '=', ctx.tenantId).select(['id', 'full_name', 'global_tech_profile_id']).executeTakeFirst();
    if (!tech) throw withCode(new TechProfileError('not_found', 'Technician not found.'), 'TECHNICIAN_NOT_FOUND');
    try {
        // §18/§81: the review row and review.submitted commit together. The partial-unique below still fires on a
        // concurrent double-submit — and because the event is in the same transaction, no event survives that case.
        await db.transaction().execute(async (trx: any) => {
          await trx.insertInto('reviews').values({
            tenant_id: ctx.tenantId, branch_id: ticket.branch_id, customer_id: customerId, ticket_id: ticketId,
            rating, comment: sanitizeText(body?.reviewText, 1000),
            technician_id: technicianId, global_tech_profile_id: tech.global_tech_profile_id ?? null,
            ticket_service_line_id: served.id, review_tags: JSON.stringify(sanitizeRatingTags(body?.tags)),
            is_public: body?.isPublic !== false,
          } as any).execute();
          if (this.outbox) await this.outbox.write(trx, createDomainEvent({
            eventType: DOMAIN_EVENTS.REVIEW_SUBMITTED, tenantId: ctx.tenantId, branchId: ticket.branch_id ?? undefined,
            aggregateType: 'review', aggregateId: ticketId, actorId: customerId, actorType: 'user',
            // §95: the score and ids — never the customer's written review text
            payload: { ticketId, technicianId, customerId, rating, isPublic: body?.isPublic !== false, hasComment: !!body?.reviewText },
          }));
        });
    } catch (e: any) {
      // partial-unique (tenant,ticket,technician,customer) — concurrent double-submit lands here, not as a 500
      if (String(e?.code) === '23505' || /duplicate key/.test(String(e?.message))) {
        throw withCode(new TechProfileError('invalid_state', 'You already rated this technician for this visit.'), 'ALREADY_RATED');
      }
      throw e;
    }
    if (tech.global_tech_profile_id) await this.recomputeRatingDenorm(tech.global_tech_profile_id);
    await db.insertInto('technician_notifications').values({
      tenant_id: ctx.tenantId, technician_id: technicianId, type: 'rating_received',
      title: `You received a ${rating}★ rating`, body: sanitizeText(body?.reviewText, 140), reference: ticketId,
    } as any).execute().catch(() => {});
    await this.audit(ctx, 'tech_rating_submitted', technicianId, { ticketId, rating });
    if (!this.emitsDomainEvents()) this.realtime?.toTenant(ctx as any, EVENTS.techRatingSubmitted as any, { technicianId, ticketId, rating });
    if (!this.emitsDomainEvents()) this.realtime?.toTechnician?.(technicianId, EVENTS.techRatingSubmitted as any, { ticketId, rating });
    return { ok: true as const, message: 'Thank you! Your rating helps customers choose the right technician.' };
  }

  /** GET /tech/profile/public-preview — the tech's own public page payload, even while is_public is OFF. */
  async myPublicPreview(ctx: TechProfileCtx) {
    const t = await this.myTechnician(ctx);
    if (!t.global_tech_profile_id) await this.getOrCreateMyProfile(ctx);
    const fresh = await this.myTechnician(ctx);
    const p = await this.loadProfile(fresh.global_tech_profile_id);
    const wasPublic = p.is_public;
    p.is_public = true; // preview bypass for the OWNER only — never persisted
    const payload = await this.buildPublicProfilePayload(p);
    return { ...payload, isLivePublicly: !!wasPublic };
  }

  private async myProfileId(ctx: TechProfileCtx): Promise<string> {
    const t = await this.myTechnician(ctx);
    if (t.global_tech_profile_id) return t.global_tech_profile_id;
    await this.getOrCreateMyProfile(ctx);
    return (await this.myTechnician(ctx)).global_tech_profile_id;
  }

  /** THE portfolio counter: approved AND published photos — the ones a customer can actually see. One definition, every writer. */
  private async refreshPhotoCount(profileId: string) {
    const db = this.need() as any;
    const r: any = await db.selectFrom('tech_portfolio_photos').where('global_tech_profile_id', '=', profileId)
      .where('moderation_status', '=', 'approved').where('is_public', '=', true).select(db.fn.countAll().as('n')).executeTakeFirst();
    await db.updateTable('global_tech_profiles').set({ portfolio_photo_count: Number(r?.n ?? 0), updated_at: new Date() }).where('id', '=', profileId).execute();
  }

  /** Phase 12 (#34): every technician image goes through the ONE upload policy — the bytes decide, EXIF (GPS) is stripped,
   *  and the key is server-chosen and random under the technician's global profile (`global/tech-profiles/<profile>/<kind>/…`;
   *  was `avatar-<ms>.<ext>` — two technicians in the same millisecond overwrote each other). The multipart guard already
   *  charged the salon's storage quota for the request. */
  private async putImage(ctx: TechProfileCtx, buf: Buffer, policy: UploadPolicy, profileId: string, kind: string): Promise<{ key: string; url: string }> {
    const up = await acceptUpload(policy, { bytes: buf, tenantId: ctx.tenantId ?? null, quotaReserved: true });
    const key = uploadObjectKey({ tenantId: null, area: 'tech-profiles', owner: [profileId, kind], ext: up.ext });
    const { url } = await this.store().put(key, up.bytes);
    return { key, url };
  }
  private async storeImage(ctx: TechProfileCtx, buf: Buffer, policy: UploadPolicy, profileId: string, kind: string): Promise<string> {
    return (await this.putImage(ctx, buf, policy, profileId, kind)).key;
  }

  /** POST /tech/profile/avatar — magic-byte validated, ≤5MB, stored behind the S3-shaped adapter. */
  async uploadAvatar(ctx: TechProfileCtx, buf: Buffer) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const v = validateImageUpload(buf, 'avatar');
    if (!v.ok) throw new TechProfileError('invalid', v.message);
    
    // Replace the previous avatar ONLY if it lives in THIS profile's namespace (global/tech-profiles/<profile>/avatar/…).
    // Legacy unnamespaced `avatar-<ts>` keys are shared with users.avatar_url across the platform; a key outside our
    // namespace is never ours to delete (Technician Profile merge).
    const oldProfile = await this.loadProfile(profileId);
    if (ownsOurProfileKey(oldProfile?.avatar_url, profileId, 'avatar')) {
      await this.store().remove(String(oldProfile.avatar_url).replace(/^\/media\//, '')).catch(() => {});
    }

    const filename = await this.storeImage(ctx, buf, UPLOAD_POLICIES.avatar, profileId, 'avatar');
    await db.updateTable('global_tech_profiles').set({ avatar_url: filename, updated_at: new Date() }).where('id', '=', profileId).execute().catch(() => {});
    if (ctx.userId) {
      await db.updateTable('users').set({ avatar_url: filename, updated_at: new Date() }).where('id', '=', ctx.userId).execute().catch(() => {});
      await db.updateTable('technicians').set({ avatar_url: filename, updated_at: new Date() }).where('user_id', '=', ctx.userId).execute().catch(() => {});
    }
    await db.updateTable('technicians').set({ avatar_url: filename, updated_at: new Date() }).where('global_tech_profile_id', '=', profileId).execute().catch(() => {});
    return this.shape(await this.loadProfile(profileId), ctx);
  }

  /** POST /tech/profile/cover — technician-owned cover banner. Same magic-byte validation + S3 pipeline as the avatar. */
  async uploadCover(ctx: TechProfileCtx, buf: Buffer) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const v = validateImageUpload(buf, 'avatar');
    if (!v.ok) throw new TechProfileError('invalid', v.message);

    const oldProfile = await this.loadProfile(profileId);
    if (ownsOurProfileKey(oldProfile?.cover_url, profileId, 'cover')) {
      await this.store().remove(String(oldProfile.cover_url).replace(/^\/media\//, '')).catch(() => {});
    }

    const filename = await this.storeImage(ctx, buf, UPLOAD_POLICIES.profilePhoto, profileId, 'cover');
    await db.updateTable('global_tech_profiles').set({ cover_url: filename, updated_at: new Date() }).where('id', '=', profileId).execute();
    await this.audit(ctx, 'tech_profile_cover_changed', (await this.myTechnician(ctx)).id, { profileId });
    return this.shape(await this.loadProfile(profileId), ctx);
  }

  /** DELETE /tech/profile/cover — fall back to the branded background. */

  async removeCover(ctx: TechProfileCtx) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    await db.updateTable('global_tech_profiles').set({ cover_url: null, updated_at: new Date() }).where('id', '=', profileId).execute();
    await this.audit(ctx, 'tech_profile_cover_changed', (await this.myTechnician(ctx)).id, { profileId, removed: true });
    return this.shape(await this.loadProfile(profileId), ctx);
  }

  /** POST /tech/profile/photos — multi-upload, each magic-byte validated, ≤10MB, thumbnail_url=image_url v1. */
  async addPortfolioPhotos(ctx: TechProfileCtx, files: Buffer[], caption?: string) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    if (!files.length) throw withCode(new TechProfileError('invalid', 'No images received.'), 'IMAGES_REQUIRED');
    if (files.length > 10) throw withCode(new TechProfileError('invalid', 'Upload at most 10 photos at a time.'), 'PHOTOS_MAX_10');
    for (const f of files) { const v = validateImageUpload(f, 'photo'); if (!v.ok) throw new TechProfileError('invalid', v.message); }
    const maxRow: any = await db.selectFrom('tech_portfolio_photos').where('global_tech_profile_id', '=', profileId)
      .select(db.fn.max('sort_order').as('m')).executeTakeFirst();
    let order = Number(maxRow?.m ?? -1);
    const created: any[] = [];
    for (const f of files) {
      const { url } = await this.putImage(ctx, f, UPLOAD_POLICIES.profilePhoto, profileId, 'portfolio');
      order += 1;
      const row: any = await db.insertInto('tech_portfolio_photos').values({
        global_tech_profile_id: profileId, tenant_id: ctx.tenantId, branch_id: ctx.branchId || null,
        uploaded_by_user_id: ctx.userId, image_url: url, thumbnail_url: url,
        caption: sanitizeText(caption, 140), sort_order: order,
        is_public: false, // consent: the technician publishes explicitly (PATCH isPublic) — never live on upload
      } as any).returning(['id', 'image_url', 'sort_order']).executeTakeFirst();
      created.push({ photoId: row.id, imageUrl: this.privateUrl(row.image_url), sortOrder: Number(row.sort_order) });
    }
    await this.refreshPhotoCount(profileId);
    return { ok: true as const, photos: created };
  }

  async listMyPhotos(ctx: TechProfileCtx) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const rows: any[] = await db.selectFrom('tech_portfolio_photos').where('global_tech_profile_id', '=', profileId)
      .where('moderation_status', '!=', 'rejected')
      .select(['id', 'image_url', 'thumbnail_url', 'caption', 'tags', 'service_category', 'is_public', 'is_featured', 'moderation_status', 'sort_order', 'created_at', 'nail_shape', 'nail_length', 'design_style', 'complexity', 'brand', 'color_name'])
      .orderBy('is_featured', 'desc').orderBy('sort_order', 'asc').execute();
    const consent = await this.consentForPhotos(rows.map((r) => r.id));
    // §46: which photos are (or are waiting to be) in the Nail Showcase
    const shared: any[] = rows.length ? await db.selectFrom('nail_showcase_posts').select(['id', 'portfolio_photo_id', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('portfolio_photo_id', 'in', rows.map((r) => r.id)).where('deleted_at', 'is', null).where('status', '!=', 'removed').execute().catch(() => []) : [];
    const showcase = new Map(shared.map((p) => [String(p.portfolio_photo_id), { postId: String(p.id), status: String(p.status) }]));
    // own view: a photo that is not (public + approved) is not served openly any more → hand the owner a signed url
    const url = (r: any, stored: string | null) => (r.is_public && r.moderation_status === 'approved' ? buildMediaUrl(stored) : this.privateUrl(stored));
    return rows.map((r) => ({
      photoId: r.id, imageUrl: url(r, r.image_url), thumbnailUrl: url(r, r.thumbnail_url), caption: r.caption,
      tags: this.j(r.tags, []), serviceCategory: r.service_category, isPublic: !!r.is_public, isFeatured: !!r.is_featured,
      moderationStatus: r.moderation_status, sortOrder: Number(r.sort_order), createdAt: new Date(r.created_at).toISOString(),
      nailShape: r.nail_shape, nailLength: r.nail_length, designStyle: r.design_style, complexity: r.complexity, brand: r.brand, colorName: r.color_name,
      consent: consent.get(r.id) ?? null,
      showcase: showcase.get(String(r.id)) ?? null,
    }));
  }

  /**
   * §46 POST /tech/profile/photos/:photoId/showcase — share ONE approved, public, consent-cleared portfolio photo into the
   * Nail Showcase as a post SHE authors at THIS salon (post_type technician_portfolio, 647). The salon's showcase policy
   * (576) decides whether it is live at once or waits for a manager's approval — the showcase's own moderation, not a
   * second one. Attribution (technician / salon / branch) is server-derived; the customer feed renders Book This Look
   * from it. Customer identity is never involved: the photo already passed the portfolio consent rules (§45).
   */
  async sharePhotoToShowcase(ctx: TechProfileCtx, photoId: string) {
    const db: any = this.need();
    const t = await this.myTechnician(ctx);
    const profileId = await this.myProfileId(ctx);
    await this.ownPhoto(profileId, photoId);
    const photo: any = await db.selectFrom('tech_portfolio_photos').where('id', '=', photoId).select(['id', 'image_url', 'thumbnail_url', 'caption', 'tags', 'is_public', 'moderation_status', 'design_style', 'nail_shape']).executeTakeFirst();
    if (!photo.is_public || photo.moderation_status !== 'approved') throw withCode(new TechProfileError('invalid', 'Only an approved, public portfolio photo can be shared to the Nail Showcase.'), 'PHOTO_NOT_SHAREABLE');
    const consent = (await this.consentForPhotos([photoId])).get(photoId);
    if (consent && !consentAllowsPublic(consent.approvedUses, consent.revoked)) throw withCode(new TechProfileError('invalid', 'The customer in this photo has not consented to public use.'), 'CUSTOMER_CONSENT_REQUIRED');
    // ONE live showcase post per portfolio photo across ALL her salons (uq_ns_posts_portfolio_photo_live, 647) — a global read by design:
    // the photo is hers (ownPhoto above), not a salon's; a share from salon B of a photo already live from salon A is "already shared".
    const existing: any = await db.selectFrom('nail_showcase_posts').select(['id', 'status', 'tenant_id']).where('portfolio_photo_id', '=', photoId).where('deleted_at', 'is', null).where('status', '!=', 'removed').executeTakeFirst();
    if (existing) return { ok: true as const, postId: String(existing.id), status: String(existing.status), already: true };
    const profile: any = await this.loadProfile(profileId);
    const policy: any = await db.selectFrom('nail_showcase_tenant_policy').select('auto_publish_manual').where('tenant_id', '=', ctx.tenantId).executeTakeFirst().catch(() => null);
    const status = policy?.auto_publish_manual ? 'published' : 'pending_review';
    const postId: string = await db.transaction().execute(async (trx: any) => {
      const post: any = await trx.insertInto('nail_showcase_posts').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId || t.branch_id || null, customer_id: ctx.userId, technician_id: t.id, service_id: null,
        caption: String(photo.caption ?? '').slice(0, 500), tags: JSON.stringify(this.j(photo.tags, [])), visibility: 'public_platform', post_type: 'technician_portfolio', status,
        is_verified_service: false, allow_comments: true, display_name: String(profile.display_name ?? t.full_name ?? 'Technician').slice(0, 60), is_anonymous: false, portfolio_photo_id: photoId,
      } as any).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('nail_showcase_photos').values({
        post_id: post.id, tenant_id: ctx.tenantId, branch_id: ctx.branchId || t.branch_id || null, customer_id: ctx.userId,
        image_url: photo.image_url, thumbnail_url: photo.thumbnail_url ?? null, sort_order: 0, caption: photo.caption ?? null,
        metadata: JSON.stringify({ source: 'tech_portfolio', portfolioPhotoId: photoId, designStyle: photo.design_style ?? null, nailShape: photo.nail_shape ?? null }),
      } as any).execute();
      return String(post.id);
    });
    await this.audit(ctx, 'tech_portfolio_photo_shared_to_showcase', t.id, { photoId, postId, status });
    return { ok: true as const, postId, status, already: false };
  }

  /** §46 DELETE /tech/profile/photos/:photoId/showcase — she takes her post out of the showcase (status → removed, soft-deleted). */
  async unsharePhotoFromShowcase(ctx: TechProfileCtx, photoId: string) {
    const db: any = this.need();
    const t = await this.myTechnician(ctx);
    const profileId = await this.myProfileId(ctx);
    await this.ownPhoto(profileId, photoId);
    const post: any = await db.selectFrom('nail_showcase_posts').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('portfolio_photo_id', '=', photoId).where('customer_id', '=', ctx.userId)
      .where('deleted_at', 'is', null).where('status', '!=', 'removed').executeTakeFirst();
    if (!post) return { ok: true as const, removed: false };
    await transitionStatus(db, NAIL_SHOWCASE_POST, { where: { id: String(post.id) }, from: post.status, to: 'removed', set: { deleted_at: new Date(), updated_at: new Date() } });
    await this.audit(ctx, 'tech_portfolio_photo_unshared_from_showcase', t.id, { photoId, postId: String(post.id) });
    return { ok: true as const, removed: true };
  }

  private async ownPhoto(profileId: string, photoId: string) {
    const row: any = await (this.need() as any).selectFrom('tech_portfolio_photos').where('id', '=', photoId)
      .select(['id', 'global_tech_profile_id', 'image_url']).executeTakeFirst();
    if (!row || row.global_tech_profile_id !== profileId) throw withCode(new TechProfileError('not_found', 'Photo not found.'), 'PHOTO_NOT_FOUND');
    return row;
  }

  /** PATCH /tech/profile/photos/:photoId — caption/tags/visibility/featured on OWN photos only. */
  async updatePhoto(ctx: TechProfileCtx, photoId: string, patch: any) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    await this.ownPhoto(profileId, photoId);
    const set: any = { updated_at: new Date() };
    if (patch.caption !== undefined) set.caption = sanitizeText(patch.caption, 140);
    if (patch.tags !== undefined) set.tags = JSON.stringify(Array.isArray(patch.tags) ? patch.tags.map((x: any) => sanitizeText(x, 30)).filter(Boolean).slice(0, 10) : []);
    if (patch.serviceCategory !== undefined) set.service_category = sanitizeText(patch.serviceCategory, 40);
    if (['nailShape', 'nailLength', 'designStyle', 'complexity', 'brand', 'colorName'].some((k) => patch[k] !== undefined)) {
      const tax = sanitizePortfolioTaxonomy(patch);
      if (patch.nailShape !== undefined) set.nail_shape = tax.nailShape;
      if (patch.nailLength !== undefined) set.nail_length = tax.nailLength;
      if (patch.designStyle !== undefined) set.design_style = tax.designStyle;
      if (patch.complexity !== undefined) set.complexity = tax.complexity;
      if (patch.brand !== undefined) set.brand = tax.brand;
      if (patch.colorName !== undefined) set.color_name = tax.colorName;
    }
    if (patch.isPublic !== undefined) set.is_public = !!patch.isPublic;
    if (patch.isFeatured !== undefined) set.is_featured = !!patch.isFeatured;
    await db.updateTable('tech_portfolio_photos').set(set).where('id', '=', photoId).execute();
    if (set.is_public !== undefined) { await this.refreshPhotoCount(profileId); await this.audit(ctx, set.is_public ? 'tech_portfolio_photo_published' : 'tech_portfolio_photo_unpublished', null, { photoId }); }
    return { ok: true as const };
  }

  /** DELETE /tech/profile/photos/:photoId — own photo; storage removal best-effort; count refreshed. */
  async deletePhoto(ctx: TechProfileCtx, photoId: string) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const row = await this.ownPhoto(profileId, photoId);
    await db.deleteFrom('tech_portfolio_photos').where('id', '=', photoId).execute();
    for (const k of new Set([ownedProfileImageKey(row.image_url, profileId), ownedProfileImageKey(row.thumbnail_url, profileId)])) if (k) await this.store().remove(k).catch(() => {}); // never a key outside our namespace
    await this.refreshPhotoCount(profileId);
    return { ok: true as const };
  }

  /** Map photoId → { approvedUses, revoked } for a set of photos (own/manager views attach this). */
  private async consentForPhotos(photoIds: string[]): Promise<Map<string, { approvedUses: string[]; revoked: boolean }>> {
    const out = new Map<string, { approvedUses: string[]; revoked: boolean }>();
    if (!photoIds.length) return out;
    const rows: any[] = await (this.need() as any).selectFrom('nail_photo_consent').where('photo_id', 'in', photoIds)
      .select(['photo_id', 'approved_uses', 'revoked']).execute().catch(() => []);
    for (const r of rows) out.set(r.photo_id, { approvedUses: this.j(r.approved_uses, []), revoked: !!r.revoked });
    return out;
  }

  /** POST /tech/profile/photos/:photoId/consent — record the customer's approved public uses for a service photo (Req §8). */
  async setPhotoConsent(ctx: TechProfileCtx, photoId: string, body: any) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    await this.ownPhoto(profileId, photoId);
    const approvedUses = sanitizeConsentUses(body?.approvedUses);
    const publicBlocked = !consentAllowsPublic(approvedUses, false);
    const usesJson = JSON.stringify(approvedUses);
    const customerId = typeof body?.customerId === 'string' ? body.customerId : null;
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId : null;
    const existing: any = await db.selectFrom('nail_photo_consent').where('photo_id', '=', photoId).select(['id']).executeTakeFirst();
    if (existing) {
      await db.updateTable('nail_photo_consent').set({
        approved_uses: usesJson, consent_version: sanitizeText(body?.consentVersion, 20), customer_id: customerId, ticket_id: ticketId,
        device: sanitizeText(body?.device, 60), session_id: sanitizeText(body?.session, 80),
        revoked: false, revoked_at: null, public_blocked: publicBlocked, updated_at: new Date(),
      } as any).where('photo_id', '=', photoId).execute();
    } else {
      await db.insertInto('nail_photo_consent').values({
        photo_id: photoId, tenant_id: ctx.tenantId || null, branch_id: ctx.branchId || null, global_tech_profile_id: profileId,
        customer_id: customerId, ticket_id: ticketId, approved_uses: usesJson, consent_version: sanitizeText(body?.consentVersion, 20),
        device: sanitizeText(body?.device, 60), session_id: sanitizeText(body?.session, 80), revoked: false, public_blocked: publicBlocked,
      } as any).execute();
    }
    await this.audit(ctx, 'nail_photo_consent_granted', null, { photoId, approvedUses, customerId, ticketId });
    return { ok: true as const, consent: { approvedUses, revoked: false } };
  }

  /** POST /tech/profile/photos/:photoId/consent/withdraw — revoke consent; photo drops from all public views (Req §8). */
  async withdrawPhotoConsent(ctx: TechProfileCtx, photoId: string) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    await this.ownPhoto(profileId, photoId);
    const existing: any = await db.selectFrom('nail_photo_consent').where('photo_id', '=', photoId).select(['id']).executeTakeFirst();
    if (existing) {
      await db.updateTable('nail_photo_consent').set({ revoked: true, revoked_at: new Date(), public_blocked: true, updated_at: new Date() } as any).where('photo_id', '=', photoId).execute();
    } else {
      await db.insertInto('nail_photo_consent').values({ photo_id: photoId, tenant_id: ctx.tenantId || null, branch_id: ctx.branchId || null, global_tech_profile_id: profileId, approved_uses: '[]', revoked: true, revoked_at: new Date(), public_blocked: true } as any).execute();
    }
    await this.audit(ctx, 'nail_photo_consent_withdrawn', null, { photoId });
    return { ok: true as const, consent: { approvedUses: [] as string[], revoked: true } };
  }

  // ───────────────────────────── Before/After sets (Req §7) ─────────────────────────────
  private shapeBeforeAfter(r: any, full: boolean) {
    const u = (stored: string | null) => (r.is_public && r.moderation_status === 'approved' ? buildMediaUrl(stored) : this.privateUrl(stored));
    const base = {
      setId: r.id, beforeImageUrl: u(r.before_image_url), beforeThumbnailUrl: u(r.before_thumbnail_url ?? r.before_image_url),
      afterImageUrl: u(r.after_image_url), afterThumbnailUrl: u(r.after_thumbnail_url ?? r.after_image_url),
      servicePerformed: r.service_performed, designNotes: r.design_notes, productsUsed: r.products_used,
      durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : null,
    };
    return full ? { ...base, customerConsent: !!r.customer_consent, isPublic: !!r.is_public, moderationStatus: r.moderation_status, createdAt: new Date(r.created_at).toISOString() } : base;
  }

  private async ownBeforeAfter(profileId: string, setId: string) {
    const row: any = await (this.need() as any).selectFrom('before_after_sets').where('id', '=', setId).selectAll().executeTakeFirst();
    if (!row || row.global_tech_profile_id !== profileId) throw withCode(new TechProfileError('not_found', 'Before/after set not found.'), 'BEFORE_AFTER_NOT_FOUND');
    return row;
  }

  /** POST /tech/profile/before-after — upload a before+after pair (magic-byte validated). Starts hidden until published. */
  async createBeforeAfter(ctx: TechProfileCtx, beforeBuf: Buffer, afterBuf: Buffer, meta: any) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    for (const [b, lbl] of [[beforeBuf, 'Before'], [afterBuf, 'After']] as const) { const v = validateImageUpload(b, 'photo'); if (!v.ok) throw withCode(new TechProfileError('invalid', `${lbl} image: ${v.message}`), 'IMAGE_INVALID'); }
    const store = async (buf: Buffer, which: string) => (await this.putImage(ctx, buf, UPLOAD_POLICIES.profilePhoto, profileId, `before-after-${which}`)).url;
    const beforeUrl = await store(beforeBuf, 'before');
    const afterUrl = await store(afterBuf, 'after');
    const d = Number(meta?.durationMinutes); const duration = Number.isFinite(d) && d > 0 && d <= 600 ? Math.round(d) : null;
    const maxRow: any = await db.selectFrom('before_after_sets').where('global_tech_profile_id', '=', profileId).select(db.fn.max('sort_order').as('m')).executeTakeFirst();
    const row: any = await db.insertInto('before_after_sets').values({
      global_tech_profile_id: profileId, tenant_id: ctx.tenantId || null, branch_id: ctx.branchId || null, uploaded_by_user_id: ctx.userId,
      before_image_url: beforeUrl, before_thumbnail_url: beforeUrl, after_image_url: afterUrl, after_thumbnail_url: afterUrl,
      service_performed: sanitizeText(meta?.servicePerformed, 80), design_notes: sanitizeText(meta?.designNotes, 280), products_used: sanitizeText(meta?.productsUsed, 120),
      duration_minutes: duration, customer_consent: !!meta?.customerConsent, is_public: false, sort_order: Number(maxRow?.m ?? -1) + 1,
    } as any).returning(['id']).executeTakeFirst();
    await this.audit(ctx, 'tech_before_after_created', null, { setId: row.id });
    return { ok: true as const, setId: row.id };
  }

  /** GET /tech/profile/before-after — the tech's own sets (full detail incl. visibility/consent). */
  async listMyBeforeAfter(ctx: TechProfileCtx) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const rows: any[] = await db.selectFrom('before_after_sets').where('global_tech_profile_id', '=', profileId)
      .orderBy('sort_order', 'asc').orderBy('created_at', 'desc').selectAll().execute();
    return rows.map((r) => this.shapeBeforeAfter(r, true));
  }

  /** PATCH /tech/profile/before-after/:setId — metadata, consent, and publish toggle (publish requires consent). */
  async updateBeforeAfter(ctx: TechProfileCtx, setId: string, patch: any) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const cur = await this.ownBeforeAfter(profileId, setId);
    const set: any = { updated_at: new Date() };
    if (patch.servicePerformed !== undefined) set.service_performed = sanitizeText(patch.servicePerformed, 80);
    if (patch.designNotes !== undefined) set.design_notes = sanitizeText(patch.designNotes, 280);
    if (patch.productsUsed !== undefined) set.products_used = sanitizeText(patch.productsUsed, 120);
    if (patch.durationMinutes !== undefined) { const d = Number(patch.durationMinutes); set.duration_minutes = Number.isFinite(d) && d > 0 && d <= 600 ? Math.round(d) : null; }
    if (patch.customerConsent !== undefined) set.customer_consent = !!patch.customerConsent;
    if (patch.isPublic !== undefined) {
      const wantPublic = !!patch.isPublic;
      const consent = patch.customerConsent !== undefined ? !!patch.customerConsent : !!cur.customer_consent;
      if (wantPublic && !consent) throw withCode(new TechProfileError('invalid', 'Customer consent is required before publishing a before/after set.'), 'CUSTOMER_CONSENT_REQUIRED');
      set.is_public = wantPublic;
    }
    await db.updateTable('before_after_sets').set(set).where('id', '=', setId).execute();
    await this.audit(ctx, 'tech_before_after_updated', null, { setId, fields: Object.keys(set).filter((k) => k !== 'updated_at') });
    return { ok: true as const };
  }

  /** DELETE /tech/profile/before-after/:setId — own set; images removed best-effort. */
  async deleteBeforeAfter(ctx: TechProfileCtx, setId: string) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    const cur = await this.ownBeforeAfter(profileId, setId);
    await db.deleteFrom('before_after_sets').where('id', '=', setId).execute();
    for (const u of [cur.before_image_url, cur.after_image_url]) { const key = ownedProfileImageKey(u, profileId); if (key) await this.store().remove(key).catch(() => {}); }
    await this.audit(ctx, 'tech_before_after_deleted', null, { setId });
    return { ok: true as const };
  }

  /** PATCH /tech/profile/photos/reorder — full own-id list sets sort_order by position. */
  async reorderPhotos(ctx: TechProfileCtx, photoIds: string[]) {
    const db = this.need() as any;
    const profileId = await this.myProfileId(ctx);
    if (!Array.isArray(photoIds) || !photoIds.length) throw new TechProfileError('invalid', 'Send the photo ids in their new order.');
    const mine: any[] = await db.selectFrom('tech_portfolio_photos').where('global_tech_profile_id', '=', profileId).select('id').execute();
    const mineSet = new Set(mine.map((m) => String(m.id)));
    if (photoIds.some((id) => !mineSet.has(String(id)))) throw withCode(new TechProfileError('not_found', 'One of those photos is not yours.'), 'PHOTO_NOT_YOURS');
    for (let i = 0; i < photoIds.length; i++) {
      await db.updateTable('tech_portfolio_photos').set({ sort_order: i, updated_at: new Date() }).where('id', '=', photoIds[i]).execute();
    }
    return { ok: true as const };
  }

  // ───────────────────────────── P5 — customer ↔ technician direct messaging ─────────────────────────────
  // Safety: only a customer who has booked with the technician may OPEN a thread, and only if the technician accepts
  // messages. Once open, both sides may message unless the thread is blocked. Either party can block or report.

  private dmThreadView(t: any) {
    return {
      threadId: t.id, status: t.status,
      lastMessageAt: t.last_message_at ? new Date(t.last_message_at).toISOString() : null,
      lastMessagePreview: t.last_message_preview ?? null,
      customerUnread: Number(t.customer_unread) || 0, technicianUnread: Number(t.technician_unread) || 0,
    };
  }

  /** Customer opens (or re-opens) a thread with a technician — gated by an existing booking + the tech accepting DMs. */
  async customerOpenThread(ctx: TechProfileCtx, slug: string) {
    const db: any = this.need();
    if (!ctx?.userId) throw withCode(new TechProfileError('unauthorized', 'Please sign in to send a message.'), 'AUTH_REQUIRED');
    const p: any = await db.selectFrom('global_tech_profiles').where('public_slug', '=', String(slug).toLowerCase()).selectAll().executeTakeFirst();
    if (!p || !p.is_public || p.admin_profile_hidden || p.status !== 'active') throw withCode(new TechProfileError('not_found', 'This profile is not available.'), 'PROFILE_NOT_AVAILABLE');
    if (!p.accepts_messages || p.admin_messaging_paused) throw withCode(new TechProfileError('messaging_off', `${p.display_name} isn't accepting messages right now.`), 'TECHNICIAN_NOT_ACCEPTING_MESSAGES');
    if (!(await this.viewerHasBookingWithProfile(ctx.userId, p.id))) throw withCode(new TechProfileError('not_booked', `You can message ${p.display_name} after your first booking with them.`), 'MESSAGE_AFTER_BOOKING');
    let thread: any = await db.selectFrom('tech_dm_threads').where('global_tech_profile_id', '=', p.id).where('customer_user_id', '=', ctx.userId).selectAll().executeTakeFirst();
    if (!thread) {
      const ins: any = await db.insertInto('tech_dm_threads').values({ global_tech_profile_id: p.id, customer_user_id: ctx.userId } as any).returningAll().executeTakeFirst().catch(() => null);
      thread = ins ?? await db.selectFrom('tech_dm_threads').where('global_tech_profile_id', '=', p.id).where('customer_user_id', '=', ctx.userId).selectAll().executeTakeFirst();
    }
    await this.recordProfileEvent(p.id, 'message_open', ctx.userId);
    return { ...this.dmThreadView(thread), displayName: p.display_name, avatarUrl: buildMediaUrl(p.avatar_url) };
  }

  private async dmCustomerThread(ctx: TechProfileCtx, threadId: string) {
    const db: any = this.need();
    const t: any = await db.selectFrom('tech_dm_threads').where('id', '=', threadId).selectAll().executeTakeFirst();
    if (!t || t.customer_user_id !== ctx?.userId) throw withCode(new TechProfileError('not_found', 'Conversation not found.'), 'CONVERSATION_NOT_FOUND');
    return t;
  }
  private async dmTechThread(ctx: TechProfileCtx, threadId: string) {
    const db: any = this.need();
    const gtp = (await this.myTechnician(ctx)).global_tech_profile_id;
    const t: any = await db.selectFrom('tech_dm_threads').where('id', '=', threadId).selectAll().executeTakeFirst();
    if (!t || !gtp || t.global_tech_profile_id !== gtp) throw withCode(new TechProfileError('not_found', 'Conversation not found.'), 'CONVERSATION_NOT_FOUND');
    return t;
  }

  private async dmSend(threadId: string, sender: 'customer' | 'technician', body: string) {
    const db: any = this.need();
    const text = sanitizeText(String(body ?? ''), 2000);
    if (!text) throw withCode(new TechProfileError('invalid', 'Message cannot be empty.'), 'MESSAGE_REQUIRED');
    await db.insertInto('tech_dm_messages').values({ thread_id: threadId, sender, body: text } as any).execute();
    const unreadCol = sender === 'customer' ? 'technician_unread' : 'customer_unread';
    await db.updateTable('tech_dm_threads').set({
      last_message_at: new Date() as any, last_message_preview: text.slice(0, 140), updated_at: new Date() as any,
    } as any).where('id', '=', threadId).execute();
    // increment the recipient's unread counter (separate statement keeps it simple + DB-agnostic on PGlite)
    await db.updateTable('tech_dm_threads').set((eb: any) => ({ [unreadCol]: eb(unreadCol, '+', 1) }) as any).where('id', '=', threadId).execute();
  }

  private dmMessagesOf(threadId: string) {
    return (this.need() as any).selectFrom('tech_dm_messages').where('thread_id', '=', threadId)
      .select(['id', 'sender', 'body', 'created_at']).orderBy('created_at', 'asc').limit(500).execute();
  }
  private mapDmMessages(rows: any[]) {
    return rows.map((m) => ({ id: m.id, sender: m.sender, body: m.body, createdAt: new Date(m.created_at).toISOString() }));
  }

  async customerSendMessage(ctx: TechProfileCtx, threadId: string, body: string) {
    const t = await this.dmCustomerThread(ctx, threadId);
    if (t.status !== 'active') throw withCode(new TechProfileError('blocked', 'This conversation is closed.'), 'CONVERSATION_CLOSED');
    await this.dmSend(threadId, 'customer', body);
    return { ok: true as const };
  }
  async customerListMessages(ctx: TechProfileCtx, threadId: string) {
    const t = await this.dmCustomerThread(ctx, threadId);
    await (this.need() as any).updateTable('tech_dm_threads').set({ customer_unread: 0 } as any).where('id', '=', threadId).execute();
    return { status: t.status, messages: this.mapDmMessages(await this.dmMessagesOf(threadId)) };
  }
  async customerListThreads(ctx: TechProfileCtx) {
    const db: any = this.need();
    if (!ctx?.userId) throw withCode(new TechProfileError('unauthorized', 'Please sign in.'), 'AUTH_REQUIRED');
    const rows: any[] = await db.selectFrom('tech_dm_threads as th')
      .innerJoin('global_tech_profiles as p', 'p.id', 'th.global_tech_profile_id')
      .where('th.customer_user_id', '=', ctx.userId)
      .select(['th.id', 'th.status', 'th.last_message_at', 'th.last_message_preview', 'th.customer_unread', 'th.technician_unread', 'p.display_name', 'p.avatar_url', 'p.public_slug'])
      .orderBy('th.last_message_at', 'desc').limit(100).execute();
    return { threads: rows.map((t) => ({ ...this.dmThreadView(t), displayName: t.display_name, avatarUrl: buildMediaUrl(t.avatar_url), publicSlug: t.public_slug })) };
  }

  async technicianSendMessage(ctx: TechProfileCtx, threadId: string, body: string) {
    const t = await this.dmTechThread(ctx, threadId);
    if (t.status !== 'active') throw withCode(new TechProfileError('blocked', 'This conversation is closed.'), 'CONVERSATION_CLOSED');
    await this.dmSend(threadId, 'technician', body);
    return { ok: true as const };
  }
  async technicianListMessages(ctx: TechProfileCtx, threadId: string) {
    const t = await this.dmTechThread(ctx, threadId);
    await (this.need() as any).updateTable('tech_dm_threads').set({ technician_unread: 0 } as any).where('id', '=', threadId).execute();
    return { status: t.status, messages: this.mapDmMessages(await this.dmMessagesOf(threadId)) };
  }
  async technicianListThreads(ctx: TechProfileCtx) {
    const db: any = this.need();
    const gtp = (await this.myTechnician(ctx)).global_tech_profile_id;
    if (!gtp) return { threads: [] as any[] };
    const rows: any[] = await db.selectFrom('tech_dm_threads as th')
      .leftJoin('customers as c', 'c.user_id', 'th.customer_user_id')
      .where('th.global_tech_profile_id', '=', gtp)
      .select(['th.id', 'th.status', 'th.last_message_at', 'th.last_message_preview', 'th.customer_unread', 'th.technician_unread', 'c.full_name'])
      .orderBy('th.last_message_at', 'desc').limit(100).execute();
    return { threads: rows.map((t) => ({ ...this.dmThreadView(t), customerName: reviewerDisplayName(t.full_name, false) })) };
  }

  /** Either party blocks the thread — no further messages until it's a fresh matter (kept simple: block is terminal). */
  async blockThread(ctx: TechProfileCtx, threadId: string, actor: 'customer' | 'technician') {
    const db: any = this.need();
    const t = actor === 'customer' ? await this.dmCustomerThread(ctx, threadId) : await this.dmTechThread(ctx, threadId);
    await transitionStatus(db, TECH_DM_THREAD, { where: { id: t.id }, to: actor === 'customer' ? 'blocked_by_customer' : 'blocked_by_technician', set: { updated_at: new Date() } });
    return { ok: true as const };
  }
  async reportThread(ctx: TechProfileCtx, threadId: string, actor: 'customer' | 'technician', reason?: string) {
    const db: any = this.need();
    const t = actor === 'customer' ? await this.dmCustomerThread(ctx, threadId) : await this.dmTechThread(ctx, threadId);
    await db.insertInto('tech_dm_reports').values({ thread_id: t.id, reported_by: actor, reporter_user_id: ctx?.userId ?? null, reason: sanitizeText(String(reason ?? ''), 300) || null } as any).execute();
    return { ok: true as const };
  }

  // ───────────────────────────── P6 — profile analytics (real event capture, never fabricated) ─────────────────────────────

  /** Best-effort event write. Analytics are only ever a sum of real rows, so a failed insert must never break the page. */
  private async recordProfileEvent(profileId: string, type: string, viewerUserId?: string | null, ref?: string | null) {
    if (!profileId) return;
    await (this.need() as any).insertInto('tech_profile_events')
      .values({ global_tech_profile_id: profileId, event_type: type, viewer_user_id: viewerUserId ?? null, ref: ref ? String(ref).slice(0, 120) : null } as any)
      .execute().catch(() => {});
  }

  /** Customer-reported low-stakes tap (a link click or a post open). Whitelisted so the client can't forge view/message counts. */
  async customerRecordEvent(ctx: TechProfileCtx, slug: string, type: string, ref?: string) {
    if (type !== 'link_click' && type !== 'post_tap') throw new TechProfileError('invalid', 'Unsupported event.');
    const p: any = await (this.need() as any).selectFrom('global_tech_profiles').where('public_slug', '=', String(slug).toLowerCase()).select(['id', 'is_public']).executeTakeFirst();
    if (!p || !p.is_public) return { ok: true as const }; // silently ignore unknown/private — telemetry is not an oracle
    await this.recordProfileEvent(p.id, type, ctx?.userId ?? null, ref ?? null);
    return { ok: true as const };
  }

  /** GET /tech/profile/analytics — the technician's own real numbers over a window (default 30 days). */
  async technicianAnalytics(ctx: TechProfileCtx, days = 30) {
    const db: any = this.need();
    const gtp = (await this.myTechnician(ctx)).global_tech_profile_id;
    const empty = { windowDays: days, totals: { profileViews: 0, linkClicks: 0, postTaps: 0, messagesOpened: 0 }, dailyViews: [] as { date: string; count: number }[], topLinks: [] as { ref: string; count: number }[], topPosts: [] as { ref: string; count: number }[] };
    if (!gtp) return empty;
    const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86400_000);
    const rows: any[] = await db.selectFrom('tech_profile_events')
      .where('global_tech_profile_id', '=', gtp).where('created_at', '>=', since as any)
      .select(['event_type', 'ref', 'created_at']).orderBy('created_at', 'desc').limit(20000).execute().catch(() => []);
    const totals = { profileViews: 0, linkClicks: 0, postTaps: 0, messagesOpened: 0 };
    const byDay = new Map<string, number>();
    const linkCounts = new Map<string, number>();
    const postCounts = new Map<string, number>();
    for (const r of rows) {
      if (r.event_type === 'profile_view') { totals.profileViews++; const d = new Date(r.created_at).toISOString().slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
      else if (r.event_type === 'link_click') { totals.linkClicks++; if (r.ref) linkCounts.set(r.ref, (linkCounts.get(r.ref) ?? 0) + 1); }
      else if (r.event_type === 'post_tap') { totals.postTaps++; if (r.ref) postCounts.set(r.ref, (postCounts.get(r.ref) ?? 0) + 1); }
      else if (r.event_type === 'message_open') { totals.messagesOpened++; }
    }
    const topN = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ref, count]) => ({ ref, count }));
    return {
      windowDays: days, totals,
      dailyViews: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
      topLinks: topN(linkCounts), topPosts: topN(postCounts),
    };
  }

  // ───────────────────────────── P8 — verification + moderation (Super Admin) ─────────────────────────────

  /** Technician asks to be verified. Moves an unverified profile to 'pending'; only a Super Admin can grant 'verified'. */
  async requestVerification(ctx: TechProfileCtx) {
    const db: any = this.need();
    const fresh = await this.myTechnician(ctx);
    if (!fresh.global_tech_profile_id) await this.getOrCreateMyProfile(ctx);
    const gtp = (await this.myTechnician(ctx)).global_tech_profile_id;
    const p: any = await db.selectFrom('global_tech_profiles').where('id', '=', gtp).select(['verification_status']).executeTakeFirst();
    const cur = p?.verification_status ?? 'unverified';
    if (cur === 'verified') return { verificationStatus: 'verified' as const };
    if (cur !== 'pending') {
      await db.updateTable('global_tech_profiles').set({ verification_status: 'pending', updated_at: new Date() as any } as any).where('id', '=', gtp).execute();
      await this.audit(ctx, 'tech_verification_requested', fresh.id, {});
    }
    return { verificationStatus: 'pending' as const };
  }

  /** Super Admin: profiles waiting for a verification decision. */
  async saListPendingVerifications() {
    const rows: any[] = await (this.need() as any).selectFrom('global_tech_profiles')
      .where('verification_status', '=', 'pending')
      .select(['id', 'public_slug', 'display_name', 'avatar_url', 'overall_rating', 'rating_count', 'portfolio_photo_count', 'verified_completed_services_count', 'updated_at'])
      .orderBy('updated_at', 'asc').limit(200).execute().catch(() => []);
    return { verifications: rows.map((p) => ({ profileId: p.id, publicSlug: p.public_slug, displayName: p.display_name, avatarUrl: p.avatar_url ?? null, rating: Number(p.overall_rating ?? 0), reviewCount: Number(p.rating_count ?? 0), portfolioCount: Number(p.portfolio_photo_count ?? 0), completedServices: Number(p.verified_completed_services_count ?? 0), requestedAt: p.updated_at ? new Date(p.updated_at).toISOString() : null })) };
  }

  /** Super Admin: grant or clear verification. Only this path can ever set 'verified'. */
  async saSetVerification(ctx: TechProfileCtx, profileId: string, status: 'verified' | 'unverified', note?: string) {
    if (status !== 'verified' && status !== 'unverified') throw new TechProfileError('invalid', 'Invalid verification status.');
    const db: any = this.need();
    const p: any = await db.selectFrom('global_tech_profiles').where('id', '=', profileId).select(['id']).executeTakeFirst();
    if (!p) throw withCode(new TechProfileError('not_found', 'Profile not found.'), 'PROFILE_NOT_FOUND');
    const verification = status;   // verification_status is not the account lifecycle (global_tech_profiles.status)
    await db.updateTable('global_tech_profiles').set({ verification_status: verification, updated_at: new Date() as any } as any).where('id', '=', profileId).execute();
    await db.insertInto('technician_audit_logs').values({ tenant_id: null, branch_id: null, technician_id: null, user_id: ctx?.userId ?? null, action: status === 'verified' ? 'tech_verified_by_superadmin' : 'tech_verification_cleared', ticket_id: null, metadata: JSON.stringify({ profileId, note: sanitizeText(String(note ?? ''), 300) || null }) } as any).execute().catch(() => {});
    return { ok: true as const, profileId, verificationStatus: status };
  }

  /** Super Admin: open DM abuse reports, with the reported conversation's context. */
  async saListDmReports() {
    const rows: any[] = await (this.need() as any).selectFrom('tech_dm_reports as r')
      .leftJoin('tech_dm_threads as th', 'th.id', 'r.thread_id')
      .leftJoin('global_tech_profiles as p', 'p.id', 'th.global_tech_profile_id')
      .where('r.status', '=', 'open')
      .select(['r.id', 'r.thread_id', 'r.reported_by', 'r.reason', 'r.created_at', 'th.status as thread_status', 'p.display_name', 'p.public_slug'])
      .orderBy('r.created_at', 'asc').limit(200).execute().catch(() => []);
    return { reports: rows.map((r) => ({ reportId: r.id, threadId: r.thread_id, reportedBy: r.reported_by, reason: r.reason ?? null, createdAt: new Date(r.created_at).toISOString(), threadStatus: r.thread_status ?? null, technicianName: r.display_name ?? null, technicianSlug: r.public_slug ?? null })) };
  }

  /** Super Admin: resolve a report — dismiss it, or block the thread so no further messages can flow. */
  async saResolveDmReport(ctx: TechProfileCtx, reportId: string, action: 'dismiss' | 'block_thread') {
    if (action !== 'dismiss' && action !== 'block_thread') throw new TechProfileError('invalid', 'Invalid action.');
    const db: any = this.need();
    const rep: any = await db.selectFrom('tech_dm_reports').where('id', '=', reportId).select(['id', 'thread_id', 'status']).executeTakeFirst();
    if (!rep) throw withCode(new TechProfileError('not_found', 'Report not found.'), 'REPORT_NOT_FOUND');
    if (action === 'block_thread' && rep.thread_id) {
      await transitionStatus(db, TECH_DM_THREAD, { where: { id: rep.thread_id }, to: 'blocked_by_technician', set: { updated_at: new Date() } });
    }
    // Phase 12 (#27): a report is resolved once — a second resolution is a 409, the first one's record is kept
    await transitionStatus(db, TECH_DM_REPORT, { where: { id: reportId }, from: 'open', to: 'resolved', set: { resolution: action, resolved_at: new Date(), resolved_by_user_id: ctx?.userId ?? null } });
    return { ok: true as const, reportId, action };
  }
}
