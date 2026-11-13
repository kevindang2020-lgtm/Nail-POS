// Customer Notes workspace (SUNMI guide, Nov 9 2026) — `/pos/customer-notes/*`.
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type CnCategory = 'general' | 'service_preference' | 'technician_preference' | 'allergy' | 'warning' | 'visit';
export type CnReviewState = 'needs_review' | 'reviewed' | 'needs_correction' | 'not_required';

export interface CnSummaryResponse {
  asOf: string;
  cards: { customersWithNotes: number; safetyWarnings: number; preferencesRecorded: number; needsReview: number };
  needsCorrection: number;
  entries: number;
  lastUpdatedAt: string | null;
  definitions: Record<'customersWithNotes' | 'safetyWarnings' | 'preferencesRecorded' | 'needsReview', string>;
  scope: { label: string; confined: boolean };
}
export interface CnListItem {
  customerId: string; customer: string | null; phone: string | null; category: CnCategory;
  preview: { text: string; truncated: boolean }; at: string | null; ticketId: string | null;
  review: CnReviewState; reviewedAt: string | null; safety: boolean;
}
export interface CnListResponse {
  items: CnListItem[]; total: number; page: number; pageSize: number; totalPages: number;
  applied: { q: string | null; category: CnCategory | null; review: CnReviewState | null; dateField: 'updated' | 'reviewed'; sort: 'newest' | 'oldest' | 'name'; preset: string; from: string | null; to: string | null };
  period: { today: string; timeZone: string };
}
export interface CnDetailResponse {
  customer: { id: string; name: string | null; phone: string | null; customerVisible: boolean; updatedAt: string | null };
  entries: { category: CnCategory; text: string; hash: string; at: string | null; ticketId: string | null; review: CnReviewState; reviewedAt: string | null; safety: boolean;
    /** Customer Notes 01 — context-aware relevance: why this note is ranked where it is for the current visit (never hides a note) */
    relevance?: { score: number; reasons: CnRelevanceReason[] } }[];
  history: { category: 'allergy' | 'warning'; decision: 'confirmed' | 'needs_correction'; reason: string | null; at: string | null; reviewer: string | null; current: boolean }[];
  /** the context the entries were ranked for: the ticket's (or the session's) branch, its technician(s) and services */
  context?: { ticketId: string | null; branch: boolean; technicians: number; services: number };
}
export type CnRelevanceReason = 'safety' | 'same_service' | 'same_technician' | 'same_branch' | 'preference';
export interface CnCheckResponse {
  overall: 'READY' | 'WARNING' | 'FAILED';
  checkedAt: string;
  checks: { key: string; state: 'READY' | 'WARNING' | 'FAILED'; count?: number;
    /** Customer Notes 10 monitors: what was measured from the request log (measured=false → the log store had nothing to read) */
    detail?: Record<string, number | boolean | null> }[];
}

// Appointment History workspace (SUNMI guide, Nov 9 2026) — `/pos/appointment-history/*`.
export interface AhSummaryResponse {
  asOf: string;
  cards: { appointments: number; upcoming: number; completed: number; canceled: number; noShows: number; rescheduled: number };
  period: { today: string; timeZone: string; preset: string; from: string | null; to: string | null };
  scope: { label: string; confined: boolean };
}
export interface AhListItem {
  id: string; date: string; startTime: string | null; endTime: string | null; durationMinutes: number | null;
  customerId: string | null; customer: string | null; phone: string | null; services: string | null; technician: string | null; anyTechnician: boolean;
  branch: string | null; status: string; source: string | null; rescheduled: number; createdAt: string | null; updatedAt: string | null; completedAt: string | null; canceledAt: string | null;
  /** extras (Appointment History 04): the recorded changes of this appointment (append-only appointment_change_log), newest first, at most 10 */
  changes?: AhChange[];
}
export interface AhChange { id: string; changeType: string; field: string | null; oldValue: string | null; newValue: string | null; actor: string | null; actorType: string | null; source: string | null; at: string | null }
export interface AhListResponse {
  items: AhListItem[]; total: number; page: number; pageSize: number; totalPages: number;
  applied: { q: string | null; status: string; dateField: string; sort: string; preset: string; from: string | null; to: string | null };
  period: { today: string; timeZone: string };
}
export interface AhCheckResponse {
  overall: 'READY' | 'WARNING' | 'FAILED';
  checkedAt: string;
  checks: { key: string; state: 'READY' | 'WARNING' | 'FAILED'; count?: number }[];
}
export interface AhOptionsResponse { technicians: { id: string; name: string }[]; statuses: readonly string[]; dateFields: readonly string[]; sorts: readonly string[]; pageSizes: readonly number[] }
