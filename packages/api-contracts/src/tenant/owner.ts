// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface OwnerDashboardState {
  owner: { userId: string; fullName: string; firstName: string; avatarUrl?: string; email?: string };
  context: { tenantId: string; selectedBranchId?: string; timezone: string; currency: string; permissions: string[] };
  date: string;
  todayRevenueCents: number; todayRevenueTrendPercent: number;
  weeklyRevenueCents: number; weeklyRevenueTrendPercent: number;
  totalBookings: number; totalBookingsTrendPercent: number;
  activeTechnicians: number; scheduledTechnicians: number;
  averageTicketCents: number; averageTicketTrendPercent: number;
  tipsTodayCents: number; tipsTrendPercent: number;
  newClients: number; newClientsTrendPercent: number;
  // live floor snapshot — current operational counts for salon-local "today", branch-scoped (mirrors Live Operations).
  servicesToday: number;
  checkInsToday: number;
  waitingNow: number;
  servingNow: number;
  readyToCheckout: number;
  revenueTrend: { date: string; revenueCents: number }[];
  unreadNotificationCount: number;
}

export interface OwnerAllowedBranch {
  branchId: string; tenantId: string; salonName: string; branchName: string;
  address?: string; city?: string; state?: string; timezone: string;
  accessLevel: 'owner' | 'manager' | 'viewer' | 'report_only'; isPrimaryOwner: boolean; hasSwitchPin: boolean;
}

export interface OwnerContextResponse {
  ownerUserId: string; tenantId: string; allowedBranches: OwnerAllowedBranch[];
  canViewAllAssignedBranches: boolean; defaultBranchId?: string;
}

export interface OwnerSalonOverview {
  branchId: string; salonName: string; city?: string; state?: string; status: string;
  todayRevenueCents: number; todayBookings: number; activeTechs: number; waitingGuests: number;
}

export interface OwnerBranchPerformanceState {
  period: { from: string; to: string; comparisonFrom?: string; comparisonTo?: string };
  totalRevenueCents: number; totalRevenueTrendPercent: number;
  topBranch?: { branchId: string; branchName: string; trendPercent: number };
  totalBranches: number; activeBranches: number;
  branches: { rank: number; branchId: string; branchName: string; revenueCents: number; trendPercent: number; bookingCount: number; averageTicketCents: number }[];
  quickComparison: {
    bestGrowth?: { branchId: string; branchName: string; valuePercent: number };
    highestAverageTicket?: { branchId: string; branchName: string; valueCents: number };
    topBookings?: { branchId: string; branchName: string; value: number };
  };
}

// ---- Module 2: Branch Performance ----
export type OwnerPeriod = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface OwnerBookingOverview {
  dateFrom: string; dateTo: string; totalBookings: number;
  /** The salon's business date the window starts on (its zone) — what a date chip shows (wave 4 pilot). */
  businessDateFrom?: string;
  completed: { count: number; percentage: number };
  cancelled: { count: number; percentage: number };
  noShow: { count: number; percentage: number };
  trend: { date: string; bookingCount: number }[];
  completionRate: number; completionRateTrendPercent: number;
  cancellationRate: number; cancellationRateTrendPercent: number;
  noShowRate: number; noShowRateTrendPercent: number;
  // booking mix by origin, bucketed Online / Phone / Walk-in / Other (only buckets with bookings appear), each with %.
  bookingSources: { label: string; count: number; percentage: number }[];
}

export interface OwnerAppointmentListItem {
  appointmentId: string; customerName: string; branchId: string | null; technicianId: string;
  apptDate: string; startTime: string; endTime: string; status: string; source: string;
}

// ---- Owner Ticket Oversight (read-only, tenant + owner-branch scoped) ----
export interface OwnerTicketRow {
  ticketId: string; ticketNumber: string | null; branchId: string | null; status: string;
  customerName: string | null; technicianName: string | null; totalCents: number; version: number;
  serviceDoneLocked: boolean; createdAt: string; paidAt: string | null; removedAt: string | null;
}

export interface OwnerTicketDetail extends OwnerTicketRow {
  subtotalCents: number; taxCents: number; discountCents: number; tipCents: number;
  servingStartedAt: string | null; serviceDoneAt: string | null;
}

export interface OwnerTicketLine { serviceName: string; priceCents: number; lineTotalCents: number; technicianName: string | null; status: string; isAddOn: boolean; }

export interface OwnerTicketRevision { version: number; action: string; actorRole: string | null; summary: string | null; createdAt: string; }

// ---- Module 4: Staff / Technician Performance ----
export interface OwnerTopTechnician { technicianId: string; fullName: string; avatarUrl?: string; roleLabel: string; servicesCompleted: number; salesCents: number; utilizationPercent: number; rating: number }

export interface OwnerStaffPerformanceState {
  period: { from: string; to: string };
  topTechnicians: OwnerTopTechnician[];
  totalStaff: number; onDutyCount: number;
  utilizationPercent: number; utilizationTrendPercent: number; totalCommissionCents: number;
}
/** 200-technician mandate §62 / §69 / §71: GET /owner/staff/performance/technicians — every technician's period
 *  aggregates (server SQL), searched, sorted and paged on the server (the summary above keeps its top-10 card). */
export type OwnerStaffPerformanceSort = 'sales' | 'services' | 'utilization' | 'rating' | 'commission' | 'name';
export interface OwnerStaffPerformanceRow extends OwnerTopTechnician {
  /** 1-based rank by sales this period across the WHOLE (branch-scoped) team — independent of search / sort / page */
  rank: number;
  commissionCents: number;
}
export interface OwnerStaffPerformancePage {
  period: { from: string; to: string };
  items: OwnerStaffPerformanceRow[];
  /** rows matching the search */
  total: number;
  /** every technician in scope */
  totalAll: number;
  page: number; pageSize: number; totalPages: number;
  sort: OwnerStaffPerformanceSort; dir: 'asc' | 'desc';
}

export interface OwnerStaffAttendance { scheduled: number; clockedIn: number; late: number; onBreak: number; absent: number; offShift: number; overtime: number }

export interface OwnerTechnicianDetail {
  technicianId: string; fullName: string; roleLabel: string; status: string;
  period: { from: string; to: string };
  servicesCompleted: number; salesCents: number; tipsCents: number; commissionCents: number;
  averageTicketCents: number; rating: number; reviewCount: number; bookingCount: number;
  busyMinutes: number; scheduledMinutes: number; utilizationPercent: number; payrollEstimateCents: number;
}

// ---- Module 5: Finance & Reports ----
export interface OwnerFinanceSummary {
  period: { from: string; to: string };
  totalRevenueCents: number; revenueTrendPercent: number;
  totalExpensesCents: number; totalCommissionCents: number;
  netProfitCents: number; profitTrendPercent: number;
  averageTicketCents: number; totalTransactions: number;
  taxCollectedCents: number; tipsCents: number; discountsCents: number;
  // top revenue-generating services in the period (by paid line totals), highest first.
  topServices: { name: string; revenueCents: number }[];
  /** Receipt/Expense mandate §94: sales (services + retail, before tax / tips / gift cards) in the same period, and approved
   *  expenses ÷ sales as a percent (null when there were no sales). `expenseRatioBasis` is the methodology shown with it. */
  salesCents?: number; expenseToSalesPct?: number | null; expenseRatioBasis?: string;
}

export interface OwnerPaymentMethod { method: string; amountCents: number; count: number; percentage: number }

export interface OwnerPaymentMix { period: { from: string; to: string }; methods: OwnerPaymentMethod[]; totalCents: number }

export interface OwnerReportInfo { id: string; title: string; description: string; formats: string[] }

export interface OwnerReportExport { reportId: string; filename: string; contentType: string; content: string }

// ---- Module 6: Alerts / More / Settings ----
export type OwnerAlertSeverity = 'info' | 'warning' | 'high' | 'critical';

export type OwnerAlertStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed';

export interface OwnerAlert {
  id: string; branchId: string | null; category: string; severity: OwnerAlertSeverity; status: OwnerAlertStatus;
  title: string; body: string | null; createdAt: string; resolvedAt: string | null;
  metadata?: Record<string, unknown> | null;
  reference?: string | null;
}

/** POST /owner/notifications/read — "Mark all read" (Oct 23 2026 merge of the developer tree): how many NEW alerts were acknowledged. */
export interface OwnerNotificationsReadResponse { ok: true; acknowledged: number }

export interface OwnerAlertSummary {
  total: number; unread: number;
  bySeverity: Record<OwnerAlertSeverity, number>;
  byStatus: Record<OwnerAlertStatus, number>;
}

export interface OwnerProfileCard {
  userId: string; fullName: string; email: string | null; phone: string | null; role: string; tenantId: string;
  businessName: string; timezone: string; currency: string; branchCount: number; avatarUrl?: string | null;
}

export interface OwnerSettingsSnapshot { businessName: string; timezone: string; currency: string; branchCount: number; activeBranchCount: number }

// ---- Cross-cutting: Owner audit log ----
export interface OwnerAuditEntry { id: string; userId: string | null; role: string | null; action: string; entityType: string | null; entityId: string | null; metadata: unknown; createdAt: string }

export interface OwnerExpense { id: string; branchId: string | null; category: string; amountCents: number; description: string | null; vendor: string | null; incurredOn: string; createdAt: string }

export interface OwnerExpenseInput { category: string; amountCents: number; description?: string | null; vendor?: string | null; incurredOn: string; branchId?: string | null }

export interface OwnerExpenseSummary { period: { from: string; to: string }; totalCents: number; count: number; byCategory: { category: string; amountCents: number; count: number }[] }

// cash-summary.ts — combine the two cash pools into one end-of-day position for the owner:
//   • register drawer (front-desk cash: float + sales − refunds + in − out), per branch
//   • technician hand-offs (Skip-the-Line cash collected by techs), per technician
// Pure aggregation over the existing per-pool summaries — read-only, no new storage.
export interface CashPoolSummary {
  expectedCents: number; countedCents: number; varianceCents: number;
  unitCount: number; reconciledCount: number; discrepancyCount: number; awaitingCount: number;
}

export interface DailyCashSummary {
  businessDate: string;
  register: CashPoolSummary;
  techCash: CashPoolSummary;
  total: { expectedCents: number; countedCents: number; varianceCents: number };
}

// ── Live Operations (owner monitoring of the live floor; reuses POS queue/serving/checkout data, branch-scoped) ──
export interface OwnerLiveTechRow { technicianId: string; technicianName: string; serviceLabel: string | null; customerName: string | null; elapsedMinutes: number; paused: boolean; }

export interface OwnerLiveQueueRow { queueItemId: string; customerName: string; isVip: boolean; serviceLabel: string | null; requestedTechnicianName: string | null; waitMinutes: number; status: string; }
/** Live Team row (Oct 12 2026 merge, workforce audit #28): clock / queue state from technician_workforce_state (579);
 *  today's sales (gross − discount) and tips (card + cash) from ticket_compensation_snapshots, salon-local day. */
/** 200-technician §2 (Oct 27 2026): GET /owner/live paging — the team is searched (name, accent-insensitive) / filtered by
 *  workforce queue status ('NONE' = no status yet) and paged; the in-service list is paged. Sizes default to 25, max 50. */
export interface OwnerLiveOpsQuery { teamPage?: number; teamPageSize?: number; teamSearch?: string; teamStatus?: string; techQueuePage?: number; techQueuePageSize?: number }
/** a page of an Owner Live Operations list (total = rows matching the search / status) */
export interface OwnerLivePage { page: number; pageSize: number; total: number; totalPages: number }
export interface OwnerLiveTeamRow { technicianId: string; technicianName: string; queueStatus: string | null; clockStatus: string | null; currentCustomerName: string | null; salesTodayCents: number; tipsTodayCents: number }

// ── Commission & Payroll (owner read surface over the canonical compensation/payroll engine; reads the engine's stored
// payroll_periods + payroll_lines — already-computed, never recalculated — scoped to the owner's allowed branches) ──
export type OwnerPayrollPeriodStatus = 'draft' | 'finalized' | 'paid';

export interface OwnerPayrollPeriodSummary {
  periodId: string; branchId: string | null; label: string | null; periodStart: string; periodEnd: string;
  status: OwnerPayrollPeriodStatus; finalizedAt: string | null; paidAt: string | null;
  totalPayableCents: number; totalCommissionCents: number; totalTipsCents: number;
}

export interface OwnerPayrollKpis {
  totalPeriods: number; openPeriods: number; unpaidPayableCents: number;
  latestPeriodPayableCents: number; lifetimeCommissionCents: number; lifetimeTipsCents: number;
}

export interface OwnerPayrollLine {
  technicianId: string; technicianName: string | null; servicesCount: number; grossSalesCents: number;
  commissionType: string; commissionValue: number; commissionCents: number; retailCommissionCents: number;
  cardTipCents: number; cashTipCents: number; tipsCents: number; guaranteeTopupCents: number;
  adjustmentCents: number; payableCents: number;
}

// ── Customers & Loyalty (owner read surface; aggregate analytics over canonical customers / customer_loyalty_profiles /
// reviews / gift_cards / tickets, scoped to the owner's branches. No payment-instrument data — spend is business
// analytics only). ──
export interface OwnerCustomerKpis {
  totalCustomers: number; newCustomers: number;
  retentionRatePercent: number; repeatRatePercent: number;
  vipCustomers: number; loyaltyMembers: number;
  giftCardOutstandingCents: number; giftCardCount: number;
  reviewAverage: number; reviewCount: number;
}

export interface OwnerLoyaltyTier { tier: string; customers: number }

export interface OwnerLoyaltyOverview {
  pointsIssued: number; pointsRedeemed: number; pointsOutstanding: number;
  rewardRedemptionCount: number; tiers: OwnerLoyaltyTier[];
}

export interface OwnerTopSpender { customerId: string; name: string; lifetimeSpendCents: number; visits: number }

// ── Inventory & Products (owner read surface; aggregate over canonical inventory_products / inventory_location_stock,
// scoped to the owner's branches. Stock value (cost/retail) is gated on owner.finance.view — null when not permitted,
// mirroring the inventory module's cost-privacy). ──
export interface OwnerInventoryStatusCounts { inStock: number; low: number; critical: number; outOfStock: number; overstock: number }

export interface OwnerInventoryReorderItem { productId: string; name: string; branchId: string | null; branchName: string; onHand: number; reorderLevel: number; status: string; suggestedQty: number }

export interface OwnerInventoryCategory { category: string; products: number; stockValueCents: number | null }

// ── Marketing & Growth (owner read surface; aggregate over canonical campaigns, reusing the campaigns module's
// deriveKpis/deriveMetrics. Branch-scoped views also include tenant-wide (null-branch) campaigns. Referrals are a count
// only — there is no referral-conversion schema, so conversions are intentionally not fabricated). ──
export interface OwnerMarketingKpis {
  activeCampaigns: number; totalCampaigns: number; totalSent: number;
  openRatePercent: number; clickRatePercent: number; conversionRatePercent: number;
  campaignRevenueCents: number; campaignCostCents: number; roi: number | null;   // null: not computable (no cost) — shown as —
  referrals: number;
}

export interface OwnerMarketingChannel { channel: string; campaigns: number; sent: number; revenueCents: number }

export interface OwnerMarketingCampaign {
  id: string; name: string; channel: string; status: string; audienceLabel: string | null;
  sent: number; openRate: number; clickRate: number; bookingRate: number;
  revenueCents: number; costCents: number; roi: number; scheduledAt: string | null;
}

// ── Payments & Money (owner read surface; payment-level oversight over canonical payments/payment_refunds, scoped to the
// owner's branches. No card/PAN data exists on these rows — only method, gateway reference, and amounts — so a
// transaction list carries no sensitive customer payment data). ──
export interface OwnerPaymentMethodSlice { method: string; amountCents: number; count: number }

export interface OwnerPaymentsSummary {
  grossCents: number; tipsCents: number; refundsCents: number; netCents: number;
  transactionCount: number; refundCount: number;
  byMethod: OwnerPaymentMethodSlice[];
}

export interface OwnerPaymentTxn { id: string; amountCents: number; tipCents: number; method: string; status: string; ticketRef: string | null; processorRef: string | null; at: string }

export interface OwnerPaymentRefund { id: string; amountCents: number; reason: string | null; status: string; paymentRef: string | null; at: string }

// ── Approval Center (owner; aggregates pending owner actions into one queue. Composed from existing reads — payroll
// periods awaiting approval/lock (gated by finance permission) + open operational alerts (gated by alerts permission) —
// so each item degrades gracefully by permission). ──
export interface OwnerApprovalItem {
  kind: 'payroll'; action: 'approve' | 'lock'; periodId: string;
  label: string; detail: string; status: string; amountCents: number; branchId: string | null;
}

/** GET /owner/portfolio — one branch of a salon in the owner's switcher (Constitution 13 §15: the wire shape, defined once). */
export interface OwnerPortfolioBranchView {
  branchId: string;
  name: string;
  city: string | null;
  state: string | null;
  isActive: boolean;
}
/** GET /owner/portfolio — one salon in the owner's switcher. salonId is the tenant id the client may ASK to switch to
 *  (the server re-verifies every switch). */
export interface OwnerPortfolioSalonView {
  salonId: string;
  salonName: string;
  storeCode: string;
  status: string;
  selectable: boolean;
  accessLevel: 'owner' | 'manager' | 'viewer' | 'report_only';
  isPrimaryOwner: boolean;
  branches: OwnerPortfolioBranchView[];
}
