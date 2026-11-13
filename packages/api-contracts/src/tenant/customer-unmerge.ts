// customer-unmerge.ts — extras Customer 08 (Nov 13 2026): undo a completed customer merge from its reversible-merge record
// (/pos/duplicate-review/merges*). An unmerge restores from the stored snapshot ONLY when nothing touched the merged rows since;
// otherwise it refuses with a coded reason (CUSTOMER_UNMERGE_*) and changes nothing.
export interface CustomerMergeParty { id: string; name: string | null }

export interface CustomerMergeRecord {
  id: string;
  groupId: string;
  mergedAt: string;
  mergedBy: string | null;
  survivor: CustomerMergeParty;
  sources: CustomerMergeParty[];
  status: 'active' | 'undone';
  undoneAt: string | null;
  undoneBy: string | null;
  undoReason: string | null;
}

export interface CustomerMergeRecordPage { items: CustomerMergeRecord[]; total: number; page: number; pageSize: number; totalPages: number }

export type CustomerUnmergeRefusal = 'CUSTOMER_UNMERGE_NOT_FOUND' | 'CUSTOMER_UNMERGE_ALREADY_UNDONE' | 'CUSTOMER_UNMERGE_SURVIVOR_CHANGED'
  | 'CUSTOMER_UNMERGE_SOURCE_CHANGED' | 'CUSTOMER_UNMERGE_ROWS_CHANGED' | 'CUSTOMER_UNMERGE_LOYALTY_CHANGED' | 'CUSTOMER_UNMERGE_UNSUPPORTED';

/** read-only: can this merge be undone right now (the same checks the unmerge runs) */
export interface CustomerUnmergeCheck { ok: boolean; code: CustomerUnmergeRefusal | null; message: string | null; details: Record<string, unknown> }

export interface CustomerUnmergeResult {
  snapshotId: string;
  survivorId: string;
  restoredCustomerIds: string[];
  /** rows put back per table (plus customer_tags) */
  restored: Record<string, number>;
  pointsRestored: number;
}
