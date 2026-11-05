// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type DisputeListRow = {
  id: string; disputeReference: string; tenantId: string; tenantName: string; branchName: string | null;
  amountCents: number; reasonCode: string | null; reason: string | null; transactionRef: string | null;
  dueBy: string | null; status: string; evidenceStatus: string; processorDecision: string;
  fundsWithdrawnCents: number; fundsRecoveredCents: number; riskLevel: string;
};

export type DisputeDetail = DisputeListRow & {
  currency: string; reasonCategory: string | null; processorType: string | null; notes: string | null;
  openedAt: string; submittedAt: string | null; decidedAt: string | null; closedAt: string | null;
  timeline: { at: string; fromStatus: string | null; toStatus: string; source: string; reason: string | null }[];
  evidence: { id: string; type: string; fileName: string | null; reviewStatus: string; scanStatus: string; includedInSubmission: boolean; createdAt: string }[];
  outcomes: { result: string; amountWonCents: number; amountLostCents: number; fundsRecoveredCents: number; isManualOverride: boolean; originalProcessorDecision: string | null; decidedAt: string | null }[];
  fundsEvents: { kind: string; amountCents: number; effectiveAt: string | null; settlementId: string | null }[];
  notifications: { channel: string; recipient: string | null; subject: string | null; deliveryStatus: string; createdAt: string }[];
};

export type EvidenceSummary = { id: string; evidenceType: string; fileName: string | null; mimeType: string | null; sizeBytes: number | null; reviewStatus: string; scanStatus: string; includedInSubmission: boolean; description: string | null; createdAt: string };

export type EvidenceChecklist = { required: string[]; recommended: string[] };
