// super-admin.ts — wire contract (Constitution 13 §13, §15). Realm: platform. Moved from the server's own declaration so the
// server and every app use ONE definition.
import type { SettlementRow, SettlementStatus, ReconciliationStatus, FundingExceptionType } from './super-admin-settlements';   // same realm, other file

export interface DonutSlice { key: string; label: string; count: number }
export type OnboardingExportFormat = 'csv' | 'excel' | 'pdf';
export interface OnboardingExportResult { format: OnboardingExportFormat; filename: string; csv?: string; disabledReason?: string }
export interface OnboardingKpis {
  applicationsReceived: number;
  inProgress: number;
  pendingApprovals: number;
  identityVerificationPending: number;
  merchantApproved: number;
  bankVerified: number;
  hardwareAssigned: number;
  dataImportsCompleted: number;
  usersInvited: number;
  trainingCompleted: number;
  finalReviewsPending: number;
  tenantsActivated: number;
}
export interface PlanDistributionItem { planTier: string; count: number }
export type Range = 'day' | 'week' | 'month' | 'year';
export type ScheduleFormat = 'csv' | 'xlsx' | 'pdf';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';
export type ScheduleSource = 'analytics_export' | 'saved_report';
export type Semantic = 'good' | 'warn' | 'bad' | 'neutral';
export type Severity = 'info' | 'warning' | 'error' | 'success';
export interface TenantCompensationSummary {
  tenantId: string;
  tenantName: string | null;
  activeRules: number;
  tierPlans: number;
  bonusRules: number;
  classifications: number;
  agreements: number;
  acknowledgedAgreements: number;
}
export interface TenantPosition { tenantId: string; receivableCents: number; payableCents: number; netCents: number }
export type TrendDir = 'up' | 'down' | 'flat';
export type WaitStatus = 'good' | 'acceptable' | 'at_risk' | 'poor' | 'critical';

// ── onboarding: the stage lists are runtime contracts beside their types (§13) ──
export const ONBOARDING_STAGES = [
  'application_received',
  'business_info_submitted',
  'identity_verification',
  'legal_documents_submitted',
  'subscription_selected',
  'merchant_application_submitted',
  'merchant_account_approved',
  'bank_account_verified',
  'hardware_assigned',
  'data_imported',
  'users_invited',
  'training_completed',
  'final_review',
  'tenant_activated',
] as const;
export const OUTCOME_STATES = ['returned_for_correction', 'rejected', 'cancelled', 'expired', 'paused', 'blocked'] as const;

/** The 14 canonical onboarding stages, in workflow order. Index == progress ordinal. */
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];
/** Non-stage outcome states an application can be in. `tenant_activated` is the only terminal *success*. */
export type OutcomeState = (typeof OUTCOME_STATES)[number];
export type OnboardingState = OnboardingStage | OutcomeState;
export interface OnboardingQuery {
  search?: string; applicationType?: 'new_tenant' | 'new_branch'; stage?: OnboardingState; specialistId?: string;
  merchantStatus?: string; hardwareStatus?: string; importStatus?: string; trainingStatus?: string;
  hasMissingDocuments?: boolean; sort?: string; direction?: 'asc' | 'desc'; page?: number; pageSize?: number;
}
export type ApprovalType = 'merchant_application' | 'bank_verification' | 'hardware_assignment' | 'data_import' | 'user_invitation' | 'training_completion' | 'final_review' | 'identity_verification' | 'step';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled' | 'expired';
export interface ApprovalRow {
  id: string; onboardingId: string; approvalType: ApprovalType; stage: string | null; status: ApprovalStatus;
  decision: string | null; decidedByUserId: string | null; decidedByRole: string | null; decidedAt: string | null;
  reason: string | null; previousStatus: string | null; newStatus: string | null; requiresSecondApproval: boolean;
  secondApproverUserId: string | null; secondApprovedAt: string | null; applicantNotified: boolean;
  auditEventId: string | null; createdAt: string; updatedAt: string;
}
export interface HwFilter { search?: string; status?: string; paymentStatus?: string; packageType?: string; carrier?: string; dateFrom?: string; dateTo?: string; tenantId?: string }
export interface HwQuery extends HwFilter { sortBy?: string; sortDirection?: 'asc' | 'desc'; page?: number; limit?: number }

/** Raw tenant_payment_config.status (022) plus 'none' when no config row exists. */
export type PaymentConfigStatus = 'pending' | 'active' | 'error' | 'disabled' | 'none';
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'expired'
  | 'cancelled';
export type CongestionLevel = 'normal' | 'elevated' | 'congested' | 'severe' | 'critical';
export interface BranchCongestion { branchId: string; branch: string | null; level: CongestionLevel; score: number; waiting: number }
export interface BranchThreshold { branchId: string; branch: string | null; overThreshold: number; longestWaitMin: number }
export interface BranchWait { branchId: string; branch: string | null; avgWaitMin: number }
export type LiveBucket = 'waiting' | 'assigned' | 'in_service' | 'unassigned' | 'other';
export interface MetricTrend { delta: number; pct: number | null; favorable: boolean | null }
export interface NotConnected { available: false; reason: string }
export interface QueueKpis {
  customersWaiting: number;
  techniciansAvailable: number | null;
  customersInService: number;
  avgWaitMin: number;
  longestWaitMin: number;
  unassignedCustomers: number;
  queueSyncPct: number | null;
  stuckRecords: number;
  offlineDevices: number | null;
  customersOverThreshold: number;
  congestedBranches: number;
}
export type ThresholdBand = 'none' | 'warning' | 'alert' | 'critical';
export interface QueueRow {
  queueId: string; tenantId: string; branchId: string | null; customer: string; tenantName: string | null; branchName: string | null; status: string;
  bucket: LiveBucket; waitMin: number; technicianName: string | null; service: string | null; isVip: boolean;
  deviceStatus: 'unknown'; syncStatus: 'unknown'; thresholdFlag: ThresholdBand; stuck: boolean; stuckReason: string | null;
}
export interface TimelineEvent { at: string; label: string; state: string; kind: string }
export interface QueueTimeline { queueId: string; customer: string; tenantName: string | null; branchName: string | null; source: string | null; currentState: string; events: TimelineEvent[] }
export interface RecentEvent { at: string; queueId: string; summary: string; branch: string | null; tenantName: string | null; newState: string; kind: string }
export interface StuckRecord { queueId: string; tenantName: string | null; branchName: string | null; customer: string; status: string; reason: string | null; stuckMin: number; waitMin: number }
export interface TechAvailability { total: number; available: number; busy: number; onBreak: number; slices: { label: string; count: number }[] }
export interface TodaySummary {
  totalQueues: number; totalCustomers: number; avgWaitMin: number; longestWaitMin: number; completedServices: number;
  thresholdBreaches: number; syncSuccessPct: number | null; stuckRecords: number; offlineDevices: number | null;
}
export interface TopBranch { branchId: string; branch: string | null; activeCount: number }
export interface WaitBranchStat { branchId: string; branch: string | null; waiting: number; overThreshold: number; avgMin: number; medianMin: number; p90Min: number; longestMin: number }
export interface WaitAnalytics {
  overall: { count: number; avgMin: number; medianMin: number; p90Min: number; longestMin: number };
  overThreshold: number;
  thresholds: { warningMin: number; alertMin: number; criticalMin: number };
  byBranch: WaitBranchStat[];
}
export interface LiveQueueOverview {
  meta: { generatedAt: string; scope: 'platform' | 'tenant' };
  /** Set only when the server unmasked ONE tenant's customer names for an admin holding a live support session. */
  supportMode?: { tenantId: string } | null;
  kpis: QueueKpis;
  queues: { rows: QueueRow[]; total: number; page: number; pageSize: number; totalPages: number };
  healthAlerts: { congestedBranches: number; offlineDevices: number | null; customersOverThreshold: number; stuckRecords: number };
  waitTimeByBranch: BranchWait[];
  liveStatusDistribution: { slices: { bucket: LiveBucket; count: number }[]; total: number };
  topBranches: TopBranch[];
  synchronizationStatus: NotConnected;                  // honest gap — no per-item sync source yet
  recentEvents: RecentEvent[];
  branchesOverThreshold: BranchThreshold[];
  congestion: BranchCongestion[];
  technicianAvailability: TechAvailability | NotConnected;
  queueVolumeTrend: { hour: number; count: number }[];
  todaySummary: TodaySummary;
  waitAnalytics: WaitAnalytics;
  stuckRecords: StuckRecord[];
  queueTimelines: QueueTimeline[];
  trends: Record<string, MetricTrend>;
  trendsSince: string | null;
}
export const SLA_STATUSES = ['on_track', 'near_breach', 'breached', 'paused', 'not_applicable'] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];
export interface SupportOverview {
  meta: { generatedAt: string; scope: 'platform' | 'tenant' };
  kpis: {
    openTickets: number; urgentTickets: number; assignedTickets: number; waitingForCustomer: number; resolvedToday: number;
    slaBreaches: number; auditedSessions: number; knowledgeArticles: number; ticketCsat: number | null; avgFirstResponseMin: number | null;
  };
  ticketVolumeTrend: { day: string; count: number }[];
  ticketsByPriority: { total: number; slices: { key: string; count: number; pct: number }[] };
  slaBreakdown: { total: number; slices: { key: string; count: number; pct: number }[] };
  agentPerformance: { agent: string; assigned: number; resolved: number; csat: number | null }[];
  urgentIncidents: { id: string; subject: string; tenant: string | null; priority: string; createdAt: string }[];
  queue: { id: string; ticketNumber: string; tenant: string | null; branch: string | null; category: string; priority: string; assignedTo: string | null; slaStatus: SlaStatus; relatedDevice: string | null; relatedTransaction: string | null; lastUpdate: string; status: string }[];
  resolvedToday: { id: string; ticketNumber: string; tenant: string | null; resolvedAt: string; csat: number | null }[];
  waitingForCustomer: { id: string; ticketNumber: string; tenant: string | null; waitingSince: string }[];
  escalated: { id: string; ticketNumber: string; tenant: string | null; escalatedTo: string | null }[];
  recentSessions: { id: string; tenant: string | null; accessLevel: string | null; reason: string; started: string; ended: string | null; durationMin: number; startedBy: string | null; auditStatus: string }[];
  knowledgeBase: { id: string; title: string; status: string; updated: string }[];
  atAGlance: { newTickets: number; ticketsResolved: number; urgentCases: number; avgResponseMin: number | null; sessionsStarted: number; csat: number | null };
}
export interface HealthDbResult {
  driver: 'postgres' | 'in-memory';
  ok: boolean;
  latencyMs?: number;
  serverVersion?: string;
  tableCount?: number;
  counts?: { tenants: number; users: number; activeSubscriptions: number };
  gateway?: { errors24h: number; configured: number; ok: boolean };
  error?: string;
}
export interface SystemHealth {
  ok: boolean;
  generatedAt: string;
  process: { uptimeSeconds: number; node: string; pid: number; memoryRssMb: number; memoryHeapUsedMb: number; env: string };
  database: HealthDbResult;
  gateway: { errors24h: number; configured: number; ok: boolean } | null;
}
export interface ActivityItem { id: string; icon: string; title: string; tenantName: string | null; message: string; ageLabel: string; severity: Severity }
export interface AlertItem { id: string; severity: Severity; title: string; message: string; ageLabel: string; to: string }
export interface ApplicationRow { id: string; salonName: string; owner: string; city: string | null; state: string | null; phone: string | null; status: string; date: string }
export interface HardwareSummary {
  pending: number; ordered: number; delivered: number; activated: number; outstandingBalanceCents: number;
  byType: { imac: number; cloverFlex: number; checkinDisplay: number };
}
export interface OverviewKpis {
  totalTenants: number;
  activeSalons: number;
  pendingApplications: number;
  paymentSetupNeeded: number;
  monthlyCardVolumeCents: number;
  openSupportTickets: number;
  systemHealthPercent: number;
  systemHealthLabel: string;
  // month-over-month % deltas (null when no prior period to compare)
  trends: {
    totalTenants: number | null;
    activeSalons: number | null;
    pausedTenants: number | null;
    trialTenants: number | null;
    pendingApplications: number | null;
    paymentSetupNeeded: number | null;
    monthlyCardVolume: number | null;
    openSupportTickets: number | null;
  };
}
export interface PlatformKpis { activeUsers: number; totalLocations: number; technicians: number; customers: number; totalAppointments: number; aiInteractions: number }
export interface SalesPoint { label: string; valueCents: number }
export interface StatusSlice { status: string; label: string; count: number; percent: number }
export interface TopTenant { rank: number; tenantId: string; name: string; city: string | null; state: string | null; monthlyVolumeCents: number; growthPercent: number | null }
export interface OverviewState {
  kpis: OverviewKpis;
  monthlySalesVolume: SalesPoint[];
  tenantsByStatus: StatusSlice[];
  recentAlerts: AlertItem[];
  hardwareSummary: HardwareSummary;
  topPerformingTenants: TopTenant[];
  recentTenantApplications: ApplicationRow[];
  hardwarePackageStatus: StatusSlice[];
  platformKpis: PlatformKpis;
  quickActionsPermissions: Record<string, boolean>;
  recentActivity: ActivityItem[];
  blockers: { module: string; reason: string }[];
  generatedAt: string;
}

export interface BillingSubscriptionsOverview {
  kpis: {
    activeSubscriptions: number; trialAccounts: number; pastDueAccounts: number; failedPayments: number; invoices: number;
    creditsIssuedCents: number; discountsAppliedCents: number; addOnsActive: number; subscriptionChanges: number;
    cancellationRequests: number; upcomingRenewals: number; mrrCents: number;
  };
  kpiTrends: Record<string, { deltaPct: number | null; favorable: boolean | null }>;
  planDistribution: { plan: string; count: number }[];
  billingStatusBreakdown: { status: string; count: number }[];
  addOnRevenueMix: { addOn: string; cents: number }[];
  revenueTrend: { date: string; cents: number }[];
  trialConversion: { rate: number; numerator: number; denominator: number };
  failedVsRecovered: { recoveredRate: number; weekly: { week: string; failed: number; recovered: number }[] };
  planCatalog: { code: string; name: string; monthlyPriceCents: number; status: string }[];
  addOnCatalog: { code: string; name: string; monthlyPriceCents: number; status: string }[];
  tenantOverview: { tenantId: string; tenant: string; plan: string | null; addOns: number; billingStatus: string; renewalDate: string | null; monthlyCents: number; discountsCents: number; creditsCents: number; state: string }[];
  invoices: { invoiceNumber: string; tenant: string; amountCents: number; dueDate: string | null; status: string; retryStatus: string | null; lastAction: string | null }[];
  changes: { changeId: string; tenant: string; requested: string; effectiveAt: string | null; reason: string | null; status: string }[];
  upcomingRenewals: { tenant: string; plan: string | null; renewalDate: string | null; amountCents: number; autoRenew: boolean; status: string }[];
  recentActivity: { at: string; tenant: string; action: string; details: string; amountCents: number | null }[];
  atAGlance: { newInvoicesToday: number; paymentsRecoveredCents: number; creditsAppliedTodayCents: number; planChangesToday: number; trialsExtended: number; renewalsDue: number };
}

/** GET /super-admin/billing/subscriptions-overview — the controller spreads the overview after ok: true. */
export type BillingSubscriptionsOverviewResponse = { ok: true } & BillingSubscriptionsOverview;

export interface SettlementKpis {
  totalBatches: number; grossCents: number; netCents: number; pendingDepositsCents: number;
  reconDiffCents: number; feesCents: number; chargebackCents: number; fundingExceptions: number;
}
/** The share of batches in each settlement status (depositStatusDistribution in the settlements core returns this). */
export interface DepositStatusDistribution { total: number; slices: { status: SettlementStatus; count: number; pct: number }[] }
export interface SettlementsOverview {
  meta: { generatedAt: string; scope: 'platform' | 'tenant' };
  kpis: SettlementKpis;
  batches: { rows: SettlementRow[]; total: number; page: number; pageSize: number; totalPages: number };
  selectedBatch: (SettlementRow & { notes: { id: string; category: string; body: string; authorRole: string | null; createdAt: string }[] }) | null;
  depositStatus: DepositStatusDistribution & { settledAmountCents: number; pendingAmountCents: number };
  settlementTrend: { date: string; grossCents: number; netCents: number }[];
  settlementTrendTotals: { grossCents: number; netCents: number };
  dailyFunding: { date: string; expectedCents: number; actualCents: number }[];
  dailyFundingTotals: { expectedCents: number; actualCents: number; varianceCents: number };
  reconciliationDifferences: { rows: { id: string; batchRef: string | null; differenceCents: number; status: ReconciliationStatus }[]; totalCents: number };
  recentActivity: { id: string; batchRef: string | null; tenantName: string | null; branchName: string | null; status: SettlementStatus; amountCents: number | null; atMs: number }[];
  fundingExceptions: { categories: { type: FundingExceptionType; count: number }[]; total: number };
}

/** An AI provider as the Super Admin usage overview shows it — the key is only ever masked + fingerprinted. */
export interface AiProviderPublic {
  id: string; providerKey: string; displayName: string; status: string; defaultModel: string | null;
  apiKeyMasked: string | null; apiKeyFingerprint: string | null; hasKey: boolean; lastSyncAt: string | null;
}
/** A page of rows as the onboarding lists return it (paginate() in the onboarding core). */
export interface PagedRows<T> { rows: T[]; total: number; page: number; pageSize: number; totalPages: number }

// ── Revenue residuals: reconcile a processor statement, and the residual revenue forecast (both were built inline) ──
/** POST /super-admin/revenue-residuals/statements/:id/reconcile — status is the DOMAIN result ('matched' | 'variance'). */
export interface ResidualReconcileResult {
  ok: true; reconciliationId: string; status: string; differenceCents: number; differenceType: string;
  expectedAmountCents: number; actualAmountCents: number; expected: { ai: number; processor: number; salon: number };
}
export interface ResidualForecastPoint { month: string; grossCents: number; netCents: number }
export interface ResidualForecastProjection { month: string; projectedNetCents: number; lowCents: number; highCents: number }
/** GET /super-admin/revenue-residuals/forecast — an honest gap (available: false + reason) when there is no history. */
export interface ResidualRevenueForecast {
  available: boolean; reason?: string; methodology?: string;
  history?: ResidualForecastPoint[]; projection?: ResidualForecastProjection[]; nextPeriod?: ResidualForecastProjection;
  monthlyGrowthPct?: number; byProcessor?: { processor: string; sharePct: number; projectedNetCents: number }[];
}

/** Security Deep Scan C2 (Oct 23 2026): a Super Admin password reset / invite resend never returns a credential — the
 *  temporary password goes to the account holder; the answer names only the channel and a masked destination. */
export type CredentialDeliveryMethod = 'auto' | 'email' | 'sms';
export interface CredentialDeliveryResult { ok: true; delivery: 'email' | 'sms'; sentTo: string; expiresAt: string }
