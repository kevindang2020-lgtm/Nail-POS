// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface MergeLogRow { id: string; sourceCustomerId: string; targetCustomerId: string; mergedByUserId: string | null; mergedAt: string }

export interface ActivityRow { action: string; entityType: string | null; entityId: string | null; actorUserId: string | null; at: string }

export interface DeletionRequest {
  id: string; tenantId: string; customerId: string; reason: string; status: DeletionStatus;
  requestedByUserId: string | null; approvedByUserId: string | null; executedByUserId: string | null; rejectReason: string | null;
  retentionChecked: boolean; retentionNote: string | null; legalHoldBlocked: boolean;
  requestedAt: string; approvedAt: string | null; executedAt: string | null;
}

export interface ImportJob {
  id: string; tenantId: string; branchId: string | null; source: string; filename: string | null; status: ImportJobStatus;
  totalRows: number; validRows: number; invalidRows: number; importedRows: number; failedRows: number;
  requestedByUserId: string | null; approvedByUserId: string | null; rejectReason: string | null;
  createdAt: string; approvedAt: string | null; completedAt: string | null;
}

export interface LegalHold {
  id: string; tenantId: string; customerId: string | null; branchId: string | null;
  matterRef: string; reason: string; scope: LegalHoldScope; status: LegalHoldStatus;
  appliedByUserId: string | null; approvedByUserId: string | null;
  appliedAt: string; effectiveAt: string; reviewAt: string | null;
  releasedByUserId: string | null; releasedAt: string | null; releaseReason: string | null;
  internalNotes: string | null;
}

export type DeletionStatus = 'requested' | 'approved' | 'rejected' | 'executed' | 'cancelled';

export type ImportJobStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'rejected';

export type LegalHoldStatus = 'active' | 'released';

export type LegalHoldScope = 'customer' | 'branch' | 'tenant';
