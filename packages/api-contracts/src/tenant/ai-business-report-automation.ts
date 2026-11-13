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
