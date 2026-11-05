// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { Semantic } from '@aipowersalon/api-contracts/platform';
import type { Semantic } from '@aipowersalon/api-contracts/platform';
// merchant-accounts-core.ts — pure, framework-free shaping for Super Admin → Payments & Revenue → Merchant Accounts.
// No I/O. Everything here is deterministic and unit-tested. Real project rule: the ONLY surfaced processors are
// Fiserv, CardPointe (a Fiserv product), and Clover — Stripe/Square are never presented (they exist only as legacy
// CHECK values and fall into "other"). Sensitive values are masked here as a defence-in-depth layer; the backend also
// never selects raw secrets. Rates are kept decimal-safe (basis points + integer minor units), formatted for display.


// ---------- processors ----------
export const MERCHANT_PROCESSORS = ['fiserv', 'cardpointe', 'clover'] as const;
export type ProcessorBucket = (typeof MERCHANT_PROCESSORS)[number] | 'other';
export const PROCESSOR_LABEL: Record<string, string> = { fiserv: 'Fiserv', cardpointe: 'CardPointe', clover: 'Clover', other: 'Other' };

export function processorBucket(raw: string | null | undefined): ProcessorBucket {
  const p = (raw || '').toLowerCase().trim();
  if (p === 'fiserv' || p === 'bolt') return 'fiserv';
  if (p === 'cardpointe') return 'cardpointe';
  if (p === 'clover') return 'clover';
  return 'other'; // stripe/square/manual/none/legacy → never surfaced as a first-class processor
}

// ---------- processing status ----------
// tenant_payment_config.status ∈ pending|active|error|disabled|paused → the spec's processing lifecycle buckets.
export function processingStatus(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'active': return { key: 'active', label: 'Active', semantic: 'good' };
    case 'pending': return { key: 'pending', label: 'Pending', semantic: 'warn' };
    case 'error': return { key: 'suspended', label: 'Suspended', semantic: 'bad' };
    case 'paused': return { key: 'suspended', label: 'Suspended', semantic: 'bad' };
    case 'disabled': return { key: 'inactive', label: 'Inactive', semantic: 'neutral' };
    default: return { key: 'pending', label: 'Not Configured', semantic: 'neutral' };
  }
}

// ---------- underwriting / application ----------
// tenant_payment_config.onboarding_status ∈ not_started|submitted|under_review|approved|declined.
export function underwritingStatus(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'approved': return { key: 'approved', label: 'Approved', semantic: 'good' };
    case 'declined': return { key: 'declined', label: 'Declined', semantic: 'bad' };
    case 'under_review': return { key: 'under_review', label: 'Review Needed', semantic: 'warn' };
    case 'submitted': return { key: 'submitted', label: 'Submitted', semantic: 'warn' };
    case 'not_started': return { key: 'not_started', label: 'Not Started', semantic: 'neutral' };
    default: return { key: 'not_started', label: 'Not Started', semantic: 'neutral' };
  }
}

export function applicationStatus(onboarding: string | null | undefined): { key: string; label: string } {
  switch ((onboarding || '').toLowerCase()) {
    case 'approved': return { key: 'approved', label: 'Approved' };
    case 'declined': return { key: 'declined', label: 'Declined' };
    case 'under_review': return { key: 'under_review', label: 'Under Review' };
    case 'submitted': return { key: 'submitted', label: 'Submitted' };
    default: return { key: 'draft', label: 'Draft' };
  }
}

// Counts as "pending underwriting" for the KPI (submitted or in review, not yet decided).
export function isPendingUnderwriting(onboarding: string | null | undefined): boolean {
  const s = (onboarding || '').toLowerCase();
  return s === 'submitted' || s === 'under_review';
}

// Current risk level from the latest risk review (§38). Low is good; medium/under-review warn; high/critical/restricted bad.
export function riskStatus(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'low': return { key: 'low', label: 'Low', semantic: 'good' };
    case 'medium': return { key: 'medium', label: 'Medium', semantic: 'warn' };
    case 'high': return { key: 'high', label: 'High', semantic: 'bad' };
    case 'critical': return { key: 'critical', label: 'Critical', semantic: 'bad' };
    case 'under_review': return { key: 'under_review', label: 'Under Review', semantic: 'warn' };
    case 'restricted': return { key: 'restricted', label: 'Restricted', semantic: 'bad' };
    default: return { key: 'unknown', label: '—', semantic: 'neutral' };
  }
}

export const isHighRisk = (raw: string | null | undefined): boolean => ['high', 'critical'].includes((raw || '').toLowerCase());

// ---------- bank verification ----------
export function bankVerification(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'verified': return { key: 'verified', label: 'Verified', semantic: 'good' };
    case 'failed': return { key: 'failed', label: 'Failed', semantic: 'bad' };
    case 'pending': return { key: 'pending', label: 'Pending', semantic: 'warn' };
    case 'submitted': return { key: 'submitted', label: 'Submitted', semantic: 'warn' };
    case 'information_required': return { key: 'information_required', label: 'Info Required', semantic: 'warn' };
    case 'reverification_required': return { key: 'reverification_required', label: 'Reverify', semantic: 'warn' };
    case 'expired': return { key: 'expired', label: 'Expired', semantic: 'bad' };
    case 'not_started': return { key: 'not_started', label: 'Not Started', semantic: 'neutral' };
    default: return { key: 'not_started', label: 'Not Started', semantic: 'neutral' };
  }
}
// Counts toward the "Bank Verification Pending" KPI (submitted/awaiting, not yet verified or failed).
export const isBankVerificationPending = (raw: string | null | undefined): boolean =>
  ['pending', 'submitted', 'information_required', 'reverification_required'].includes((raw || '').toLowerCase());

// ---------- funding schedule ----------
const FUNDING_LABELS: Record<string, string> = {
  same_day: 'Same Day', next_day: 'Next Day', two_business_days: 'Two Business Days', daily: 'Daily',
  weekly: 'Weekly', custom: 'Custom', funding_hold: 'Funding Hold', not_configured: 'Not Configured',
};
export function fundingSchedule(raw: string | null | undefined): { key: string; label: string; available: boolean } {
  const k = (raw || 'not_configured').toLowerCase();
  const available = k !== 'not_configured' && k in FUNDING_LABELS;
  return { key: k, label: FUNDING_LABELS[k] || '—', available };
}

export const FUNDING_ISSUE_LABELS: Record<string, string> = {
  bank_verification_pending: 'Bank Verification Pending', document_expired: 'Document Expired',
  account_info_mismatch: 'Account Info Mismatch', funding_delays: 'Funding Delays', other: 'Other',
};

// ---------- alerts ----------
export function alertSeverity(raw: string | null | undefined): { key: string; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'critical': return { key: 'critical', label: 'Critical', semantic: 'bad' };
    case 'warning': return { key: 'warning', label: 'Warning', semantic: 'warn' };
    case 'info': return { key: 'info', label: 'Info', semantic: 'neutral' };
    default: return { key: 'warning', label: 'Warning', semantic: 'warn' };
  }
}
// Active alerts shown in the module = anything not resolved/closed.
export const isActiveAlert = (status: string | null | undefined): boolean => !['resolved', 'closed'].includes((status || '').toLowerCase());

// ---------- masking (defence in depth; unmodeled fields render honestly) ----------
export function maskBankAccount(last4: string | null | undefined): string {
  const d = (last4 || '').replace(/\D/g, '').slice(-4);
  return d.length === 4 ? `•••• ${d}` : '—';
}

// A MID/merchant reference is an identifier, not a secret — shown as-is, honest em dash when absent.
export function merchantRef(merchantId: string | null | undefined, fallback: string): string {
  return (merchantId && merchantId.trim()) || fallback;
}

// ---------- decimal-safe rate formatting ----------
// Authoritative values stay structured (basis points + integer minor units); this only formats for display.
export function formatRate(percentageBasisPoints: number | null | undefined, perTxnFeeMinor: number | null | undefined): string {
  if (percentageBasisPoints == null && perTxnFeeMinor == null) return '—';
  const pct = percentageBasisPoints != null ? `${(percentageBasisPoints / 100).toFixed(2)}%` : '';
  const fee = perTxnFeeMinor != null ? `$${(perTxnFeeMinor / 100).toFixed(2)}` : '';
  return [pct, fee].filter(Boolean).join(' + ') || '—';
}

// ---------- shared math ----------
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Distribution rows with reconciling percentages that sum to the whole. */
export function distribution<T extends { key: string; label: string; count: number }>(rows: T[], total: number): (T & { pct: number })[] {
  return rows.map((r) => ({ ...r, pct: pct(r.count, total) }));
}

// Trend semantic for a KPI: some KPIs are "bad when up" (pending, high-risk, funding issues, inactive).
export function kpiTrendSemantic(key: string, direction: 'up' | 'down' | 'flat'): Semantic {
  const upIsBad = ['pending_underwriting', 'bank_verification_pending', 'high_risk', 'funding_issues', 'inactive'].includes(key);
  if (direction === 'flat') return 'neutral';
  const up = direction === 'up';
  return upIsBad ? (up ? 'bad' : 'good') : (up ? 'good' : 'bad');
}
