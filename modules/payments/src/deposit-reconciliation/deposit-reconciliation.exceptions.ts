// deposit-reconciliation.exceptions.ts — reconciliation exception cases + the PURE workflow state machine.
// A case is raised from a reconciliation signal and moves through human review. Resolution requires a note
// (evidence) and is a deliberate human step (approve permission at the controller). Nothing auto-resolves.
// + amount_mismatch / integration_error (AI Deposit Reconciliation mandate Oct 29 2026 §15: the six exception classes)
export type ExceptionKind = 'missing_deposit' | 'fee_difference' | 'duplicate' | 'unmatched_settlement' | 'unmatched_deposit' | 'adjustment_unresolved' | 'amount_mismatch' | 'integration_error' | 'other';
export const EXCEPTION_KINDS: ExceptionKind[] = ['missing_deposit', 'fee_difference', 'duplicate', 'unmatched_settlement', 'unmatched_deposit', 'adjustment_unresolved', 'amount_mismatch', 'integration_error', 'other'];
export type ExceptionSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';
export const EXCEPTION_SEVERITIES: ExceptionSeverity[] = ['info', 'low', 'moderate', 'high', 'critical'];
export type ExceptionStatus = 'open' | 'in_review' | 'escalated' | 'resolved' | 'reopened';
export const EXCEPTION_STATUSES: ExceptionStatus[] = ['open', 'in_review', 'escalated', 'resolved', 'reopened'];

export interface ReconException {
  id: string;
  branchId: string | null;
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  title: string;
  detail: string | null;
  amountCents: number;
  currency: string;
  status: ExceptionStatus;
  sourceRef: string | null;
  assignedToUserId: string | null;
  resolutionNote: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** round 10 (AI Deposit Reconciliation 01): the case's review due date from its severity (EXCEPTION_REVIEW_DAYS) and whether an
   *  unresolved case is past it — derived on read, so it can never drift from the severity shown */
  dueAt?: string | null; overdue?: boolean;
}
/** how many days a case of each severity may wait for review (the per-case due date = created + these days) */
export const EXCEPTION_REVIEW_DAYS: Record<ExceptionSeverity, number> = { critical: 1, high: 2, moderate: 5, low: 10, info: 14 };
export function caseDue(c: Pick<ReconException, 'severity' | 'createdAt' | 'status'>, now: Date = new Date()): { dueAt: string | null; overdue: boolean } {
  const t = Date.parse(String(c.createdAt || ''));
  if (!Number.isFinite(t)) return { dueAt: null, overdue: false };
  const due = t + (EXCEPTION_REVIEW_DAYS[c.severity] ?? 5) * 86_400_000;
  return { dueAt: new Date(due).toISOString(), overdue: c.status !== 'resolved' && now.getTime() > due };
}

export interface ExceptionsKpis {
  total: number; open: number; inReview: number; escalated: number; resolved: number;
  critical: number; high: number; amountAtRiskCents: number;  // sum of amounts on non-resolved cases
  overdue?: number;   // round 10: unresolved cases past their review due date
}
export interface ExceptionsState { kpis: ExceptionsKpis; items: ReconException[] }

// Allowed status transitions. Resolution ('resolved') is handled via a dedicated path that requires a note.
const TRANSITIONS: Record<ExceptionStatus, ExceptionStatus[]> = {
  open: ['in_review', 'escalated', 'resolved'],
  in_review: ['open', 'escalated', 'resolved'],
  escalated: ['in_review', 'resolved'],
  resolved: ['reopened'],
  reopened: ['in_review', 'escalated', 'resolved'],
};
export function canTransition(from: ExceptionStatus, to: ExceptionStatus): boolean {
  if (!EXCEPTION_STATUSES.includes(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

// Suggested severity from kind + amount. Purely advisory; a human can override on create.
export function suggestSeverity(kind: ExceptionKind, amountCents: number): ExceptionSeverity {
  const amt = Math.abs(amountCents);
  if (kind === 'missing_deposit' || kind === 'duplicate') {
    if (amt >= 100000) return 'critical';
    if (amt >= 20000) return 'high';
    return 'moderate';
  }
  if (kind === 'fee_difference') return amt >= 5000 ? 'high' : amt >= 500 ? 'moderate' : 'low';
  return amt >= 50000 ? 'high' : 'moderate';
}

export function buildExceptionsState(items0: ReconException[], now: Date = new Date()): ExceptionsState {
  const items = items0.map((i) => ({ ...i, ...caseDue(i, now) }));
  const active = items.filter((i) => i.status !== 'resolved');
  const kpis: ExceptionsKpis = {
    total: items.length,
    open: items.filter((i) => i.status === 'open').length,
    inReview: items.filter((i) => i.status === 'in_review').length,
    escalated: items.filter((i) => i.status === 'escalated').length,
    resolved: items.filter((i) => i.status === 'resolved').length,
    critical: items.filter((i) => i.severity === 'critical' && i.status !== 'resolved').length,
    high: items.filter((i) => i.severity === 'high' && i.status !== 'resolved').length,
    amountAtRiskCents: active.reduce((a, i) => a + Math.abs(i.amountCents), 0),
    overdue: items.filter((i) => i.overdue).length,
  };
  const sorted = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { kpis, items: sorted };
}

export function validateCreateException(i: { kind?: string; title?: string }): { ok: boolean; error?: string } {
  if (!i?.kind || !EXCEPTION_KINDS.includes(i.kind as ExceptionKind)) return { ok: false, error: 'A valid exception kind is required' };
  if (!i?.title || !String(i.title).trim()) return { ok: false, error: 'A title is required' };
  return { ok: true };
}
