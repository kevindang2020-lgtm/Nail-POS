// disputes-actions-core.ts — pure decision logic for Unit 3 sensitive workflows. No I/O.
//  • Submission eligibility (status, deadline, at-least-one-clean-evidence) + immutable manifest builder.
//  • Outcome rules: map an outcome to a lifecycle status, and decide when recording an outcome is a *manual override*
//    (marking won/lost without an authoritative processor result) that must be gated by permission + reason.

export const SUBMITTABLE = new Set(['open', 'needs_evidence', 'evidence_collecting', 'under_review', 'escalated', 'reopened']);

export type SubmitCtx = { status: string; dueBy: string | null };
export type EvidenceItem = { id: string; fileHash?: string | null; scanStatus: string; reviewStatus: string; fileName?: string | null; evidenceType?: string | null };
export type Check = { ok: boolean; error?: string };

export function canSubmit(ctx: SubmitCtx, evidence: EvidenceItem[], now: number): Check {
  if (!SUBMITTABLE.has(ctx.status)) return { ok: false, error: `Dispute is not eligible for submission in status "${ctx.status}".` };
  if (ctx.dueBy && new Date(ctx.dueBy).getTime() < now) return { ok: false, error: 'The response deadline has passed. Resubmission requires approved processor support.' };
  if (cleanItems(evidence).length === 0) return { ok: false, error: 'At least one clean, non-rejected evidence file is required before submitting.' };
  return { ok: true };
}

export function cleanItems(evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.filter((e) => e.scanStatus === 'clean' && e.reviewStatus !== 'rejected');
}

// Immutable record of exactly what was sent to the processor (evidence ids + hashes). Never contains file contents.
export function buildManifest(evidence: EvidenceItem[]) {
  const items = cleanItems(evidence).map((e) => ({ id: e.id, type: e.evidenceType ?? null, hash: e.fileHash ?? null, fileName: e.fileName ?? null }));
  return { count: items.length, items };
}

export const OUTCOME_RESULTS = new Set(['won', 'lost', 'partially_won', 'withdrawn', 'reversed', 'expired', 'cancelled', 'reopened']);

export function outcomeToStatus(result: string): string {
  const m: Record<string, string> = { won: 'won', lost: 'lost', partially_won: 'won', withdrawn: 'withdrawn', reversed: 'won', expired: 'expired', cancelled: 'cancelled', reopened: 'reopened' };
  return m[result] ?? 'closed';
}

// Recording won/lost/partially_won without an authoritative processor result is a manual reconciliation override.
export function outcomeRequiresOverride(processorDecision: string, result: string): boolean {
  const noAuthoritative = ['none', 'under_review', 'unknown'].includes(processorDecision);
  const decisive = ['won', 'lost', 'partially_won'].includes(result);
  return noAuthoritative && decisive;
}
