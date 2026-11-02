// global-tech-admin-core.ts — the PURE decisions behind Super Admin's authority over a technician's account.
//
// Merging two human beings into one and erasing a person's professional identity are both irreversible. So the
// rules that permit them are functions of their inputs, testable directly, and refuse loudly rather than
// proceeding on a guess.
//
// No database, no Nest, no I/O.

// ── merge ────────────────────────────────────────────────────────────────────────────────────────────────

/** What the server resolved about one side of a proposed merge. */
export interface MergeCandidate {
  profileId: string;
  techCode: string;
  displayName: string;
  status: string;
  /** Tenants this profile is KNOWN at — any membership, not just active ones. */
  tenantIds: string[];
}

export type MergeDecision =
  | { ok: true; canonicalId: string; duplicateId: string; sharedTenantIds: [] }
  | { ok: false; code: 'same_profile' | 'not_found' | 'not_mergeable' | 'shared_salon'; message: string; sharedTenantIds?: string[] };

/**
 * May these two profiles be merged into one?
 *
 * The rule that matters is the last one. If BOTH profiles are known at the SAME salon, that salon has two
 * technicians rows for one human — two roster entries, two schedules, two commission settings, and quite
 * possibly two payroll histories. Collapsing them here would silently pick a winner among two payroll
 * identities, and the platform is the one party that cannot know which roster row is the real one.
 *
 * So it REFUSES, names the salon, and tells the Super Admin to have that salon fix its own roster first. A merge
 * that guesses about someone's pay is worse than a merge that does not happen.
 */
export function decideMerge(canonical: MergeCandidate | null, duplicate: MergeCandidate | null): MergeDecision {
  if (!canonical || !duplicate) {
    return { ok: false, code: 'not_found', message: 'One of those technician profiles does not exist.' };
  }
  if (canonical.profileId === duplicate.profileId) {
    return { ok: false, code: 'same_profile', message: 'A profile cannot be merged into itself.' };
  }
  for (const p of [canonical, duplicate]) {
    if (p.status !== 'active' && p.status !== 'suspended') {
      return {
        ok: false, code: 'not_mergeable',
        message: `${p.techCode} is ${p.status} and cannot take part in a merge. A tombstone is not a person.`,
      };
    }
  }

  const shared = canonical.tenantIds.filter((t) => duplicate.tenantIds.includes(t));
  if (shared.length) {
    return {
      ok: false, code: 'shared_salon', sharedTenantIds: shared,
      message: `${canonical.techCode} and ${duplicate.techCode} are both on the roster at the same salon. That salon has two technician records for one person — it must merge or retire one of them before the platform accounts can be merged. Merging now would pick a winner between two payroll histories.`,
    };
  }

  return { ok: true, canonicalId: canonical.profileId, duplicateId: duplicate.profileId, sharedTenantIds: [] };
}

// ── anonymize ────────────────────────────────────────────────────────────────────────────────────────────

export interface DeleteRequestState {
  requestId: string;
  profileId: string;
  status: string;
  reason: string;
  legalHold: boolean;
}

export type AnonymizeDecision =
  | { ok: true; requestId: string; profileId: string }
  | { ok: false; code: 'no_request' | 'not_approved' | 'legal_hold' | 'already_anonymized' | 'no_reason'; message: string };

/**
 * May this technician's account be erased?
 *
 * Four gates, and none of them is a formality:
 *
 *   1. A REQUEST must exist. There is no path from "Super Admin opens a screen" to "a person's professional
 *      identity is gone". Erasure begins with somebody asking, and the asking is a row.
 *   2. It must be APPROVED — a second decision, by a named human, recorded.
 *   3. A LEGAL HOLD blocks it outright. Not "warns"; blocks.
 *   4. A REASON must be present and non-empty. An irreversible act with no stated reason is one nobody can
 *      answer for later.
 *
 * Already-anonymized is not an error worth throwing over — it is the desired end state, and reporting it as a
 * failure would push an operator into retrying an irreversible operation.
 */
export function decideAnonymize(profileStatus: string, req: DeleteRequestState | null): AnonymizeDecision {
  if (profileStatus === 'anonymized') {
    return { ok: false, code: 'already_anonymized', message: 'This account has already been anonymized.' };
  }
  if (!req) {
    return { ok: false, code: 'no_request', message: 'No deletion request exists for this technician. Erasure begins with a request, not a button.' };
  }
  if (req.legalHold) {
    return { ok: false, code: 'legal_hold', message: 'This account is under a legal hold and cannot be anonymized.' };
  }
  if (req.status !== 'approved') {
    return { ok: false, code: 'not_approved', message: `The deletion request is ${req.status}. It must be approved before the account can be anonymized.` };
  }
  if (!String(req.reason ?? '').trim()) {
    return { ok: false, code: 'no_reason', message: 'The deletion request carries no reason. An irreversible act needs one on the record.' };
  }
  return { ok: true, requestId: req.requestId, profileId: req.profileId };
}

/**
 * The name a tombstone wears.
 *
 * Keeps the tech_code, because every `technicians` row, ticket, payroll line and audit entry at every salon she
 * ever worked at still points here, and a support agent reading those records six months from now needs to know
 * that this WAS somebody and that the somebody was erased on purpose — not that the database lost a row.
 */
export function anonymizedDisplayName(techCode: string): string {
  return `Anonymized technician (${techCode})`;
}

