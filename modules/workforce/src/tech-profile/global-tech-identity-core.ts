// global-tech-identity-core.ts — the PURE decisions behind one permanent technician identity.
//
// No database, no Nest, no I/O. Everything here is a function of its inputs, so the rules that decide
// "is this the same human being?" and "what is a salon allowed to see about a technician it has not hired
// yet?" can be tested directly instead of inferred from a stack of queries.
//
// Phone/email normalization deliberately REUSES customer-activation-core — the same primitives the
// customer-phone module uses. Two normalizers would eventually disagree, and the day they disagreed the
// platform would quietly mint a second global profile for a technician who already had one.
import { normalizePhone, phoneKey } from '@aipowersalon/customers';

/**
 * Lives HERE, not in the service, and that is deliberate.
 *
 * The `*-core.spec.ts` harnesses are bundled by esbuild and run in plain node with no Nest — that is what
 * "Nest-free core specs" means. A value import from a file that imports @nestjs/common pulls the whole of Nest
 * into that bundle and it fails to build. So the one value TechniciansService needs from the identity system —
 * this error — is defined in the pure module that neither Nest nor Kysely can reach.
 */
export class GlobalTechIdentityError extends Error {
  constructor(public code: string, msg: string) { super(msg); this.name = 'GlobalTechIdentityError'; }
}

// ── the permanent id ─────────────────────────────────────────────────────────────────────────────────────

/** TECH-000123. Sequence-backed upstream; this only formats. Width 6 → 999,999 technicians before it grows. */
export function formatTechCode(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('tech code sequence must be a positive integer');
  return `TECH-${String(seq).padStart(6, '0')}`;
}

export function isTechCode(v: unknown): boolean {
  return typeof v === 'string' && /^TECH-\d{6,}$/.test(v);
}

// ── identity keys ────────────────────────────────────────────────────────────────────────────────────────

export interface IdentityKeys {
  normalizedPhone: string | null;
  phoneHash: string | null;
  emailNormalized: string | null;
}

export function normalizeTechEmail(raw?: string | null): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

/**
 * The keys a technician is recognised by, ACROSS salons.
 *
 * phone_hash is unsalted on purpose. For a CUSTOMER, a hash that collides across tenants would be a leak —
 * two salons must not be able to discover they share a client. For a TECHNICIAN it is the entire feature:
 * the same person really is the same person at Salon A and Salon B, and the platform's job is to say so.
 */
export function identityKeys(input: { phone?: string | null; email?: string | null }): IdentityKeys {
  const e164 = normalizePhone(String(input.phone ?? ''));
  return {
    normalizedPhone: e164,
    phoneHash: e164 ? phoneKey(e164) : null,
    emailNormalized: normalizeTechEmail(input.email),
  };
}

/** "Olivia Brown" → first/last, without losing multi-part surnames. */
export function splitName(full: string): { firstName: string; lastName: string; fullName: string } {
  const clean = String(full ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: '', lastName: '', fullName: '' };
  const [first, ...rest] = clean.split(' ');
  return { firstName: first, lastName: rest.join(' '), fullName: clean };
}

// ── the link decision ────────────────────────────────────────────────────────────────────────────────────

/** What a lookup found. `status` is the GLOBAL account status, not the salon relationship. */
/** Every status global_tech_profiles.status can hold (migrations 376 → 378 → 395). */
export type GlobalProfileStatus = 'active' | 'paused' | 'locked' | 'suspended' | 'anonymized' | 'merged';

export interface ExistingProfile {
  profileId: string;
  techCode: string;
  displayName: string;
  status: GlobalProfileStatus;
  matchedOn: 'phone' | 'email';
}

export type IdentityRefusalCode = 'platform_suspended' | 'platform_paused' | 'platform_locked' | 'platform_merged';

export type IdentityDecision =
  | { action: 'link_existing'; profileId: string; techCode: string; matchedOn: 'phone' | 'email' }
  | { action: 'create_new' }
  | { action: 'refuse'; code: IdentityRefusalCode; message: string };

/**
 * Given what the lookup found, decide what the manager's create-technician flow does.
 *
 * Three rules, and the second and third are the ones that matter:
 *
 *  1. A match → LINK. Never a second global account for a person who already has one. This is the whole
 *     "do not duplicate technician accounts" requirement, and it is one branch.
 *
 *  2. An ANONYMIZED match is NOT a match. That row is a tombstone: its PII was stripped when the platform
 *     honoured a deletion request, and its keys were released. Linking a new hire to it would resurrect a
 *     deleted account and hand the new person the old person's followers and ratings. It creates a NEW
 *     profile — and the tombstone keeps its tech_code forever, which is how "never reuse a technician ID"
 *     is actually enforced rather than merely asserted.
 *
 *  3. A SUSPENDED match refuses. A platform-level suspension that a salon could route around by simply
 *     re-hiring the technician is not a suspension. This returns a refusal the manager can read, not a
 *     silent new account.
 */
export function decideIdentity(found: ExistingProfile | null): IdentityDecision {
  if (!found) return { action: 'create_new' };
  if (found.status === 'anonymized') return { action: 'create_new' };
  // Only an ACTIVE account can be linked. The four non-active, non-tombstone statuses each refuse with their own
  // code, so the manager reads the real reason — and so that none of them can be routed around by re-hiring:
  //   suspended → a platform sanction;  locked → a security stop;  paused → a reversible restriction the
  //   technician or support asked for;  merged → a signpost (findByKeys follows it to the canonical account,
  //   so arriving here means the signpost was handed in directly — refuse rather than link to a dead row).
  if (found.status === 'suspended') {
    return {
      action: 'refuse',
      code: 'platform_suspended',
      message: 'This technician’s platform account is suspended. Contact AIPowerSalon support — a salon cannot re-hire around a platform suspension.',
    };
  }
  if (found.status === 'locked') {
    return { action: 'refuse', code: 'platform_locked', message: 'This technician’s platform account is locked for security. Contact AIPowerSalon support.' };
  }
  if (found.status === 'paused') {
    return { action: 'refuse', code: 'platform_paused', message: 'This technician’s platform account is paused. It must be reactivated before a salon can link to it.' };
  }
  if (found.status === 'merged') {
    return { action: 'refuse', code: 'platform_merged', message: 'This technician profile was merged into another account. Look the technician up again.' };
  }
  return { action: 'link_existing', profileId: found.profileId, techCode: found.techCode, matchedOn: found.matchedOn };
}

// ── what a salon may see about a technician it has NOT hired ─────────────────────────────────────────────

/** The full row as the lookup reads it from the global profile. Never returned to a manager as-is. */
export interface GlobalProfileRow {
  profileId: string;
  techCode: string;
  displayName: string;
  avatarUrl: string | null;
  yearsExperience: number | null;
  overallRating: number | null;
  ratingCount: number;
  portfolioPhotoCount: number;
  status: GlobalProfileStatus;
  normalizedPhone: string | null;
  emailNormalized: string | null;
  /** Salons this technician is ACTIVE at. Used only for the count and the already-here flag — never listed. */
  activeTenantIds: string[];
  /**
   * Salons with an OPEN relationship that is not yet (or no longer) 'active': a pending invite / approval, a paused
   * or suspended membership, or a live roster row that carries this profile. A salon in this list may not create
   * her again either — it already has her, in some state. Never listed to a manager; only compared.
   */
  openTenantIds?: string[];
}

export interface ManagerLookupView {
  found: true;
  techCode: string;
  displayName: string;
  avatarUrl: string | null;
  yearsExperience: number | null;
  overallRating: number | null;
  ratingCount: number;
  portfolioPhotoCount: number;
  /** Already employed at — or already invited to / on the roster of — the salon doing the lookup. */
  alreadyAtThisSalon: boolean;
  /** What that relationship is, so the create guard can say it plainly. */
  relationshipHere: 'active' | 'open' | null;
  /** How many salons in total, as a NUMBER. Never which ones. */
  activeSalonCount: number;
  platformStatus: Exclude<GlobalProfileStatus, 'anonymized'>;
}

/**
 * The disclosure boundary for `POST /pos/technicians/lookup`.
 *
 * A manager typing a phone number is asking "does this person already have an AIPowerSalon account?" — they
 * are NOT asking "where else does this person work". Those are different questions and only the first one is
 * theirs to ask. So this returns the technician's own PUBLIC identity (the same fields any customer sees on
 * the public profile) plus a COUNT, and never the names of the other salons.
 *
 * Returning the salon list here would hand every manager on the platform a competitor-roster tool built out
 * of the technician's employment history, and the technician never consented to that.
 */
export function managerLookupView(row: GlobalProfileRow, viewerTenantId: string): ManagerLookupView | { found: false } {
  if (row.status === 'anonymized') return { found: false };   // a tombstone is not a person you can hire
  const active = row.activeTenantIds.includes(viewerTenantId);
  const open = !active && (row.openTenantIds ?? []).includes(viewerTenantId);
  return {
    found: true,
    techCode: row.techCode,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    yearsExperience: row.yearsExperience,
    overallRating: row.overallRating,
    ratingCount: row.ratingCount,
    portfolioPhotoCount: row.portfolioPhotoCount,
    alreadyAtThisSalon: active || open,
    relationshipHere: active ? 'active' : open ? 'open' : null,
    activeSalonCount: row.activeTenantIds.length,
    platformStatus: row.status,
  };
}

// ── the employment relationship ──────────────────────────────────────────────────────────────────────────

export const MEMBERSHIP_STATUSES = [
  'pending_invite', 'pending_tech_approval', 'pending_salon_approval',
  'active', 'suspended', 'former', 'rejected', 'revoked', 'cancelled',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** The tech can work — and can select this salon in the app switcher. */
export function isEmployed(status: string): boolean {
  return status === 'active';
}

/**
 * A membership that is OVER. Everything else — pending, active, paused, suspended — is an open relationship:
 * the salon still "has" this technician in some state, and must not create her a second time.
 */
export const ENDED_MEMBERSHIP_STATUSES = ['former', 'rejected', 'revoked', 'cancelled'] as const;
export function isEndedMembership(status: string): boolean {
  return (ENDED_MEMBERSHIP_STATUSES as readonly string[]).includes(status);
}

/**
 * The per-branch ROLE a membership grants its login (user_branch_access.role). Only roles rbac knows: a
 * role_label that says "manager" makes her a MANAGER at that branch; everything else is a TECHNICIAN. There is
 * no BRANCH_MANAGER in the Role vocabulary, and inventing one here would be a string no guard honours.
 */
export function branchRoleForLabel(roleLabel: string | null | undefined): 'MANAGER' | 'TECHNICIAN' {
  return /manager/i.test(String(roleLabel ?? '')) ? 'MANAGER' : 'TECHNICIAN';
}

/** Shows in the tech's Workplaces list as something they must act on. */
export function needsTechAction(status: string): boolean {
  return status === 'pending_invite' || status === 'pending_tech_approval';
}

/** Shows in the salon's approval queue. */
export function needsSalonAction(status: string): boolean {
  return status === 'pending_salon_approval';
}

/**
 * A salon may end its OWN relationship with a technician. It may never touch the global account.
 *
 * This is the enforcement point for "a salon can remove the technician from that salon but cannot delete the
 * global account" — the salon's entire vocabulary of destruction is these three words, and none of them
 * reaches global_tech_profiles.
 */
export const SALON_TERMINAL_STATUSES = ['suspended', 'former', 'revoked'] as const;
export type SalonTerminalStatus = (typeof SALON_TERMINAL_STATUSES)[number];

export function isSalonTerminal(v: unknown): v is SalonTerminalStatus {
  return (SALON_TERMINAL_STATUSES as readonly string[]).includes(String(v));
}

// ── switching salon ──────────────────────────────────────────────────────────────────────────────────────

/** One row of what the SERVER resolved about this technician's salons. Never built from the request body. */
export interface SwitchableWorkplace {
  tenantId: string;
  branchId: string | null;
  salonName: string;
  /** tech_salon_memberships.status */
  status: string;
  /** tenants.status */
  tenantStatus: string;
  /** The technician's `users` row IN THAT SALON — option (b)'s per-salon login. */
  userId: string | null;
  /** users.status in that salon. A salon that disabled the login has disabled the switch. */
  userStatus: string | null;
  /** users.role in that salon. The switched session takes THIS role, never the source salon's. */
  role: string | null;
}

export type TechSwitchDecision =
  | { ok: true; tenantId: string; branchId: string | null; userId: string; role: string; salonName: string }
  | { ok: false; reason: 'not_available' | 'not_employed' | 'salon_inactive' | 'access_suspended'; message: string };

/**
 * May this technician switch into this salon?
 *
 * Takes the workplaces the SERVER resolved from the session's own global profile. The requested tenantId is used
 * ONLY to look one of them up — it never becomes the answer. A tampered tenantId matches nothing, exactly as
 * `decideSwitch` works for owners.
 *
 * "Not one of your salons" and "no such salon" return the SAME message, deliberately. A technician must not be
 * able to enumerate which salons exist on the platform by watching the error text change.
 *
 * And the switched session takes the TARGET salon's role — never the source's. Salon A granting a technician
 * payment permissions must not carry those permissions into Salon B, which granted nothing.
 */
export function decideTechSwitch(workplaces: SwitchableWorkplace[], requestedTenantId: string): TechSwitchDecision {
  const NOT_AVAILABLE = { ok: false as const, reason: 'not_available' as const, message: 'That salon is not available for your account.' };

  const w = workplaces.find((x) => x.tenantId === requestedTenantId);
  if (!w) return NOT_AVAILABLE;

  // A pending invite is not a workplace yet. A former salon is not a workplace any more.
  if (!isEmployed(w.status)) {
    return w.status === 'suspended'
      ? { ok: false, reason: 'access_suspended', message: 'That salon has paused your access.' }
      : { ok: false, reason: 'not_employed', message: 'You are not currently working at that salon.' };
  }
  if (w.tenantStatus !== 'active') {
    return { ok: false, reason: 'salon_inactive', message: 'That salon is not currently active.' };
  }
  // No login row there → nothing to become. Indistinguishable from "not yours" on purpose.
  if (!w.userId || !w.role) return NOT_AVAILABLE;
  if (w.userStatus === 'suspended' || w.userStatus === 'inactive') {
    return { ok: false, reason: 'access_suspended', message: 'That salon has paused your access.' };
  }

  return { ok: true, tenantId: w.tenantId, branchId: w.branchId, userId: w.userId, role: w.role, salonName: w.salonName };
}
