// runtime-safety.ts — BUILD_PLAN Phase 11 (Constitution 4 §116, §131, §133, §139, §12): the wire contract of
// GET /super-admin/system/runtime-safety (apps/api/src/observability/runtime-safety.ts), read by the admin-web System
// Operations panel. One copy (Constitution 13 §15).

export type SchemaVersionStatus = 'ok' | 'pending' | 'ahead' | 'drift' | 'unknown';
export interface SchemaVersion {
  status: SchemaVersionStatus;
  latest: string | null; latestAppliedAt: string | null;
  applied: number; files: number;
  pending: string[]; unknown: string[]; mismatches: string[];
  migrationsDir: string | null; checkedAt: string; error?: string;
}
/** What /health carries as `schemaVersion` (counts + latest name only). */
export interface SchemaVersionSummary { status: SchemaVersionStatus; latest: string | null; applied: number; pending: number; mismatches: number; unknown: number }

export type BreakGlassMode = 'off' | 'read_only' | 'full';
export interface BreakGlassStatus { mode: BreakGlassMode; message: string | null; problem: string | null }
export interface RateLimiterView { enabled: boolean; store: 'redis' | 'memory' | 'off'; maxPerWindow: number; windowMs: number; keyedBy: 'location' }

export interface StrandedPaymentRow {
  id: string; kind: 'split_attempt' | 'card_payment'; tenantId: string; tenantName: string | null; ticketId: string;
  amountCents: number; status: string; resolution: string | null; createdAt: string; strandedAt: string | null;
}
export interface RuntimeSafety {
  generatedAt: string;
  schema: SchemaVersion;
  breakGlass: BreakGlassStatus;
  rateLimiter: RateLimiterView;
  redis: { configured: boolean; requiredBecause: string[] };
  strandedPayments: { thresholdMinutes: number; needsReview: number; unverifiedCards: number; recent: StrandedPaymentRow[]; error?: string };
}
