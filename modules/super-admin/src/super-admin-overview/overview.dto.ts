// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { Range, Severity } from '@aipowersalon/api-contracts/platform';
import type { Range, Severity } from '@aipowersalon/api-contracts/platform';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { ActivityItem, AlertItem, ApplicationRow, HardwareSummary, OverviewKpis, PlatformKpis, SalesPoint, StatusSlice, TopTenant, OverviewState } from '@aipowersalon/api-contracts/platform';
import type { ActivityItem, AlertItem, ApplicationRow, HardwareSummary, OverviewKpis, PlatformKpis, SalesPoint, StatusSlice, TopTenant, OverviewState } from '@aipowersalon/api-contracts/platform';
// overview.dto.ts — types for the Super-Admin Overview dashboard (GET /super-admin/overview/state).
// Every field maps to a real source; where a source table does not exist yet (AI interactions, a support-ticket
// system) the value is 0 and the gap is listed in `blockers`, never fabricated.





// Raw facts the repository supplies; the pure core turns these into the OverviewState above.
export interface OverviewFacts {
  tenantStatusCounts: { status: string; count: number }[];     // tenants.status
  activeSalons: number;                                         // branches active (fallback: active tenants)
  pausedTenants: number;                                        // tenants.status = suspended
  trialTenants: number;                                         // tenant_subscriptions.status = trialing
  newApplications: number;                                     // tenant_applications new/reviewing
  paymentSetupNeeded: number;                                  // tenant_payment_config incomplete
  monthlyCardVolumeCents: number;                              // current calendar month, tenant_daily_sales_summary
  priorMonthCardVolumeCents: number;                           // previous month (for the trend)
  openSupportSessions: number;                                 // support_access_sessions active (mapped to "tickets")
  systemHealthPercent: number;
  systemHealthLabel: string;
  salesSeries: SalesPoint[];                                   // for the requested range
  hardwareStatusCounts: { status: string; count: number }[];   // hardware_packages.status
  hardwareSummary: HardwareSummary;
  topTenants: TopTenant[];
  recentApplications: ApplicationRow[];
  platformKpis: PlatformKpis;
  recentActivity: ActivityItem[];
  recentAlertsRaw: AlertItem[];
  trendBaselines: { totalTenantsPrior: number | null; activeSalonsPrior: number | null; pausedTenantsPrior: number | null; trialTenantsPrior: number | null; newApplicationsPrior: number | null; paymentSetupPrior: number | null; openSupportPrior: number | null };
  aiInteractionsAvailable: boolean;
}
