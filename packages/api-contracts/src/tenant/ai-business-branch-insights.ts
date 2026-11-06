// ai-business-branch-insights.ts — wire types for the A3 AI Branch Comparison scorecard / explanation / advisor / data check
// (Nov 6 2026). Server: modules/analytics/src/ai-business/branch-insights.ts.
export interface BranchScorecardRow {
  branchId: string; branchName: string; status: string; timeZone: string;
  netSalesCents: number | null; ticketsCount: number | null; averageTicketCents: number | null;
  totalBookings: number; completed: number; completionRate: number | null; noShowPercent: number; cancelledPercent: number;
  technicianHours: number | null; operatingHours: number | null; customers: number; returningCustomers: number;
  netPerTechnicianHourCents: number | null; netPerOperatingHourCents: number | null; returningRate: number | null;
  rank: { perTechnicianHour: number | null; perOperatingHour: number | null; returningRate: number | null };
}
export interface BranchAdvice { branchId: string; branchName: string; kind: string; severity: 'info' | 'warning'; message: string; basis: Record<string, number | string | null>; route: string }
export interface BranchScorecardResponse { preset: string; range: { from: string; to: string } | null; financialsIncluded: boolean; rows: BranchScorecardRow[]; advice: BranchAdvice[]; notes: string[] }
export interface BranchExplainResponse { a: string; b: string; preset: string; range: { from: string; to: string } | null; lines: string[]; bridge: { volumeCents: number; priceCents: number; totalCents: number } | null }
export interface BranchDataCheckResponse { id: string; overall: 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA'; checks: { key: string; component: string; state: string; count: number }[]; checkedAt: string; reused: boolean; changesAnything: false }
