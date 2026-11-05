/* owner.service.ts — Owner App orchestration + authorization. Enforces owner.* permissions and tenant/branch scope
 * (a provided branchId must belong to the session's tenant), then composes the dashboard from the data port. */
import { type AiCenterService, type AiCenterCtx, type AiCenterOverview } from '@aipowersalon/ai';
import { type PayrollService, type PayrollContext } from '@aipowersalon/workforce';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import type { OwnerContext, OwnerDataPort } from './owner.repository';
import { OwnerError } from './owner-errors';
import { pageStaffRows } from './owner-staff-paging';
import type { OwnerStaffPerformancePage, OwnerStaffPerformanceRow } from '@aipowersalon/api-contracts/tenant';
import { verifyPassword, hashPassword } from '@aipowersalon/auth';
import { ranges, pct, pctOf, periodRange, toCsv, type OwnerPeriod, type OwnerBookingPeriod, type OwnerDashboardState, type OwnerBranchPerformanceState, type OwnerBranchListItem, type OwnerBranchDetail, type OwnerBookingOverview, type OwnerAppointmentListItem, type OwnerAppointmentDetail, type OwnerStaffPerformanceState, type OwnerStaffAttendance, type OwnerTechnicianDetail, type OwnerTechnicianEarnings, type OwnerFinanceSummary, type OwnerPaymentMix, type OwnerReportInfo, type OwnerReportExport, type OwnerAlert, type OwnerAlertSummary, type OwnerProfileCard, type OwnerSettingsSnapshot, type OwnerAuditEntry, type OwnerExpense, type OwnerExpenseInput, type OwnerExpenseSummary, type OwnerContextResponse, type OwnerSalonOverview, type OwnerTicketList, type OwnerTicketHistory, type OwnerTicketFilters, type OwnerLiveOperations, type OwnerLiveOpsQuery, type OwnerPayrollList, type OwnerPayrollPeriodDetail, type OwnerCustomersOverview, type OwnerGiftCardReport, type OwnerInventoryOverview, type OwnerMarketingOverview, type OwnerPaymentsOverview, type OwnerApprovals, type OwnerApprovalItem, type OwnerAttention } from './owner.dto';
import { clampPage, withCode } from '@aipowersalon/api-contracts';
import { buildMediaUrl } from '@aipowersalon/media';
import { hasPermission, hasTenantWideScope, isPlatformPrincipal } from '@aipowersalon/permissions';
export { OwnerError } from './owner-errors';

/**
 * The finance module's ExpenseService, as the Owner App's older expense routes use it (structural — analytics does not
 * import the finance module; apps/api binds it in finance-wiring.ts). Oct 21 2026, Receipt / Expense / OCR / Accounting
 * mandate §9: ONE expense authority. The five /owner/expenses* routes and these OwnerService methods are kept (Kevin:
 * nothing is removed) and now delegate to it — no second expense writer remains in this module.
 */
export interface OwnerExpensesPort {
  list(ctx: OwnerFinanceCtx, f: Record<string, unknown>): Promise<{ items: Array<{ id: string; branchId: string | null; category: string; amountCents: number; description: string | null; vendor: string | null; incurredOn: string; createdAt: string; status: string; version: number }>; total: number }>;
  report(ctx: OwnerFinanceCtx, q: { period?: 'today' | 'week' | 'month' | 'year' | 'custom'; from?: string; to?: string; branchId?: string | null }): Promise<{ window: { from: string; to: string }; totalCents: number; count: number; byCategory: Array<{ key: string; totalCents: number; count: number }> }>;
  create(ctx: OwnerFinanceCtx, i: Record<string, unknown>): Promise<{ expense: { id: string; branchId: string | null; category: string; amountCents: number; description: string | null; vendor: string | null; incurredOn: string; createdAt: string } }>;
  detail(ctx: OwnerFinanceCtx, id: string): Promise<{ expense: { id: string; status: string; version: number } }>;
  update(ctx: OwnerFinanceCtx, id: string, patch: Record<string, unknown>): Promise<{ expense: { id: string; branchId: string | null; category: string; amountCents: number; description: string | null; vendor: string | null; incurredOn: string; createdAt: string } }>;
  deleteDraft(ctx: OwnerFinanceCtx, id: string): Promise<{ id: string; deleted: boolean }>;
  void(ctx: OwnerFinanceCtx, id: string, reason: string): Promise<unknown>;
}
export interface OwnerFinanceCtx { tenantId: string; userId: string; role: string; permissions: string[]; selectedBranchId?: string | null }

export class OwnerService {
  /** bound by apps/api (finance-wiring.ts); the older /owner/expenses* routes delegate to it */
  expenses: OwnerExpensesPort | null = null;

  constructor(private readonly repo: OwnerDataPort, private readonly rt?: RealtimeEmitter, private readonly payroll?: PayrollService, private readonly aiCenter?: AiCenterService) {}

  // Tenant timezone+currency, memoized on the request context so repeated date-window computations hit the DB once.
  private async tzc(ctx: OwnerContext): Promise<{ timezone: string; currency: string }> {
    const c = ctx as OwnerContext & { __tzc?: { timezone: string; currency: string } };
    if (c.__tzc) return c.__tzc;
    c.__tzc = await this.repo.tenantTimezoneCurrency(ctx);
    return c.__tzc;
  }

  private require(ctx: OwnerContext, key: string): void {
    if (!ctx.permissions || !ctx.permissions.includes(key)) throw withCode(new OwnerError('forbidden', `You don't have permission for this action (${key}).`), 'PERMISSION_DENIED');
  }

  // ── Owner Access Code (optional login second factor) ──────────────────────────────────────────────────────
  //
  // Provisioning for the code the Owner login screen asks for. It is NOT a second password: it is validated at
  // login only when configured (see auth-login.service 'owner' branch). Here the owner sets, rotates, or REMOVES
  // her own code. Rules that make this safe:
  //   • Only an OWNER can hold one, and only for HER OWN account (scoped to ctx.userId, the session user).
  //   • Changing it requires re-entering the CURRENT PASSWORD — a hijacked, already-open session cannot silently
  //     add a factor or lock the real owner out.
  //   • The code is hashed with the same hasher as passwords; the plaintext is never stored, logged, or returned.
  //   • An empty newCode REMOVES the code (back to password-only) — the deliberate opt-out.
  async getSecurityStatus(ctx: OwnerContext): Promise<{ accessCodeConfigured: boolean }> {
    // BUILD_PLAN Phase 9: the Owner Access Code is an owner-settings change — owner.settings.edit (owner-level only by
    // default), not the role's name.
    if (!hasPermission(ctx as any, 'owner.settings.edit')) throw withCode(new OwnerError('forbidden', 'Only an owner can manage the Owner Access Code.'), 'OWNER_ONLY_ACTION');
    return { accessCodeConfigured: await this.repo.ownerAccessCodeConfigured(ctx) };
  }

  async setOwnerAccessCode(ctx: OwnerContext, input: { currentPassword?: string; newCode?: string }): Promise<{ ok: true; configured: boolean }> {
    if (!hasPermission(ctx as any, 'owner.settings.edit')) throw withCode(new OwnerError('forbidden', 'Only an owner can set an Owner Access Code.'), 'OWNER_ONLY_ACTION');
    const pwHash = await this.repo.ownerPasswordHash(ctx);
    const passwordOk = pwHash ? await verifyPassword(input.currentPassword ?? '', pwHash) : false;
    if (!passwordOk) throw withCode(new OwnerError('invalid', 'Your current password is incorrect.'), 'CURRENT_PASSWORD_INCORRECT');

    const code = (input.newCode ?? '').trim();
    let newHash: string | null = null;
    if (code) {
      if (code.length < 4 || code.length > 64) throw withCode(new OwnerError('invalid', 'Owner Access Code must be 4–64 characters.'), 'OWNER_ACCESS_CODE_INVALID');
      newHash = await hashPassword(code);
    }
    await this.repo.setOwnerAccessCodeHash(ctx, newHash);
    try {
      await this.repo.writeAudit(ctx, { action: newHash ? 'owner_access_code_set' : 'owner_access_code_cleared', entityType: 'user', entityId: ctx.userId, branchId: null });
    } catch { /* audit is best-effort; never fail the security change on a logging error */ }
    return { ok: true, configured: !!newHash };
  }

  // Resolve the branch scope: null = all of the owner's tenant; a provided id must belong to the tenant.
  // Branch authorization scope. OWNER/SUPER_ADMIN see every branch in the tenant; any other role (e.g. MANAGER) is
  // restricted to its assigned branch (users.branch_id). Returns null = unrestricted, or the single allowed branch id.
  // Memoized on the per-request ctx so it costs at most one lookup.
  private async branchConstraint(ctx: OwnerContext): Promise<string | null> {
    // BUILD_PLAN Phase 9: the tenant-wide view is a permission (owner.branches.compare), not the OWNER role's name.
    if (hasTenantWideScope(ctx as any) || isPlatformPrincipal(ctx)) return null;
    const cache = ctx as unknown as { __homeBranch?: string | null };
    if (cache.__homeBranch !== undefined) return cache.__homeBranch;
    cache.__homeBranch = await this.repo.userHomeBranch(ctx);
    return cache.__homeBranch;
  }

  // Owner Multi-Salon: the set of branch ids this user may see. MANAGER → exactly their assigned branch; OWNER with
  // user_branch_access rows → that subset; OWNER with no rows (or SUPER_ADMIN) → null (whole tenant, legacy). Memoized
  // AND stashed on ctx so the repository's bScope/bSql can apply `branch_id IN (...)` to the combined ("all") path.
  private async allowedSet(ctx: OwnerContext): Promise<string[] | null> {
    const cache = ctx as unknown as { __allowedBranchIds?: string[] | null };
    if (cache.__allowedBranchIds !== undefined) return cache.__allowedBranchIds;
    const single = await this.branchConstraint(ctx);
    let result: string[] | null;
    if (single !== null) result = [single];
    else if (isPlatformPrincipal(ctx)) result = null;
    else {
      const assigned = await this.repo.allowedBranchIds(ctx);
      result = assigned && assigned.length ? assigned : null;
    }
    cache.__allowedBranchIds = result;
    return result;
  }

  /** Public branch-scope resolver reused by other modules (e.g. ai_business compare_branches): the concrete list of
   *  branches this user is authorized to see. Delegates to the SAME allowedSet() the owner dashboards use — no
   *  duplicate branch authorization. null-scope (whole-tenant owner) expands to every branch; a restricted user
   *  (e.g. MANAGER) gets exactly their assigned branch. Callers must never widen beyond this set. */
  async listAuthorizedBranches(ctx: OwnerContext): Promise<{ branchId: string; branchName: string; status: string }[]> {
    const allowed = await this.allowedSet(ctx);
    const all = await this.repo.listBranches(ctx);
    const rows = allowed === null ? all : all.filter((b) => allowed.includes(b.branchId));
    return rows.map((b) => ({ branchId: b.branchId, branchName: b.branchName, status: b.status }));
  }

  // Record the spec's owner_unauthorized_branch_access_blocked audit event, then deny. Centralized so every
  // branch-scope rejection (saved selection or explicit ?branchId) leaves an honest trail without masking the 403.
  private async denyUnassigned(ctx: OwnerContext, branchId: string): Promise<never> {
    try { await this.repo.writeAudit(ctx, { action: 'owner_unauthorized_branch_access_blocked', entityType: 'branch', entityId: branchId, branchId: null, metadata: { requestedBranchId: branchId } }); } catch { /* never let audit failure mask the security denial */ }
    throw withCode(new OwnerError('forbidden', 'You do not have access to that salon.'), 'TENANT_ACCESS_DENIED');
  }

  private async resolveBranch(ctx: OwnerContext): Promise<string | null> {
    await this.allowedSet(ctx);
    const restricted = await this.branchConstraint(ctx);
    if (restricted !== null) {
      if (ctx.selectedBranchId && ctx.selectedBranchId !== restricted) throw withCode(new OwnerError('forbidden', 'You can only view your assigned branch.'), 'BRANCH_ASSIGNED_ONLY');
      return restricted;
    }
    if (!ctx.selectedBranchId) return null;
    const ok = await this.repo.validateBranch(ctx, ctx.selectedBranchId);
    if (!ok) throw withCode(new OwnerError('not_found', 'That branch was not found for your business.'), 'BRANCH_NOT_FOUND');
    const allowed = await this.allowedSet(ctx);
    if (allowed && !allowed.includes(ctx.selectedBranchId)) return this.denyUnassigned(ctx, ctx.selectedBranchId);
    return ctx.selectedBranchId;
  }

  // Validate an explicit branch filter (query param). Restricted roles are forced to their assigned branch and forbidden
  // from requesting another; null = all authorized branches (OWNER).
  private async ensureBranch(ctx: OwnerContext, branchId?: string): Promise<string | null> {
    await this.allowedSet(ctx);
    const restricted = await this.branchConstraint(ctx);
    if (restricted !== null) {
      if (branchId && branchId !== restricted) throw withCode(new OwnerError('forbidden', 'You can only view your assigned branch.'), 'BRANCH_ASSIGNED_ONLY');
      return restricted;
    }
    if (!branchId) return null;
    if (!(await this.repo.validateBranch(ctx, branchId))) throw withCode(new OwnerError('not_found', 'That branch was not found for your business.'), 'BRANCH_NOT_FOUND');
    const allowed = await this.allowedSet(ctx);
    if (allowed && !allowed.includes(branchId)) return this.denyUnassigned(ctx, branchId);
    return branchId;
  }

  async setAvatar(ctx: OwnerContext, key: string): Promise<void> {
    await this.repo.setAvatar(ctx, key);
  }

  async getDashboard(ctx: OwnerContext): Promise<OwnerDashboardState> {
    this.require(ctx, 'owner.dashboard.view');
    const branchId = await this.resolveBranch(ctx);
    const now = new Date();
    const R = ranges(now, (await this.tzc(ctx)).timezone);
    const [profile, tz] = await Promise.all([this.repo.ownerProfile(ctx), this.tzc(ctx)]);
    const [todayRev, yRev, wkRev, pwkRev, wkTickets, pwkTickets, tipsToday, tipsY, bookWk, bookPwk, newWk, newPwk, techs, alertCounts, wkSales, pwkSales] = await Promise.all([
      this.repo.paidRevenueCents(ctx, branchId, R.today),
      this.repo.paidRevenueCents(ctx, branchId, R.yesterday),
      this.repo.paidRevenueCents(ctx, branchId, R.week),
      this.repo.paidRevenueCents(ctx, branchId, R.priorWeek),
      this.repo.paidTicketCount(ctx, branchId, R.week),
      this.repo.paidTicketCount(ctx, branchId, R.priorWeek),
      this.repo.tipsCents(ctx, branchId, R.today),
      this.repo.tipsCents(ctx, branchId, R.yesterday),
      this.repo.bookingsCount(ctx, branchId, R.week),
      this.repo.bookingsCount(ctx, branchId, R.priorWeek),
      this.repo.newCustomersCount(ctx, branchId, R.week),
      this.repo.newCustomersCount(ctx, branchId, R.priorWeek),
      this.repo.activeTechnicianCount(ctx, branchId),
      this.repo.alertCounts(ctx, branchId),
      this.repo.paidSalesCents(ctx, branchId, R.week),
      this.repo.paidSalesCents(ctx, branchId, R.priorWeek),
    ]);
    const [revenueTrend, floor] = await Promise.all([
      Promise.all(R.weekDays.map(async (d) => ({ date: d.date, revenueCents: await this.repo.paidRevenueCents(ctx, branchId, { fromIso: d.fromIso, toIso: d.toIso }) }))),
      this.repo.ownerFloorCounts(ctx, branchId, tz.timezone),
    ]);
    // Average ticket = SALES ÷ paid tickets — the POS reports' definition (wave 4 pilot: it divided everything collected,
    // tax, tips and gift cards sold included, so the owner's figure never matched the POS).
    const avg = wkTickets > 0 ? Math.round(wkSales / wkTickets) : 0;
    const pavg = pwkTickets > 0 ? Math.round(pwkSales / pwkTickets) : 0;
    return {
      owner: { userId: ctx.userId, fullName: profile?.fullName ?? 'Owner', firstName: profile?.firstName ?? 'Owner', avatarUrl: buildMediaUrl(profile?.avatarUrl ?? null) ?? undefined, email: profile?.email ?? undefined },
      context: { tenantId: ctx.tenantId, selectedBranchId: branchId ?? undefined, timezone: tz.timezone, currency: tz.currency, permissions: ctx.permissions },
      date: R.today.fromDate ?? R.today.fromIso.slice(0, 10),   // the salon's business date (its zone) — not the UTC date of its start-of-day instant (wave 4 pilot)
      todayRevenueCents: todayRev, todayRevenueTrendPercent: pct(todayRev, yRev),
      weeklyRevenueCents: wkRev, weeklyRevenueTrendPercent: pct(wkRev, pwkRev),
      totalBookings: bookWk, totalBookingsTrendPercent: pct(bookWk, bookPwk),
      activeTechnicians: techs.active, scheduledTechnicians: techs.scheduled,
      averageTicketCents: avg, averageTicketTrendPercent: pct(avg, pavg),
      tipsTodayCents: tipsToday, tipsTrendPercent: pct(tipsToday, tipsY),
      newClients: newWk, newClientsTrendPercent: pct(newWk, newPwk),
      servicesToday: floor.servicesToday,
      checkInsToday: floor.checkInsToday,
      waitingNow: floor.waiting,
      servingNow: floor.serving,
      readyToCheckout: floor.readyToCheckout,
      revenueTrend,
      unreadNotificationCount: alertCounts.unread, // wired to owner_alerts (status 'new') now that Module 6's table exists
    };
  }

  // ---- Module 2: Branch Performance ----
  async getBranchList(ctx: OwnerContext): Promise<OwnerBranchListItem[]> {
    this.require(ctx, 'owner.branches.view');
    await this.allowedSet(ctx);
    const restricted = await this.branchConstraint(ctx);
    const all = await this.repo.listBranches(ctx); // already restricted to the owner's assigned subset (if any)
    return restricted !== null ? all.filter((b) => b.branchId === restricted) : all;
  }

  // GET /owner/context — the allowed salons + access metadata the Owner App loads on sign-in.
  async getContext(ctx: OwnerContext): Promise<OwnerContextResponse> {
    this.require(ctx, 'owner.dashboard.view');
    await this.allowedSet(ctx);
    const [branches, accessRows, tz, homeBranch] = await Promise.all([
      this.repo.listBranches(ctx), this.repo.ownerAccessRows(ctx), this.tzc(ctx), this.repo.userHomeBranch(ctx),
    ]);
    const byBranch = new Map(accessRows.map((a) => [a.branchId, a] as const));
    const allowedBranches = branches.map((b) => {
      const a = byBranch.get(b.branchId);
      return {
        branchId: b.branchId, tenantId: ctx.tenantId, salonName: b.branchName, branchName: b.branchName,
        address: b.address ?? undefined, city: b.city ?? undefined, state: b.state ?? undefined, timezone: tz.timezone,
        accessLevel: (a?.accessLevel as 'owner' | 'manager' | 'viewer' | 'report_only') ?? (hasTenantWideScope(ctx as any) ? 'owner' : 'manager'),
        isPrimaryOwner: a?.isPrimaryOwner ?? false, hasSwitchPin: b.hasSwitchPin ?? false,
      };
    });
    const primary = allowedBranches.find((b) => b.isPrimaryOwner) ?? (homeBranch ? allowedBranches.find((b) => b.branchId === homeBranch) : undefined);
    await this.repo.writeAudit(ctx, { action: 'owner_context_loaded', metadata: { branchCount: allowedBranches.length } });
    return {
      ownerUserId: ctx.userId, tenantId: ctx.tenantId, allowedBranches,
      canViewAllAssignedBranches: allowedBranches.length > 1, defaultBranchId: primary?.branchId,
    };
  }

  // POST /owner/context/select — record which salon (or the combined "All My Salons" view) the owner switched to.
  // A specific branch is permission-checked first (ensureBranch → 403 + blocked-audit if it isn't theirs), so the
  // event can never imply access the owner doesn't have.
  async recordSelection(ctx: OwnerContext, mode: 'single' | 'all', branchId?: string, pin?: string): Promise<{ ok: true; mode: 'single' | 'all'; branchId: string | null }> {
    this.require(ctx, 'owner.dashboard.view');
    if (mode === 'single') {
      const resolved = await this.ensureBranch(ctx, branchId);
      const targetId = resolved ?? branchId ?? null;
      // Multi-salon switch PIN: if this salon has a PIN configured, the user must supply the matching 6-digit PIN to
      // switch into it. Salons with no PIN never prompt (single-salon owners, or PIN not yet set) — fully back-compat.
      if (targetId) {
        const pinHash = await this.repo.branchSwitchPinHash(ctx, targetId);
        if (pinHash) {
          const ok = typeof pin === 'string' && pin.length > 0 && await verifyPassword(pin, pinHash);
          if (!ok) {
            try { await this.repo.writeAudit(ctx, { action: 'owner_branch_switch_pin_rejected', entityType: 'branch', entityId: targetId, branchId: null, metadata: { mode } }); } catch { /* never mask the denial */ }
            throw withCode(new OwnerError('forbidden', 'Enter the salon\u2019s 6-digit PIN to switch into it.'), 'SALON_PIN_REQUIRED');
          }
        }
      }
      await this.repo.writeAudit(ctx, { action: 'owner_branch_selected', entityType: 'branch', entityId: targetId, branchId: resolved ?? null, metadata: { mode } });
      return { ok: true, mode, branchId: resolved ?? null };
    }
    await this.allowedSet(ctx);
    await this.repo.writeAudit(ctx, { action: 'owner_all_salons_selected', metadata: { mode } });
    return { ok: true, mode, branchId: null };
  }

  // POST /owner/activity — fired by the app on genuine navigation (a tab open / salon switch), NOT on background data
  // refreshes, so the realtime stream can re-fetch the dashboard without flooding the audit log with view events. A
  // specific salon is permission-checked (ensureBranch → 403 + blocked-audit if it isn't theirs).
  async recordActivity(ctx: OwnerContext, screen: 'dashboard' | 'reports', branchId?: string): Promise<{ ok: true }> {
    this.require(ctx, 'owner.dashboard.view');
    const action = screen === 'reports' ? 'owner_reports_viewed' : 'owner_dashboard_viewed';
    const resolved = branchId ? await this.ensureBranch(ctx, branchId) : null;
    await this.repo.writeAudit(ctx, { action, branchId: resolved ?? null, metadata: { screen, scope: resolved ? 'single' : 'all' } });
    return { ok: true };
  }

  // GET /owner/salons/overview — a today-at-a-glance snapshot per assigned salon (revenue + bookings + status), for the
  // "All My Salons" picker cards. Restricted to the owner's assigned subset; reuses the grouped, subset-aware queries.
  async getSalonsOverview(ctx: OwnerContext): Promise<OwnerSalonOverview[]> {
    this.require(ctx, 'owner.dashboard.view');
    await this.allowedSet(ctx);
    const tz = (await this.tzc(ctx)).timezone;
    const R = ranges(new Date(), tz);
    const [branches, rev, books, techs, waiting] = await Promise.all([
      this.repo.listBranches(ctx),
      this.repo.revenueByBranch(ctx, R.today),
      this.repo.bookingsByBranch(ctx, R.today),
      this.repo.activeTechsByBranch(ctx),
      this.repo.waitingGuestsByBranch(ctx),
    ]);
    const revMap = new Map(rev.map((x) => [x.branchId, x.revenueCents] as const));
    const bookMap = new Map(books.map((x) => [x.branchId, x.bookingCount] as const));
    const techMap = new Map(techs.map((x) => [x.branchId, x.active] as const));
    const waitMap = new Map(waiting.map((x) => [x.branchId, x.waiting] as const));
    return branches.map((b) => ({
      branchId: b.branchId, salonName: b.branchName, city: b.city ?? undefined, state: b.state ?? undefined,
      status: b.status, todayRevenueCents: revMap.get(b.branchId) ?? 0, todayBookings: bookMap.get(b.branchId) ?? 0,
      activeTechs: techMap.get(b.branchId) ?? 0, waitingGuests: waitMap.get(b.branchId) ?? 0,
    }));
  }

  async getBranchPerformance(ctx: OwnerContext, period: OwnerPeriod = 'month'): Promise<OwnerBranchPerformanceState> {
    this.require(ctx, 'owner.branches.view');
    await this.allowedSet(ctx); // prime the assigned-subset filter for listBranches/revenueByBranch/bookingsByBranch
    const now = new Date();
    const { from, prev } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const restricted = await this.branchConstraint(ctx);
    const [branchesAll, revCur, revPrev, bookCur] = await Promise.all([
      this.repo.listBranches(ctx),
      this.repo.revenueByBranch(ctx, from),
      this.repo.revenueByBranch(ctx, prev),
      this.repo.bookingsByBranch(ctx, from),
    ]);
    const branches = restricted !== null ? branchesAll.filter((b) => b.branchId === restricted) : branchesAll;
    const revC = new Map(revCur.map((x) => [x.branchId, x] as const));
    const revP = new Map(revPrev.map((x) => [x.branchId, x.revenueCents] as const));
    const book = new Map(bookCur.map((x) => [x.branchId, x.bookingCount] as const));
    const rows = branches.map((b) => {
      const rc = revC.get(b.branchId);
      const rev = rc?.revenueCents ?? 0;
      const tc = rc?.ticketCount ?? 0;
      const prevRev = revP.get(b.branchId) ?? 0;
      return { branchId: b.branchId, branchName: b.branchName, revenueCents: rev, trendPercent: pct(rev, prevRev), bookingCount: book.get(b.branchId) ?? 0, averageTicketCents: tc > 0 ? Math.round((rc?.salesCents ?? 0) / tc) : 0 };   // sales ÷ paid tickets (POS definition)
    });
    rows.sort((a, b) => b.revenueCents - a.revenueCents);
    const ranked = rows.map((r, i) => ({ rank: i + 1, ...r }));
    const totalRevenueCents = rows.reduce((s, r) => s + r.revenueCents, 0);
    const totalPrev = (restricted !== null ? revPrev.filter((x) => x.branchId === restricted) : revPrev).reduce((s, x) => s + x.revenueCents, 0);
    const top = ranked[0];
    const bestGrowth = [...rows].sort((a, b) => b.trendPercent - a.trendPercent)[0];
    const highestAvg = [...rows].sort((a, b) => b.averageTicketCents - a.averageTicketCents)[0];
    const topBookings = [...rows].sort((a, b) => b.bookingCount - a.bookingCount)[0];
    return {
      period: { from: from.fromIso, to: from.toIso, comparisonFrom: prev.fromIso, comparisonTo: prev.toIso },
      totalRevenueCents, totalRevenueTrendPercent: pct(totalRevenueCents, totalPrev),
      topBranch: top ? { branchId: top.branchId, branchName: top.branchName, trendPercent: top.trendPercent } : undefined,
      totalBranches: branches.length, activeBranches: branches.filter((b) => b.status === 'active').length,
      branches: ranked,
      quickComparison: {
        bestGrowth: bestGrowth ? { branchId: bestGrowth.branchId, branchName: bestGrowth.branchName, valuePercent: bestGrowth.trendPercent } : undefined,
        highestAverageTicket: highestAvg ? { branchId: highestAvg.branchId, branchName: highestAvg.branchName, valueCents: highestAvg.averageTicketCents } : undefined,
        topBookings: topBookings ? { branchId: topBookings.branchId, branchName: topBookings.branchName, value: topBookings.bookingCount } : undefined,
      },
    };
  }

  async getBranchDetail(ctx: OwnerContext, branchId: string, period: OwnerPeriod = 'month'): Promise<OwnerBranchDetail> {
    this.require(ctx, 'owner.branches.view');
    await this.ensureBranch(ctx, branchId); // manager restriction + owner assigned-subset membership (403 if unassigned)
    const branches = await this.repo.listBranches(ctx);
    const b = branches.find((x) => x.branchId === branchId)!;
    const now = new Date();
    const { from, prev } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const [rev, prevRev, tickets, bookings, tips, newClients, techs, , sales] = await Promise.all([
      this.repo.paidRevenueCents(ctx, branchId, from),
      this.repo.paidRevenueCents(ctx, branchId, prev),
      this.repo.paidTicketCount(ctx, branchId, from),
      this.repo.bookingsCount(ctx, branchId, from),
      this.repo.tipsCents(ctx, branchId, from),
      this.repo.newCustomersCount(ctx, branchId, from),
      this.repo.activeTechnicianCount(ctx, branchId),
      this.repo.alertCounts(ctx, branchId),
      this.repo.paidSalesCents(ctx, branchId, from),
    ]);
    return {
      branchId, branchName: b.branchName, status: b.status,
      period: { from: from.fromIso, to: from.toIso },
      revenueCents: rev, revenueTrendPercent: pct(rev, prevRev), bookingCount: bookings,
      averageTicketCents: tickets > 0 ? Math.round(sales / tickets) : 0 /* sales ÷ paid tickets (POS definition) */, tipsCents: tips, newClients, activeTechnicians: techs.active, scheduledTechnicians: techs.scheduled,
    };
  }

  // Comparison tab reuses the ranked branch payload (branch-vs-branch). Period-over-period overlay is a documented refinement.
  async getComparison(ctx: OwnerContext, period: OwnerPeriod = 'month'): Promise<OwnerBranchPerformanceState> {
    return this.getBranchPerformance(ctx, period);
  }

  // ---- Module 3: Booking Overview ----
  async getBookingOverview(ctx: OwnerContext, period: OwnerBookingPeriod = 'week', branchId?: string): Promise<OwnerBookingOverview> {
    this.require(ctx, 'owner.bookings.view');
    const b = await this.ensureBranch(ctx, branchId);
    const now = new Date();
    const R = ranges(now, (await this.tzc(ctx)).timezone);
    const cur = period === 'today' ? R.today : R.week;
    const prevWin = period === 'today' ? R.yesterday : R.priorWeek;
    const [c, prev, byDate, srcCounts] = await Promise.all([
      this.repo.bookingStatusCounts(ctx, b, cur),
      this.repo.bookingStatusCounts(ctx, b, prevWin),
      this.repo.bookingsByDate(ctx, b, R.week), // trend is always this week's 7 days
      this.repo.bookingSourceCounts(ctx, b, cur),
    ]);
    const m = new Map(byDate.map((x) => [x.date, x.count] as const));
    const trend = R.weekDays.map((d) => ({ date: d.date, bookingCount: m.get(d.date) ?? 0 }));
    const compRate = pctOf(c.completed, c.total), cancRate = pctOf(c.cancelled, c.total), nsRate = pctOf(c.noShow, c.total);
    const pComp = pctOf(prev.completed, prev.total), pCanc = pctOf(prev.cancelled, prev.total), pNs = pctOf(prev.noShow, prev.total);
    const SOURCE_BUCKET: Record<string, string> = { online: 'Online', customer_app: 'Online', google: 'Online', web: 'Online', phone: 'Phone', walk_in: 'Walk-in' };
    const srcBuckets = new Map<string, number>();
    for (const { source, count } of srcCounts) { const label = SOURCE_BUCKET[source] ?? 'Other'; srcBuckets.set(label, (srcBuckets.get(label) ?? 0) + count); }
    const srcTotal = [...srcBuckets.values()].reduce((s, v) => s + v, 0);
    const bookingSources = ['Online', 'Phone', 'Walk-in', 'Other'].filter((l) => srcBuckets.has(l)).map((label) => ({ label, count: srcBuckets.get(label)!, percentage: srcTotal > 0 ? Math.round((srcBuckets.get(label)! / srcTotal) * 100) : 0 }));
    return {
      dateFrom: cur.fromIso, dateTo: cur.toIso, businessDateFrom: cur.fromDate ?? cur.fromIso.slice(0, 10), totalBookings: c.total,
      completed: { count: c.completed, percentage: compRate },
      cancelled: { count: c.cancelled, percentage: cancRate },
      noShow: { count: c.noShow, percentage: nsRate },
      trend,
      completionRate: compRate, completionRateTrendPercent: pct(compRate, pComp),
      cancellationRate: cancRate, cancellationRateTrendPercent: pct(cancRate, pCanc),
      noShowRate: nsRate, noShowRateTrendPercent: pct(nsRate, pNs),
      bookingSources,
    };
  }

  async getBookingTrend(ctx: OwnerContext, branchId?: string): Promise<{ trend: { date: string; bookingCount: number }[] }> {
    this.require(ctx, 'owner.bookings.view');
    const b = await this.ensureBranch(ctx, branchId);
    const R = ranges(new Date(), (await this.tzc(ctx)).timezone);
    const byDate = await this.repo.bookingsByDate(ctx, b, R.week);
    const m = new Map(byDate.map((x) => [x.date, x.count] as const));
    return { trend: R.weekDays.map((d) => ({ date: d.date, bookingCount: m.get(d.date) ?? 0 })) };
  }

  async getBookingDrillDown(ctx: OwnerContext, opts: { period?: OwnerBookingPeriod; branchId?: string; status?: string; source?: string; limit?: number }): Promise<OwnerAppointmentListItem[]> {
    this.require(ctx, 'owner.bookings.view');
    const b = await this.ensureBranch(ctx, opts.branchId);
    const R = ranges(new Date(), (await this.tzc(ctx)).timezone);
    const win = opts.period === 'today' ? R.today : R.week;
    return this.repo.listAppointments(ctx, b, win, { status: opts.status, source: opts.source, limit: opts.limit });
  }

  async getAppointment(ctx: OwnerContext, appointmentId: string): Promise<OwnerAppointmentDetail> {
    this.require(ctx, 'owner.bookings.details');
    await this.allowedSet(ctx); // getAppointmentDetail scopes by branch → a foreign-branch appointment reads as not_found
    const d = await this.repo.getAppointmentDetail(ctx, appointmentId);
    if (!d) throw withCode(new OwnerError('not_found', 'Appointment not found.'), 'APPOINTMENT_NOT_FOUND');
    return d;
  }

  // ---- Module 4: Staff / Technician Performance ----
  async getStaffPerformance(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerStaffPerformanceState> {
    this.require(ctx, 'owner.staff.performance.view');
    const b = await this.ensureBranch(ctx, branchId);
    const a = await this.staffAggregates(ctx, b, period);
    return {
      period: a.period,
      topTechnicians: a.rows.slice(0, 10).map(({ rank: _r, commissionCents: _c, ...t }) => t),   // the summary card: top 10 by sales
      totalStaff: a.rows.length, onDutyCount: a.onDuty,
      utilizationPercent: a.util, utilizationTrendPercent: pct(a.util, a.utilPrev), totalCommissionCents: a.totalCommissionCents,
    };
  }

  /** 200-technician mandate §62 / §69 / §71 (Oct 26 2026): every technician's period figures — the same SQL aggregates
   *  as the summary — searched, sorted and paged on the server (the screen showed the top 10 and nobody else). */
  async getStaffPerformanceTechnicians(ctx: OwnerContext, q: { period?: OwnerPeriod; branchId?: string; search?: string; sort?: string; dir?: string; page?: number; pageSize?: number } = {}): Promise<OwnerStaffPerformancePage> {
    this.require(ctx, 'owner.staff.performance.view');
    const b = await this.ensureBranch(ctx, q.branchId);
    const a = await this.staffAggregates(ctx, b, q.period ?? 'month');
    return pageStaffRows(a.rows, a.period, q);
  }

  private async staffAggregates(ctx: OwnerContext, b: string | null, period: OwnerPeriod): Promise<{ period: { from: string; to: string }; rows: OwnerStaffPerformanceRow[]; onDuty: number; util: number; utilPrev: number; totalCommissionCents: number }> {
    const now = new Date();
    const { from, prev } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const [roster, sales, salesPrev, ratings, schedCur, schedPrev, onDuty] = await Promise.all([
      this.repo.listTechnicians(ctx, b),
      this.repo.staffSales(ctx, b, from),
      this.repo.staffSales(ctx, b, prev),
      this.repo.ratingsByTechnician(ctx, b),
      this.repo.scheduledMinutesByTechnician(ctx, b, from),
      this.repo.scheduledMinutesByTechnician(ctx, b, prev),
      this.repo.activeTechnicianCount(ctx, b),
    ]);
    const salesMap = new Map(sales.map((x) => [x.technicianId, x] as const));
    const ratingMap = new Map(ratings.map((x) => [x.technicianId, x] as const));
    const schedMap = new Map(schedCur.map((x) => [x.technicianId, x.minutes] as const));
    const rows: OwnerStaffPerformanceRow[] = roster.map((t) => {
      const sv = salesMap.get(t.technicianId);
      const rt = ratingMap.get(t.technicianId);
      const sched = schedMap.get(t.technicianId) ?? 0;
      const utilizationPercent = sched > 0 ? Math.round(((sv?.busyMinutes ?? 0) / sched) * 100) : 0;
      return { technicianId: t.technicianId, fullName: t.fullName, roleLabel: 'Technician', servicesCompleted: sv?.servicesCompleted ?? 0, salesCents: sv?.salesCents ?? 0, utilizationPercent, rating: rt?.rating ?? 0, commissionCents: sv?.commissionCents ?? 0, rank: 0 };
    }).sort((a, b) => b.salesCents - a.salesCents || a.fullName.localeCompare(b.fullName) || a.technicianId.localeCompare(b.technicianId));
    rows.forEach((r, i) => { r.rank = i + 1; });
    const totalBusy = sales.reduce((s, x) => s + x.busyMinutes, 0);
    const totalSched = schedCur.reduce((s, x) => s + x.minutes, 0);
    const util = totalSched > 0 ? Math.round((totalBusy / totalSched) * 100) : 0;
    const busyPrev = salesPrev.reduce((s, x) => s + x.busyMinutes, 0);
    const schedPrevTotal = schedPrev.reduce((s, x) => s + x.minutes, 0);
    const utilPrev = schedPrevTotal > 0 ? Math.round((busyPrev / schedPrevTotal) * 100) : 0;
    return { period: { from: from.fromIso, to: from.toIso }, rows, onDuty: onDuty.active, util, utilPrev, totalCommissionCents: sales.reduce((s, x) => s + x.commissionCents, 0) };
  }

  async getStaffAttendance(ctx: OwnerContext, branchId?: string): Promise<OwnerStaffAttendance> {
    this.require(ctx, 'owner.staff.view');
    const b = await this.ensureBranch(ctx, branchId);
    const a = await this.repo.attendanceSnapshot(ctx, b);
    return { scheduled: a.scheduledToday, clockedIn: a.clockedIn, late: 0, onBreak: a.onBreak, absent: Math.max(0, a.scheduledToday - a.clockedIn - a.onBreak), offShift: a.offShift, overtime: 0 };
  }

  async getTechnicianDetail(ctx: OwnerContext, technicianId: string, period: OwnerPeriod = 'month'): Promise<OwnerTechnicianDetail> {
    this.require(ctx, 'owner.staff.performance.view');
    await this.allowedSet(ctx); // validateTechnician scopes by branch → a foreign-branch technician reads as not_found
    if (!(await this.repo.validateTechnician(ctx, technicianId))) throw withCode(new OwnerError('not_found', 'Technician not found.'), 'TECHNICIAN_NOT_FOUND');
    const roster = await this.repo.listTechnicians(ctx, null);
    const t = roster.find((x) => x.technicianId === technicianId)!;
    const now = new Date();
    const { from } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const [sales, ratings, tips, sched, bookings] = await Promise.all([
      this.repo.staffSales(ctx, null, from),
      this.repo.ratingsByTechnician(ctx, null),
      this.repo.tipsByTechnician(ctx, null, from),
      this.repo.scheduledMinutesByTechnician(ctx, null, from),
      this.repo.technicianBookingCount(ctx, technicianId, from),
    ]);
    const sv = sales.find((x) => x.technicianId === technicianId);
    const rt = ratings.find((x) => x.technicianId === technicianId);
    const tp = tips.find((x) => x.technicianId === technicianId);
    const sc = sched.find((x) => x.technicianId === technicianId);
    const salesCents = sv?.salesCents ?? 0, services = sv?.servicesCompleted ?? 0, busy = sv?.busyMinutes ?? 0, schedMin = sc?.minutes ?? 0;
    const commissionCents = sv?.commissionCents ?? 0, tipsCents = tp?.tipsCents ?? 0;
    return {
      technicianId, fullName: t.fullName, roleLabel: 'Technician', status: t.status,
      period: { from: from.fromIso, to: from.toIso },
      servicesCompleted: services, salesCents, tipsCents, commissionCents,
      averageTicketCents: services > 0 ? Math.round(salesCents / services) : 0,
      rating: rt?.rating ?? 0, reviewCount: rt?.reviewCount ?? 0, bookingCount: bookings,
      busyMinutes: busy, scheduledMinutes: schedMin, utilizationPercent: schedMin > 0 ? Math.round((busy / schedMin) * 100) : 0,
      payrollEstimateCents: commissionCents + tipsCents,
    };
  }

  async getTechnicianEarnings(ctx: OwnerContext, technicianId: string, period: OwnerPeriod = 'month'): Promise<OwnerTechnicianEarnings> {
    this.require(ctx, 'owner.staff.earnings.view');
    await this.allowedSet(ctx); // validateTechnician scopes by branch → a foreign-branch technician reads as not_found
    if (!(await this.repo.validateTechnician(ctx, technicianId))) throw withCode(new OwnerError('not_found', 'Technician not found.'), 'TECHNICIAN_NOT_FOUND');
    const now = new Date();
    const { from } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const [sales, tips] = await Promise.all([this.repo.staffSales(ctx, null, from), this.repo.tipsByTechnician(ctx, null, from)]);
    const sv = sales.find((x) => x.technicianId === technicianId);
    const tp = tips.find((x) => x.technicianId === technicianId);
    const salesCents = sv?.salesCents ?? 0, commissionCents = sv?.commissionCents ?? 0, tipsCents = tp?.tipsCents ?? 0;
    return { technicianId, period: { from: from.fromIso, to: from.toIso }, salesCents, commissionCents, tipsCents, totalEstimateCents: commissionCents + tipsCents };
  }

  // ---- Module 5: Finance & Reports ----
  // Net profit = revenue − staff commission − APPROVED expenses (the finance module's ledger: rent, supplies, utilities …).
  // Still an estimate — processor fees and taxes are not deducted here, and payroll is counted only if an owner recorded it
  // as an expense (the payroll module's own totals are never added a second time — mandate §90).
  async getFinanceSummary(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerFinanceSummary> {
    this.require(ctx, 'owner.finance.view');
    const b = await this.ensureBranch(ctx, branchId);
    const now = new Date();
    const { from, prev } = periodRange(now, period, (await this.tzc(ctx)).timezone);
    const [rev, prevRev, txns, tips, taxDisc, salesCur, salesPrev, expensesCur, expensesPrev, topSvcs, paidSales] = await Promise.all([
      this.repo.paidRevenueCents(ctx, b, from), this.repo.paidRevenueCents(ctx, b, prev),
      this.repo.paidTicketCount(ctx, b, from), this.repo.tipsCents(ctx, b, from),
      this.repo.taxAndDiscountCents(ctx, b, from), this.repo.staffSales(ctx, b, from), this.repo.staffSales(ctx, b, prev),
      this.repo.expensesTotalCents(ctx, b, from), this.repo.expensesTotalCents(ctx, b, prev),
      this.repo.topServices(ctx, b, from, 5),
      this.repo.paidSalesCents(ctx, b, from),
    ]);
    const commission = salesCur.reduce((s, x) => s + x.commissionCents, 0);
    const prevCommission = salesPrev.reduce((s, x) => s + x.commissionCents, 0);
    const netProfit = rev - commission - expensesCur;
    const prevProfit = prevRev - prevCommission - expensesPrev;
    return {
      period: { from: from.fromIso, to: from.toIso },
      totalRevenueCents: rev, revenueTrendPercent: pct(rev, prevRev),
      totalExpensesCents: expensesCur, totalCommissionCents: commission,
      netProfitCents: netProfit, profitTrendPercent: pct(netProfit, prevProfit),
      averageTicketCents: txns > 0 ? Math.round(paidSales / txns) : 0, totalTransactions: txns,   // sales ÷ paid tickets — the POS reports' definition (wave 4 pilot)
      taxCollectedCents: taxDisc.taxCents, tipsCents: tips, discountsCents: taxDisc.discountCents,
      topServices: topSvcs,
      // §94: the expense-to-sales ratio, with its method stated next to it (one decimal; null without sales)
      salesCents: paidSales, expenseToSalesPct: paidSales > 0 ? Math.round((expensesCur / paidSales) * 1000) / 10 : null,
      expenseRatioBasis: 'Approved expenses ÷ sales (services + retail, before tax, tips and gift cards) for the same period and location. Commission and payroll are not in the expenses. Not a tax figure.',
    };
  }

  async getPaymentMix(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerPaymentMix> {
    this.require(ctx, 'owner.finance.view');
    const b = await this.ensureBranch(ctx, branchId);
    const { from } = periodRange(new Date(), period, (await this.tzc(ctx)).timezone);
    const rows = await this.repo.paymentMix(ctx, b, from);
    const total = rows.reduce((s, x) => s + x.amountCents, 0);
    const methods = rows.map((x) => ({ method: x.method, amountCents: x.amountCents, count: x.count, percentage: pctOf(x.amountCents, total) })).sort((a, b) => b.amountCents - a.amountCents);
    return { period: { from: from.fromIso, to: from.toIso }, methods, totalCents: total };
  }

  private static REPORTS: OwnerReportInfo[] = [
    { id: 'sales', title: 'Sales Report', description: 'Daily revenue and transaction counts for the period.', formats: ['csv'] },
    { id: 'payment-mix', title: 'Payment Mix', description: 'Revenue by payment method.', formats: ['csv'] },
    { id: 'staff', title: 'Staff Performance', description: 'Per-technician services, sales, commission, and tips.', formats: ['csv'] },
    { id: 'bookings', title: 'Booking Summary', description: 'Appointment counts by status.', formats: ['csv'] },
  ];

  async getReports(ctx: OwnerContext): Promise<OwnerReportInfo[]> {
    this.require(ctx, 'owner.reports.view');
    return OwnerService.REPORTS;
  }

  async exportReport(ctx: OwnerContext, reportId: string, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerReportExport> {
    this.require(ctx, 'owner.reports.export');
    const b = await this.ensureBranch(ctx, branchId);
    const { from } = periodRange(new Date(), period, (await this.tzc(ctx)).timezone);
    const dollars = (c: number) => (c / 100).toFixed(2);
    let headers: string[], rows: (string | number)[][], name: string;
    if (reportId === 'sales') {
      const d = await this.repo.revenueByDate(ctx, b, from, (await this.tzc(ctx)).timezone);
      headers = ['Date', 'Revenue (USD)', 'Transactions']; rows = d.map((x) => [x.date, dollars(x.revenueCents), x.transactions]); name = 'sales';
    } else if (reportId === 'payment-mix') {
      const m = await this.repo.paymentMix(ctx, b, from);
      headers = ['Method', 'Amount (USD)', 'Count']; rows = m.map((x) => [x.method, dollars(x.amountCents), x.count]); name = 'payment-mix';
    } else if (reportId === 'staff') {
      const [roster, sales, tips] = await Promise.all([this.repo.listTechnicians(ctx, b), this.repo.staffSales(ctx, b, from), this.repo.tipsByTechnician(ctx, b, from)]);
      const sm = new Map(sales.map((x) => [x.technicianId, x] as const));
      const tm = new Map(tips.map((x) => [x.technicianId, x.tipsCents] as const));
      headers = ['Technician', 'Services', 'Sales (USD)', 'Commission (USD)', 'Tips (USD)'];
      rows = roster.map((t) => { const sv = sm.get(t.technicianId); return [t.fullName, sv?.servicesCompleted ?? 0, dollars(sv?.salesCents ?? 0), dollars(sv?.commissionCents ?? 0), dollars(tm.get(t.technicianId) ?? 0)]; });
      name = 'staff';
    } else if (reportId === 'bookings') {
      const c = await this.repo.bookingStatusCounts(ctx, b, from);
      headers = ['Status', 'Count']; rows = [['completed', c.completed], ['cancelled', c.cancelled], ['no_show', c.noShow], ['total', c.total]]; name = 'bookings';
    } else {
      throw withCode(new OwnerError('not_found', 'Unknown report.'), 'REPORT_NOT_FOUND');
    }
    await this.repo.writeAudit(ctx, { action: 'owner_export_created', entityType: 'report', entityId: reportId, metadata: { period } });
    return { reportId, filename: `${name}-${from.fromIso.slice(0, 10)}.csv`, contentType: 'text/csv', content: toCsv(headers, rows) };
  }

  // ---- Module 6: Alerts / More / Settings ----
  async getAlerts(ctx: OwnerContext, opts: { status?: string; severity?: string; branchId?: string; limit?: number }): Promise<OwnerAlert[]> {
    this.require(ctx, 'owner.alerts.view');
    const b = await this.ensureBranch(ctx, opts.branchId);
    return this.repo.listAlerts(ctx, b, { status: opts.status, severity: opts.severity, limit: opts.limit });
  }

  async getAlertSummary(ctx: OwnerContext, branchId?: string): Promise<OwnerAlertSummary> {
    this.require(ctx, 'owner.alerts.view');
    const b = await this.ensureBranch(ctx, branchId);
    const c = await this.repo.alertCounts(ctx, b);
    return { total: c.total, unread: c.unread, bySeverity: c.bySeverity as OwnerAlertSummary['bySeverity'], byStatus: c.byStatus as OwnerAlertSummary['byStatus'] };
  }

  // ack/resolve/dismiss all require owner.alerts.resolve (MANAGER can view alerts but not act on them).
  private async transitionAlert(ctx: OwnerContext, alertId: string, status: string, markResolved: boolean): Promise<OwnerAlert> {
    this.require(ctx, 'owner.alerts.resolve');
    await this.allowedSet(ctx); // populate __allowedBranchIds so the repo can scope the mutation to the caller's branches
    const a = await this.repo.updateAlertStatus(ctx, alertId, status, ctx.userId, markResolved);
    if (!a) throw withCode(new OwnerError('not_found', 'Alert not found.'), 'ALERT_NOT_FOUND');
    await this.repo.writeAudit(ctx, { action: `alert_${status}`, entityType: 'alert', entityId: alertId, branchId: a.branchId });
    if (!this.repo.emitsDomainEvents?.()) this.rt?.toOwner(ctx.tenantId, EVENTS.ownerAlertUpdated, { alertId, status });   // §343: else the projection delivers owner_alert.status_changed
    return a;
  }
  acknowledgeAlert(ctx: OwnerContext, alertId: string): Promise<OwnerAlert> { return this.transitionAlert(ctx, alertId, 'acknowledged', false); }
  resolveAlert(ctx: OwnerContext, alertId: string): Promise<OwnerAlert> { return this.transitionAlert(ctx, alertId, 'resolved', true); }
  dismissAlert(ctx: OwnerContext, alertId: string): Promise<OwnerAlert> { return this.transitionAlert(ctx, alertId, 'dismissed', false); }

  async getProfileCard(ctx: OwnerContext): Promise<OwnerProfileCard> {
    this.require(ctx, 'owner.dashboard.view'); // identity card — available to any owner-app user
    const [p, tz, name, branches] = await Promise.all([this.repo.ownerProfile(ctx), this.repo.tenantTimezoneCurrency(ctx), this.repo.tenantName(ctx), this.repo.listBranches(ctx)]);
    return { userId: p?.userId ?? ctx.userId, fullName: p?.fullName ?? 'Owner', email: p?.email ?? null, phone: p?.phone ?? null, role: ctx.role, tenantId: ctx.tenantId, businessName: name, timezone: tz.timezone, currency: tz.currency, branchCount: branches.length, avatarUrl: buildMediaUrl(p?.avatarUrl ?? null) };
  }

  async getSettings(ctx: OwnerContext): Promise<OwnerSettingsSnapshot> {
    this.require(ctx, 'owner.settings.view');
    const [tz, name, branches] = await Promise.all([this.tzc(ctx), this.repo.tenantName(ctx), this.repo.listBranches(ctx)]);
    return { businessName: name, timezone: tz.timezone, currency: tz.currency, branchCount: branches.length, activeBranchCount: branches.filter((b) => b.status === 'active').length };
  }

  // Append-only audit trail of owner actions (alert transitions, report exports). Gated by owner.settings.view.
  async getAuditLog(ctx: OwnerContext, limit?: number): Promise<OwnerAuditEntry[]> {
    this.require(ctx, 'owner.settings.view');
    return this.repo.listAudit(ctx, limit);
  }

  // ---- Expenses — DEPRECATED wrappers over the finance module (Oct 21 2026). Same routes, same shapes; the rules
  // (approval, versioning, duplicates, categories, audit, events) now live in ONE place, ExpenseService. View gated to
  // owner.expenses.view; mutations to owner.expenses.manage — exactly as before.
  private expenseSvc(): OwnerExpensesPort {
    if (!this.expenses) throw withCode(new OwnerError('invalid', 'Expenses are not available on this server.'), 'FEATURE_NOT_AVAILABLE');
    return this.expenses;
  }
  private fctx(ctx: OwnerContext): OwnerFinanceCtx { return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, selectedBranchId: ctx.selectedBranchId ?? null }; }
  /** a finance ExpenseError (code + status) → the Owner App's error vocabulary, so the older clients see what they always saw */
  private async viaFinance<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      const x = e as { code?: string; status?: number; message?: string };
      if (x && typeof x.status === 'number' && typeof x.code === 'string') {
        if (x.status === 403) throw new OwnerError('forbidden', x.message || 'Forbidden.');
        if (x.status === 404) throw new OwnerError('not_found', x.message || 'Not found.');
        throw new OwnerError('invalid', x.message || 'Invalid.');
      }
      throw e;
    }
  }
  private legacyWindow(period: OwnerPeriod): { period?: 'today' | 'week' | 'month' | 'year' | 'custom'; from?: string; to?: string } {
    if (period !== 'quarter') return { period };
    const d = new Date(); const q = Math.floor(d.getUTCMonth() / 3); const y = d.getUTCFullYear();
    const pad = (m: number) => String(m).padStart(2, '0'); const last = new Date(Date.UTC(y, q * 3 + 3, 0)).getUTCDate();
    return { period: 'custom', from: `${y}-${pad(q * 3 + 1)}-01`, to: `${y}-${pad(q * 3 + 3)}-${pad(last)}` };
  }
  private legacyExpense(e: { id: string; branchId: string | null; category: string; amountCents: number; description: string | null; vendor: string | null; incurredOn: string; createdAt: string }): OwnerExpense {
    return { id: e.id, branchId: e.branchId, category: e.category, amountCents: e.amountCents, description: e.description, vendor: e.vendor, incurredOn: e.incurredOn, createdAt: e.createdAt };
  }

  async getExpenses(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerExpense[]> {
    this.require(ctx, 'owner.expenses.view');
    const w = this.legacyWindow(period);
    const r = await this.viaFinance(() => this.expenseSvc().list(this.fctx({ ...ctx, selectedBranchId: branchId ?? ctx.selectedBranchId }), { tab: 'all', ...w, branchId: branchId ?? null, pageSize: 200 }));
    return r.items.filter((e) => e.status !== 'voided').map((e) => this.legacyExpense(e));   // the older list never showed a removed expense
  }

  async getExpenseSummary(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerExpenseSummary> {
    this.require(ctx, 'owner.expenses.view');
    const r = await this.viaFinance(() => this.expenseSvc().report(this.fctx({ ...ctx, selectedBranchId: branchId ?? ctx.selectedBranchId }), { ...this.legacyWindow(period), branchId: branchId ?? null }));
    return { period: { from: r.window.from, to: r.window.to }, totalCents: r.totalCents, count: r.count, byCategory: r.byCategory.filter((c) => c.count > 0).map((c) => ({ category: c.key, amountCents: c.totalCents, count: c.count })) };
  }

  async createExpense(ctx: OwnerContext, input: OwnerExpenseInput): Promise<OwnerExpense> {
    this.require(ctx, 'owner.expenses.manage');
    if (!input?.category || input.amountCents === undefined || !input.incurredOn) throw withCode(new OwnerError('invalid', 'category, amountCents, and incurredOn are required.'), 'EXPENSE_DETAILS_REQUIRED');
    const r = await this.viaFinance(() => this.expenseSvc().create(this.fctx(ctx), { category: input.category, amountCents: input.amountCents, incurredOn: input.incurredOn, vendor: input.vendor ?? null, description: input.description ?? null, branchId: input.branchId ?? ctx.selectedBranchId ?? null }));
    return this.legacyExpense(r.expense);
  }

  async updateExpense(ctx: OwnerContext, id: string, patch: Partial<OwnerExpenseInput>): Promise<OwnerExpense> {
    this.require(ctx, 'owner.expenses.manage');
    const svc = this.expenseSvc();
    const cur = await this.viaFinance(() => svc.detail(this.fctx(ctx), id));
    const r = await this.viaFinance(() => svc.update(this.fctx(ctx), id, { ...patch, version: cur.expense.version, ...(cur.expense.status === 'approved' ? { reason: 'Edited in the Owner App' } : {}) }));
    return this.legacyExpense(r.expense);
  }

  /** the older Delete: a draft is removed; an approved expense is VOIDED with a reason (never hard-deleted, §85) */
  async deleteExpense(ctx: OwnerContext, id: string): Promise<{ id: string; deleted: boolean }> {
    this.require(ctx, 'owner.expenses.manage');
    const svc = this.expenseSvc();
    const cur = await this.viaFinance(() => svc.detail(this.fctx(ctx), id));
    if (cur.expense.status === 'draft' || cur.expense.status === 'rejected') return this.viaFinance(() => svc.deleteDraft(this.fctx(ctx), id));
    await this.viaFinance(() => svc.void(this.fctx(ctx), id, 'Deleted in the Owner App'));
    return { id, deleted: true };
  }

  /** The Owner App's branch authorization, for the finance module (BranchScopePort) — the same allowedSet / branchConstraint
   *  every owner screen uses; restricted roles get exactly their branch and may not ask for another. */
  async resolveBranchScope(ctx: OwnerContext, requested?: string | null): Promise<{ branchId: string | null; allowed: string[] | null; restricted: string | null }> {
    const allowed = await this.allowedSet(ctx);
    const restricted = await this.branchConstraint(ctx);
    const branchId = await this.ensureBranch(ctx, requested ?? undefined);
    return { branchId, allowed: restricted ? [restricted] : allowed, restricted };
  }
  /** an entry in the Owner App's audit trail (owner_audit_log), for another module's owner-facing action */
  async recordOwnerAudit(ctx: OwnerContext, e: { action: string; entityType?: string | null; entityId?: string | null; branchId?: string | null; metadata?: unknown }): Promise<void> {
    await this.repo.writeAudit(ctx, e);
  }

  // ---- Ticket Oversight (read-only, tenant + owner-branch scoped) ----
  async listTickets(ctx: OwnerContext, f: OwnerTicketFilters = {}): Promise<OwnerTicketList> {
    this.require(ctx, 'owner.dashboard.view');
    const allowed = await this.allowedSet(ctx); // stamps __allowedBranchIds for the repo bScope
    if (f.branchId && allowed && !allowed.includes(f.branchId)) throw withCode(new OwnerError('forbidden', 'You do not have access to that branch.'), 'BRANCH_ACCESS_DENIED');
    const page = clampPage(f.page);
    const pageSize = Math.min(100, Math.max(1, Number(f.pageSize) || 25));
    const search = typeof f.search === 'string' ? f.search.trim().slice(0, 80) : undefined;
    const ymd = (s?: string) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
    const df = ymd(f.dateFrom); const dt = ymd(f.dateTo);
    const tz = (df || dt) ? (await this.repo.tenantTimezoneCurrency(ctx)).timezone : undefined; // salon-local day boundaries
    return this.repo.ownerTicketsList(ctx, { branchId: f.branchId || undefined, status: f.status || undefined, search: search || undefined, dateFrom: df, dateTo: dt, tz, page, pageSize });
  }

  async ticketHistory(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketHistory> {
    this.require(ctx, 'owner.dashboard.view');
    await this.allowedSet(ctx); // ownerTicket() applies the branch scope → a ticket outside the owner's branches reads as not_found
    const id = String(ticketId ?? '').trim();
    if (!id) throw new OwnerError('invalid', 'A ticket id is required.');
    const ticket = await this.repo.ownerTicket(ctx, id);
    if (!ticket) throw withCode(new OwnerError('not_found', 'Ticket not found.'), 'TICKET_NOT_FOUND');
    const [lines, revisions] = await Promise.all([this.repo.ownerTicketLines(ctx, id), this.repo.ownerTicketRevisions(ctx, id)]);
    return { ticket, lines, revisions };
  }

  async liveOperations(ctx: OwnerContext, branchId?: string, q: OwnerLiveOpsQuery = {}): Promise<OwnerLiveOperations> {
    this.require(ctx, 'owner.dashboard.view');
    const allowed = await this.allowedSet(ctx); // stamps __allowedBranchIds for the repo bScope
    if (branchId && allowed && !allowed.includes(branchId)) throw withCode(new OwnerError('forbidden', 'You do not have access to that branch.'), 'BRANCH_ACCESS_DENIED');
    const tz = (await this.repo.tenantTimezoneCurrency(ctx)).timezone; // salon-local "today"
    return this.repo.ownerLiveOperations(ctx, branchId || null, tz, q);
  }

  // Customers & Loyalty (read-only): aggregate analytics over canonical customer tables, branch-scoped. Gated by the
  // general owner dashboard permission; no payment-instrument data is returned (spend is business analytics only).
  async customersOverview(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerCustomersOverview> {
    this.require(ctx, 'owner.dashboard.view');
    const b = await this.ensureBranch(ctx, branchId);
    const { from, prev } = periodRange(new Date(), period, (await this.tzc(ctx)).timezone);
    return this.repo.ownerCustomersOverview(ctx, b, from, prev);
  }
  async giftCardReport(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerGiftCardReport> {
    this.require(ctx, 'owner.dashboard.view');
    const b = await this.ensureBranch(ctx, branchId);
    const { from } = periodRange(new Date(), period, (await this.tzc(ctx)).timezone);
    return this.repo.ownerGiftCardReport(ctx, b, from);
  }

  // Inventory & Products (read-only): aggregate stock health + valuation, scoped to the owner's branches. Cost/retail
  // valuation is only surfaced to finance-permitted owners — otherwise nulled here, mirroring the inventory module's
  // cost-privacy for non-cost roles.
  async inventoryOverview(ctx: OwnerContext, branchId?: string): Promise<OwnerInventoryOverview> {
    this.require(ctx, 'owner.dashboard.view');
    const allowed = await this.allowedSet(ctx);
    let branchIds: string[] | null;
    if (branchId) {
      if (allowed !== null && !allowed.includes(branchId)) throw withCode(new OwnerError('forbidden', 'You can only view your assigned branch.'), 'BRANCH_ASSIGNED_ONLY');
      branchIds = [branchId];
    } else {
      branchIds = allowed;
    }
    const overview = await this.repo.ownerInventoryOverview(ctx, branchIds);
    if (!ctx.permissions?.includes('owner.finance.view')) {
      overview.stockValueCents = null; overview.retailValueCents = null;
      overview.topCategories = overview.topCategories.map((c) => ({ ...c, stockValueCents: null }));
    }
    return overview;
  }

  // Marketing & Growth (read-only): campaign performance + channel mix + referrals, scoped to the owner's branches plus
  // tenant-wide campaigns. Performance data (revenue/ROI) is shown to any owner-app user — it's marketing attribution,
  // not the books.
  async marketingOverview(ctx: OwnerContext, branchId?: string): Promise<OwnerMarketingOverview> {
    this.require(ctx, 'owner.dashboard.view');
    const allowed = await this.allowedSet(ctx);
    let branchIds: string[] | null;
    if (branchId) {
      if (allowed !== null && !allowed.includes(branchId)) throw withCode(new OwnerError('forbidden', 'You can only view your assigned branch.'), 'BRANCH_ASSIGNED_ONLY');
      branchIds = [branchId];
    } else {
      branchIds = allowed;
    }
    return this.repo.ownerMarketingOverview(ctx, branchIds);
  }

  // Payments & Money (read-only): payment-level oversight (summary + recent transactions + refunds) for a period, scoped
  // to the owner's branches. Financial — gated on owner.finance.view.
  async paymentsOverview(ctx: OwnerContext, period: OwnerPeriod = 'month', branchId?: string): Promise<OwnerPaymentsOverview> {
    this.require(ctx, 'owner.finance.view');
    const b = await this.ensureBranch(ctx, branchId);
    const { from } = periodRange(new Date(), period, (await this.tzc(ctx)).timezone);
    return this.repo.ownerPaymentsOverview(ctx, b, from);
  }

  // AI Center (read-only): delegates to the canonical AiCenterService (which honestly flags each metric tracked/untracked)
  // with the owner's branch scope. Gated by the general owner dashboard permission. NOTE: AI Center scoping is single
  // branch or all-tenant; a multi-branch owner with a branch subset sees all-tenant AI data (the AI Center module's own
  // scoping limitation), which is acceptable for this read surface.
  async aiCenterOverview(ctx: OwnerContext, branchId?: string): Promise<AiCenterOverview> {
    this.require(ctx, 'owner.dashboard.view');
    const b = await this.ensureBranch(ctx, branchId);
    if (!this.aiCenter) throw withCode(new OwnerError('invalid', 'AI Center is temporarily unavailable.'), 'SERVICE_UNAVAILABLE');
    const aiCtx: AiCenterCtx = { tenantId: ctx.tenantId, branchId: b, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    return this.aiCenter.overview(aiCtx);
  }

  // Approval Center (read-only aggregator): one queue of pending owner actions, composed from existing reads. Payroll
  // periods awaiting approval (draft) or lock (finalized) are included only for finance-permitted users; the open-alert
  // count only for alerts-permitted users — so the queue degrades gracefully by permission. No new data path.
  async approvals(ctx: OwnerContext): Promise<OwnerApprovals> {
    this.require(ctx, 'owner.dashboard.view');
    const items: OwnerApprovalItem[] = [];
    let payrollToApprove = 0, payrollToLock = 0, openAlerts = 0;

    if (ctx.permissions?.includes('owner.finance.view')) {
      const pl = await this.repo.ownerPayrollList(ctx);
      for (const p of pl.periods) {
        const action = p.status === 'draft' ? 'approve' : p.status === 'finalized' ? 'lock' : null;
        if (!action) continue;
        items.push({ kind: 'payroll', action, periodId: p.periodId, label: p.label ?? 'Pay period', detail: `${p.periodStart} – ${p.periodEnd}`, status: p.status, amountCents: p.totalPayableCents, branchId: p.branchId });
        if (action === 'approve') payrollToApprove++; else payrollToLock++;
      }
    }
    if (ctx.permissions?.includes('owner.alerts.view')) {
      const b = await this.ensureBranch(ctx, undefined);
      openAlerts = (await this.repo.alertCounts(ctx, b)).unread;
    }
    // approvals (draft) first, then locks (finalized); within each, larger payouts first
    items.sort((a, b) => (a.action === b.action ? b.amountCents - a.amountCents : a.action === 'approve' ? -1 : 1));
    return { items, counts: { payrollToApprove, payrollToLock, openAlerts }, generatedAt: new Date().toISOString() };
  }

  // Home "Needs Attention" strip: one lightweight cross-module aggregate, scoped to the owner's branches. Payroll counts
  // are finance-gated, alerts are alerts-gated, and low/out-of-stock reuse the canonical inventory status — each count
  // degrades to 0 by permission so the strip never implies access the user doesn't have.
  async attention(ctx: OwnerContext, branchId?: string): Promise<OwnerAttention> {
    this.require(ctx, 'owner.dashboard.view');
    const allowed = await this.allowedSet(ctx);
    let branchIds: string[] | null;
    if (branchId) {
      if (allowed !== null && !allowed.includes(branchId)) throw withCode(new OwnerError('forbidden', 'You can only view your assigned branch.'), 'BRANCH_ASSIGNED_ONLY');
      branchIds = [branchId];
    } else {
      branchIds = allowed;
    }
    let payrollToApprove = 0, payrollToLock = 0, openAlerts = 0;
    if (ctx.permissions?.includes('owner.finance.view')) {
      const pl = await this.repo.ownerPayrollList(ctx);
      for (const p of pl.periods) { if (p.status === 'draft' || (p.status as string) === 'review') payrollToApprove++; else if (p.status === 'finalized') payrollToLock++; }
    }
    const inv = await this.repo.ownerInventoryOverview(ctx, branchIds);
    if (ctx.permissions?.includes('owner.alerts.view')) {
      openAlerts = (await this.repo.alertCounts(ctx, branchId ? branchIds![0] : null)).unread;
    }
    return {
      payrollToApprove, payrollToLock,
      lowStock: inv.statusCounts.low + inv.statusCounts.critical, outOfStock: inv.statusCounts.outOfStock,
      openAlerts, generatedAt: new Date().toISOString(),
    };
  }

  // Commission & Payroll (read-only): scoped to the owner's allowed branches via the repo bScope (payroll is org-level).
  async payrollList(ctx: OwnerContext): Promise<OwnerPayrollList> {    this.require(ctx, 'owner.finance.view');
    await this.allowedSet(ctx); // stamps __allowedBranchIds for the repo bScope
    return this.repo.ownerPayrollList(ctx);
  }

  async payrollPeriod(ctx: OwnerContext, periodId: string): Promise<OwnerPayrollPeriodDetail> {
    this.require(ctx, 'owner.finance.view');
    await this.allowedSet(ctx);
    const id = String(periodId ?? '').trim();
    if (!id) throw new OwnerError('invalid', 'A payroll period id is required.');
    const detail = await this.repo.ownerPayrollPeriod(ctx, id);
    if (!detail) throw withCode(new OwnerError('not_found', 'Payroll period not found.'), 'PAYROLL_PERIOD_NOT_FOUND');
    return detail;
  }

  // Sensitive payroll state changes. Each one: owner finance permission + branch scope (the period must be inside the
  // owner's allowed branches) + FRESH AUTHENTICATION (the owner re-enters their own PIN) before delegating to the
  // canonical payroll engine (which owns the state machine + its own audit). We additionally write an owner-side audit
  // so the action shows in the owner's audit trail, and audit a rejected PIN as a security event.
  async approvePayroll(ctx: OwnerContext, periodId: string, pin?: string): Promise<OwnerPayrollPeriodDetail> {
    return this.payrollTransition(ctx, periodId, pin, 'approve');
  }
  async lockPayroll(ctx: OwnerContext, periodId: string, pin?: string): Promise<OwnerPayrollPeriodDetail> {
    return this.payrollTransition(ctx, periodId, pin, 'lock');
  }
  async reopenPayroll(ctx: OwnerContext, periodId: string, pin?: string, reason?: string): Promise<OwnerPayrollPeriodDetail> {
    return this.payrollTransition(ctx, periodId, pin, 'reopen', reason);
  }

  /** Weekly Paycheck (Oct 21 2026): the Owner App's approve / approve-held use the same fresh-PIN check as approve / lock. */
  async assertPayrollPin(ctx: OwnerContext, pin: string | undefined, periodId: string, kind: string): Promise<void> { return this.assertFreshPin(ctx, pin, periodId, kind); }
  private async assertFreshPin(ctx: OwnerContext, pin: string | undefined, periodId: string, kind: string): Promise<void> {
    const hash = await this.repo.ownerUserPinHash(ctx);
    if (!hash) throw withCode(new OwnerError('forbidden', 'Set a security PIN in Settings before approving or locking payroll.'), 'SECURITY_PIN_REQUIRED');
    const ok = typeof pin === 'string' && pin.length > 0 && await verifyPassword(pin, hash);
    if (!ok) {
      try { await this.repo.writeAudit(ctx, { action: 'payroll_pin_rejected', entityType: 'payroll_period', entityId: periodId, metadata: { kind } }); } catch { /* never mask the denial */ }
      throw withCode(new OwnerError('forbidden', 'Incorrect PIN. Please try again.'), 'PIN_INVALID');
    }
  }

  private async payrollTransition(ctx: OwnerContext, periodId: string, pin: string | undefined, kind: 'approve' | 'lock' | 'reopen', reason?: string): Promise<OwnerPayrollPeriodDetail> {
    this.require(ctx, 'owner.finance.view');
    // Constitution 5 Step 8 audit (Oct 4 2026): approving / locking / reopening payroll is a WRITE — it was gated on the
    // VIEW key alone. OWNER and MANAGER hold both today, but a custom role template granting finance visibility (an
    // accountant) must not be able to approve or reopen payroll. Same holders as before, so nobody is locked out.
    this.require(ctx, 'payroll.manage');
    // Payroll mandate wave 2 (§71/§79/§101): approving / reopening needs payroll.approve, locking (= paying) needs
    // payouts.manage — the same keys the POS routes require, so the Owner App is not a side door around them.
    this.require(ctx, kind === 'lock' ? 'payouts.manage' : 'payroll.approve');
    await this.allowedSet(ctx);
    const id = String(periodId ?? '').trim();
    if (!id) throw new OwnerError('invalid', 'A payroll period id is required.');
    const before = await this.repo.ownerPayrollPeriod(ctx, id); // also enforces the owner's branch scope
    if (!before) throw withCode(new OwnerError('not_found', 'Payroll period not found.'), 'PAYROLL_PERIOD_NOT_FOUND');
    await this.assertFreshPin(ctx, pin, id, kind); // fresh authentication
    if (!this.payroll) throw withCode(new OwnerError('invalid', 'Payroll actions are temporarily unavailable.'), 'SERVICE_UNAVAILABLE');
    // The owner layer has authorized this caller; grant the engine its manage permission for the delegated call. The
    // engine still validates the transition (a paid period is locked) and scopes to the tenant before mutating.
    // the owner's OWN permissions (they hold the keys checked above) — the engine re-checks them, nothing is granted here
    const pctx: PayrollContext = { tenantId: ctx.tenantId, branchId: before.period.branchId ?? null, userId: ctx.userId, role: ctx.role, permissions: [...(ctx.permissions ?? [])] };
    try {
      if (kind === 'approve') await this.payroll.finalize(pctx, id);
      else if (kind === 'lock') await this.payroll.markPaid(pctx, id);
      else await this.payroll.reopen(pctx, id, reason);   // the written reason is mandatory (the engine refuses without one)
    } catch (e) {
      throw new OwnerError('invalid', (e as Error)?.message || 'That payroll action could not be completed.');
    }
    const action = kind === 'approve' ? 'payroll_approved' : kind === 'lock' ? 'payroll_locked' : 'payroll_reopened';
    try { await this.repo.writeAudit(ctx, { action, entityType: 'payroll_period', entityId: id, branchId: before.period.branchId ?? null, metadata: { fromStatus: before.period.status, totalPayableCents: before.period.totalPayableCents } }); } catch { /* don't fail the action on owner-audit write */ }
    if (!this.payroll?.emitsDomainEvents?.()) this.rt?.toOwner(ctx.tenantId, EVENTS.ownerPayrollUpdated, { periodId: id, action });   // §343: else the projection delivers payroll.period_*
    // Constitution 9 §246 NO PRODUCER, closed: technician_earnings_updated was in the registry, routed to the
    // "technicians"/"reports" screens, and compared by TechPayrollScreen — with nothing anywhere emitting it.
    // A technician's payroll screen waited on an event that never came and refreshed only on its 20 s poll.
    //
    // The fact occurs HERE. `owner_payroll_updated` is the same moment, but it goes to the OWNER room, which a
    // technician is not in. Approving, locking or reopening a period changes what every technician on it is
    // owed, so each one is told in their OWN room. ids only: the screen refetches through its guarded route.
    //
    // Scope note: this covers the payroll-period fact, not "earnings changed because a ticket was just paid".
    // That second case has no single write site — earnings are COMPUTED from tickets, not stored — and fanning
    // out per payment would be noisy. The poll still covers it.
    if (!this.payroll?.emitsDomainEvents?.()) for (const techId of new Set((before.lines ?? []).map((l) => l.technicianId).filter(Boolean))) {
      this.rt?.toTechnician(techId, EVENTS.technicianEarningsUpdated, { periodId: id, action });
    }
    const after = await this.repo.ownerPayrollPeriod(ctx, id);
    return after ?? before;
  }
}
