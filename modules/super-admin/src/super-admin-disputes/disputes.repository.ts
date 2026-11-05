// disputes.repository.ts — port for the Chargebacks & Disputes data access. Read-only surface in this unit; mutation
// methods (evidence, submit, outcome, notify, risk) arrive in later units. All access is tenant-scoped in SQL.
import type { DisputeListRow, DisputeDetail, EvidenceSummary } from '@aipowersalon/api-contracts/platform';
export type { DisputeListRow, DisputeDetail, EvidenceSummary };   // owned by packages/api-contracts (Constitution 13 §13)
import type { OverviewInput } from './disputes-overview-core';

export type ListParams = {
  page: number; pageSize: number; search?: string; tenantId?: string; branchId?: string;
  reasonCode?: string; currentStatus?: string; evidenceStatus?: string; processorDecision?: string;
  riskLevel?: string; deadlineStart?: string; deadlineEnd?: string; amountMinCents?: number; amountMaxCents?: number;
  processor?: string; sort?: string; direction?: 'asc' | 'desc';
};
export type ListResult = { rows: DisputeListRow[]; total: number; page: number; pageSize: number };

export interface DisputesRepo {
  getOverviewData(): Promise<OverviewInput>;
  listDisputes(params: ListParams): Promise<ListResult>;
  getDisputeDetail(id: string): Promise<DisputeDetail | null>;
  resolveDispute(idOrRef: string): Promise<ResolvedDispute | null>;
  requestEvidence(actor: AuditActor, cbId: string, tenantId: string, note: string | null): Promise<void>;
  insertEvidence(actor: AuditActor, cbId: string, tenantId: string, branchId: string | null, e: EvidenceInsert): Promise<EvidenceSummary>;
  reviewEvidence(actor: AuditActor, cbId: string, tenantId: string, evidenceId: string, decision: string, reason: string | null): Promise<EvidenceSummary | null>;
  listEvidence(cbId: string): Promise<EvidenceSummary[]>;
  getSubmitContext(cbId: string): Promise<SubmitContext>;
  findSubmission(tenantId: string, idempotencyKey: string): Promise<SubmissionSummary | null>;
  recordSubmission(actor: AuditActor, cbId: string, tenantId: string, key: string, processorType: string | null, processorRef: string, manifest: unknown, result: string, safeError: string | null, newStatus: string): Promise<SubmissionSummary>;
  findNotification(tenantId: string, idempotencyKey: string): Promise<NotificationSummary | null>;
  recordNotification(actor: AuditActor, cbId: string, tenantId: string, branchId: string | null, n: NotificationInsert): Promise<NotificationSummary>;
  recordOutcome(actor: AuditActor, cbId: string, tenantId: string, o: OutcomeInsert): Promise<OutcomeSummary>;
  getDeadlineRows(): Promise<DeadlineRow[]>;
  getPatternRows(): Promise<import('./patterns-core').PatternRow[]>;
  getHighRiskMerchants(): Promise<MerchantRiskRow[]>;
  flagMerchantRisk(actor: AuditActor, tenantId: string, f: RiskFlagInsert): Promise<MerchantRiskRow | null>;
  writeAuditLog(actor: AuditActor, action: string, entityId: string, tenantId: string | null, meta: Record<string, unknown>): Promise<void>;
}

export type MerchantRiskRow = {
  tenantId: string; tenantName: string; openDisputes: number; totalDisputes: number; lostDisputes: number;
  amountAtRiskCents: number; riskLevel: string; lastReviewedAt: string | null; nextReviewAt: string | null; recommendedAction: string | null; riskReason: string | null;
};
export type RiskFlagInsert = { riskLevel: string; riskReason: string; recommendedAction: string | null; nextReviewAt: string | null; merchantAccountId: string | null };

export type DeadlineRow = {
  id: string; disputeReference: string; tenantId: string; tenantName: string; branchName: string | null;
  amountCents: number; processorType: string | null; reasonCode: string | null; dueBy: string | null;
  status: string; evidenceStatus: string; riskLevel: string; submitted: boolean; tenantNotified: boolean;
};

export type AuditActor = { userId?: string | null; role?: string | null };
export type ResolvedDispute = { id: string; tenantId: string; branchId: string | null; reasonCategory: string | null; evidenceStatus: string; status: string; processorDecision: string };
export type EvidenceInsert = { evidenceType: string; fileName: string; mimeType: string; sizeBytes: number; fileHash: string; storageRef: string; scanStatus: string; description: string | null; source: string | null };
export type SubmitContext = { status: string; dueBy: string | null; processorType: string | null; evidence: { id: string; fileHash: string | null; scanStatus: string; reviewStatus: string; fileName: string | null; evidenceType: string | null }[] };
export type SubmissionSummary = { id: string; result: string; processorRef: string | null; idempotencyKey: string; createdAt: string; alreadyExisted?: boolean };
export type NotificationInsert = { key: string | null; channel: string; recipient: string | null; subject: string | null; body: string | null; deliveryStatus: string };
export type NotificationSummary = { id: string; channel: string; recipient: string | null; subject: string | null; deliveryStatus: string; createdAt: string; alreadyExisted?: boolean };
export type OutcomeInsert = { result: string; amountWonCents: number; amountLostCents: number; fundsRecoveredCents: number; processorFeeCents: number; decisionReason: string | null; isManualOverride: boolean; overrideReason: string | null; originalProcessorDecision: string; newStatus: string; setProcessorDecision: string | null };
export type OutcomeSummary = { id: string; result: string; isManualOverride: boolean; newStatus: string; fundsRecoveredCents: number; createdAt: string };

export class InMemoryDisputesRepo implements DisputesRepo {
  async getOverviewData(): Promise<OverviewInput> {
    return { disputes: [], activity: [], risk: [], trend: [], wonCountPeriod: 0, lostCountPeriod: 0, underReviewCountPeriod: 0 };
  }
  async listDisputes(p: ListParams): Promise<ListResult> { return { rows: [], total: 0, page: p.page, pageSize: p.pageSize }; }
  async getDisputeDetail(): Promise<DisputeDetail | null> { return null; }
  async resolveDispute(): Promise<ResolvedDispute | null> { return null; }
  async requestEvidence(): Promise<void> { /* honest no-op */ }
  async insertEvidence(_a: AuditActor, _c: string, _t: string, _b: string | null, e: EvidenceInsert): Promise<EvidenceSummary> {
    return { id: 'stub', evidenceType: e.evidenceType, fileName: e.fileName, mimeType: e.mimeType, sizeBytes: e.sizeBytes, reviewStatus: 'uploaded', scanStatus: e.scanStatus, includedInSubmission: false, description: e.description, createdAt: new Date().toISOString() };
  }
  async reviewEvidence(): Promise<EvidenceSummary | null> { return null; }
  async listEvidence(): Promise<EvidenceSummary[]> { return []; }
  async getSubmitContext(): Promise<SubmitContext> { return { status: 'open', dueBy: null, processorType: null, evidence: [] }; }
  async findSubmission(): Promise<SubmissionSummary | null> { return null; }
  async recordSubmission(_a: AuditActor, _c: string, _t: string, key: string, _p: string | null, ref: string, _m: unknown, result: string): Promise<SubmissionSummary> {
    return { id: 'stub', result, processorRef: ref, idempotencyKey: key, createdAt: new Date().toISOString() };
  }
  async findNotification(): Promise<NotificationSummary | null> { return null; }
  async recordNotification(_a: AuditActor, _c: string, _t: string, _b: string | null, n: NotificationInsert): Promise<NotificationSummary> {
    return { id: 'stub', channel: n.channel, recipient: n.recipient, subject: n.subject, deliveryStatus: n.deliveryStatus, createdAt: new Date().toISOString() };
  }
  async recordOutcome(_a: AuditActor, _c: string, _t: string, o: OutcomeInsert): Promise<OutcomeSummary> {
    return { id: 'stub', result: o.result, isManualOverride: o.isManualOverride, newStatus: o.newStatus, fundsRecoveredCents: o.fundsRecoveredCents, createdAt: new Date().toISOString() };
  }
  async getDeadlineRows(): Promise<DeadlineRow[]> { return []; }
  async getPatternRows(): Promise<import('./patterns-core').PatternRow[]> { return []; }
  async getHighRiskMerchants(): Promise<MerchantRiskRow[]> { return []; }
  async flagMerchantRisk(): Promise<MerchantRiskRow | null> { return null; }
  async writeAuditLog(): Promise<void> { /* honest no-op */ }
}
