// identity-core.ts — the ONE pure core for AI PowerSalon customer identity (Kevin's sync spec, Jul 26 2026).
// No DB, no Nest: every rule here is unit-testable. Phone normalization is DELEGATED to the existing
// customer-activation normalizer (spec §1: reuse, don't fork a fifth implementation — three other legacy
// normalizers exist and will be migrated onto this module, not duplicated by it).
//
// Kevin's emphasized rule is structural in this design: the GLOBAL identity carries only the fields in
// GLOBAL_FIELDS below; everything tenant-specific stays in the tenant's own `customers` row and satellite
// tables and is NEVER copied between salons.

import { normalizePhone, maskPhone } from '../customer-activation-rules/customer-activation-core';

export { maskPhone };

/** §5 — E.164 or null. Delegates to the activation normalizer so activation, creation, and reconciliation can
 *  never disagree about what "the same phone" means. */
export function normalizePhoneE164(raw: string | null | undefined, defaultCountry = '1'): string | null {
  if (raw == null) return null;
  return normalizePhone(String(raw), defaultCountry);
}

/** §5 — canonical email for MATCHING: trim, lowercase, basic syntax check. Returns null when not a valid shape.
 *  (Display casing may be preserved elsewhere; comparisons always use this.) */
export function canonicalEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

/** §5 — names are weak identifiers; normalize only for comparison (trim, collapse spaces, casefold). */
export function canonicalName(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function maskEmail(email: string | null | undefined): string {
  const e = canonicalEmail(email);
  if (!e) return '•••';
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}•••@${domain}`;
}

// ── §6 confidence ladder ─────────────────────────────────────────────────────

export type MatchConfidence = 'very_strong' | 'strong' | 'medium' | 'weak' | 'none';

export interface IdentitySnapshot {
  phone: string | null;            // E.164 (already normalized) or null
  phoneVerified: boolean;
  email: string | null;            // canonical or null
  emailVerified: boolean;
  name: string | null;             // canonical
}

/** Compare a candidate identity against an existing global identity. VERIFIED identifiers carry the weight;
 *  name alone NEVER exceeds `weak` (spec §6: never merge on name/address/birthday/similar spelling alone). */
export function matchConfidence(a: IdentitySnapshot, b: IdentitySnapshot): MatchConfidence {
  const phoneMatch = !!a.phone && a.phone === b.phone;
  const emailMatch = !!a.email && a.email === b.email;
  const phoneVerifiedBoth = phoneMatch && a.phoneVerified && b.phoneVerified;
  const emailVerifiedBoth = emailMatch && a.emailVerified && b.emailVerified;
  if (phoneVerifiedBoth && emailVerifiedBoth) return 'very_strong';
  if (phoneVerifiedBoth || emailVerifiedBoth) return 'strong';
  if (phoneMatch && emailMatch) return 'strong';                 // both identifiers agree, even unverified
  if (phoneMatch || emailMatch) return 'medium';
  const nameMatch = !!a.name && canonicalName(a.name) === canonicalName(b.name ?? '');
  return nameMatch ? 'weak' : 'none';
}

// ── §7 creation-time decision (real-time duplicate prevention) ───────────────

export type CreateDecision =
  | { kind: 'link'; globalCustomerId: string; confidence: MatchConfidence }        // CASE A
  | { kind: 'create' }                                                            // CASE B
  | { kind: 'review'; candidateIds: string[]; reason: string };                    // CASE C — never guess

export interface GlobalCandidate extends IdentitySnapshot { globalCustomerId: string }

/** Given the normalized identity of a customer a tenant is creating, and the global candidates that share any
 *  identifier with it, decide link / create / review. AUTO-LINK requires `strong`+; a single `medium` candidate
 *  links only when nothing contradicts (phone matches and the candidate has NO differing verified email, or
 *  vice versa); everything ambiguous goes to review — spec §7 CASE C. */
export function decideOnCreate(incoming: IdentitySnapshot, candidates: GlobalCandidate[]): CreateDecision {
  if (candidates.length === 0) return { kind: 'create' };
  const scored = candidates.map((c) => ({ c, conf: matchConfidence(incoming, c) }))
    .filter((x) => x.conf !== 'none' && x.conf !== 'weak');       // name-only never links or blocks creation alone
  if (scored.length === 0) return { kind: 'create' };

  const strong = scored.filter((x) => x.conf === 'strong' || x.conf === 'very_strong');
  if (strong.length === 1) return { kind: 'link', globalCustomerId: strong[0].c.globalCustomerId, confidence: strong[0].conf };
  if (strong.length > 1) {
    return { kind: 'review', candidateIds: strong.map((x) => x.c.globalCustomerId), reason: 'MULTIPLE_STRONG_MATCHES' };
  }

  // Only medium candidates remain. §6: phone matches but email differs (or vice versa).
  if (scored.length === 1) {
    const { c } = scored[0];
    const phoneMatch = !!incoming.phone && incoming.phone === c.phone;
    const emailMatch = !!incoming.email && incoming.email === c.email;
    const conflictingVerifiedEmail = phoneMatch && !!incoming.email && !!c.email && incoming.email !== c.email && c.emailVerified;
    const conflictingVerifiedPhone = emailMatch && !!incoming.phone && !!c.phone && incoming.phone !== c.phone && c.phoneVerified;
    if (conflictingVerifiedEmail || conflictingVerifiedPhone) {
      return { kind: 'review', candidateIds: [c.globalCustomerId], reason: 'IDENTIFIER_CONFLICTS_WITH_VERIFIED' };
    }
    return { kind: 'link', globalCustomerId: c.globalCustomerId, confidence: 'medium' };
  }
  // Two different medium candidates (e.g. phone matches customer X while email matches customer Y) — the spec's
  // canonical conflict. Never pick.
  return { kind: 'review', candidateIds: scored.map((x) => x.c.globalCustomerId), reason: 'PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS' };
}

// ── §11 field ownership ──────────────────────────────────────────────────────

export const GLOBAL_FIELDS = ['first_name', 'last_name', 'full_name', 'normalized_phone', 'phone_display', 'email', 'avatar_url'] as const;
export type GlobalField = (typeof GLOBAL_FIELDS)[number];
export function isGlobalField(field: string): field is GlobalField {
  return (GLOBAL_FIELDS as readonly string[]).includes(field);
}
// Everything else on the tenant customer row (notes, marketing opt-ins, preferred technician, status, …) and every
// satellite table (appointments, tickets, loyalty, memberships) is tenant-specific and NEVER synchronized.

// ── §12 verified-over-unverified precedence ─────────────────────────────────

/** May `incoming` overwrite `current` for an identity field? Verified data never yields to unverified conflict. */
export function mayOverwriteIdentity(current: { value: string | null; verified: boolean }, incoming: { value: string | null; verified: boolean }): boolean {
  if (incoming.value == null || incoming.value === current.value) return false;    // nothing to change
  if (current.verified && !incoming.verified) return false;                        // §12: create a conflict instead
  return true;
}

// ── §30 stale-write guard ────────────────────────────────────────────────────

/** A reconciliation write computed from a snapshot older than the row's current updated_at must be dropped. */
export function isStaleWrite(snapshotTakenAt: string | Date, rowUpdatedAt: string | Date | null): boolean {
  if (!rowUpdatedAt) return false;
  return new Date(rowUpdatedAt).getTime() > new Date(snapshotTakenAt).getTime();
}

// ── §3 / §38 schedule window (19:00 in the production timezone) ─────────────

export function hourInTimeZone(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(now));
}

/** Fire during the 19:00-19:59 window in `timeZone` when the last completed run is over ~20h old. */
export function shouldFireDailySync(now: Date, lastCompletedIso: string | null, timeZone = 'America/New_York'): boolean {
  if (hourInTimeZone(now, timeZone) !== 19) return false;
  if (!lastCompletedIso) return true;
  return now.getTime() - Date.parse(lastCompletedIso) > 20 * 3_600_000;
}

/** §38 watchdog: the nightly run is MISSED when more than ~26h pass without a completed run. */
export function isSyncMissed(now: Date, lastCompletedIso: string | null): boolean {
  if (!lastCompletedIso) return false;                            // never-ran is a bootstrap state, not a miss
  return now.getTime() - Date.parse(lastCompletedIso) > 26 * 3_600_000;
}
