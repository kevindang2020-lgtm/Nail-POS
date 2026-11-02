/* owner.repository.ts — Owner data port (the boundary the service depends on) + an in-memory stub. */
import type { DateRange, OwnerBranchListItem, OwnerAppointmentListItem, OwnerAppointmentDetail, OwnerAlert, OwnerAuditEntry, OwnerExpense, OwnerExpenseInput, OwnerTicketList, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketFilters, OwnerLiveOperations, OwnerLiveOpsQuery, OwnerPayrollList, OwnerPayrollPeriodDetail, OwnerCustomersOverview, OwnerGiftCardReport, OwnerInventoryOverview, OwnerMarketingOverview, OwnerPaymentsOverview } from './owner.dto';
export interface OwnerContext { tenantId: string; userId: string; role: string; permissions: string[]; selectedBranchId?: string }
export interface OwnerProfile { userId: string; fullName: string; firstName: string; email: string | null; phone: string | null; avatarUrl: string | null }
export interface OwnerDataPort {
  /** true when alert-status changes reach the owner's screens through the domain-event projection */
  emitsDomainEvents?(): boolean;
  ownerProfile(ctx: OwnerContext): Promise<OwnerProfile | null>;
  setAvatar(ctx: OwnerContext, key: string): Promise<void>;
  tenantTimezoneCurrency(ctx: OwnerContext): Promise<{ timezone: string; currency: string }>;
  validateBranch(ctx: OwnerContext, branchId: string): Promise<boolean>;
  // Owner Multi-Salon: branch ids explicitly assigned to this user (user_branch_access). null = no assignment rows
  // (caller falls back to whole-tenant). Also the raw rows for the /owner/context payload.
  allowedBranchIds(ctx: OwnerContext): Promise<string[] | null>;
  ownerAccessRows(ctx: OwnerContext): Promise<{ branchId: string; accessLevel: string; isPrimaryOwner: boolean }[]>;
  // Per-branch live snapshot for the salon-overview cards (subset-aware): currently-on technicians + lobby waiting guests.
  activeTechsByBranch(ctx: OwnerContext): Promise<{ branchId: string; active: number }[]>;
  waitingGuestsByBranch(ctx: OwnerContext): Promise<{ branchId: string; waiting: number }[]>;
  userHomeBranch(ctx: OwnerContext): Promise<string | null>;
  paidRevenueCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  /** wave 4 pilot: SALES on the tickets paid in the window — service + retail lines (not removed), before discounts; the POS
   *  reports' basis for the average ticket (revenue also carries tax, tips, surcharge and gift cards sold). */
  paidSalesCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  topServices(ctx: OwnerContext, branchId: string | null, r: DateRange, limit: number): Promise<{ name: string; revenueCents: number }[]>;
  paidTicketCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  tipsCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  bookingsCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  newCustomersCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  activeTechnicianCount(ctx: OwnerContext, branchId: string | null): Promise<{ active: number; scheduled: number }>;
  listBranches(ctx: OwnerContext): Promise<OwnerBranchListItem[]>;
  revenueByBranch(ctx: OwnerContext, r: DateRange): Promise<{ branchId: string; revenueCents: number; ticketCount: number; salesCents?: number }[]>;
  bookingsByBranch(ctx: OwnerContext, r: DateRange): Promise<{ branchId: string; bookingCount: number }[]>;
  bookingStatusCounts(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ total: number; completed: number; cancelled: number; noShow: number }>;
  bookingSourceCounts(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ source: string; count: number }[]>;
  bookingsByDate(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ date: string; count: number }[]>;
  listAppointments(ctx: OwnerContext, branchId: string | null, r: DateRange, opts: { status?: string; source?: string; limit?: number }): Promise<OwnerAppointmentListItem[]>;
  getAppointmentDetail(ctx: OwnerContext, appointmentId: string): Promise<OwnerAppointmentDetail | null>;
  listTechnicians(ctx: OwnerContext, branchId: string | null): Promise<{ technicianId: string; fullName: string; status: string; isActive: boolean }[]>;
  validateTechnician(ctx: OwnerContext, technicianId: string): Promise<boolean>;
  staffSales(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; servicesCompleted: number; salesCents: number; commissionCents: number; busyMinutes: number }[]>;
  ratingsByTechnician(ctx: OwnerContext, branchId: string | null): Promise<{ technicianId: string; rating: number; reviewCount: number }[]>;
  tipsByTechnician(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; tipsCents: number }[]>;
  scheduledMinutesByTechnician(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; minutes: number }[]>;
  attendanceSnapshot(ctx: OwnerContext, branchId: string | null): Promise<{ clockedIn: number; onBreak: number; offShift: number; scheduledToday: number }>;
  technicianBookingCount(ctx: OwnerContext, technicianId: string, r: DateRange): Promise<number>;
  taxAndDiscountCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ taxCents: number; discountCents: number }>;
  paymentMix(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ method: string; amountCents: number; count: number }[]>;
  revenueByDate(ctx: OwnerContext, branchId: string | null, r: DateRange, timeZone?: string): Promise<{ date: string; revenueCents: number; transactions: number }[]>;
  tenantName(ctx: OwnerContext): Promise<string>;
  listAlerts(ctx: OwnerContext, branchId: string | null, opts: { status?: string; severity?: string; limit?: number }): Promise<OwnerAlert[]>;
  alertCounts(ctx: OwnerContext, branchId: string | null): Promise<{ total: number; unread: number; bySeverity: Record<string, number>; byStatus: Record<string, number> }>;
  getAlert(ctx: OwnerContext, alertId: string): Promise<OwnerAlert | null>;
  updateAlertStatus(ctx: OwnerContext, alertId: string, status: string, userId: string, markResolved: boolean): Promise<OwnerAlert | null>;
  writeAudit(ctx: OwnerContext, e: { action: string; entityType?: string | null; entityId?: string | null; branchId?: string | null; metadata?: unknown }): Promise<void>;
  // Owner Access Code (optional login second factor). The authenticated owner manages their OWN code only — every
  // one of these is scoped by ctx.userId (the session user, server-derived), never a client-supplied id. Hashes
  // only; the plaintext code is never stored or returned.
  ownerPasswordHash(ctx: OwnerContext): Promise<string | null>;
  ownerAccessCodeConfigured(ctx: OwnerContext): Promise<boolean>;
  setOwnerAccessCodeHash(ctx: OwnerContext, hash: string | null): Promise<void>;
  // Switch-PIN hash for a branch (tenant-scoped). null = branch not found in tenant OR no PIN configured. Used to gate
  // a manager/receptionist switching into a salon in the POS. The plaintext PIN is never stored or returned.
  branchSwitchPinHash(ctx: OwnerContext, branchId: string): Promise<string | null>;
  listAudit(ctx: OwnerContext, limit?: number): Promise<OwnerAuditEntry[]>;
  createExpense(ctx: OwnerContext, e: OwnerExpenseInput): Promise<OwnerExpense>;
  listExpenses(ctx: OwnerContext, branchId: string | null, r: DateRange, limit?: number): Promise<OwnerExpense[]>;
  getExpense(ctx: OwnerContext, id: string): Promise<OwnerExpense | null>;
  updateExpense(ctx: OwnerContext, id: string, patch: Partial<OwnerExpenseInput>): Promise<OwnerExpense | null>;
  deleteExpense(ctx: OwnerContext, id: string): Promise<boolean>;
  expensesTotalCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number>;
  expensesByCategory(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ category: string; amountCents: number; count: number }[]>;
  ownerTicketsList(ctx: OwnerContext, f: Required<Pick<OwnerTicketFilters, 'page' | 'pageSize'>> & OwnerTicketFilters): Promise<OwnerTicketList>;
  ownerLiveOperations(ctx: OwnerContext, branchId: string | null, tz: string, q?: OwnerLiveOpsQuery): Promise<OwnerLiveOperations>;
  // Lightweight live-floor counts for the Home dashboard (no queue arrays). Salon-local "today", branch-scoped.
  ownerFloorCounts(ctx: OwnerContext, branchId: string | null, tz: string): Promise<{ waiting: number; serving: number; servicesToday: number; readyToCheckout: number; checkInsToday: number }>;
  ownerPayrollList(ctx: OwnerContext): Promise<OwnerPayrollList>;
  ownerPayrollPeriod(ctx: OwnerContext, periodId: string): Promise<OwnerPayrollPeriodDetail | null>;
  ownerUserPinHash(ctx: OwnerContext): Promise<string | null>;
  ownerCustomersOverview(ctx: OwnerContext, branchId: string | null, from: DateRange, prev: DateRange): Promise<OwnerCustomersOverview>;
  ownerGiftCardReport(ctx: OwnerContext, branchId: string | null, from: DateRange): Promise<OwnerGiftCardReport>;
  ownerInventoryOverview(ctx: OwnerContext, branchIds: string[] | null): Promise<OwnerInventoryOverview>;
  ownerMarketingOverview(ctx: OwnerContext, branchIds: string[] | null): Promise<OwnerMarketingOverview>;
  ownerPaymentsOverview(ctx: OwnerContext, branchId: string | null, from: DateRange): Promise<OwnerPaymentsOverview>;
  ownerTicket(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketDetail | null>;
  ownerTicketLines(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketLine[]>;
  ownerTicketRevisions(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketRevision[]>;
}
export class InMemoryOwnerRepository implements OwnerDataPort {
  async ownerProfile(): Promise<OwnerProfile | null> { return null; }
  async tenantTimezoneCurrency(): Promise<{ timezone: string; currency: string }> { return { timezone: 'America/New_York', currency: 'USD' }; }
  async validateBranch(): Promise<boolean> { return false; }
  async allowedBranchIds(): Promise<string[] | null> { return null; }
  async ownerAccessRows(): Promise<{ branchId: string; accessLevel: string; isPrimaryOwner: boolean }[]> { return []; }
  async activeTechsByBranch(): Promise<{ branchId: string; active: number }[]> { return []; }
  async waitingGuestsByBranch(): Promise<{ branchId: string; waiting: number }[]> { return []; }
  async userHomeBranch(): Promise<string | null> { return null; }
  async paidRevenueCents(): Promise<number> { return 0; }
  async paidSalesCents(): Promise<number> { return 0; }
  async topServices(): Promise<{ name: string; revenueCents: number }[]> { return []; }
  async paidTicketCount(): Promise<number> { return 0; }
  async tipsCents(): Promise<number> { return 0; }
  async bookingsCount(): Promise<number> { return 0; }
  async newCustomersCount(): Promise<number> { return 0; }
  async activeTechnicianCount(): Promise<{ active: number; scheduled: number }> { return { active: 0, scheduled: 0 }; }
  async listBranches(): Promise<OwnerBranchListItem[]> { return []; }
  async revenueByBranch(): Promise<{ branchId: string; revenueCents: number; ticketCount: number }[]> { return []; }
  async bookingsByBranch(): Promise<{ branchId: string; bookingCount: number }[]> { return []; }
  async bookingStatusCounts(): Promise<{ total: number; completed: number; cancelled: number; noShow: number }> { return { total: 0, completed: 0, cancelled: 0, noShow: 0 }; }
  async bookingSourceCounts(): Promise<{ source: string; count: number }[]> { return []; }
  async bookingsByDate(): Promise<{ date: string; count: number }[]> { return []; }
  async listAppointments(): Promise<OwnerAppointmentListItem[]> { return []; }
  async getAppointmentDetail(): Promise<OwnerAppointmentDetail | null> { return null; }
  async listTechnicians(): Promise<{ technicianId: string; fullName: string; status: string; isActive: boolean }[]> { return []; }
  async validateTechnician(): Promise<boolean> { return false; }
  async staffSales(): Promise<{ technicianId: string; servicesCompleted: number; salesCents: number; commissionCents: number; busyMinutes: number }[]> { return []; }
  async ratingsByTechnician(): Promise<{ technicianId: string; rating: number; reviewCount: number }[]> { return []; }
  async tipsByTechnician(): Promise<{ technicianId: string; tipsCents: number }[]> { return []; }
  async scheduledMinutesByTechnician(): Promise<{ technicianId: string; minutes: number }[]> { return []; }
  async attendanceSnapshot(): Promise<{ clockedIn: number; onBreak: number; offShift: number; scheduledToday: number }> { return { clockedIn: 0, onBreak: 0, offShift: 0, scheduledToday: 0 }; }
  async technicianBookingCount(): Promise<number> { return 0; }
  async taxAndDiscountCents(): Promise<{ taxCents: number; discountCents: number }> { return { taxCents: 0, discountCents: 0 }; }
  async paymentMix(): Promise<{ method: string; amountCents: number; count: number }[]> { return []; }
  async revenueByDate(): Promise<{ date: string; revenueCents: number; transactions: number }[]> { return []; }
  async tenantName(): Promise<string> { return 'My Business'; }
  async listAlerts(): Promise<OwnerAlert[]> { return []; }
  async alertCounts(): Promise<{ total: number; unread: number; bySeverity: Record<string, number>; byStatus: Record<string, number> }> { return { total: 0, unread: 0, bySeverity: {}, byStatus: {} }; }
  async getAlert(): Promise<OwnerAlert | null> { return null; }
  async updateAlertStatus(): Promise<OwnerAlert | null> { return null; }
  async writeAudit(): Promise<void> { /* no-op */ }
  async branchSwitchPinHash(): Promise<string | null> { return null; }
  async listAudit(): Promise<OwnerAuditEntry[]> { return []; }
  async ownerPasswordHash(): Promise<string | null> { return null; }
  async ownerAccessCodeConfigured(): Promise<boolean> { return false; }
  async setOwnerAccessCodeHash(): Promise<void> { /* no-op */ }
  async createExpense(_ctx: OwnerContext, e: OwnerExpenseInput): Promise<OwnerExpense> { return { id: 'mem', branchId: e.branchId ?? null, category: e.category, amountCents: e.amountCents, description: e.description ?? null, vendor: e.vendor ?? null, incurredOn: e.incurredOn, createdAt: new Date().toISOString() }; }
  async listExpenses(): Promise<OwnerExpense[]> { return []; }
  async getExpense(): Promise<OwnerExpense | null> { return null; }
  async updateExpense(): Promise<OwnerExpense | null> { return null; }
  async deleteExpense(): Promise<boolean> { return false; }
  async expensesTotalCents(): Promise<number> { return 0; }
  async expensesByCategory(): Promise<{ category: string; amountCents: number; count: number }[]> { return []; }
  async ownerTicketsList(_ctx: OwnerContext, f: Required<Pick<OwnerTicketFilters, 'page' | 'pageSize'>> & OwnerTicketFilters): Promise<OwnerTicketList> { return { tickets: [], total: 0, page: f.page, pageSize: f.pageSize }; }
  async ownerLiveOperations(_ctx: OwnerContext, branchId: string | null): Promise<OwnerLiveOperations> { return { branchId, counts: { waiting: 0, serving: 0, completedToday: 0 }, techQueue: [], liveQueue: [], team: [], todaySoFar: { servicesDone: 0, walkIns: 0 }, signals: { readyForCheckout: 0, delayedAppointments: 0 }, generatedAt: new Date().toISOString() }; }
  async ownerFloorCounts(): Promise<{ waiting: number; serving: number; servicesToday: number; readyToCheckout: number; checkInsToday: number }> { return { waiting: 0, serving: 0, servicesToday: 0, readyToCheckout: 0, checkInsToday: 0 }; }
  async ownerPayrollList(_ctx: OwnerContext): Promise<OwnerPayrollList> { return { periods: [], kpis: { totalPeriods: 0, openPeriods: 0, unpaidPayableCents: 0, latestPeriodPayableCents: 0, lifetimeCommissionCents: 0, lifetimeTipsCents: 0 } }; }
  async ownerPayrollPeriod(_ctx: OwnerContext, _periodId: string): Promise<OwnerPayrollPeriodDetail | null> { return null; }
  async ownerUserPinHash(_ctx: OwnerContext): Promise<string | null> { return null; }
  async setAvatar(_ctx: OwnerContext, _key: string): Promise<void> {}
  async ownerCustomersOverview(_ctx: OwnerContext, _branchId: string | null, from: DateRange): Promise<OwnerCustomersOverview> {
    return { range: { from: from.fromIso, to: from.toIso }, kpis: { totalCustomers: 0, newCustomers: 0, retentionRatePercent: 0, repeatRatePercent: 0, vipCustomers: 0, loyaltyMembers: 0, giftCardOutstandingCents: 0, giftCardCount: 0, reviewAverage: 0, reviewCount: 0 }, loyalty: { pointsIssued: 0, pointsRedeemed: 0, pointsOutstanding: 0, rewardRedemptionCount: 0, tiers: [] }, topSpenders: [], generatedAt: new Date().toISOString() };
  }
  async ownerGiftCardReport(_ctx: OwnerContext, _branchId: string | null, from: DateRange): Promise<OwnerGiftCardReport> {
    return { range: { from: from.fromIso, to: from.toIso }, outstandingCents: 0, activeCount: 0, totalCards: 0, issuedCents: 0, issuedCount: 0, redeemedCents: 0, redeemedCount: 0, generatedAt: new Date().toISOString() };
  }
  async ownerInventoryOverview(_ctx: OwnerContext, _branchIds: string[] | null): Promise<OwnerInventoryOverview> {
    return { totalProducts: 0, stockPositions: 0, statusCounts: { inStock: 0, low: 0, critical: 0, outOfStock: 0, overstock: 0 }, needsReorderCount: 0, stockValueCents: 0, retailValueCents: 0, brandsCount: 0, vendorsCount: 0, categoriesCount: 0, topCategories: [], reorderList: [], generatedAt: new Date().toISOString() };
  }
  async ownerMarketingOverview(_ctx: OwnerContext, _branchIds: string[] | null): Promise<OwnerMarketingOverview> {
    return { kpis: { activeCampaigns: 0, totalCampaigns: 0, totalSent: 0, openRatePercent: 0, clickRatePercent: 0, conversionRatePercent: 0, campaignRevenueCents: 0, campaignCostCents: 0, roi: 0, referrals: 0 }, channels: [], topCampaigns: [], generatedAt: new Date().toISOString() };
  }
  async ownerPaymentsOverview(_ctx: OwnerContext, _branchId: string | null, from: DateRange): Promise<OwnerPaymentsOverview> {
    return { range: { from: from.fromIso, to: from.toIso }, summary: { grossCents: 0, tipsCents: 0, refundsCents: 0, netCents: 0, transactionCount: 0, refundCount: 0, byMethod: [] }, transactions: [], refunds: [], generatedAt: new Date().toISOString() };
  }
  async ownerTicket(): Promise<OwnerTicketDetail | null> { return null; }
  async ownerTicketLines(): Promise<OwnerTicketLine[]> { return []; }
  async ownerTicketRevisions(): Promise<OwnerTicketRevision[]> { return []; }
}
