// Pure validation for duplicate-profile review (§28/29). Duplicate detection is data-driven (workers sharing the same
// lower(email) within a tenant). Review is a CONSERVATIVE governance action: the admin records which profile is
// canonical and why, flagging the rest for the tenant to resolve. The platform NEVER auto-merges identities — merging
// touches tickets, payroll, and history and is a tenant-management responsibility.

export const MIN_DUP_REASON_LEN = 8;
export const DUPLICATE_REVIEW_AUDIT_TYPE = 'workforce_duplicate_reviewed';

export interface DuplicateReviewInput { canonicalId?: unknown; memberIds?: unknown; reason?: unknown }
export type DuplicateReviewValidation =
  | { ok: true; canonicalId: string; flaggedIds: string[]; reason: string }
  | { ok: false; error: string; code: 'invalid' };

const asIdList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) { const s = typeof x === 'string' ? x.trim() : ''; if (s && !out.includes(s)) out.push(s); }
  return out;
};

export function validateDuplicateReview(input: DuplicateReviewInput): DuplicateReviewValidation {
  const members = asIdList(input?.memberIds);
  if (members.length < 2) return { ok: false, code: 'invalid', error: 'a duplicate group needs at least two members' };
  const canonicalId = typeof input?.canonicalId === 'string' ? input.canonicalId.trim() : '';
  if (!canonicalId) return { ok: false, code: 'invalid', error: 'canonicalId is required' };
  if (!members.includes(canonicalId)) return { ok: false, code: 'invalid', error: 'canonicalId must be one of the group members' };
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_DUP_REASON_LEN) return { ok: false, code: 'invalid', error: `reason is required (at least ${MIN_DUP_REASON_LEN} characters)` };
  const flaggedIds = members.filter((m) => m !== canonicalId);
  return { ok: true, canonicalId, flaggedIds, reason };
}
