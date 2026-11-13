// ai-business-assistant-history.ts — wire types for the A4 AI Business Assistant history + Check Business Data (Nov 6 2026).
export interface AssistantHistoryItem { id: string; question: string | null; intent: string | null; preset: string | null; period: { from: string; to: string } | null; answer: string | null; answeredBy: 'ai' | 'numbers_only' | 'clarification' | 'records'; at: string | null;
  /** round 10 (AI Business Assistant 13): the stored record's provenance — never edited; visible to the asker only */
  provenance?: { recordId: string; toolUsed: string | null; sources: string[]; language: string | null; branchId: string | null; headline: Record<string, number>; visibleTo: 'asker_only'; editable: false } }
export interface AssistantHistoryResponse { page: number; limit: number; total: number; totalPages: number; retentionDays: number; items: AssistantHistoryItem[] }
export interface AssistantDataCheckResponse { id: string; overall: 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA'; checks: { key: string; component: string; state: string; count: number }[]; checkedAt: string | null; reused: boolean; changesAnything: false }
export interface AssistantHistoryDeleteResponse { ok: boolean }

// ── AI Business Assistant 10 — What Changed Since Last Check (GET pos/ai-business/center/reports/:id/compare?with=<otherId>).
//    Two VALIDATED reports (each stores the canonical Sales Report figures for its exact days at the time it was made). The
//    older report's days are re-read from the Sales Report NOW (the same read Verify Numbers uses): what moved on those
//    days since is a DATA CORRECTION (late refunds, edits, back-dated tickets); the newer report vs the corrected older
//    days is the ACTUAL BUSINESS CHANGE. Same days on both → everything is correction. Read only; integer cents.
export interface ReportChangeItem {
  metric: 'netSalesCents' | 'grossSalesCents' | 'ticketsCount' | 'averageTicketCents' | 'refundsCents' | 'discountsCents';
  olderInReport: number; olderNow: number; newerInReport: number;
  /** olderNow − olderInReport: later corrections to the older report's own days */
  dataCorrection: number;
  /** newerInReport − olderNow (null when both reports cover the same days — nothing to compare as business) */
  businessChange: number | null;
}
export interface ReportChangeResponse {
  status: 'compared' | 'cannot_compare';
  reason: 'not_completed' | 'no_snapshot' | 'no_permission' | 'same_report' | null;
  older: { id: string; period: { from: string; to: string; partial?: boolean } | null; snapshotTakenAt: string | null } | null;
  newer: { id: string; period: { from: string; to: string; partial?: boolean } | null; snapshotTakenAt: string | null } | null;
  samePeriod: boolean;
  items: ReportChangeItem[];
  checkedAt: string;
}
