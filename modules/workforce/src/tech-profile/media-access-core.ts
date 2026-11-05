// media-access-core.ts — PURE rules for who may read a stored media object (Technician Profile merge, Oct 12 2026;
// mandate §93, §117–§118).
//
// `/media/*` used to stream ANY key to anyone: private and rejected portfolio photos, unpublished before/after sets,
// and the skill documents (certificates, licences) technicians upload for their manager. The controller is excluded
// from the session middleware on purpose — the customer app loads images anonymously — so the fix has to be
// STATELESS: a key is either public by the data that references it, or it is served only to a request that proves
// authorization, by a short-lived HMAC-signed URL (preferred: works in <img> tags, native apps, CDN pass-through) or
// by a verified session that the DB confirms owns / manages the technician.
//
// Everything here is Node-only + unit-testable: no Nest, no DB.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const MEDIA_SIGNED_URL_TTL_SECONDS = 15 * 60;

/** Dedicated media signing key derived from AUTH_SESSION_SECRET (never the session key itself). Empty → null (fail closed). */
export function mediaSignKey(sessionSecret: string | undefined | null): Buffer | null {
  if (!sessionSecret) return null;
  return createHmac('sha256', sessionSecret).update('aps:media-url:v1').digest();
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Normalise any stored reference (bare key, `/media/<key>`, `media/<key>`) to the bare storage key. http(s) → null. */
export function mediaKeyFromStored(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const s = String(stored).trim();
  if (!s || /^https?:\/\//i.test(s)) return null;
  return s.replace(/^\/+/, '').replace(/^media\//, '');
}

function sigFor(key: string, exp: number, signKey: Buffer): string {
  return b64url(createHmac('sha256', signKey).update(`m1.${key}.${exp}`).digest());
}

/** `/media/<key>?exp=<unix>&sig=<b64url>` — or null when no signing key is configured (callers then fall back to the plain path). */
export function signMediaUrl(key: string, opts: { signKey: Buffer | null; now?: number; ttlSeconds?: number }): string | null {
  const k = mediaKeyFromStored(key);
  if (!k || !opts.signKey || !opts.signKey.length) return null;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? MEDIA_SIGNED_URL_TTL_SECONDS);
  return `/media/${k}?exp=${exp}&sig=${sigFor(k, exp, opts.signKey)}`;
}

/** Constant-time verification. Expired, malformed, or unsigned → false. */
export function verifyMediaSignature(key: string, exp: unknown, sig: unknown, opts: { signKey: Buffer | null; now?: number }): boolean {
  if (!opts.signKey || !opts.signKey.length) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || typeof sig !== 'string' || !sig) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (e < now) return false;
  const expected = Buffer.from(sigFor(key, e, opts.signKey));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── Key namespaces ───────────────────────────────────────────────────────────────────────────────────────
export type MediaKeyKind = 'skilldoc' | 'portfolio' | 'before_after' | 'avatar' | 'cover' | 'showcase' | 'other';

/** `skilldoc/<tenant>/<gtp>/<uuid>.<ext>` — private namespace; nothing under it is ever served unsigned. */
export const SKILLDOC_PREFIX = 'skilldoc/';
export const AVATAR_PREFIX = 'avatar/';
export const COVER_PREFIX = 'cover/';

export function classifyMediaKey(key: string): MediaKeyKind {
  const k = mediaKeyFromStored(key) ?? '';
  // OUR layouts (packages/media uploadObjectKey): `global/tech-profiles/<profile>/<kind>/<random>.<ext>` for the
  // global profile's images, `tenants/<tenant>/skill-docs/<user>/…` for skill documents, `tenants/<tenant>/
  // nail-showcase/…` for showcase photos — plus the other chat's prefixes and the legacy bare names.
  if (k.startsWith(SKILLDOC_PREFIX) || k.startsWith('skill-docs/') || /^tenants\/[^/]+\/skill-docs\//.test(k)) return 'skilldoc';
  if (k.startsWith(AVATAR_PREFIX) || /^avatar-\d+\./.test(k) || /^global\/tech-profiles\/[^/]+\/avatar\//.test(k)) return 'avatar';
  if (k.startsWith(COVER_PREFIX) || /^cover-\d+\./.test(k) || /^global\/tech-profiles\/[^/]+\/cover\//.test(k)) return 'cover';
  if (/^tech-profiles\/[^/]+\/portfolio\//.test(k) || /^global\/tech-profiles\/[^/]+\/portfolio\//.test(k)) return 'portfolio';
  if (/^tech-profiles\/[^/]+\/before-after\//.test(k) || /^global\/tech-profiles\/[^/]+\/(before|after|before-after)\//.test(k)) return 'before_after';
  if (/\/nail-showcase\//.test(k)) return 'showcase';
  return 'other';
}

/** Namespaced, unguessable keys — the owner is in the path, so "never delete a key you don't own" is a string check. */
export function avatarKey(profileId: string, ext: string) { return `${AVATAR_PREFIX}${profileId}/${randomUUID()}.${ext}`; }
export function coverKey(profileId: string, ext: string) { return `${COVER_PREFIX}${profileId}/${randomUUID()}.${ext}`; }
export function skillDocKey(tenantId: string, profileId: string, ext: string) { return `${SKILLDOC_PREFIX}${tenantId}/${profileId}/${randomUUID()}.${ext}`; }
export function ownsNamespacedKey(stored: string | null | undefined, prefix: string, profileId: string): boolean {
  const k = mediaKeyFromStored(stored);
  return !!k && k.startsWith(`${prefix}${profileId}/`);
}

// ── Skill-document upload validation: magic bytes, never the declared type ────────────────────────────────
export const SKILLDOC_MAX_BYTES = 10 * 1024 * 1024;

export function sniffDocumentType(buf: Buffer): 'pdf' | 'jpg' | 'png' | 'webp' | null {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function validateSkillDocumentUpload(buf: Buffer): { ok: true; ext: 'pdf' | 'jpg' | 'png' | 'webp' } | { ok: false; message: string } {
  if (!buf || buf.length === 0) return { ok: false, message: 'No file received.' };
  if (buf.length > SKILLDOC_MAX_BYTES) return { ok: false, message: `File is too large — max ${Math.round(SKILLDOC_MAX_BYTES / 1024 / 1024)}MB.` };
  const ext = sniffDocumentType(buf);
  if (!ext) return { ok: false, message: 'Only PDF, JPG, PNG, or WebP files are allowed.' };
  return { ok: true, ext };
}

export const MEDIA_CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

// ── The decision ─────────────────────────────────────────────────────────────────────────────────────────
/** What the DB knows about the object a key references. `null` fields = not referenced by that table. */
export interface MediaObjectFacts {
  kind: MediaKeyKind;
  /** Global profile that owns the object (portfolio / before-after / avatar / cover / skilldoc), when known. */
  profileId: string | null;
  /** The object's own publish flags, when it is a portfolio photo / before-after set / showcase photo. */
  objectPublic: boolean | null;         // is_public (portfolio, before/after) · status==='published' && visibility!=='private' (showcase)
  objectApproved: boolean | null;       // moderation_status === 'approved' (portfolio, before/after); showcase: always true when published
  consentBlocked: boolean;              // nail_photo_consent.public_blocked
  /** Owning profile state. */
  profileHidden: boolean;               // admin_profile_hidden
  profileStatus: string | null;         // global_tech_profiles.status
}

export interface MediaViewer {
  userId: string | null;
  role: string | null;
  tenantId: string | null;
  /** DB-confirmed: this session's user IS the owning technician (technicians.user_id / users.global_tech_profile_id). */
  ownsProfile: boolean;
  /** DB-confirmed: this session's tenant has an ACTIVE membership of the owning profile (manager of a salon the tech works at). */
  managesProfileTenant: boolean;
}

const PROFILE_OK = (f: MediaObjectFacts) => !f.profileHidden && (f.profileStatus == null || f.profileStatus === 'active' || f.profileStatus === 'paused');
const MANAGER_ROLES = new Set(['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION']);

/** Is this object world-readable by the data that references it? */
export function isPubliclyServable(f: MediaObjectFacts): boolean {
  switch (f.kind) {
    case 'skilldoc': return false;
    case 'portfolio':
    case 'before_after':
      return f.objectPublic === true && f.objectApproved === true && !f.consentBlocked && PROFILE_OK(f);
    case 'showcase':
      return f.objectPublic === true;
    case 'avatar':
    case 'cover':
      // identity images are visible wherever the profile is; a hidden / suspended profile's are not
      return f.profileId == null ? true : PROFILE_OK(f);
    default:
      return true; // keys no private-media table references (user avatars, social avatars) keep today's behaviour
  }
}

/** May this (verified) viewer read a non-public object? Owner, manager of an active workplace, or super admin. */
export function viewerMayRead(f: MediaObjectFacts, v: MediaViewer | null): boolean {
  if (!v || !v.userId) return false;
  if (v.role === 'SUPER_ADMIN') return true;
  if (v.ownsProfile) return true;
  if (MANAGER_ROLES.has(String(v.role)) && v.managesProfileTenant) return true;
  return false;
}
