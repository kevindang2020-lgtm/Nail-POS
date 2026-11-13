// AI Business Reports 14 + 15 (extras, Nov 12 2026) — `/pos/ai-business/center/reports/schedules` and `/reports/:id/executive`.
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

/** one of the caller's own automated reports (a type never turned on shows its defaults with active=false and id=null) */
export interface BcSchedule {
  id: string | null; reportType: 'daily_brief' | 'weekly_summary' | 'monthly_review'; preset: string; when: 'every_day' | 'sunday' | 'last_day_of_month';
  sendHour: number; active: boolean; notifyInApp: boolean; lastRunAt: string | null; lastStatus: 'generated' | 'failed' | 'skipped' | null; lastReason: string | null;
  lastReportId: string | null; timeZone: string;
}
export interface BcScheduleListResponse { items: BcSchedule[]; timeZone: string; note: string }

/** Executive Summary & Growth Advisor of one report — the report's own verified figures + proposals for the owner to review */
export interface BcExecutiveFact {
  key: string; value: number; unit: 'cents' | 'count' | 'percent'; source: 'sales_report_snapshot' | 'report_section';
  check: 'matches_sales_report' | 'changed_since' | 'not_checkable'; salesReportNow: number | null;
}
export interface BcGrowthOpportunity { kind: string; basis: Record<string, number | null>; route: string; status: 'proposed'; ownerReview: true }
export interface BcExecutiveSummaryResponse {
  id: string; available: boolean; reason?: string; reportType: string; period: unknown;
  verification: { status: string; reason: string | null; checkedAt: string | null } | null;
  facts: BcExecutiveFact[]; opportunities: BcGrowthOpportunity[]; changesAnything: false; rule?: string;
}

/** extras AI Business Reports 15 — AI-model wording of the executive summary. The model only WORDS the verified figures; a
 *  number guard drops any wording containing a number that is not one of them. `worded` is the only state with text. */
export type BcExecutiveWordingState = 'worded' | 'not_configured' | 'denied' | 'rejected_numbers' | 'provider_error' | 'unavailable';
export interface BcExecutiveWordingResponse {
  id: string; state: BcExecutiveWordingState; text: string | null;
  provider: string | null; model: string | null;
  /** numbers the model wrote that are not among the verified figures (only for rejected_numbers) */
  unverifiedNumbers: string[];
  /** the access decision's reason when denied */
  reason: string | null;
  changesAnything: false;
}
