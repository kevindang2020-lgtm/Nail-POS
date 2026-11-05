// deposit-reconciliation.exceptions.ts — reconciliation exception cases + the PURE workflow state machine.
// A case is raised from a reconciliation signal and moves through human review. Resolution requires a note
// (evidence) and is a deliberate human step (approve permission at the controller). Nothing auto-resolves.
export type ExceptionKind = 'missing_deposit' | 'fee_difference' | 'duplicate' | 'unmatched_settlement' | 'unmatched_deposit' | 'adjustment_unresolved' | 'other';
export const EXCEPTION_KINDS: ExceptionKind[] = ['missing_deposit', 'fee_difference', 'duplicate', 'unmatched_settlement', 'unmatched_deposit', 'adjustment_unresolved', 'other'];
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
}

export interface ExceptionsKpis {
  total: number; open: number; inReview: number; escalated: number; resolved: number;
  critical: number; high: number; amountAtRiskCents: number;  // sum of amounts on non-resolved cases
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

export function buildExceptionsState(items: ReconException[]): ExceptionsState {
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
  };
  const sorted = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { kpis, items: sorted };
}

export function validateCreateException(i: { kind?: string; title?: string }): { ok: boolean; error?: string } {
  if (!i?.kind || !EXCEPTION_KINDS.includes(i.kind as ExceptionKind)) return { ok: false, error: 'A valid exception kind is required' };
  if (!i?.title || !String(i.title).trim()) return { ok: false, error: 'A title is required' };
  return { ok: true };
}
