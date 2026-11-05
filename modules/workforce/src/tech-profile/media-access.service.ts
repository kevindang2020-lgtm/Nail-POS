// media-access.service.ts — the DB side of /media/* authorization (rules live in media-access-core.ts).
//
// Two questions, answered from the tables that REFERENCE a storage key:
//   facts(key)        → which object this is, its publish/moderation state, its owner profile's state
//   viewer(session,f) → does this verified session own the profile, or manage a salon where the tech is active
// Unknown keys (user avatars, social avatars, …) are 'other' and stay publicly servable — the lock-down is scoped to
// the private media classes the audit named: portfolio, before/after, skill documents, hidden profiles.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { classifyMediaKey, mediaKeyFromStored, mediaSignKey, signMediaUrl, type MediaObjectFacts, type MediaViewer } from './media-access-core';

@Injectable()
export class MediaAccessService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}

  /** Signing key from AUTH_SESSION_SECRET (null when unset → private media is served to sessions only). */
  signKey(): Buffer | null { return mediaSignKey(process.env.AUTH_SESSION_SECRET); }

  /** Short-lived signed URL for a stored reference; http(s) URLs pass through; no key → the plain /media path. */
  signedUrl(stored: string | null | undefined, ttlSeconds?: number): string | null {
    if (!stored) return null;
    if (/^https?:\/\//i.test(stored)) return stored;
    return signMediaUrl(stored, { signKey: this.signKey(), ttlSeconds }) ?? `/media/${mediaKeyFromStored(stored)}`;
  }

  async facts(key: string): Promise<MediaObjectFacts> {
    const kind = classifyMediaKey(key);
    const base: MediaObjectFacts = { kind, profileId: null, objectPublic: null, objectApproved: null, consentBlocked: false, profileHidden: false, profileStatus: null };
    const db: any = this.db;
    if (!db) return kind === 'other' ? base : { ...base, objectPublic: false, objectApproved: false }; // no DB → fail closed for private classes
    const k = mediaKeyFromStored(key) ?? '';
    const refs = [k, `/media/${k}`];
    try {
      if (kind === 'portfolio' || kind === 'other') {
        const ph: any = await db.selectFrom('tech_portfolio_photos as p')
          .leftJoin('nail_photo_consent as c', 'c.photo_id', 'p.id')
          .where((eb: any) => eb.or([eb('p.image_url', 'in', refs), eb('p.thumbnail_url', 'in', refs)]))
          .select(['p.global_tech_profile_id', 'p.is_public', 'p.moderation_status', 'c.public_blocked']).executeTakeFirst();
        if (ph) return this.withProfile(db, { ...base, kind: 'portfolio', profileId: ph.global_tech_profile_id, objectPublic: !!ph.is_public, objectApproved: ph.moderation_status === 'approved', consentBlocked: !!ph.public_blocked });
      }
      if (kind === 'before_after' || kind === 'other') {
        const ba: any = await db.selectFrom('before_after_sets')
          .where((eb: any) => eb.or([eb('before_image_url', 'in', refs), eb('after_image_url', 'in', refs), eb('before_thumbnail_url', 'in', refs), eb('after_thumbnail_url', 'in', refs)]))
          .select(['global_tech_profile_id', 'is_public', 'moderation_status']).executeTakeFirst();
        if (ba) return this.withProfile(db, { ...base, kind: 'before_after', profileId: ba.global_tech_profile_id, objectPublic: !!ba.is_public, objectApproved: ba.moderation_status === 'approved' });
      }
      if (kind === 'showcase') {
        const sp: any = await db.selectFrom('nail_showcase_photos as ph').innerJoin('nail_showcase_posts as p', 'p.id', 'ph.post_id')
          .where((eb: any) => eb.or([eb('ph.image_url', 'in', refs), eb('ph.thumbnail_url', 'in', refs)]))
          .select(['p.status', 'p.visibility', 'p.deleted_at']).executeTakeFirst();
        const pub = !!sp && sp.status === 'published' && sp.visibility !== 'private' && sp.deleted_at == null;
        return { ...base, objectPublic: pub, objectApproved: pub };
      }
      if (kind === 'skilldoc') {
        // skilldoc/<tenant>/<gtp>/<uuid> — the owner is in the path. OUR layout tenants/<tenant>/skill-docs/<userId>/… names
        // the LOGIN: resolve the profile through users.global_tech_profile_id. Legacy skill-docs/<userId>-… keys → super admin only.
        const m = /^skilldoc\/[^/]+\/([^/]+)\//.exec(k);
        let profileId: string | null = m?.[1] ?? null;
        const ours = /^tenants\/[^/]+\/skill-docs\/([^/]+)\//.exec(k);
        if (!profileId && ours) {
          const u: any = await db.selectFrom('users').where('id', '=', ours[1]).select(['global_tech_profile_id']).executeTakeFirst().catch(() => null);
          profileId = u?.global_tech_profile_id ?? null;
        }
        return this.withProfile(db, { ...base, profileId, objectPublic: false, objectApproved: false });
      }
      if (kind === 'avatar' || kind === 'cover') {
        const m = /^(?:avatar|cover)\/([^/]+)\//.exec(k);
        let profileId: string | null = m?.[1] ?? null;
        if (!profileId) {
          const col = kind === 'avatar' ? 'avatar_url' : 'cover_url';
          const p: any = await db.selectFrom('global_tech_profiles').where(col, 'in', refs).select(['id']).executeTakeFirst();
          profileId = p?.id ?? null;
        }
        return this.withProfile(db, { ...base, profileId });
      }
    } catch { /* fall through: unknown → base */ }
    return base;
  }

  private async withProfile(db: any, f: MediaObjectFacts): Promise<MediaObjectFacts> {
    if (!f.profileId) return f;
    const p: any = await db.selectFrom('global_tech_profiles').where('id', '=', f.profileId).select(['admin_profile_hidden', 'status']).executeTakeFirst().catch(() => null);
    if (!p) return f;
    return { ...f, profileHidden: !!p.admin_profile_hidden, profileStatus: p.status ?? null };
  }

  /** Resolve a verified session into the ownership facts the rules need. */
  async viewer(session: { userId: string; tenantId: string | null; role: string } | null, f: MediaObjectFacts): Promise<MediaViewer | null> {
    if (!session?.userId) return null;
    const v: MediaViewer = { userId: session.userId, role: session.role ?? null, tenantId: session.tenantId ?? null, ownsProfile: false, managesProfileTenant: false };
    const db: any = this.db;
    if (!db || !f.profileId) return v;
    try {
      const own: any = await db.selectFrom('technicians').where('user_id', '=', session.userId).where('global_tech_profile_id', '=', f.profileId).select(['id']).executeTakeFirst();
      if (own) v.ownsProfile = true;
      else {
        const u: any = await db.selectFrom('users').where('id', '=', session.userId).where('global_tech_profile_id', '=', f.profileId).select(['id']).executeTakeFirst().catch(() => null);
        if (u) v.ownsProfile = true;
      }
      if (session.tenantId) {
        const m: any = await db.selectFrom('tech_salon_memberships').where('tenant_id', '=', session.tenantId)
          .where('global_tech_profile_id', '=', f.profileId).where('status', '=', 'active').select(['id']).executeTakeFirst();
        if (m) v.managesProfileTenant = true;
      }
    } catch { /* fail closed: flags stay false */ }
    return v;
  }
}
