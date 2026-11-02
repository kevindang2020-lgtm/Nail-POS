// profile-change-approval.ts — Technician Profile mandate §95 (publicProfileChangesRequireApproval), §53 (public profile
// status vocabulary) and §62 (consented portable career history). Pure helpers + the small SQL the service calls.
//
// §95: a salon may require a manager's approval before the technician's PUBLIC profile edits go live. The policy is
// per salon (technician_profile_tenant_policy, 646). The profile is GLOBAL, so the rule is: if ANY salon where she is
// actively employed requires approval, her public-field edits are HELD (tech_profile_change_requests, one pending per
// profile) and a manager of one of THOSE salons approves or rejects. Settings that are hers alone (isPublic,
// acceptsMessages, marketplace discovery, bookable, career-history consent) never wait — they are not "public profile
// content", they are her switches. Nothing tenant-private is in a change request: only the public fields below.
import { sql } from 'kysely';
import { transitionStatus } from '@aipowersalon/database';
import { sanitizeLinkVisibility, sanitizeProfileLinks, sanitizeText } from './tech-profile-core';
import { TECH_PROFILE_CHANGE_REQUEST } from '../workforce-lifecycles';

/** The PUBLIC-CONTENT fields of PATCH /tech/profile (the ones §95 holds). Everything else in the patch is a switch. */
export const PUBLIC_PROFILE_FIELDS = ['displayName', 'title', 'bio', 'yearsExperience', 'specialties', 'certifications', 'styleTags', 'languages', 'profileLinks', 'profileLinkVisibility'] as const;

/** Split a PATCH body into the held public-content part and the apply-now switches. Unknown keys are dropped (no mass assignment). */
export function splitProfilePatch(patch: Record<string, unknown>): { publicFields: Record<string, unknown>; switches: Record<string, unknown> } {
  const publicFields: Record<string, unknown> = {}; const switches: Record<string, unknown> = {};
  const SWITCHES = ['isPublic', 'marketplaceDiscoveryEnabled', 'acceptsMessages', 'isBookable', 'careerHistoryPublic'];
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined) continue;
    if ((PUBLIC_PROFILE_FIELDS as readonly string[]).includes(k)) publicFields[k] = v;
    else if (SWITCHES.includes(k)) switches[k] = v;
  }
  return { publicFields, switches };
}

/**
 * The ONE sanitiser for public-content fields → global_tech_profiles column set. Used by the direct write, by the
 * held request (stored already-sanitised, re-run on approval) and by the manager's salon-assist edit.
 * Throws {code:'invalid'} when the display name would be emptied.
 */
export function sanitizePublicProfilePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const list = (v: unknown, max: number, len: number) => JSON.stringify(Array.isArray(v) ? v.map((x: any) => sanitizeText(x, max)).filter(Boolean).slice(0, len) : []);
  if (patch.displayName !== undefined) { const v = sanitizeText(patch.displayName, 60); if (!v) { const e: any = new Error('Display name is required.'); e.code = 'invalid'; throw e; } set.display_name = v; }
  if (patch.title !== undefined) set.title = sanitizeText(patch.title, 60);
  if (patch.bio !== undefined) set.bio = sanitizeText(patch.bio, 1000);
  if (patch.yearsExperience !== undefined) { const n = Number(patch.yearsExperience); set.years_experience = Number.isInteger(n) && n >= 0 && n <= 60 ? n : null; }
  if (patch.specialties !== undefined) set.specialties = list(patch.specialties, 40, 12);
  if (patch.certifications !== undefined) set.certifications = list(patch.certifications, 60, 20);
  if (patch.styleTags !== undefined) set.style_tags = list(patch.styleTags, 30, 20);
  if (patch.languages !== undefined) set.languages = list(patch.languages, 30, 8);
  if (patch.profileLinks !== undefined) set.profile_links = JSON.stringify(sanitizeProfileLinks(patch.profileLinks));
  if (patch.profileLinkVisibility !== undefined) set.profile_link_visibility = JSON.stringify(sanitizeLinkVisibility(patch.profileLinkVisibility));
  return set;
}

/** Column set → the camelCase "what changes" view a screen shows (JSON columns parsed back). */
export function describeHeldChanges(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const j = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };
  const map: Record<string, string> = { display_name: 'displayName', title: 'title', bio: 'bio', years_experience: 'yearsExperience', specialties: 'specialties', certifications: 'certifications', style_tags: 'styleTags', languages: 'languages', profile_links: 'profileLinks', profile_link_visibility: 'profileLinkVisibility' };
  for (const [k, v] of Object.entries(set)) if (map[k]) out[map[k]] = ['specialties', 'certifications', 'style_tags', 'languages', 'profile_links', 'profile_link_visibility'].includes(k) ? j(v) : v;
  return out;
}

/** §53 — ONE derived vocabulary over is_public + the platform status + the admin hide. */
export type PublicProfileStatus = 'PUBLIC' | 'PRIVATE' | 'HIDDEN' | 'SUSPENDED';
export function publicProfileStatus(p: { is_public?: boolean | null; status?: string | null; admin_profile_hidden?: boolean | null }): PublicProfileStatus {
  const st = String(p.status ?? 'active');
  if (st === 'suspended' || st === 'locked') return 'SUSPENDED';
  if (st !== 'active' || p.admin_profile_hidden) return 'HIDDEN';
  return p.is_public ? 'PUBLIC' : 'PRIVATE';
}

/** The salons (tenant ids) where this profile is ACTIVELY employed and whose policy requires approval. */
export async function approvalTenantsFor(db: any, profileId: string): Promise<string[]> {
  const r: any = await sql`
    select m.tenant_id from tech_salon_memberships m
      join technician_profile_tenant_policy p on p.tenant_id = m.tenant_id and p.public_profile_changes_require_approval = true
     where m.global_tech_profile_id = ${profileId} and m.status = 'active'`.execute(db).catch(() => ({ rows: [] }));
  return (r?.rows ?? []).map((x: any) => String(x.tenant_id));
}

/** Upsert the ONE pending request for a profile: a new edit merges over the held payload (last write per field wins). */
export async function holdProfileChanges(db: any, i: { profileId: string; set: Record<string, unknown>; requestedByUserId: string | null; requestedInTenantId: string | null }): Promise<{ requestId: string; changes: Record<string, unknown> }> {
  const existing: any = await sql`select id, changes from tech_profile_change_requests where global_tech_profile_id = ${i.profileId} and status = 'pending' limit 1`.execute(db);
  const prev = existing?.rows?.[0];
  const merged = { ...(prev ? (typeof prev.changes === 'string' ? JSON.parse(prev.changes) : prev.changes ?? {}) : {}), ...i.set };
  if (prev) {
    await sql`update tech_profile_change_requests set changes = ${JSON.stringify(merged)}::jsonb, version = version + 1, updated_at = now(),
                requested_by_user_id = ${i.requestedByUserId}, requested_in_tenant_id = ${i.requestedInTenantId} where id = ${prev.id}`.execute(db);
    return { requestId: String(prev.id), changes: merged };
  }
  const ins: any = await sql`insert into tech_profile_change_requests (global_tech_profile_id, requested_by_user_id, requested_in_tenant_id, changes)
    values (${i.profileId}, ${i.requestedByUserId}, ${i.requestedInTenantId}, ${JSON.stringify(merged)}::jsonb) returning id`.execute(db);
  return { requestId: String(ins.rows[0].id), changes: merged };
}

export interface PendingProfileChange { requestId: string; profileId: string; technicianId: string | null; displayName: string; changes: Record<string, unknown>; current: Record<string, unknown>; requestedAt: string; version: number }

/** The pending requests a manager of THIS salon may decide: profiles actively employed here. Nothing from other salons. */
export async function listPendingForTenant(db: any, tenantId: string): Promise<PendingProfileChange[]> {
  const r: any = await sql`
    select r.id, r.global_tech_profile_id, r.changes, r.created_at, r.version, p.display_name, p.title, p.bio, p.years_experience, p.specialties, p.certifications, p.style_tags, p.languages, p.profile_links, p.profile_link_visibility,
           (select t.id from technicians t where t.tenant_id = ${tenantId} and t.global_tech_profile_id = p.id and t.archived_at is null limit 1) as technician_id
      from tech_profile_change_requests r
      join global_tech_profiles p on p.id = r.global_tech_profile_id
     where r.status = 'pending'
       and exists (select 1 from tech_salon_memberships m where m.global_tech_profile_id = r.global_tech_profile_id and m.tenant_id = ${tenantId} and m.status = 'active')
     order by r.created_at asc limit 100`.execute(db);
  return (r?.rows ?? []).map((x: any) => ({
    requestId: String(x.id), profileId: String(x.global_tech_profile_id), technicianId: x.technician_id ? String(x.technician_id) : null,
    displayName: String(x.display_name ?? ''), changes: describeHeldChanges(typeof x.changes === 'string' ? JSON.parse(x.changes) : x.changes ?? {}),
    current: describeHeldChanges({ display_name: x.display_name, title: x.title, bio: x.bio, years_experience: x.years_experience, specialties: x.specialties, certifications: x.certifications, style_tags: x.style_tags, languages: x.languages, profile_links: x.profile_links, profile_link_visibility: x.profile_link_visibility }),
    requestedAt: new Date(x.created_at).toISOString(), version: Number(x.version ?? 1),
  }));
}

/** The technician's own pending request (for her screen), or null. */
export async function myPendingChange(db: any, profileId: string): Promise<{ requestId: string; changes: Record<string, unknown>; requestedAt: string } | null> {
  const r: any = await sql`select id, changes, created_at from tech_profile_change_requests where global_tech_profile_id = ${profileId} and status = 'pending' limit 1`.execute(db).catch(() => ({ rows: [] }));
  const x = r?.rows?.[0];
  return x ? { requestId: String(x.id), changes: describeHeldChanges(typeof x.changes === 'string' ? JSON.parse(x.changes) : x.changes ?? {}), requestedAt: new Date(x.created_at).toISOString() } : null;
}

/**
 * Decide a pending request. Tenant-scoped (the request must belong to a profile actively employed at `tenantId`),
 * optimistic (§104: `version` must match → else VERSION_CONFLICT), and the approval applies the held set verbatim
 * through the same sanitiser inside ONE transaction. Returns the profile id for the caller's audit / realtime.
 */
export async function decideProfileChange(trx: any, i: { requestId: string; tenantId: string; decision: 'approved' | 'rejected'; version: number; decidedByUserId: string | null; note: string | null }): Promise<{ profileId: string; applied: Record<string, unknown> }> {
  const r: any = await sql`
    select r.id, r.global_tech_profile_id, r.changes, r.version, r.status from tech_profile_change_requests r
     where r.id = ${i.requestId}
       and exists (select 1 from tech_salon_memberships m where m.global_tech_profile_id = r.global_tech_profile_id and m.tenant_id = ${i.tenantId} and m.status = 'active')
     for update`.execute(trx);
  const row = r?.rows?.[0];
  if (!row) { const e: any = new Error('Profile change request not found.'); e.code = 'not_found'; throw e; }
  if (row.status !== 'pending') { const e: any = new Error('This request was already decided.'); e.code = 'VERSION_CONFLICT'; throw e; }
  if (Number(row.version) !== Number(i.version)) { const e: any = new Error('This request changed since you loaded it. Refresh and decide again.'); e.code = 'VERSION_CONFLICT'; throw e; }
  const held = typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes ?? {};
  let applied: Record<string, unknown> = {};
  if (i.decision === 'approved') {
    applied = sanitizePublicProfilePatch(describeHeldChanges(held));   // re-sanitised: the stored payload is data, never trusted verbatim
    if (Object.keys(applied).length) {
      const sets = Object.entries(applied).map(([k, v]) => sql`${sql.ref(k)} = ${v as any}`);
      await sql`update global_tech_profiles set ${sql.join(sets, sql`, `)}, updated_at = now() where id = ${row.global_tech_profile_id}`.execute(trx);
    }
  }
  // the status write goes through the ONE machine (pending → approved | rejected); a concurrent decision surfaces as a conflict
  const moved = await transitionStatus(trx, TECH_PROFILE_CHANGE_REQUEST, { where: { id: String(row.id) }, from: 'pending', to: i.decision,
    set: { decided_by_user_id: i.decidedByUserId, decided_in_tenant_id: i.tenantId, decision_note: i.note, decided_at: new Date(), version: Number(row.version) + 1, updated_at: new Date() } }).catch(() => null);
  if (!moved) { const e: any = new Error('This request was already decided.'); e.code = 'VERSION_CONFLICT'; throw e; }
  return { profileId: String(row.global_tech_profile_id), applied };
}

/** She withdraws her own held edit (pending → withdrawn). Returns false when nothing was pending. */
export async function withdrawPendingChange(db: any, profileId: string): Promise<boolean> {
  const r: any = await sql`select id, version from tech_profile_change_requests where global_tech_profile_id = ${profileId} and status = 'pending' limit 1`.execute(db);
  const row = r?.rows?.[0];
  if (!row) return false;
  const moved = await transitionStatus(db, TECH_PROFILE_CHANGE_REQUEST, { where: { id: String(row.id) }, from: 'pending', to: 'withdrawn', set: { decided_at: new Date(), version: Number(row.version) + 1, updated_at: new Date() } }).catch(() => null);
  return !!moved;
}

/** §62 — the consented career history: salon NAMES + years, nothing else. Empty unless she opted in. */
export async function careerHistoryFor(db: any, profileId: string, optedIn: boolean): Promise<Array<{ salonName: string; from: number | null; to: number | null; current: boolean }>> {
  if (!optedIn) return [];
  const r: any = await sql`
    select tn.display_name, m.status, m.start_date, m.end_date, m.created_at
      from tech_salon_memberships m join tenants tn on tn.id = m.tenant_id
     where m.global_tech_profile_id = ${profileId} and m.status in ('active','former','paused')
     order by coalesce(m.start_date, m.created_at) desc limit 20`.execute(db).catch(() => ({ rows: [] }));
  const year = (v: unknown) => (v ? new Date(v as any).getFullYear() : null);
  return (r?.rows ?? []).map((x: any) => ({ salonName: String(x.display_name ?? ''), from: year(x.start_date ?? x.created_at), to: x.status === 'active' ? null : year(x.end_date), current: x.status === 'active' }));
}
