// legal-document-core.ts — pure lifecycle rules for versioned legal documents. No DB.
// Published versions are immutable; editing a published/terminal version is not allowed (create a new draft instead).

export const LEGAL_DOC_TYPES = ['terms_of_service', 'privacy_policy', 'cookie_policy', 'acceptable_use', 'data_processing_addendum', 'merchant_terms', 'ai_disclosure'] as const;
export type LegalDocType = typeof LEGAL_DOC_TYPES[number];

export const LEGAL_STATUSES = ['draft', 'under_review', 'approved', 'scheduled', 'published', 'superseded', 'retired', 'archived'] as const;
export type LegalStatus = typeof LEGAL_STATUSES[number];

export const TRANSITIONS: Record<LegalStatus, LegalStatus[]> = {
  draft: ['under_review', 'approved', 'published', 'archived'],
  under_review: ['approved', 'draft', 'archived'],
  approved: ['published', 'scheduled', 'archived'],
  scheduled: ['published', 'archived'],
  published: ['superseded', 'retired'],
  superseded: ['archived'],
  retired: ['archived'],
  archived: [],
};

export const DOC_TYPE_LABEL: Record<LegalDocType, string> = {
  terms_of_service: 'Terms of Service', privacy_policy: 'Privacy Policy', cookie_policy: 'Cookie Policy',
  acceptable_use: 'Acceptable Use Policy', data_processing_addendum: 'Data Processing Addendum',
  merchant_terms: 'Merchant Terms', ai_disclosure: 'AI Usage Disclosure',
};

export function isLegalDocType(s: string): s is LegalDocType { return (LEGAL_DOC_TYPES as readonly string[]).includes(s); }
export function canTransitionLegalStatus(from: LegalStatus, to: LegalStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }

/** Published and all terminal states are immutable — their content cannot be edited (create a new draft version). */
export function isContentImmutable(status: LegalStatus): boolean { return status !== 'draft' && status !== 'under_review' && status !== 'approved' && status !== 'scheduled'; }

export class LegalTransitionError extends Error {
  constructor(readonly from: LegalStatus, readonly to: LegalStatus) { super(`A legal document cannot move from ${from} to ${to}.`); this.name = 'LegalTransitionError'; }
}
export function assertLegalTransition(from: LegalStatus, to: LegalStatus): void {
  if (!canTransitionLegalStatus(from, to)) throw new LegalTransitionError(from, to);
}

const VERSION_RE = /^v\d+\.\d+(\.\d+)?$/;
export function isValidVersion(v: string): boolean { return VERSION_RE.test(v.trim()); }
/** Numeric comparison of vX.Y.Z strings; returns >0 if a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number); const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

/** Acceptance breakdown for the currently-required version. pending = subjects that have neither accepted nor declined. */
export function acceptanceBreakdown(accepted: number, declined: number, totalSubjects: number): { accepted: number; declined: number; pending: number; total: number } {
  const decided = accepted + declined;
  const total = Math.max(totalSubjects, decided);
  return { accepted, declined, pending: Math.max(total - decided, 0), total };
}
