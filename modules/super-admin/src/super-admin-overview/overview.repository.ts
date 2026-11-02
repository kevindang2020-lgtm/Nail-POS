import type { OverviewScope } from '@aipowersalon/database';
// overview.repository.ts — data port for the Overview + an in-memory adapter.
// The in-memory adapter returns zeros/empty by default (never fabricated) and is seedable for tests and local-without-DB.
import type { OverviewFacts, Range } from './overview.dto';

export interface OverviewDataPort {
  getFacts(range: Range, scope?: OverviewScope): Promise<OverviewFacts>;
  /** Optional: persist the current month's KPIs for accurate month-over-month trends (Postgres adapter only). */
  captureMonthlySnapshot?(facts: OverviewFacts): Promise<void>;
}

export const EMPTY_FACTS: OverviewFacts = {
  tenantStatusCounts: [],
  activeSalons: 0,
  pausedTenants: 0,
  trialTenants: 0,
  newApplications: 0,
  paymentSetupNeeded: 0,
  monthlyCardVolumeCents: 0,
  priorMonthCardVolumeCents: 0,
  openSupportSessions: 0,
  systemHealthPercent: 100,
  systemHealthLabel: 'All Systems Online',
  salesSeries: [],
  hardwareStatusCounts: [],
  hardwareSummary: { pending: 0, ordered: 0, delivered: 0, activated: 0, outstandingBalanceCents: 0, byType: { imac: 0, cloverFlex: 0, checkinDisplay: 0 } },
  topTenants: [],
  recentApplications: [],
  platformKpis: { activeUsers: 0, totalLocations: 0, technicians: 0, customers: 0, totalAppointments: 0, aiInteractions: 0 },
  recentActivity: [],
  recentAlertsRaw: [],
  trendBaselines: { totalTenantsPrior: null, activeSalonsPrior: null, pausedTenantsPrior: null, trialTenantsPrior: null, newApplicationsPrior: null, paymentSetupPrior: null, openSupportPrior: null },
  aiInteractionsAvailable: false,
};

export class InMemoryOverviewRepository implements OverviewDataPort {
  constructor(private readonly seed: Partial<OverviewFacts> = {}) {}
  async getFacts(_range: Range, _scope?: OverviewScope): Promise<OverviewFacts> { return { ...EMPTY_FACTS, ...this.seed }; }
}
