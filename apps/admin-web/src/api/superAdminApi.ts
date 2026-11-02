// superAdminApi.ts — RECONCILED to the real backend (super-admin-tenants.controller.ts @Controller('super-admin')).
// The Delivery-Package stub called /super-admin/tenants (list) + /status (patch), which don't exist. Real routes:
// GET tenants/state, POST tenants, POST tenants/:id/suspend|reactivate|reset-owner-password, GET tenants/:id/audit,
// POST tenants/import. (Support access uses /super-admin/platform/support-sessions — step-up confirmed + audited.) Reads via the shared root-relative `api` (credentials: include).
import type { CredentialDeliveryMethod, CredentialDeliveryResult } from '@aipowersalon/api-contracts/platform';
export type { CredentialDeliveryMethod, CredentialDeliveryResult };
import type { TenantHealth, TenantHealthList, HealthListSort, IntegrationState, PlatformStaffList, PlatformRoleChangeResult } from '@aipowersalon/api-contracts/platform';
import type { MaskedPaymentGateway } from '@aipowersalon/api-contracts/tenant';
import type { ActivityRow, CatalogOverview, DeletionRequest, DisputeDetail, DisputeListRow, EvidenceChecklist, EvidenceSummary, ImportJob, LegalHold, MergeLogRow } from '@aipowersalon/api-contracts/platform';
export type { ActivityRow, CatalogOverview, DeletionRequest, DisputeDetail, DisputeListRow, EvidenceChecklist, EvidenceSummary, ImportJob, LegalHold, MergeLogRow };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api, apiUrl } from './client';
import type { AiProviderPublic } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { MobileTelemetryView } from '@aipowersalon/api-contracts';   // BUILD_PLAN Phase 13 E
import type { PaymentDeviceSecuritySummary } from '@aipowersalon/api-contracts';   // Secure Tap to Pay §51 (Oct 27 2026)
import type { TenantPosLanguage, SetTenantPosLanguageBody } from '@aipowersalon/api-contracts';   // Vietnamese POS mandate WP-A §93
const enc = (s: string) => encodeURIComponent(s);
/** Security Deep Scan C2: which of the account's OWN channels receives an admin-initiated temporary password. */
/** C2: what an admin-initiated reset / re-sent invite answers — the channel and a MASKED destination, never the password. */
/** C3: the secure invitation (POST invitations, and POST users/invite which now goes through it) — a single-use token to the invitee. */
export interface InvitationResult { id: string; status: string; reused: boolean; email?: string | null; phone?: string | null; role?: string; tokenPrefix: string; expiresAt: string; deliveryStatus: string; deliveryNote?: string; manualAcceptToken?: string | null; message?: string }

/** Mirror of SuperAdminTenantsService.getDirectoryOverview() (GET /super-admin/tenants/directory-overview). */
export type DirectorySlice = { key: string; label: string; count: number; pct: number };




export type AiKpi = { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean };
export type AiInsightRow = { id: string; reference: string; title: string; tenant: string; branch: string; category: string; severity: string; confidence: number | null; confidenceMethod: string | null; recommendation: string | null; status: string; updatedAt: string; freshness: string };
export type AiInsightsOverview = {
  total: number;
  kpis: AiKpi[];
  byCategory: { category: string; label: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
  volumeTrend: { available: boolean; points: { date: string; count: number }[] };
  tenantRisk: { tenant: string; tenantId: string | null; flaggedBranches: number; openInsights: number; churnRisk: number | null; status: string }[];
  highPriority: { key: string; label: string; branches: number; flaggedCents?: number }[];
  categoryPanel: { category: string; label: string; count: number }[];
  bookingsRiskChurn: { available: boolean };
};
export type AiInsightsDirectory = { rows: AiInsightRow[]; total: number; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };

export type AiInsightFeedbackRow = { id: string; insightId: string; insightReference: string | null; insightTitle: string | null; verdict: string; comment: string | null; modelVersion: string | null; promptVersion: string | null; createdAt: string };
export type AiInsightDetail = { id: string; insightReference: string; title: string; summary: string | null; category: string; severity: string; confidence: number | null; confidenceMethod: string | null; status: string; tenantName: string | null; branchName: string | null; generatedAt: string; lastEvaluatedAt: string; freshness: string; recommendation: string | null; modelProvider: string | null; modelName: string | null; modelVersion: string | null; promptVersion: string | null; churnRiskScore: number | null; flaggedAmountCents: number | null };
export type SsKpi = { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean };
export type PlatformInfrastructure = {
  storage: { database: { available: boolean; reason?: string; sizeBytes: number | null; tables: { table: string; totalBytes: number; rows: number | null }[] };
             media: { store: 'object_storage' | 'disk'; bucket: string | null; region: string | null; endpoint: string | null; envSegment: string; diskAccepted: boolean; productionSafe: boolean } };
  deployments: { build: { version: string; commit: string; deployment: string; environment: string; startedAt: string }; uptimeSeconds: number;
                 schema: { status: string; latest: string | null; latestAppliedAt: string | null; applied: number; files: number; pending: string[]; mismatches: string[] } | null;
                 migrations: { available: boolean; reason?: string; recent: { filename: string; appliedAt: string | null }[] } };
};
export type RealtimeSyncStatus = { status: string; scope: string; connectedPosClients: number; connectedOtherClients: number; activeTenantChannels: number; eventsPerMinute: number; eventsDelivered: number; failedDeliveries: number; reconnects: number; connectionsOpened: number; connectionsClosed: number; latencyP50Ms: number | null; latencyP95Ms: number | null; latencyP99Ms: number | null };
export type RealtimeTenantDiagnostics = { tenantId: string; connectedChannels: { room: string; subscribers: number }[]; totalSubscribers: number; lastEvents: { room: string; event: string }[]; note?: string };
export type SystemStatusOverview = {
  kpis: SsKpi[];
  services: { key: string; service: string; category: string; status: string; statusLabel: string; uptimePct: number | null; responseTimeMs: number | null; ownerTeam: string; affectedTenants: number; lastIncidentAt: string | null }[];
  statusBreakdown: { status: string; label: string; count: number; pct: number }[];
  categoryHealth: { category: string; label: string; total: number; operational: number; allOperational: boolean }[];
  globalUptime: { available: boolean; pct: number | null };
  affectedByService: { service: string; affected: number }[];
  activeIncidents: { incidentId: string; service: string; severity: string; status: string; startedAt: string; affectedTenants: number }[];
  incidentTimeline: { stage: string; count: number }[];
  scheduledMaintenance: { service: string; scope: string; windowStart: string; windowEnd: string; tenantImpact: number; noticeStatus: string; owner: string }[];
  publicUpdates: { time: string; title: string; audience: string; status: string }[];
  incidentHistory: { incidentId: string; service: string; severity: string; rootCause: string; duration: string; status: string }[];
  postIncidentReports: { reportReference: string; title: string; incidentReference: string | null; owner: string; status: string; publishedAt: string | null }[];
  communicationLog: { time: string; channel: string; audience: string; message: string; sentBy: string }[];
  recoveryProgress: { incident: string; percentRecovered: number; nextMilestone: string; owner: string }[];
  affectedTenants: { tenant: string; branch: string; service: string; impactLevel: string; commStatus: string }[];
  healthTrend: { available: boolean; points: { date: string; pct: number }[] };
};


export type DmKpi = { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean };
export type DmDevice = { id: string; name: string; type: string; tenant: string; branch: string; serial: string; os: string; appVersion: string; lastConnection: string; status: string; assignedUser: string; merchantTerminalId: string; securityStatus: string; updateStatus: string };
export type DmDeviceDetail = DmDevice & { ownershipType: string; manufacturer: string; model: string; osVersion: string; minRequiredVersion: string; configVersion: string; connectionStatus: string; lastHeartbeat: string; ipMasked: string; networkType: string; sessionStatus: string; lockStatus: string; certificateStatus: string; maintenanceStatus: string; note: string };

export type DmSeg = { label: string; value: number; pct: number };
export type DeviceMgmtOverview = {
  kpis: DmKpi[];
  devices: DmDevice[];
  byType: DmSeg[]; byStatus: DmSeg[]; byUpdate: DmSeg[];
  tenantUsage: { tenant: string; total: number; online: number; offline: number; assignedUsers: number; lastSync: string | null }[];
  shipmentsMaintenance: { reference: string; device: string; branch: string; status: string; eta: string | null }[];
  securityAlerts: { device: string; tenant: string; issue: string; severity: string; lastAction: string | null }[];
  connectionLogs: { time: string; device: string; tenant: string; event: string; result: string }[];
  catalog: { deviceType: string; displayName: string; modelCount: number; availability: string }[];
  connectionTrend: { available: boolean; points: { date: string; online: number; offline: number; total: number }[] };
  terminalConnectivity: { available: boolean; points: { date: string; connected: number }[] };
};

export type AiUsageKpi = { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean };
export type AiGlobalPrompt = { id: string; promptKey: string; name: string; body: string | null; version: number; status: string; updatedAt: string };
export type AiUsageAnalytics = {
  trend: { available: boolean; points: { date: string; tokens: number }[] };
  costRequests: { available: boolean; points: { date: string; costCents: number; requests: number }[] };
  byProvider: { available: boolean; segments: { label: string; value: number; pct: number }[] };
  byFeature: { available: boolean; segments: { label: string; value: number; pct: number }[] };
  tenants: { tenant: string; tokens: number; minutes: number; calls: number; costCents: number; failed: number; status: string }[];
};
export type AiUsageOverview = { kpis: AiUsageKpi[]; providers: AiProviderPublic[]; prompts: AiGlobalPrompt[]; analytics: AiUsageAnalytics; security: { kekConfigured: boolean; note: string } };

export type McKpi = { key: string; label: string; value: string | null; supporting?: string; available: boolean; unfavorableIfUp?: boolean };
export type McRow = { id: string; reference: string; name: string; ownerType: 'platform' | 'tenant'; tenantId: string | null; tenant: string; branch: string; channel: string; audienceSize: number; deliveryRate: number | null; deliveryRateAvailable: boolean; openRate: number; clickRate: number; bookingConversions: number; revenueCents: number; scheduledAt: string | null; status: string; complianceStatus: string | null; complianceAvailable: boolean };
export type McAnnouncementInput = { title: string; body?: string; channel?: string; audienceScope?: string; tenantIds?: string[]; scheduledAt?: string | null };
export type McAnnouncementResult = { ok: boolean; errors?: string[]; announcement?: { id: string; title: string; status: string; audienceSize: number } };
export type McSeg = { channel: string; count: number; pct: number };
export type MarketingOverview = {
  kpis: McKpi[];
  channelMix: McSeg[];
  revenueByCampaign: { id: string; name: string; revenueCents: number }[];
  topCampaigns: { id: string; name: string; deliveryRate: number | null; openRate: number; clickRate: number; bookings: number; revenueCents: number }[];
  rankingMetric: string;
  counts: { total: number; platform: number; tenant: number; active: number; scheduled: number; completed: number };
  directory: { platform: McRow[]; tenant: McRow[]; page: McRow[] };
  directoryTotal: number;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  deliveryFailures: { available: boolean; total?: number; byCategory?: { category: string; label: string; count: number; pct: number }[] };
  complianceAlerts: { available: boolean; categories?: { key: string; label: string; count: number }[]; totalFlagged?: number; allCompliant?: boolean };
  performanceTrend: { available: boolean; points: { date: string; deliveryRate: number | null; openRate: number | null; clickRate: number | null }[] };
};
export type McLimits = { id: string; maxSendsPerDay: number | null; maxCampaignsPerDay: number | null; quietHoursStart: number | null; quietHoursEnd: number | null; minHoursBetween: number | null } | null;
export type McPauseResult = { ok: boolean; errors?: string[]; flag?: { id: string; actionTaken: string | null; status: string } };
export type McLimitsInput = { maxSendsPerDay?: number | null; maxCampaignsPerDay?: number | null; quietHoursStart?: number | null; quietHoursEnd?: number | null; minHoursBetween?: number | null };
export type McTemplateInput = { name: string; campaignType?: string; channel?: string; subject?: string; body?: string; smsContent?: string; suggestedAudience?: string; suggestedOffer?: string };
export type McTemplateResult = { ok: boolean; errors?: string[]; template?: { id: string; name: string; status: string; currentVersion: number } };

export type PcKpi = { key: string; label: string; value: string | null; supporting?: string; available: boolean; to?: string };
export type PcRow = { id: string; name: string; brandName: string | null; sku: string | null; barcode: string | null; categoryName: string | null; costCents: number | null; retailPriceCents: number | null; taxCategory: string | null; unitType: string | null; vendorName: string | null; tenantId: string; tenantName: string | null; activeTenants: number; importStatus: string; importStatusAvailable: boolean; duplicateFlag: boolean; status: string };
export type PcSeg = { key?: string; label: string; count: number };
export type ProductCatalogOverview = {
  kpis: PcKpi[];
  byCategory: PcSeg[];
  byBrand: PcSeg[];
  retailPriceDistribution: PcSeg[];
  duplicateDetection: { duplicateSkus: number; duplicateBarcodes: number; potentialMatches: number };
  atAGlance: { barcodeCoveragePct: number; duplicateRatePct: number; retailConfiguredPct: number; importSuccessRate: number | null };
  counts?: { total: number; live: number; retired: number; tenants: number; withBarcode: number; withRetail: number };
  /** Top products by DISTINCT tenants carrying the SKU — aggregated server-side across the whole catalog
   *  (the directory below is paginated, so a page-local ranking would be misleading). */
  topByTenantUsage?: { sku: string; name: string; brandName: string | null; tenants: number }[];
  /** true = ranked over every product row; false = ranked over the capped projection (newest-first), which the UI discloses. */
  topByTenantUsageScansAll?: boolean;
  /** Per-tenant product distribution rollup; null when the backing table isn't available (renders NotConnected). */
  tenantProductConfigs?: { tenantId: string; tenantName: string | null; distributed: number; linked: number; pending: number; lastSyncAt: string | null }[] | null;
  /** Recent audited product events; null when the audit trail isn't readable (renders NotConnected). */
  productChangeHistory?: { id: string; action: string; productName: string | null; entityId: string | null; actorName: string | null; tenantName: string | null; at: string }[] | null;
  directory: PcRow[]; directoryTotal: number; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

export type PcImportJob = { id: string; source: string; filename: string | null; status: string; totalRows: number; validRows: number; invalidRows: number; importedRows: number; failedRows: number; errorSummary: string | null; createdAt: string; approvedAt: string | null; completedAt: string | null };
export type PcImportError = { id: string; jobId: string; rowNumber: number | null; errorType: string; productName: string | null; sourceFile: string | null; status: string; retryable: boolean; createdAt: string };

export type PcDuplicateCandidate = { id: string; name: string; reason: 'exact_sku' | 'exact_barcode' | 'brand_and_name'; confidence: number };
export type PcMasterProduct = { id: string; name: string; sku: string | null; normalizedSku: string | null; status: string; brandName: string | null; categoryName: string | null };
export type PcCreateResult = { ok: true; product: PcMasterProduct } | { ok: false; errors?: string[]; requiresConfirmation?: boolean; candidates?: PcDuplicateCandidate[] };
export type PcCreateInput = {
  name: string; categoryName: string; code?: string; brandName?: string; sku?: string; manufacturerSku?: string;
  upc?: string; barcode?: string; productType?: string; description?: string; costCents?: number | null;
  suggestedRetailCents?: number | null; currency?: string; taxCategory?: string; inventoryUnit?: string; vendorName?: string;
  confirmDuplicates?: boolean;
};

export type CdoKpi = { key: string; label: string; value: string | null; trend?: string; trendUp?: boolean | null; supporting?: string; available: boolean; to?: string };
export type CdoRow = { id: string; name: string; tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null; phoneStatus: string; emailStatus: string; completeness: number; duplicateRisk: string; consentStatus: string; privacyRequest: string; importSource: string; lastUpdated: string };
export type CdoSeg = { key: string; label: string; count: number };
export type CustomerDataOverview = {
  kpis: CdoKpi[];
  directory: CdoRow[]; directoryTotal: number; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  healthAlerts: { key: string; label: string; count: number | null; available: boolean; to?: string }[];
  customersByTenant: { tenantId: string; label: string; count: number }[]; customersByTenantTotal: number;
  duplicateDistribution: { total: number; segments: CdoSeg[] };
  consentOverview: { ratePct: number; segments: CdoSeg[] };
  growthTrend: { date: string; newRecords: number }[]; growthDefinition: string;
  integrityIssues: { total: number; categories: CdoSeg[]; note: string };
  integrityScore: number;
  suspiciousCrossTenant: { count: number; alerts: { reason: string; maskedKey: string; tenantIds: string[]; recordCount: number }[] };
  importSuccess: { available: boolean; successRatePct: number | null };
  privacyRequestStatus: { available: boolean; total: number; segments: CdoSeg[] };
  recentMerges: { available: boolean; rows: { id: string; sourceCustomerId: string; targetCustomerId: string; mergedByUserId: string | null; mergedAt: string }[] };
  recentActivity: { available: boolean; rows: { action: string; entityType: string | null; entityId: string | null; actorUserId: string | null; at: string }[] };
};

export type DirectoryOverview = {
  kpis: {
    totalTenants: number; activeTenants: number; trialTenants: number; pendingApprovals: number;
    suspendedTenants: number; enterpriseTenants: number; totalBranches: number; totalCustomers: number;
    monthlyRevenueCents: number; churnRiskHigh: number; overduePayments: number;
    activePosDevices: number | null; openSupportTickets: number | null;
  };
  planDistribution: DirectorySlice[];
  statusDistribution: DirectorySlice[];
  healthDistribution: DirectorySlice[];
  healthAlerts: Array<{ key: string; label: string; count: number; available: boolean }>;
  growthTrend: Array<{ month: string; label: string; totalTenants: number }>;
  onboardingPipeline: { stages: Array<{ key: string; label: string; count: number }>; conversionRatePct: number; available: boolean };
  upcomingRenewals: { rows: Array<{ tenantId: string; tenantName: string | null; plan: string | null; renewalDate: string; daysRemaining: number; warning: 'past_due' | 'renewal_approaching' | 'ok' }>; available: boolean };
  meta: { growthDefinition: string; revenueDefinition: string };
};

export type SaOwnerRow = { ownerId: string; tenantId: string; fullName: string; email: string | null; status: string; tenantName: string | null; assignedBranchCount: number };
export type SaOwnerAssignedBranch = { branchId: string; branchName: string; accessLevel: string; isPrimaryOwner: boolean; hasSwitchPin: boolean };
export type SaOwnerAssignableBranch = { branchId: string; branchName: string; status: string };
export type SaOwnerDetail = { ownerId: string; tenantId: string; fullName: string; email: string | null; status: string; isMultiSalon: boolean; assignedBranches: SaOwnerAssignedBranch[]; assignableBranches: SaOwnerAssignableBranch[] };
/** A salon in the owner's portfolio, as Super Admin sees it. A salon IS a tenant — hence the Store Code. */
export type SaPortfolioSalon = {
  tenantId: string; salonName: string; storeCode: string; tenantStatus: string;
  accessLevel: string; isPrimaryOwner: boolean;
  branches: { branchId: string; name: string; city: string | null; state: string | null; isActive: boolean }[];
};
export type SaOwnerPortfolio = {
  ok: boolean;
  portfolio: { ownerUserId: string; salons: SaPortfolioSalon[] };
  summary: Record<string, any>;
  topSalons: { rank: number; tenantId: string; salonName: string; revenueTodayCents: number }[];
  totals: { tenantId: string; revenueMonthCents: number }[];
};

export type SaOwnerActivity = { action: string; branchId: string | null; entityType: string | null; entityId: string | null; role: string | null; metadata: Record<string, unknown>; createdAt: string };

export type BranchDirectoryRow = { id: string; name: string; tenantId: string; tenantName: string | null; city: string | null; state: string | null; status: string; manager: string | null; staff: number; todaysAppts: number; revenueMtdCents: number; devices: number | null; openTickets: number; queueWaiting: number; healthScore: number | null };
export type BranchesDirectoryPage = { rows: BranchDirectoryRow[]; total: number; page: number; pageSize: number; pages: number; facets: { statuses: string[]; tenants: string[]; cities: string[] } };
export type BranchesDashboard = {
  kpis: { totalBranches: number; activeBranches: number; newThisMonth: number; totalStaff: number; todaysAppointments: number; monthlyRevenueCents: number; suspendedBranches: number; pendingOpenings: number; openTodayBranches: number; posDevices: number; customersCheckedIn: number; todaysRevenueCents: number; openSupportTickets: number; totalTechs: number };
  statusDistribution: { active: number; maintenance: number; inactive: number; total: number; raw: { status: string; count: number }[] };
  directory: BranchDirectoryRow[];
  recentActivity: { action: string; branchId: string | null; at: string | null; actorRole: string | null; actorName: string | null }[];
  healthDistribution: { excellent: number; good: number; average: number; poor: number; critical: number; scored: number; unscored: number; total: number };
  operationalAlerts: { key: string; label: string; count: number; severity: 'info' | 'warning' | 'critical'; to: string }[];
  deviceStatus: { total: number; online: number; offline: number; maintenance: number; inactive: number };
  performanceTrend: { month: string; revenueCents: number; appointments: number }[];
  topBranches: { id: string; name: string; tenantName: string | null; revenueMtdCents: number }[];
  revenueByCity: { city: string; state: string; cents: number }[];
  queueByBranch: { branchId: string; name: string; count: number }[];
  upcomingByBranch: { branchId: string; name: string; count: number }[];
  onboardingPipeline: { received: number; underReview: number; siteVerified: number; setupInProgress: number; readyToLaunch: number; conversionRate: number };
  hoursAvailability: { full: number; partial: number; limited: number; total: number; avgAvailabilityPct: number };
  atAGlance: { totalBranches: number; totalTechs: number; customersToday: number; apptsToday: number; revenueTodayCents: number };
  capacity: null; healthScore: null;
};
// Monthly hardware-payment totals (super-admin reports). Base aggregate row + the three figures reportMonthlyTotals derives.
export type HwReportRow = { billingMonth: string; invoiceCount: number; cardVolumeCents: number; hardwareCreditCents: number; dueCents: number; shortfallCents: number; chargedCents: number; paidCount: number; failedCount: number; collectedCents: number; outstandingCents: number; collectionRatePct: number };
// Per-tenant hardware-payment shapes (super-admin). Plan endpoint reuses ownerPlan → { plan, savedPaymentMethod } envelope.
export type HwPlan = { id: string; tenantId: string; branchId: string | null; hardwarePackageId: string | null; status: string; totalHardwareCostCents: number; downPaymentCents: number; financedAmountCents: number; monthlyPaymentCents: number; remainingBalanceCents: number; startDate: string | null; endDate: string | null; dueDayOfMonth: number; revenueSplitRecoveryEnabled: boolean; autoChargeShortfallEnabled: boolean; extraCreditHandling: string; carryForwardCreditCents: number; savedPaymentMethodId: string | null; createdByUserId: string | null };
export type HwPlanResponse = { plan: HwPlan | null; savedPaymentMethod: { brand: string | null; last4: string | null; status: string } | null };
export type HwSplitSettings = { pricingRateBps: number; expenseRateBps: number; platformSharePercent: number; fiservSharePercent: number; salonHardwareCreditPercentOfPlatformShare: number };
export type HwTenantSettingsResponse = { effective: HwSplitSettings; hasOverride: boolean };
export type HwInvoice = { id: string; tenantId: string; planId: string; billingMonth: string; cardVolumeCents: number; pricingRateBps: number; expenseRateBps: number; netMarginCents: number; platformShareCents: number; fiservShareCents: number; salonHardwareCreditCents: number; hardwareMonthlyDueCents: number; carryForwardCreditCents: number; shortfallCents: number; autoChargeAmountCents: number; status: string; dueDate: string | null; paidAt: string | null };
export type HwLedgerRow = { id: string; tenantId: string; planId: string; invoiceId: string | null; entryType: string; amountCents: number; description: string; source: string; createdAt: string };
// Super-admin alerts (mirrors alerts-core: AlertRow / AlertsSummary / AlertNote).
export type SaAlert = { id: string; tenantId: string | null; tenantName: string | null; title: string; message: string; type: string; severity: string; status: string; relatedModule: string | null; relatedRecordId: string | null; dedupeKey: string; createdAt: string; updatedAt: string; readAt?: string | null; resolvedAt?: string | null; dismissedAt?: string | null };
export type SaAlertNote = { id: string; alertId: string; actorUserId?: string; note: string; createdAt: string };
export type SaAlertDetail = SaAlert & { notes: SaAlertNote[] };
export type SaAlertsSummary = { total: number; unread: number; critical: number; high: number; payment: number; system: number; security: number; support: number };

// wave 3 PAYI: masked view of a branch's own merchant account (never a credential).
export type BranchMerchantAccount = {
  id: string; tenantId: string; branchId: string; branchName: string | null; processorType: string; environment: 'sandbox' | 'production';
  displayName: string | null; merchantIdMasked: string; currency: string; status: string; credentialsConfigured: boolean;
  terminalConfigured: boolean; terminalBaseUrl: string | null; webhookSecretConfigured: boolean; configVersion: number;
  tapToPayMerchantIdMasked?: string; tapToPayConfigured?: boolean;   // migration 704
  lastValidatedAt: string | null; lastValidationError: string | null; updatedAt: string | null;
};
// Payment Gateways command center — shapes returned by /super-admin/platform/payment-gateways/state.
export type PgGateway = {
  tenantId: string; tenantName: string; salonCode: string | null; tenantStatus: string;
  ownerName: string | null; city: string | null; state: string | null; location: string | null;
  branchCount: number; branches: { id: string; name: string; city: string | null; state: string | null; status: string | null }[];
  processor: string | null; merchantIdMasked: string | null; environment: string | null;
  gatewayStatus: 'active' | 'pending' | 'error' | 'disabled' | 'paused' | 'not_configured';
  setupStage: string; paymentSetupLabel: string; onboardingStatus: string; onboardingLabel: string;
  settlementStatus: 'settled' | 'failed' | 'pending' | 'needs_review' | 'not_applicable';
  monthlyVolumeCents: number; todayVolumeCents: number; todayTxnCount: number; pairedTerminals: number; hasConfig: boolean; chargebackAlerts: number;
  credentials: { apiConfigured: boolean; webhookConfigured: boolean };
  lastSyncAt: string | null; lastPaymentAt: string | null;
};
export type PgKpis = {
  totalGateways: number; activeMerchantAccounts: number; pendingPaymentSetup: number; gatewayIssues: number;
  monthlyProcessedVolumeCents: number; failedSettlements: number; chargebackAlerts: number; chargebacksTracked: boolean;
  connectedProcessors: number;
};
export type PgEvent = { id: string; kind: 'success' | 'warning' | 'error' | 'info'; label: string; tenantName: string | null; at: string };
export type PgState = {
  kpis: PgKpis;
  filters: Record<string, unknown>;
  gateways: PgGateway[];
  pagination: { total: number; page: number; limit: number; pages: number };
  analytics: {
    statusBreakdown: { key: string; label: string; count: number; pct: number }[];
    topProcessors: { rank: number; processor: string; activeGateways: number; monthlyVolumeCents: number }[];
    recentEvents: PgEvent[];
    recentActivity: PgEvent[];
  };
  permissions: Record<string, boolean>;
};

export type CustomerSyncRun = { id: string; trigger: string; scope: string; scopeId: string | null; status: string; startedAt: string; finishedAt: string | null; tenantsScanned: number; customersScanned: number; newGlobals: number; linkedExisting: number; duplicateSuspects: number; conflicts: number; errors: number };
export type CustomerSyncTenantStat = { tenantId: string; customersScanned: number; newGlobals: number; linkedExisting: number; duplicateSuspects: number; conflicts: number; errors: number; status: string; errorDetail: string | null };
export type CustomerSyncMergeSide = { globalCustomerId: string; name: string | null; phoneMasked: string; emailMasked: string; phoneVerified: boolean; emailVerified: boolean; status: string; linkedTenants: number; createdAt: string | null };
export type CustomerSyncMergePreview = { a: CustomerSyncMergeSide; b: CustomerSyncMergeSide; indicators: { samePhone: boolean; sameEmail: boolean; sharesTenant: boolean } };
export type CustomerSyncMergeResult = { ok: boolean; reason?: string; moved?: number };
export type CustomerSyncConflict = { id: string; kind: string; tenantId: string | null; customerId: string | null; field: string | null; mainValueMasked: string | null; tenantValueMasked: string | null; status: string; occurrences: number; recommendedAction: string | null; createdAt: string };
export type CustomerSyncDashboard = { lastSync: string | null; lastStatus: string | null; nextScheduled: string | null; recentRuns: CustomerSyncRun[]; openConflicts: number };
export type CustomerSyncRunResult = { ran: boolean; status?: string; skippedReason?: string; customersScanned?: number; newGlobals?: number; linkedExisting?: number; conflicts?: number; errors?: number };

export const superAdminApi = {
  state: (q?: Record<string, unknown>) => api.get('/super-admin/tenants/state', q),
  directoryOverview: () => api.get<DirectoryOverview>('/super-admin/tenants/directory-overview'),
  customerDataOversight: (params?: Record<string, string | number | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<CustomerDataOverview>(`/super-admin/customer-data-oversight/overview${qs ? `?${qs}` : ''}`);
  },
  productCatalog: (params?: Record<string, string | number | boolean | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<ProductCatalogOverview>(`/super-admin/product-catalog/overview${qs ? `?${qs}` : ''}`);
  },
  marketingOverview: (params?: Record<string, string | number | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<MarketingOverview>(`/super-admin/campaigns/marketing-overview${qs ? `?${qs}` : ''}`);
  },
  createAnnouncement: (body: McAnnouncementInput) => api.post<McAnnouncementResult>('/super-admin/campaigns/announcements', body),
  pauseCampaign: (body: { subjectType: string; subjectId: string; subjectName?: string; tenantId?: string | null; currentStatus: string; reason: string }) => api.post<McPauseResult>('/super-admin/campaigns/compliance/pause', body),
  getCampaignLimits: () => api.get<McLimits>('/super-admin/campaigns/compliance/limits'),
  setCampaignLimits: (body: McLimitsInput) => api.post<{ ok: boolean; errors?: string[]; limits?: McLimits }>('/super-admin/campaigns/compliance/limits', body),
  createTemplate: (body: McTemplateInput) => api.post<McTemplateResult>('/super-admin/campaigns/templates', body),
  aiInsightsOverview: (params?: Record<string, string | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<AiInsightsOverview>(`/super-admin/ai-insights/overview${qs ? `?${qs}` : ''}`);
  },
  aiInsights: (params?: Record<string, string | number | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<AiInsightsDirectory>(`/super-admin/ai-insights${qs ? `?${qs}` : ''}`);
  },
  reviewInsights: (ids: string[]) => api.post<{ ok: boolean; reviewed: number }>('/super-admin/ai-insights/bulk-review', { ids }),
  assignInsights: (ids: string[]) => api.post<{ ok: boolean; assigned: number }>('/super-admin/ai-insights/bulk-assign', { ids }),
  dismissInsight: (id: string, reason: string) => api.post<{ ok: boolean; errors?: string[] }>(`/super-admin/ai-insights/${enc(id)}/dismiss`, { reason }),
  aiInsightFeedback: (id: string, input: { verdict: 'helpful' | 'not_helpful' | 'incorrect'; comment?: string }) =>
    api.post<{ ok: boolean; feedback?: AiInsightFeedbackRow; errors?: string[] }>(`/super-admin/ai-insights/${enc(id)}/feedback`, input),
  aiInsightFeedbackRecent: (limit = 8) =>
    api.get<{ ok: boolean; feedback: AiInsightFeedbackRow[] }>(`/super-admin/ai-insights/feedback/recent?limit=${limit}`),
  aiInsight: (id: string) => api.get<{ ok: boolean; insight?: AiInsightDetail; errors?: string[] }>(`/super-admin/ai-insights/${enc(id)}`),
  aiUsageOverview: () => api.get<AiUsageOverview>('/super-admin/ai-usage/overview'),
  saveAiProvider: (body: { providerKey: string; displayName: string; apiKey?: string; defaultModel?: string; status?: string }) => api.post<{ ok: boolean; errors?: string[]; provider?: AiProviderPublic }>('/super-admin/ai-usage/providers', body),
  setAiProviderStatus: (providerKey: string, status: string) => api.post<{ ok: boolean; errors?: string[]; provider?: AiProviderPublic }>('/super-admin/ai-usage/providers/status', { providerKey, status }),
  saveAiPrompt: (body: { promptKey: string; name: string; body: string; status?: string }) => api.post<{ ok: boolean; errors?: string[]; prompt?: AiGlobalPrompt }>('/super-admin/ai-usage/prompts', body),
  deviceMgmtOverview: (params?: Record<string, string | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<DeviceMgmtOverview>(`/super-admin/device-management/overview${qs ? `?${qs}` : ''}`);
  },
  deviceMgmtDevice: (id: string) => api.get<{ ok: boolean; device?: DmDeviceDetail; errors?: string[] }>(`/super-admin/device-management/devices/${enc(id)}`),
  systemStatusOverview: (params?: Record<string, string | undefined>) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<SystemStatusOverview>(`/super-admin/system-status/overview${qs ? `?${qs}` : ''}`);
  },
  realtimeSync: () => api.get<RealtimeSyncStatus>('/super-admin/system-status/realtime'),
  infrastructure: () => api.get<PlatformInfrastructure>('/super-admin/system-status/infrastructure'),
  realtimeTenantDiagnostics: (tenantId: string) => api.get<RealtimeTenantDiagnostics>(`/super-admin/system-status/realtime/tenant/${enc(tenantId)}`),
  createIncident: (body: { title: string; componentKey: string; severity?: string; impact?: string; affectedTenants?: number }) => api.post<{ ok: boolean; errors?: string[]; incident?: { incidentId: string; service: string; severity: string; status: string } }>('/super-admin/system-status/incidents', body),
  updateIncidentStatus: (id: string, status: string) => api.post<{ ok: boolean; errors?: string[]; incident?: { incidentId: string; status: string } }>(`/super-admin/system-status/incidents/${enc(id)}/status`, { status }),
  publishStatusUpdate: (body: { title: string; body?: string; audience?: string; incidentId?: string }) => api.post<{ ok: boolean; errors?: string[]; update?: { title: string; audience: string; status: string } }>('/super-admin/system-status/public-updates', body),
  scheduleMaintenance: (body: { service: string; scope?: string; windowStart: string; windowEnd: string; tenantImpact?: number; owner?: string }) => api.post<{ ok: boolean; errors?: string[]; maintenance?: { service: string; scope: string; noticeStatus: string } }>('/super-admin/system-status/maintenance', body),
  createPostIncidentReport: (body: { title: string; incidentReference: string; summary?: string; rootCause?: string; owner?: string }) => api.post<{ ok: boolean; errors?: string[]; report?: { reportReference: string; title: string; status: string } }>('/super-admin/system-status/post-incident-reports', body),
  notifyTenants: (body: { message: string; channel?: string; audience?: string; incidentReference?: string }) => api.post<{ ok: boolean; errors?: string[]; sent?: { channel: string; audience: string; message: string } }>('/super-admin/system-status/notify-tenants', body),
  createMasterProduct: (body: PcCreateInput) => api.post<PcCreateResult>('/super-admin/product-catalog/products', body),
  listMasterProducts: (params?: { status?: string; search?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<PcMasterProduct[]>(`/super-admin/product-catalog/products${qs ? `?${qs}` : ''}`);
  },
  distributeProduct: (body: { masterProductId: string; tenantIds: string[]; reason?: string; skipExisting?: boolean }) =>
    api.post<{ ok: boolean; errors?: string[]; summary?: { total: number; created: number; skippedExisting: number; alreadyDistributed: number }; results?: { tenantId: string; action: string; tenantProductId?: string | null }[] }>('/super-admin/product-catalog/distributions', body),
  retireMasterProduct: (id: string, reason: string) => api.post<{ ok: boolean; errors?: string[]; product?: PcMasterProduct }>(`/super-admin/product-catalog/products/${enc(id)}/retire`, { reason }),
  productImports: (params?: { status?: string }) => { const qs = params?.status ? `?status=${enc(params.status)}` : ''; return api.get<PcImportJob[]>(`/super-admin/product-catalog/imports${qs}`); },
  productImportErrors: (params?: { status?: string; jobId?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<PcImportError[]>(`/super-admin/product-catalog/imports/errors${qs ? `?${qs}` : ''}`);
  },
  createProductImport: (body: { source?: string; filename?: string | null; rows: any[]; idempotencyKey?: string }) => api.post<{ ok: boolean; errors?: string[]; job?: PcImportJob; deduped?: boolean }>('/super-admin/product-catalog/imports', body),
  approveProductImport: (id: string) => api.post<{ ok: boolean; errors?: string[]; job?: PcImportJob }>(`/super-admin/product-catalog/imports/${enc(id)}/approve`, {}),
  retryProductImportError: (id: string) => api.post<{ ok: boolean; errors?: string[]; error?: PcImportError }>(`/super-admin/product-catalog/imports/errors/${enc(id)}/retry`, {}),
  legalHolds: (params?: { tenantId?: string; status?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<LegalHold[]>(`/super-admin/customer-data-oversight/legal-holds${qs ? `?${qs}` : ''}`);
  },

  // Customer Sync & Reconciliation (global customer identity — the 7 PM engine)
  customerSyncDashboard: () => api.get<CustomerSyncDashboard>('/super-admin/customer-data-oversight/sync/dashboard'),
  customerSyncRuns: (limit = 10) => api.get<CustomerSyncRun[]>(`/super-admin/customer-data-oversight/sync/runs?limit=${limit}`),
  customerSyncRunDetail: (id: string) => api.get<CustomerSyncTenantStat[]>(`/super-admin/customer-data-oversight/sync/runs/${enc(id)}`),
  customerSyncMergePreview: (a: string, b: string) => api.get<CustomerSyncMergePreview>(`/super-admin/customer-data-oversight/sync/merge-preview?a=${enc(a)}&b=${enc(b)}`),
  customerSyncMerge: (body: { sourceGlobalCustomerId: string; targetGlobalCustomerId: string; confirm: boolean }) => api.post<CustomerSyncMergeResult>('/super-admin/customer-data-oversight/sync/merge', body),
  customerSyncConflictStatus: (id: string, status: string) => api.post<boolean>(`/super-admin/customer-data-oversight/sync/conflicts/${enc(id)}/status`, { status }),
  customerSyncConflicts: (status?: string) => api.get<CustomerSyncConflict[]>(`/super-admin/customer-data-oversight/sync/conflicts${status ? `?status=${enc(status)}` : ''}`),
  customerSyncRun: (body: { tenantId?: string; customerId?: string }) => api.post<CustomerSyncRunResult>('/super-admin/customer-data-oversight/sync/run', body),
  applyLegalHold: (body: { tenantId: string; customerId?: string | null; branchId?: string | null; matterRef: string; reason: string; scope: string; reviewAt?: string | null; internalNotes?: string | null }) =>
    api.post<{ ok: boolean; errors?: string[]; hold?: LegalHold }>('/super-admin/customer-data-oversight/legal-holds', body),
  releaseLegalHold: (id: string, reason: string) =>
    api.post<{ ok: boolean; errors?: string[]; hold?: LegalHold }>(`/super-admin/customer-data-oversight/legal-holds/${enc(id)}/release`, { reason }),
  importJobs: (params?: { tenantId?: string; status?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<ImportJob[]>(`/super-admin/customer-data-oversight/imports${qs ? `?${qs}` : ''}`);
  },
  approveImport: (id: string) => api.post<{ ok: boolean; errors?: string[]; job?: ImportJob }>(`/super-admin/customer-data-oversight/imports/${enc(id)}/approve`, {}),
  retryImport: (id: string) => api.post<{ ok: boolean; errors?: string[]; job?: ImportJob }>(`/super-admin/customer-data-oversight/imports/${enc(id)}/retry`, {}),
  rejectImport: (id: string, reason: string) => api.post<{ ok: boolean; errors?: string[]; job?: ImportJob }>(`/super-admin/customer-data-oversight/imports/${enc(id)}/reject`, { reason }),
  deletionRequests: (params?: { tenantId?: string; status?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<DeletionRequest[]>(`/super-admin/customer-data-oversight/deletions${qs ? `?${qs}` : ''}`);
  },
  requestDeletion: (body: { tenantId: string; customerId: string; reason: string }) => api.post<{ ok: boolean; errors?: string[]; request?: DeletionRequest }>('/super-admin/customer-data-oversight/deletions', body),
  approveDeletion: (id: string) => api.post<{ ok: boolean; errors?: string[]; request?: DeletionRequest }>(`/super-admin/customer-data-oversight/deletions/${enc(id)}/approve`, {}),
  rejectDeletion: (id: string, reason: string) => api.post<{ ok: boolean; errors?: string[]; request?: DeletionRequest }>(`/super-admin/customer-data-oversight/deletions/${enc(id)}/reject`, { reason }),
  mergeHistory: (params?: { tenantId?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<MergeLogRow[]>(`/super-admin/customer-data-oversight/merges${qs ? `?${qs}` : ''}`);
  },
  auditHistory: (params?: { tenantId?: string }) => {
    const qs = params ? Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&') : '';
    return api.get<ActivityRow[]>(`/super-admin/customer-data-oversight/audit${qs ? `?${qs}` : ''}`);
  },
  executeDeletion: (id: string, typedConfirmation: string) => api.post<{ ok: boolean; errors?: string[]; request?: DeletionRequest }>(`/super-admin/customer-data-oversight/deletions/${enc(id)}/execute`, { typedConfirmation }),
  bulkStatus: (tenantIds: string[], status: 'active' | 'paused' | 'suspended' | 'cancelled', reason?: string, reasonCode?: string) =>
    api.post<{ ok: boolean; total: number; succeeded: number; failed: number; errors?: string[]; results: Array<{ id: string; ok: boolean; error?: string }> }>('/super-admin/tenants/bulk-status', { tenantIds, status, reason, ...(reasonCode ? { reasonCode } : {}) }),
  dashboard: (q?: Record<string, unknown>) => api.get('/super-admin/dashboard', q),
  systemHealth: () => api.get('/super-admin/system-health'),
  // Constitution 11 §140–156: System Operations — computed component health, platform alerts, SLOs.
  systemOperationsOverview: () => api.get('/super-admin/system/overview'),
  systemOperationsApi: () => api.get('/super-admin/system/api'),
  systemRuntimeSafety: () => api.get('/super-admin/system/runtime-safety'),
  systemMobileTelemetry: () => api.get<MobileTelemetryView>('/super-admin/system/mobile-telemetry'),   // BUILD_PLAN Phase 13 (C6 §116–119)   // BUILD_PLAN Phase 11: schema version, break-glass, limiter, stranded payments
  systemPaymentDevices: () => api.get<PaymentDeviceSecuritySummary>('/super-admin/system/payment-devices'),   // Secure Tap to Pay §51: the fleet's payment-phone security counts
  systemComponentHistory: (key: string) => api.get(`/super-admin/system/components/${enc(key)}/history`),
  createTenant: (body: Record<string, unknown>) => api.post('/super-admin/tenants', body),
  suspend: (id: string, reason: string) => api.post(`/super-admin/tenants/${enc(id)}/suspend`, { reason }),
  // Quick Actions (Tenants/Salons detail panel)
  /** Constitution 7 §16 — move a tenant through the explicit lifecycle (step-up; transition table enforced server-side). */
  changeLifecycle: (id: string, state: string, reason?: string, reasonCode?: string) =>
    api.post<{ ok: boolean; errors?: string[]; from?: string; to?: string; status?: string }>(`/super-admin/tenants/${enc(id)}/lifecycle`, { state, reason, ...(reasonCode ? { reasonCode } : {}) }),
  /** Vietnamese POS mandate WP-A §93: the salon's DEFAULT POS language (English / Vietnamese). PUT is a step-up route
   *  (the client re-prompts on STEP_UP_REQUIRED); staff who chose their own language keep it. */
  tenantPosLanguage: (id: string) => api.get<TenantPosLanguage>(`/super-admin/tenants/${enc(id)}/pos-language`),
  setTenantPosLanguage: (id: string, b: SetTenantPosLanguageBody) => api.put<TenantPosLanguage & { changed: boolean }>(`/super-admin/tenants/${enc(id)}/pos-language`, b as unknown as Record<string, unknown>),
  changeStatus: (id: string, status: 'active' | 'paused' | 'suspended' | 'cancelled', reason?: string, reasonCode?: string) => api.patch<{ ok: boolean; tenant?: any; warning?: string; errors?: string[] }>(`/super-admin/tenants/${enc(id)}/status`, { status, reason, ...(reasonCode ? { reasonCode } : {}) }),
  sendWarning: (id: string, body: Record<string, unknown>) => api.post<{ ok: boolean; warningId?: string; deliveryStatus?: string; errors?: string[] }>(`/super-admin/tenants/${enc(id)}/warning`, body),
  supportAccess: (id: string, body: Record<string, unknown> = {}) => api.post<{ ok: boolean; sessionId?: string; expiresAt?: string; errors?: string[] }>(`/super-admin/tenants/${enc(id)}/support-access`, body),
  /** Security Deep Scan C2: a reason (≥ 10 characters, audited) is required; the temporary password is SENT to the owner
   *  (email / SMS) and never returned — the answer names the channel and a masked destination. Step-up route. */
  resetOwnerPassword: (id: string, b: { reason: string; deliveryMethod?: CredentialDeliveryMethod }) => api.post<CredentialDeliveryResult>(`/super-admin/tenants/${enc(id)}/reset-owner-password`, b),
  audit: (id: string) => api.get(`/super-admin/tenants/${enc(id)}/audit`),
  generateCommissionAuthCode: (body?: { tenantId?: string }) => api.post<{ ok: boolean; code: string; tenantId: string; expiresAt: string }>('/super-admin/commission-auth-code/generate', body || {}),
  getCommissionOversight: () => api.get<{ ok: boolean; activeCodes: any[]; history: any[] }>('/super-admin/commission-oversight'),
  updateTenantCommission: (id: string, initialCommissionPercent: number) => api.patch<{ ok: boolean; defaultCommissionPercent: number }>(`/super-admin/tenants/${enc(id)}/commission`, { initialCommissionPercent }),
  // owner multi-salon assignment — backend: @Controller('super-admin') owners + owners/:ownerId/branches
  owners: () => api.get<{ owners: SaOwnerRow[] }>('/super-admin/owners'),
  owner: (ownerId: string) => api.get<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}`),
  ownerActivity: (ownerId: string) => api.get<SaOwnerActivity[]>(`/super-admin/owners/${enc(ownerId)}/activity`),
  // The owner's salons ACROSS TENANTS, with Store Codes and MTD revenue — the "Salons in Portfolio" table.
  // Backed by the same repository the Owner App uses, so Super Admin can never disagree with the owner.
  ownerPortfolio: (ownerId: string) => api.get<SaOwnerPortfolio>(`/super-admin/owners/${enc(ownerId)}/portfolio`),
  createOwnerSalon: (ownerId: string, body: { name: string; city?: string; state?: string; address?: string; accessLevel?: string; isPrimaryOwner?: boolean; switchPin?: string }) => api.post<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}/salons`, body),
  assignOwnerBranch: (ownerId: string, body: { branchId: string; accessLevel?: string; isPrimaryOwner?: boolean }) => api.post<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}/branches`, body),
  updateOwnerBranch: (ownerId: string, branchId: string, body: { accessLevel?: string; isPrimaryOwner?: boolean }) => api.patch<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}/branches/${enc(branchId)}`, body),
  removeOwnerBranch: (ownerId: string, branchId: string) => api.del<{ ok: boolean; removed: boolean }>(`/super-admin/owners/${enc(ownerId)}/branches/${enc(branchId)}`),
  setOwnerBranchPin: (ownerId: string, branchId: string, pin: string) => api.post<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}/branches/${enc(branchId)}/pin`, { pin }),
  clearOwnerBranchPin: (ownerId: string, branchId: string) => api.del<SaOwnerDetail>(`/super-admin/owners/${enc(ownerId)}/branches/${enc(branchId)}/pin`),
  // project status — backend: @Controller('super-admin/project-status')
  projectStatus: () => api.get('/super-admin/project-status/pos-settings'),
  recheckModule: (moduleKey: string) => api.patch(`/super-admin/project-status/pos-settings/${enc(moduleKey)}/recheck`),
  // per-tenant payment gateway — backend: @Controller('super-admin') tenants/:id/payment-gateway (masked; secrets encrypted)
  getGateway: (id: string) => api.get<MaskedPaymentGateway>(`/super-admin/tenants/${enc(id)}/payment-gateway`),
  /** Constitution 11 §293 — one salon's health (payments, messaging, booking, devices, jobs), worst-in-use overall. */
  /** Constitution 7 §24–§26 — the platform's own staff and their roles. */
  /** Constitution 7 §140–§141 — permission-aware platform search (groups the role cannot see are not returned). */
  platformSearch: (q: string) => api.get<import('@aipowersalon/api-contracts/platform').PlatformSearchResult>('/super-admin/platform-search', { q }),
  platformStaff: () => api.get<PlatformStaffList>('/super-admin/platform-staff'),
  /** Constitution 7 §24 — suspend / reactivate a platform account; its sessions; revoke them all. */
  setPlatformUserStatus: (userId: string, status: 'active' | 'suspended', reason: string) => api.post<{ ok: boolean; from: string; to: string }>(`/super-admin/platform-staff/${enc(userId)}/status`, { status, reason }),
  platformUserSessions: (userId: string) => api.get<{ rows: Array<{ id: string; status: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastSeenAt: string | null; ip: string | null; userAgent: string | null; device: string | null }> }>(`/super-admin/platform-staff/${enc(userId)}/sessions`),
  resetPlatformUserMfa: (userId: string, reason: string) => api.post<{ ok: boolean; recoveryPath: string; expiresAt: string; note: string }>(`/super-admin/platform-staff/${enc(userId)}/reset-mfa`, { reason }),
  revokePlatformUserSessions: (userId: string, reason: string) => api.post<{ ok: boolean; revoked: number }>(`/super-admin/platform-staff/${enc(userId)}/revoke-sessions`, { reason }),
  changePlatformRole: (userId: string, role: string, reason: string) =>
    api.post<PlatformRoleChangeResult>(`/super-admin/platform-staff/${enc(userId)}/role`, { platformRole: role, reason }),
  tenantHealth: (id: string) => api.get<TenantHealth>(`/super-admin/tenants/${enc(id)}/health`),
  /** Constitution 11 §156 — every salon's latest hourly health snapshot (§344), worst first by default. */
  tenantHealthList: (sort: HealthListSort = 'worst', status?: IntegrationState, cursor?: string | null) =>
    api.get<TenantHealthList>(`/super-admin/tenant-health?sort=${enc(sort)}&limit=100${status ? `&status=${enc(status)}` : ''}${cursor ? `&cursor=${enc(cursor)}` : ''}`),
  tenantWarnings: (id: string, limit = 20) => api.get<Array<{ id: string; warningType: string; severity: string; subject: string; message: string; sendEmail: boolean; sendSms: boolean; showInTenantDashboard: boolean; deliveryStatus: string; createdAt: string }>>(`/super-admin/tenants/${enc(id)}/warnings`, { limit }),
  // Super-Admin AI subscription manager (the 15-package paid system; distinct from the legacy tier screen).
  aiAdminPackages: () => api.get<{ packages: Array<{ code: string; name: string; category: string; monthlyPriceCents: number; includedUsageLimit: number; usageUnit: string; trialDays: number; subscribers: number; activeSubscribers: number; byStatus: Record<string, number>; mrrCents: number }>; totals: { subscribers: number; activeSubscribers: number; mrrCents: number } }>('/super-admin/ai/packages'),
  aiAdminPackageTenants: (code: string) => api.get<Array<{ tenantId: string; tenantName: string | null; packageCode: string; status: string; usageLimit: number; overageEnabled: boolean; trialEndsAt: string | null }>>(`/super-admin/ai/packages/${enc(code)}/tenants`),
  aiAdminUsageSummary: () => api.get<Array<{ packageCode: string; status: string; calls: number; usageAmount: number; costMicroUsd: number }>>('/super-admin/ai/usage/summary'),
  aiAdminAssign: (tenantId: string, body: Record<string, unknown>) => api.post<{ ok: boolean }>(`/super-admin/ai/tenants/${enc(tenantId)}/subscriptions`, body),
  aiAdminUpdate: (tenantId: string, code: string, body: Record<string, unknown>) => api.patch<{ ok: boolean }>(`/super-admin/ai/tenants/${enc(tenantId)}/subscriptions/${enc(code)}`, body),
  aiAdminCancel: (tenantId: string, code: string) => api.del<{ ok: boolean }>(`/super-admin/ai/tenants/${enc(tenantId)}/subscriptions/${enc(code)}`),
  setGateway: (id: string, body: Record<string, unknown>) => api.post(`/super-admin/tenants/${enc(id)}/payment-gateway`, body),
  testGateway: (id: string) => api.post(`/super-admin/tenants/${enc(id)}/payment-gateway/test-connection`, {}),
  verifyGateway: (id: string) => api.post<{ ok: boolean; configured: boolean; processorType: string; environment: string; missing: string[]; note: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/verify-credentials`, {}),
  syncGatewayStatus: (id: string) => api.post<{ onboardingStatus: string; status: string; synced: boolean; note: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/sync-merchant-status`, {}),
  rotateWebhookSecret: (id: string) => api.post<{ rotated: boolean; secretOnce: string; secretMasked: string; note: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/webhooks/rotate-secret`, {}),
  gatewaySettlements: (id: string, limit?: number) => api.get<{ settlements: Array<{ id: string; settlementId: string | null; grossCents: number; feeCents: number; netCents: number; currency: string; status: string; settledAt: string | null }> }>(`/super-admin/tenants/${enc(id)}/payment-gateway/settlements`, limit ? { limit } : undefined),
  gatewayWebhooks: (id: string, limit?: number) => api.get<{ events: Array<{ id: string; eventType: string | null; processorType: string; signatureValid: boolean; matched: boolean; receivedAt: string | null }>; health: { received: number; signatureFailures: number; lastReceivedAt: string | null; status: 'healthy' | 'failing' | 'none' } }>(`/super-admin/tenants/${enc(id)}/payment-gateway/webhooks`, limit ? { limit } : undefined),
  // Gateway lifecycle actions (audited; thin wrappers over the resolver status update). Returns the masked gateway.
  // wave 3 PAYI §7/§10: a branch's own merchant account — backend: @Controller('super-admin') tenants/:id/payment-gateway/branches (masked; secrets encrypted; step-up on writes)
  listBranchMerchants: (id: string) => api.get<BranchMerchantAccount[]>(`/super-admin/tenants/${enc(id)}/payment-gateway/branches`),
  setBranchMerchant: (id: string, branchId: string, body: Record<string, unknown>) => api.post<BranchMerchantAccount>(`/super-admin/tenants/${enc(id)}/payment-gateway/branches/${enc(branchId)}`, body),
  testBranchMerchant: (id: string, branchId: string) => api.post<{ ok: boolean; configured: boolean; status: string; tested: boolean; note: string; scope: 'tenant' | 'branch' }>(`/super-admin/tenants/${enc(id)}/payment-gateway/branches/${enc(branchId)}/test-connection`, {}),
  branchMerchantStatus: (id: string, branchId: string, action: 'pause' | 'resume' | 'disable') => api.post<BranchMerchantAccount>(`/super-admin/tenants/${enc(id)}/payment-gateway/branches/${enc(branchId)}/status`, { action }),
  pauseGateway: (id: string) => api.post<{ status: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/pause`, {}),
  resumeGateway: (id: string) => api.post<{ status: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/resume`, {}),
  disableGateway: (id: string) => api.post<{ status: string }>(`/super-admin/tenants/${enc(id)}/payment-gateway/disable`, {}),
  // platform module (applications / leads / hardware / support access) — backend: @Controller('super-admin/platform')
  platformState: () => api.get('/super-admin/platform/state'),
  applications: (q?: Record<string, unknown>) => api.get('/super-admin/platform/applications', q),
  applicationMetrics: () => api.get<any>('/super-admin/platform/applications/metrics'),
  applicationStatus: (id: string, status: string, meta?: { note?: string; reason?: string }) => api.post(`/super-admin/platform/applications/${enc(id)}/status`, { status, ...(meta || {}) }),
  applicationAssign: (id: string, userId: string | null) => api.post(`/super-admin/platform/applications/${enc(id)}/assign`, { userId }),
  applicationPriority: (id: string, priority: string) => api.post(`/super-admin/platform/applications/${enc(id)}/priority`, { priority }),
  applicationFollowUp: (id: string, at: string | null) => api.post(`/super-admin/platform/applications/${enc(id)}/follow-up`, { at }),
  applicationContactLog: (id: string, channel: string, note?: string) => api.post(`/super-admin/platform/applications/${enc(id)}/contact-log`, { channel, note }),
  applicationApprove: (id: string, note: string) => api.post(`/super-admin/platform/applications/${enc(id)}/approve`, { note }),
  applicationReject: (id: string, reason: string) => api.post(`/super-admin/platform/applications/${enc(id)}/reject`, { reason }),
  applicationDuplicate: (id: string, reason?: string) => api.post(`/super-admin/platform/applications/${enc(id)}/duplicate`, { reason }),
  applicationSpam: (id: string, reason?: string) => api.post(`/super-admin/platform/applications/${enc(id)}/spam`, { reason }),
  applicationArchive: (id: string) => api.post(`/super-admin/platform/applications/${enc(id)}/archive`, {}),
  applicationConvertToOnboarding: (id: string) => api.post(`/super-admin/platform/applications/${enc(id)}/convert-to-onboarding`, {}),
  applicationEin: (id: string) => api.get<{ ok: boolean; ein: string | null; last4: string | null; reason?: string }>(`/super-admin/platform/applications/${enc(id)}/ein`),

  // AI Analytics & Forecasting oversight (aggregate platform health only)
  aiForecastingOverview: () => api.get<any>('/super-admin/ai-forecasting/overview'),
  aiForecastingTenants: (q?: Record<string, unknown>) => api.get<any>('/super-admin/ai-forecasting/tenants', q),


  // General Settings (platform-wide configuration)
  generalSettingsOverview: () => api.get<{ cards: Record<string, any> }>('/super-admin/settings/general/overview'),
  generalSettings: () => api.get<{ groups: { group: string; settings: any[] }[]; explicitlySetCount: number }>('/super-admin/settings/general'),
  generalSettingsSave: (changes: { key: string; value: unknown; expectedVersion?: number; reason?: string }[]) =>
    api.post<{ applied: { key: string; version: number }[]; skipped: string[]; conflicts: string[] }>('/super-admin/settings/general/save', { changes }),
  generalSettingsHistory: (limit?: number) => api.get<any[]>('/super-admin/settings/general/history', limit ? { limit } : undefined),
  generalSettingsSeries: (days = 7) => api.get<{ date: string; count: number }[]>('/super-admin/settings/general/history/series', { days }),
  generalSettingsLocaleDistribution: () => api.get<{ available: boolean; defaultLocale: string; items: { locale: string; label: string; count: number }[] }>('/super-admin/settings/general/localization-distribution'),
  generalSettingsAdoptionRate: () => api.get<{ available: boolean; totalTenants: number; onDefaults: number; customized: number; rate: number }>('/super-admin/settings/general/adoption-rate'),
  generalSettingsReset: (confirm: string) => api.post<{ reset: number }>('/super-admin/settings/general/reset', { confirm }),
  generalSettingsOperation: (op: string) => api.post<{ ok: boolean; op: string; note: string }>('/super-admin/settings/general/operations', { op }),

  // Business Categories
  bizCategories: (includeInactive = false) => api.get<{ id: string; name: string; slug: string; description: string | null; sortOrder: number; active: boolean; isDefault: boolean }[]>('/super-admin/settings/general/business-categories', includeInactive ? { includeInactive: true } : undefined),
  bizCategoriesSummary: () => api.get<{ active: number; total: number }>('/super-admin/settings/general/business-categories/summary'),
  bizCatCreate: (body: { name: string; description?: string }) => api.post<any>('/super-admin/settings/general/business-categories', body),
  bizCatRename: (id: string, name: string) => api.post<any>(`/super-admin/settings/general/business-categories/${enc(id)}/rename`, { name }),
  bizCatActivate: (id: string) => api.post<any>(`/super-admin/settings/general/business-categories/${enc(id)}/activate`),
  bizCatDeactivate: (id: string) => api.post<any>(`/super-admin/settings/general/business-categories/${enc(id)}/deactivate`),
  bizCatReorder: (orderedIds: string[]) => api.post<any>('/super-admin/settings/general/business-categories/reorder', { orderedIds }),

  // Tenant Presets
  tenantPresets: () => api.get<{ id: string; name: string; scope: string; scopeLabel: string; category: string | null; count: number; isDefault: boolean; active: boolean; updatedAt: string }[]>('/super-admin/settings/general/tenant-presets'),
  tenantPresetDefaults: () => api.get<Record<'tenant' | 'branch' | 'onboarding', { id: string; name: string; count: number } | null>>('/super-admin/settings/general/tenant-presets/defaults'),
  tenantPresetCreate: (body: { name: string; scope: string; description?: string; settings?: unknown; makeDefault?: boolean }) => api.post<any>('/super-admin/settings/general/tenant-presets', body),
  tenantPresetMakeDefault: (id: string) => api.post<any>(`/super-admin/settings/general/tenant-presets/${enc(id)}/make-default`),

  // Platform Branding (colors + tagline; logo is a locked brand asset)
  branding: () => api.get<{ platform_name: string; tagline: string; primary_color: string; secondary_color: string; accent_color: string; surface_color: string; text_color: string; logo_full_url: string; logo_locked: boolean }>('/super-admin/settings/branding'),
  brandingUpdate: (patch: Record<string, string>) => api.patch<any>('/super-admin/settings/branding', patch),
  brandingRestore: () => api.post<any>('/super-admin/settings/branding/restore'),
  legalDocAcceptance: (docType: string) => api.get<{ available: boolean; version?: string; accepted: number; declined: number; pending: number; total: number }>('/super-admin/settings/general/legal-documents/acceptance-status', { docType }),

  // Legal Documents
  legalDocuments: () => api.get<{ docType: string; label: string; version: string; lastUpdated: string | null; status: string; versionId: string; requiredAcceptance: boolean }[]>('/super-admin/settings/general/legal-documents'),
  legalDocOverviewVersion: () => api.get<{ available: boolean; version: string | null; docCount: number }>('/super-admin/settings/general/legal-documents/overview-version'),
  legalDocHistory: (limit?: number) => api.get<{ id: string; docType: string; label: string; version: string; publishedOn: string | null; publishedBy: string | null; status: string }[]>('/super-admin/settings/general/legal-documents/history', limit ? { limit } : undefined),
  legalDocCreate: (body: { docType: string; version: string; title?: string; content?: string; summary?: string; requiredAcceptance?: boolean }) => api.post<any>('/super-admin/settings/general/legal-documents', body),
  legalDocPublish: (id: string) => api.post<any>(`/super-admin/settings/general/legal-documents/${enc(id)}/publish`),
  legalDocRetire: (id: string) => api.post<any>(`/super-admin/settings/general/legal-documents/${enc(id)}/retire`),

  // Maintenance & Messaging
  maintenanceState: () => api.get<{ active: boolean; mode: string; message: string; expectedRestoration: string | null; allowedRoles: string[]; announcementBanner: string; enabledBy: string | null; enabledAt: string | null; nextScheduled: { id: string; title: string; startsAt: string | null; endsAt: string | null } | null }>('/super-admin/settings/general/maintenance'),
  maintenanceHistory: (limit?: number) => api.get<{ id: string; startsAt: string | null; duration: string; reason: string; status: string; mode: string }[]>('/super-admin/settings/general/maintenance/history', limit ? { limit } : undefined),
  maintenanceEnable: (body: { reason: string; mode?: string; message?: string; expectedRestoration?: string; allowedRoles?: string[] }) => api.post<any>('/super-admin/settings/general/maintenance/enable', body),
  maintenanceDisable: () => api.post<any>('/super-admin/settings/general/maintenance/disable'),
  maintenanceSchedule: (body: { title?: string; reason: string; startsAt: string; endsAt: string; mode?: string; timezone?: string }) => api.post<any>('/super-admin/settings/general/maintenance/schedule', body),
  maintenanceCancel: (id: string) => api.post<any>(`/super-admin/settings/general/maintenance/schedule/${enc(id)}/cancel`),
  maintenanceBanner: (text: string) => api.post<any>('/super-admin/settings/general/maintenance/banner', { text }),

  applicationNote: (id: string, text: string) => api.post(`/super-admin/platform/applications/${enc(id)}/notes`, { text }),
  applicationConverted: (id: string, tenantId: string) => api.post(`/super-admin/platform/applications/${enc(id)}/converted`, { tenantId }),
  leads: (q?: Record<string, unknown>) => api.get('/super-admin/platform/leads', q),
  createLead: (b: Record<string, unknown>) => api.post('/super-admin/platform/leads', b),
  leadStatus: (id: string, status: string) => api.post(`/super-admin/platform/leads/${enc(id)}/status`, { status }),
  leadConvert: (id: string) => api.post(`/super-admin/platform/leads/${enc(id)}/convert`, {}),
  hardware: (q?: Record<string, unknown>) => api.get('/super-admin/platform/hardware', q),
  createHardware: (b: Record<string, unknown>) => api.post('/super-admin/platform/hardware', b),
  updateHardware: (id: string, b: Record<string, unknown>) => api.post(`/super-admin/platform/hardware/${enc(id)}`, b),
  supportSessions: (active = true) => api.get('/super-admin/platform/support-sessions', { active }),
  startSupportSession: (b: Record<string, unknown>) => api.post('/super-admin/platform/support-sessions', b),
  /** Constitution 7 §75 — this admin's live Support Mode sessions (the banner). */
  mySupportSessions: () => api.get<import('../components/SupportModeBanner').MySupportSession[]>('/super-admin/platform/support-sessions/mine'),
  /** Constitution 7 §78 — extend your own live support session (reason; step-up; capped; owner told). */
  extendSupportSession: (id: string, minutes: number, reason: string) => api.post(`/super-admin/platform/support-sessions/${enc(id)}/extend`, { minutes, reason }),
  endSupportSession: (id: string) => api.post(`/super-admin/platform/support-sessions/${enc(id)}/end`, {}),
  auditLogs: (q?: Record<string, unknown>) => api.get('/super-admin/platform/audit-logs', q),
  tenantActivity: (q?: Record<string, unknown>) => api.get('/super-admin/tenant-activity', q),
  tenantActivitySummary: (q?: Record<string, unknown>) => api.get('/super-admin/tenant-activity/summary', q),
  // Payment Gateways command center — backend: @Controller('super-admin/platform') payment-gateways/state|export (masked; secrets stay server-side).
  paymentGatewaysState: (q?: Record<string, unknown>) => api.get<PgState>('/super-admin/platform/payment-gateways/state', q),
  paymentGatewaysExport: (q?: Record<string, unknown>) => api.exportAsync<{ filename: string; csv: string }>('/super-admin/platform/payment-gateways/export', q),
  aiPackages: () => api.get('/super-admin/platform/ai-packages'),
  setAiPackage: (tenantId: string, pkg: string) => api.post(`/super-admin/platform/ai-packages/${enc(tenantId)}`, { package: pkg }),
  setAiFeature: (tenantId: string, feature: string, enabled: boolean | null) => api.post(`/super-admin/platform/ai-packages/${enc(tenantId)}/features`, { feature, enabled }),
  appFlags: (tenantId: string) => api.get<{ ok: boolean; flags: { key: string; default: boolean; override: boolean | null; enabled: boolean }[] }>(`/super-admin/platform/app-flags/${enc(tenantId)}`),
  setAppFlag: (tenantId: string, flag: string, enabled: boolean | null) => api.post(`/super-admin/platform/app-flags/${enc(tenantId)}`, { flag, enabled }),
  usageLimits: () => api.get('/super-admin/platform/usage-limits'),
  setUsageLimit: (tenantId: string, metric: string, limitValue: number) => api.post(`/super-admin/platform/usage-limits/${enc(tenantId)}`, { metric, limitValue }),
  users: (q?: Record<string, unknown>) => api.get('/super-admin/platform/users', q),
  usersDashboard: (q?: Record<string, unknown>) => api.get<{ kpis: any; kpiCards: any[]; rolesDistribution: any[]; roleHealth: any[]; permissions: any; permissionLevels: any[]; branchAllocation: any; branchAccess: any; topTenants: any; pendingInvitations: any; growth: any[]; growthDaily: any; recentActivity: any[]; accessAlerts: any[]; mfaAdoptionPct: any; securityScore: any; avgLoginTime: any }>('/super-admin/platform/users-dashboard', q),
  branchesDashboard: () => api.get<BranchesDashboard>('/super-admin/platform/branches-dashboard'),
  branchesDirectory: (q?: Record<string, unknown>) => api.get<BranchesDirectoryPage>('/super-admin/platform/branches', q),
  branchesExport: (q?: Record<string, unknown>) => api.exportAsync<{ filename: string; mime: string; content: string; rowCount: number }>('/super-admin/platform/branches/export', q),
  bulkBranchStatus: (body: { branchIds: string[]; status: string; reason: string }) => api.post<{ status: string; summary: { total: number; succeeded: number; failed: number }; results: { id: string; name: string; ok: boolean; message: string }[] }>('/super-admin/platform/branches/bulk-status', body),
  createBranch: (body: Record<string, unknown>) => api.post<{ id: string; name: string; status: string; tenantId: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null }>('/super-admin/platform/branches', body),
  changeBranchStatus: (id: string, body: { status: string; reason: string; confirmName?: string }) => api.post<{ id: string; name: string; from: string; to: string }>(`/super-admin/platform/branches/${enc(id)}/status`, body),
  assignableManagers: (id: string) => api.get<{ branchTenantId: string; managers: { id: string; name: string; email: string | null; role: string; currentBranchId: string | null }[] }>(`/super-admin/platform/branches/${enc(id)}/assignable-managers`),
  assignBranchManager: (id: string, body: { managerUserId: string; reason: string; effectiveDate?: string }) => api.post<{ branch: { id: string; name: string }; manager: { id: string; name: string; email: string | null }; movedFromBranchId: string | null }>(`/super-admin/platform/branches/${enc(id)}/manager`, body),
  branchTransferOptions: (id: string) => api.get<{ branch: { id: string; name: string; currentTenantId: string; currentTenantName: string | null }; destinations: { id: string; name: string; status: string }[] }>(`/super-admin/platform/branches/${enc(id)}/transfer-options`),
  branchTransferPreflight: (id: string, destTenantId: string) => api.get<{ branch: { id: string; name: string }; destination: { id: string; name: string; status: string }; impact: { staff: number; appointments: number; serviceRecords: number; supportTickets: number; queueItems: number }; blockers: string[] }>(`/super-admin/platform/branches/${enc(id)}/transfer-preflight`, { destTenantId }),
  requestBranchTransfer: (id: string, body: { destinationTenantId: string; reason: string; confirmName: string; effectiveDate?: string }) => api.post<{ id: string; status: string; toTenantId: string; executed: boolean }>(`/super-admin/platform/branches/${enc(id)}/transfer`, body),
  branchHours: (id: string) => api.get<{ branch: { id: string; name: string }; days: { dayOfWeek: number; label: string; isClosed: boolean; opensAt: string | null; closesAt: string | null; set: boolean }[] }>(`/super-admin/platform/branches/${enc(id)}/hours`),
  setBranchHours: (id: string, body: { days: { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[] }) => api.post<{ count: number }>(`/super-admin/platform/branches/${enc(id)}/hours`, body),
  branchDevices: (id: string) => api.get<{ branch: { id: string; name: string }; tenantId: string; devices: { id: string; category: string; deviceType: string; name: string; status: string; currentBranchId: string | null; currentBranchName: string | null; onThisBranch: boolean; allocatable: boolean }[] }>(`/super-admin/platform/branches/${enc(id)}/devices`),
  allocateDevice: (id: string, body: { deviceId: string; category: string }) => api.post<{ device: { id: string; name: string }; movedFromBranchId: string | null }>(`/super-admin/platform/branches/${enc(id)}/devices/allocate`, body),
  platformServices: (q?: Record<string, unknown>) => api.get('/super-admin/platform/services', q),
  platformServiceCategories: (q?: Record<string, unknown>) => api.get<{ rows: any[]; total: number; kpis: any; duplicates: any[] }>('/super-admin/platform/service-categories', q),
  tenantServiceCategories: (tenantId: string) => api.get<{ tenantName: string | null; categories: { id: string; name: string; status: string; serviceCount: number }[] }>('/super-admin/platform/tenant-service-categories', { tenantId }),

  // Ticket Oversight (read-only, cross-tenant) — backend: @Controller('super-admin/tickets') (SuperAdminGuard, GET-only).
  tickets: (q?: Record<string, unknown>) => api.get<{ ok: boolean; tickets: any[]; page: number; pageSize: number; total: number }>('/super-admin/tickets', q),
  ticketHistory: (id: string) => api.get<{ ok: boolean; ticket: any; lines: any[]; revisions: any[] }>(`/super-admin/tickets/${enc(id)}/history`),
  // Deletion Authorization Code + controlled logical removal (P8) — SuperAdminGuard. Code is encrypted at rest; reveal + remove are audited.
  generateDeletionCode: (id: string) => api.post<{ ok: boolean; generated: boolean }>(`/super-admin/tickets/${enc(id)}/deletion-code`, {}),
  revealDeletionCode: (id: string) => api.post<{ ok: boolean; code: string }>(`/super-admin/tickets/${enc(id)}/deletion-code/reveal`, {}),
  removeTicket: (id: string, body: { code: string; reason: string }) => api.post<{ ok: boolean; removed: boolean }>(`/super-admin/tickets/${enc(id)}/remove`, body),
  customerDuplicates: (q?: Record<string, unknown>) => api.get<{ cases: any[]; total: number }>('/super-admin/platform/customer-duplicates', q),
  mergeServiceCategories: (b: Record<string, unknown>) => api.post<{ ok: boolean; mergeLogId: string | null; sourceCategoryId: string; targetCategoryId: string; reattributedServiceCount: number }>('/super-admin/platform/service-categories/merge', b),
  privacyRequests: (q?: Record<string, unknown>) => api.get<{ rows: any[]; total: number; kpis: any }>('/super-admin/platform/privacy-requests', q),
  paymentsTransactions: (q?: Record<string, unknown>) => api.get('/super-admin/platform/payments-transactions', q),
  paymentTransactionDetail: (id: string) => api.get(`/super-admin/platform/payments-transactions/${encodeURIComponent(id)}`),
  paymentAuthorizationHistory: (id: string) => api.get(`/super-admin/platform/payments-transactions/${encodeURIComponent(id)}/authorization-history`),
  promotionsOverview: () => api.get('/super-admin/promotions/overview'),
  aiReportsOverview: () => api.get('/super-admin/ai-reports/overview'),
  promotionApprove: (id: string) => api.post(`/super-admin/promotions/${encodeURIComponent(id)}/approve`, {}),
  promotionDisable: (id: string, reason: string) => api.post(`/super-admin/promotions/${encodeURIComponent(id)}/disable`, { reason }),
  platformReminders: (q?: Record<string, unknown>) => api.get('/super-admin/platform/reminders', q),
  securityOverview: () => api.get('/super-admin/security/overview'),
  securityAuditRun: () => api.post('/super-admin/security/audit/run', {}),
  securityAuditRuns: (limit = 10) => api.get(`/super-admin/security/audit/runs?limit=${limit}`),
  securityAuditFindings: (status?: string) => api.get(`/super-admin/security/audit/findings${status ? `?status=${status}` : ''}`),
  securitySessionRevokePreview: (b: Record<string, unknown>) => api.post('/super-admin/security/sessions/revoke/preview', b),
  securitySessionRevoke: (b: Record<string, unknown>) => api.post('/super-admin/security/sessions/revoke', b),
  securityIpBlocks: () => api.get('/super-admin/security/ip-blocks'),
  securityIpBlockPreview: (b: Record<string, unknown>) => api.post('/super-admin/security/ip-blocks/preview', b),
  securityIpBlock: (b: Record<string, unknown>) => api.post('/super-admin/security/ip-blocks', b),
  securityIpUnblock: (id: string) => api.del('/super-admin/security/ip-blocks/' + encodeURIComponent(id)),
  securityIncidents: () => api.get('/super-admin/security/incidents'),
  securityIncidentCreate: (b: Record<string, unknown>) => api.post('/super-admin/security/incidents', b),
  securityIncidentTransition: (id: string, b: Record<string, unknown>) => api.patch('/super-admin/security/incidents/' + encodeURIComponent(id) + '/transition', b),
  securityMfaPolicy: () => api.get('/super-admin/security/mfa-policy'),
  securityMfaPolicySet: (b: Record<string, unknown>) => api.patch('/super-admin/security/mfa-policy', b),
  securityPasswordPolicy: () => api.get('/super-admin/security/password-policy'),
  securityPasswordPolicySet: (b: Record<string, unknown>) => api.patch('/super-admin/security/password-policy', b),
  securitySessionPolicy: () => api.get('/super-admin/security/session-policy'),
  securitySessionPolicySet: (b: Record<string, unknown>) => api.patch('/super-admin/security/session-policy', b),
  securityLockdowns: () => api.get('/super-admin/security/lockdowns'),
  securityLockdownPropose: (b: Record<string, unknown>) => api.post('/super-admin/security/lockdowns/propose', b),
  securityLockdownConfirm: (id: string, b: Record<string, unknown>) => api.post('/super-admin/security/lockdowns/' + encodeURIComponent(id) + '/confirm', b),
  securityLockdownExecute: (id: string) => api.post('/super-admin/security/lockdowns/' + encodeURIComponent(id) + '/execute', {}),
  securityLockdownLift: (id: string, b: Record<string, unknown>) => api.post('/super-admin/security/lockdowns/' + encodeURIComponent(id) + '/lift', b),
  securityPrivilegedGrants: () => api.get('/super-admin/security/privileged-access'),
  securityPrivilegedGrantRequest: (b: Record<string, unknown>) => api.post('/super-admin/security/privileged-access/request', b),
  securityPrivilegedGrantApprove: (id: string) => api.post('/super-admin/security/privileged-access/' + encodeURIComponent(id) + '/approve', {}),
  securityPrivilegedGrantRevoke: (id: string, b: Record<string, unknown>) => api.post('/super-admin/security/privileged-access/' + encodeURIComponent(id) + '/revoke', b),
  securityRetentionRules: () => api.get('/super-admin/security/retention-rules'),
  securityRetentionRuleSet: (dataClass: string, b: Record<string, unknown>) => api.patch('/super-admin/security/retention-rules/' + encodeURIComponent(dataClass), b),
  securityRetentionPurgePreview: (dataClass: string) => api.post('/super-admin/security/retention-rules/' + encodeURIComponent(dataClass) + '/preview-purge', {}),
  roles: () => api.get('/super-admin/platform/roles'),
  // Security Deep Scan C3: POST /super-admin/platform/users (create a Super Admin with a returned password) is retired (410).
  // Platform accounts are created by invitation: role SUPER_ADMIN + the platformRole they will hold (step-up route).
  // Either identifier is enough — the person signs in with whichever the admin provides (both is fine too).
  inviteUser: (b: { email?: string; phone?: string; fullName: string; role: string; platformRole?: string; tenantId?: string | null; branchId?: string | null }) => api.post<InvitationResult>('/super-admin/platform/users/invite', b),
  assignUserBranch: (b: Record<string, unknown>) => api.post<{ ok: boolean; userId: string; branchId: string; accessLevel: string }>('/super-admin/platform/users/branch-access', b),
  revokeUserBranch: (b: Record<string, unknown>) => api.post<{ ok: boolean; userId: string; branchId: string; removed: number }>('/super-admin/platform/users/branch-access/revoke', b),
  tenantUsersAndBranches: (tenantId: string) => api.get<{ tenantName: string | null; users: { id: string; fullName: string; email: string | null; role: string }[]; branches: { id: string; name: string }[] }>('/super-admin/platform/tenant-users-branches', { tenantId }),
  disableUser: (id: string) => api.post(`/super-admin/platform/users/${enc(id)}/disable`, {}),
  enableUser: (id: string) => api.post(`/super-admin/platform/users/${enc(id)}/enable`, {}),
  /** C2: reason required (audited); the temporary password goes to the account holder only — step-up route */
  resetUserPassword: (id: string, b: { reason: string; deliveryMethod?: CredentialDeliveryMethod }) => api.post<CredentialDeliveryResult & { id: string }>(`/super-admin/platform/users/${enc(id)}/reset-password`, b),
  setUserRole: (id: string, role: string) => api.post<{ id: string; before: string; after: string }>(`/super-admin/platform/users/${enc(id)}/role`, { role }),
  setUserMfa: (id: string, required: boolean) => api.post<{ id: string; mfaEnabled: boolean; changed: boolean }>(`/super-admin/platform/users/${enc(id)}/mfa`, { required }),
  /** C2: the re-sent temporary password goes to the invitee only — step-up route */
  resendInvite: (id: string, b: { deliveryMethod?: CredentialDeliveryMethod } = {}) => api.post<CredentialDeliveryResult & { id: string; email: string | null }>(`/super-admin/platform/users/${enc(id)}/resend-invite`, b),
  // secure invitation tokens (single-use, expiring) — distinct from the legacy temp-password invite above
  // Addressed to an email OR a phone; a phone-addressed invite is delivered by SMS (see migration 379).
  createInvitation: (b: { email?: string; phone?: string; fullName?: string; role: string; platformRole?: string; tenantId?: string | null; branchId?: string | null; channel?: string }) => api.post<InvitationResult>('/super-admin/platform/invitations', b),
  listInvitations: (q?: Record<string, unknown>) => api.get<{ rows: any[]; total: number }>('/super-admin/platform/invitations', q),
  resendInvitationToken: (id: string) => api.post<{ id: string; tokenPrefix: string; expiresAt: string; deliveryStatus: string; manualAcceptToken?: string | null }>(`/super-admin/platform/invitations/${enc(id)}/resend`, {}),
  cancelInvitationToken: (id: string) => api.post<{ id: string; status: string }>(`/super-admin/platform/invitations/${enc(id)}/cancel`, {}),
  // access-request approval workflow (§26)
  listAccessRequests: (q?: Record<string, unknown>) => api.get<{ rows: any[]; total: number }>('/super-admin/platform/access-requests', q),
  exportUsers: (q?: Record<string, unknown>) => api.exportAsync<{ filename: string; csv: string; rowCount: number; total: number; truncated: boolean }>('/super-admin/platform/users/export', q),
  // scheduled reports
  listScheduledReports: () => api.get<{ rows: any[]; total: number }>('/super-admin/platform/scheduled-reports'),
  createScheduledReport: (b: { name: string; reportKey?: string; cadence: string; recipientEmail?: string | null; filters?: Record<string, unknown> }) => api.post<{ id: string }>('/super-admin/platform/scheduled-reports', b),
  toggleScheduledReport: (id: string, enabled: boolean) => api.post<{ id: string; enabled: boolean }>(`/super-admin/platform/scheduled-reports/${enc(id)}/toggle`, { enabled }),
  runScheduledReportNow: (id: string) => api.post<{ id: string; status: string }>(`/super-admin/platform/scheduled-reports/${enc(id)}/run-now`, {}),
  deleteScheduledReport: (id: string) => api.del<{ id: string; deleted: boolean }>(`/super-admin/platform/scheduled-reports/${enc(id)}`),
  approveAccessRequest: (id: string, body?: { notes?: string; durationDays?: number | null; confirmHighRisk?: boolean }) => api.post<{ status: string }>(`/super-admin/platform/access-requests/${enc(id)}/approve`, body || {}),
  rejectAccessRequest: (id: string, body?: { notes?: string }) => api.post<{ status: string }>(`/super-admin/platform/access-requests/${enc(id)}/reject`, body || {}),
  cancelInvite: (id: string) => api.post<{ id: string; status: string }>(`/super-admin/platform/users/${enc(id)}/cancel-invite`, {}),
  userSessions: (id: string) => api.get<{ id: string; deviceId: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string; expiresAt: string }[]>(`/super-admin/platform/users/${enc(id)}/sessions`),
  revokeSession: (sessionId: string) => api.post<{ sessionId: string; revoked: boolean }>(`/super-admin/platform/sessions/${enc(sessionId)}/revoke`, {}),
  revokeAllUserSessions: (id: string) => api.post<{ userId: string; revoked: number }>(`/super-admin/platform/users/${enc(id)}/revoke-sessions`, {}),
  reports: () => api.get('/super-admin/platform/reports'),
  topPerformingTenants: (limit = 5) => api.get<{ tenants: { rank: number; tenantId: string; salonName: string; salonCode: string | null; city: string | null; state: string | null; monthlyCardVolume: number; formattedMonthlyCardVolume: string; growthPercent: number | null; trendDirection: string }[] }>('/super-admin/platform/top-performing-tenants', { limit }),
  tenantPerformanceReport: (q?: Record<string, unknown>) => api.get<{ rows: any[]; total: number; page: number; pageSize: number; totalPages: number; summary: { totalVolumeCents: number; totalTransactions: number; averageTenantVolumeCents: number; topTenantVolumeCents: number; momGrowthPercent: number | null; activeTenantsIncluded: number } }>('/super-admin/platform/tenant-performance', q),
  // hardware payment recovery — backend: @Controller('super-admin') hardware-payment/*
  hwTenantSettings: (id: string) => api.get<HwTenantSettingsResponse>(`/super-admin/tenants/${enc(id)}/hardware-payment/settings`),
  hwSetTenantSettings: (id: string, b: Record<string, unknown>) => api.patch(`/super-admin/tenants/${enc(id)}/hardware-payment/settings`, b),
  hwPlan: (id: string) => api.get<HwPlanResponse>(`/super-admin/tenants/${enc(id)}/hardware-payment-plan`),
  hwCreatePlan: (id: string, b: Record<string, unknown>) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment-plan`, b),
  hwInvoices: (id: string) => api.get<HwInvoice[]>(`/super-admin/tenants/${enc(id)}/hardware-payment/invoices`),
  hwLedger: (id: string) => api.get<HwLedgerRow[]>(`/super-admin/tenants/${enc(id)}/hardware-payment/ledger`),
  hwRecalc: (id: string, b: Record<string, unknown>) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment/recalculate-month`, b),
  hwChargeShortfall: (id: string, b: Record<string, unknown>) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment/charge-shortfall`, b),
  hwImportVolume: (id: string, b: Record<string, unknown>) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment/import-volume`, b),
  hwPause: (id: string, planId: string) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment/pause`, { planId }),
  hwResume: (id: string, planId: string) => api.post(`/super-admin/tenants/${enc(id)}/hardware-payment/resume`, { planId }),
  hwRunMonthly: (billingMonth: string) => api.post('/super-admin/hardware-payment/run-monthly', { billingMonth }),
  hwReports: () => api.get<HwReportRow[]>('/super-admin/hardware-payment/reports'),
  // Alerts (Recent Alerts card + full Alerts page)
  alerts: (q?: Record<string, unknown>) => api.get<{ rows: SaAlert[]; total: number }>('/super-admin/alerts', q),
  alertsSummary: () => api.get<SaAlertsSummary>('/super-admin/alerts/summary'),
  alertsUnreadCount: () => api.get<number>('/super-admin/alerts/unread-count'),
  alert: (id: string) => api.get<SaAlertDetail | null>(`/super-admin/alerts/${enc(id)}`),
  alertStatus: (id: string, status: string) => api.patch<{ ok: boolean; alert?: SaAlert; error?: string }>(`/super-admin/alerts/${enc(id)}/status`, { status }),
  alertNote: (id: string, note: string) => api.post<{ ok: boolean; error?: string }>(`/super-admin/alerts/${enc(id)}/notes`, { note }),
  alertsMarkAllRead: () => api.post<{ ok: boolean; count: number }>('/super-admin/alerts/mark-all-read', {}),
  alertsSync: () => api.post<{ ok: boolean; created: number }>('/super-admin/alerts/sync', {}),

  // Catalog Management → Service Templates
  catalogOverview: () => api.get<CatalogOverview>('/super-admin/catalog/service-templates/overview'),
  catalogTemplates: (q?: Record<string, unknown>) => api.get<CatalogListResult>('/super-admin/catalog/service-templates', q),
  catalogTemplate: (id: string) => api.get<CatalogTemplateDetail>(`/super-admin/catalog/service-templates/${enc(id)}`),
  catalogCreate: (body: Record<string, unknown>) => api.post<CatalogTemplateDetail>('/super-admin/catalog/service-templates', body),
  catalogUpdate: (id: string, body: Record<string, unknown>) => api.patch<CatalogTemplateDetail>(`/super-admin/catalog/service-templates/${enc(id)}`, body),
  catalogPublish: (id: string) => api.post<CatalogTemplateDetail>(`/super-admin/catalog/service-templates/${enc(id)}/publish`, {}),
  catalogRetire: (id: string, reason: string) => api.post<CatalogTemplateDetail>(`/super-admin/catalog/service-templates/${enc(id)}/retire`, { reason }),
  catalogCategories: () => api.get<CatalogCategoryRow[]>('/super-admin/catalog/categories'),
  catalogCategoryCreate: (body: { name: string; iconKey?: string | null }) => api.post<CatalogCategoryRow[]>('/super-admin/catalog/categories', body),
  catalogCategoryUpdate: (code: string, body: Record<string, unknown>) => api.patch<CatalogCategoryRow[]>(`/super-admin/catalog/categories/${enc(code)}`, body),
  catalogDeployPreview: (id: string, allowOverwrite: boolean) => api.get<CatalogDeployPreview>(`/super-admin/catalog/service-templates/${enc(id)}/deploy-preview`, { allowOverwrite }),
  catalogDeploy: (id: string, body: { tenantIds?: string[]; allowOverwrite?: boolean; customizable?: boolean }) => api.post<CatalogDeployResult>(`/super-admin/catalog/service-templates/${enc(id)}/deploy`, body),
  catalogComparison: (id: string) => api.get<CatalogComparison>(`/super-admin/catalog/service-templates/${enc(id)}/comparison`),
  catalogSetCustomizable: (deploymentId: string, customizable: boolean) => api.patch<{ deploymentId: string; customizable: boolean }>(`/super-admin/catalog/deployments/${enc(deploymentId)}/customizable`, { customizable }),
  catalogExport: (q?: Record<string, unknown>) => api.exportAsync<{ filename: string; csv: string; rowCount: number; generatedAt: string }>('/super-admin/catalog/service-templates/export', q),
};

export type CatalogDeployPlanItem = { tenantId: string; tenantName: string; action: string; reason: string };
export type CatalogDeployPreview = { template: { id: string; name: string; status: string }; plan: CatalogDeployPlanItem[]; summary: { deploy: number; overwrite: number; skipped: number } };
export type CatalogDeployResult = { summary: { deploy: number; overwrite: number; skipped: number }; results: { tenantId: string; tenantName: string; action: string; reason: string; copiedServiceId: string | null }[] };
export type CatalogComparisonRow = { deploymentId: string; tenantId: string; tenantName: string; copiedServiceId: string | null; customizable: boolean; templateName: string; serviceName: string | null; templatePriceMinCents: number; servicePriceCents: number | null; templateDuration: number; serviceDuration: number | null; customized: boolean };
export type CatalogComparison = { template: { id: string; name: string }; rows: CatalogComparisonRow[] };

export type CatalogCategoryRow = { code: string; name: string; iconKey: string | null; displayOrder: number; status: string; templateCount: number };

export type CatalogTemplateDetail = {
  id: string; code: string; name: string; categoryCode: string | null; description: string | null;
  durationMinutes: number; priceMinCents: number; priceMaxCents: number; taxSetting: string;
  commissionEligible: boolean; isCustomizable: boolean; status: string; version: number; versionLabel: string;
  resources: { label: string; quantity: number }[]; addons: { name: string; priceCents: number }[]; deploymentCount: number;
};

export type CatalogTemplateRow = {
  id: string; code: string; name: string; categoryCode: string | null; categoryName: string | null;
  durationMinutes: number; priceMinCents: number; priceMaxCents: number;
  resources: { label: string; quantity: number }[]; taxSetting: string; commissionEligible: boolean;
  addonCount: number; activeTenantUsage: number; versionLabel: string; status: string;
};
export type CatalogListResult = { rows: CatalogTemplateRow[]; total: number; page: number; pageSize: number };

// ---- Chargebacks & Disputes ----
export type DisputeKpis = { totalOpenDisputes: number; amountAtRiskCents: number; responseDeadlinesThisWeek: number; evidenceSubmitted: number; wonDisputes: number; lostDisputes: number; fundsWithdrawnCents: number; fundsRecoveredCents: number };
export type DisputeFundsSummary = { fundsWithdrawnCents: number; fundsRecoveredCents: number; netLostCents: number; recoveryRatePct: number };
export type DisputeOverview = {
  kpis: DisputeKpis; fundsSummary: DisputeFundsSummary;
  reasonDistribution: { code: string; count: number }[];
  processorDecisionBreakdown: { won: number; underReview: number; lost: number; total: number };
  trend: { date: string; open: number; submitted: number; won: number; lost: number }[];
  recentActivity: { at: string; disputeRef: string; action: string; tenantName: string; status: string }[];
  highRiskMerchants: { tenantId: string; tenantName: string; openDisputes: number; amountAtRiskCents: number; riskLevel: string }[];
  approachingDeadlines: { disputeRef: string; dueBy: string | null; daysLeft: number; tenantName: string; amountCents: number }[];
  counts: { total: number };
};
export type DisputeListResult = { rows: DisputeListRow[]; total: number; page: number; pageSize: number };

export type ReviewWorkspace = { dispute: DisputeDetail; checklist: EvidenceChecklist; missingRequired: string[] };

export const disputesApi = {
  overview: () => api.get<DisputeOverview>('/super-admin/disputes/overview'),
  list: (q?: Record<string, unknown>) => api.get<DisputeListResult>('/super-admin/disputes', q),
  detail: (id: string) => api.get<DisputeDetail>(`/super-admin/disputes/${enc(id)}`),
  review: (id: string) => api.get<ReviewWorkspace>(`/super-admin/disputes/${enc(id)}/review`),
  evidence: (id: string) => api.get<{ checklist: EvidenceChecklist; evidence: EvidenceSummary[] }>(`/super-admin/disputes/${enc(id)}/evidence`),
  requestEvidence: (id: string, body: { note?: string }) => api.post<{ ok: boolean; evidenceStatus: string }>(`/super-admin/disputes/${enc(id)}/evidence/request`, body),
  uploadEvidence: (id: string, body: { evidenceType: string; fileName: string; mimeType: string; sizeBytes: number; contentBase64?: string; description?: string; source?: string }) => api.post<{ ok: boolean; evidence: EvidenceSummary }>(`/super-admin/disputes/${enc(id)}/evidence`, body),
  reviewEvidence: (id: string, evidenceId: string, body: { decision: string; reason?: string }) => api.post<{ ok: boolean; evidence: EvidenceSummary }>(`/super-admin/disputes/${enc(id)}/evidence/${enc(evidenceId)}/review`, body),
  submit: (id: string, body: { idempotencyKey: string }) => api.post<{ ok: boolean; idempotent: boolean; submission: { id: string; result: string; processorRef: string | null; createdAt: string }; manifestCount?: number }>(`/super-admin/disputes/${enc(id)}/submit`, body),
  notifyTenant: (id: string, body: { channel: string; recipient?: string; subject?: string; body?: string; idempotencyKey?: string }) => api.post<{ ok: boolean; idempotent: boolean; notification: { id: string; channel: string; deliveryStatus: string; createdAt: string } }>(`/super-admin/disputes/${enc(id)}/notify-tenant`, body),
  // Phase 12: one Idempotency-Key per submission — a double click or a retried request records the outcome (and adds the
  // recovered funds) once
  recordOutcome: (id: string, body: { result: string; fundsRecoveredCents?: number; amountWonCents?: number; amountLostCents?: number; processorFeeCents?: number; decisionReason?: string; overrideReason?: string }, idempotencyKey: string) => api.postOnce<{ ok: boolean; manualOverride: boolean; outcome: { id: string; result: string; newStatus: string; fundsRecoveredCents: number } }>(`/super-admin/disputes/${enc(id)}/outcome`, body, idempotencyKey),
  deadlines: (q?: Record<string, unknown>) => api.get<DeadlineWorkspace>('/super-admin/disputes/deadlines', q),
  patterns: () => api.get<DisputePatterns>('/super-admin/disputes/patterns'),
  highRiskMerchants: () => api.get<MerchantRisk[]>('/super-admin/disputes/high-risk-merchants'),
  flagMerchantRisk: (tenantId: string, body: { riskLevel: string; riskReason: string; recommendedAction?: string; nextReviewAt?: string }) => api.post<{ ok: boolean; merchant: MerchantRisk }>(`/super-admin/disputes/merchant-risk/${enc(tenantId)}/flag`, body),
  exportCsv: async (body: Record<string, unknown>): Promise<{ filename: string; csv: string }> => {
    const res = await fetch(apiUrl('/super-admin/disputes/exports'), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const csv = await res.text();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { filename: m?.[1] ?? 'chargebacks-disputes.csv', csv };
  },
};

export type DisputePatterns = {
  totals: { count: number; amountAtRiskCents: number; decided: number; won: number; lost: number; winRatePct: number; lossRatePct: number; recoveryRatePct: number; fundsWithdrawnCents: number; fundsRecoveredCents: number };
  byReason: { code: string; count: number; amountCents: number }[];
  byTenant: { tenant: string; count: number; open: number; amountAtRiskCents: number; won: number; lost: number }[];
  byProcessor: { processor: string; count: number }[];
  byCardPresence: { cardPresent: number; cardAbsent: number; other: number };
};
export type MerchantRisk = { tenantId: string; tenantName: string; openDisputes: number; totalDisputes: number; lostDisputes: number; amountAtRiskCents: number; riskLevel: string; lastReviewedAt: string | null; nextReviewAt: string | null; recommendedAction: string | null; riskReason: string | null; suggestedRiskLevel: string };

export type DeadlineWorkspaceRow = { disputeReference: string; tenantId: string; tenantName: string; branchName: string | null; amountCents: number; processorType: string | null; reasonCode: string | null; dueBy: string | null; status: string; evidenceStatus: string; riskLevel: string; tenantNotified: boolean; deadlineState: string; daysRemaining: number | null; hoursRemaining: number | null; reminderDue: boolean; missingEvidence: boolean };
export type DeadlineWorkspace = { rows: DeadlineWorkspaceRow[]; summary: Record<string, number>; remindersDue: number; generatedAt: string };
export type { AiProviderPublic };
