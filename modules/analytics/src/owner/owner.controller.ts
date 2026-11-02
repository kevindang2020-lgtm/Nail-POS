import { RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { OWNER_ACCESS_CODE_BODY, OWNER_ACTIVITY_BODY, OWNER_CONTEXT_SELECT_BODY, OWNER_EXPENSE_CREATE_BODY, OWNER_EXPENSE_UPDATE_BODY, OWNER_PAYROLL_PIN_BODY, OWNER_PAYROLL_REOPEN_BODY, OWNER_PAYCHECK_APPROVE_BODY, OWNER_PAYCHECK_DECISION_BODY } from '../request-schemas';
import { validateImageUpload } from '@aipowersalon/workforce';
/* owner.controller.ts — Owner App HTTP surface (/owner/*). Thin: derives ctx (incl. optional ?branchId) from the
 * session, calls OwnerService, maps OwnerError → HTTP (forbidden → 403, not_found → 404, invalid → 400). */
import { CashDrawerService, drawerCtx, drawerRun } from '@aipowersalon/checkout';
import { TechCashHandoffService, tchCtx, tchRun, PayrollPaycheckService, PayrollError, paycheckWeekFilterFromQuery, payStubHeaders } from '@aipowersalon/workforce';
import type { PaycheckWeek, PaycheckOwnerSummary, PayStatementDetail, PaycheckDecisionRequest, PayrollTechnicianDetail, PayStubQuery, OwnerNotificationsReadResponse, OwnerStaffPerformancePage } from '@aipowersalon/api-contracts/tenant';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { OwnerService, OwnerError } from './owner.service';
import { MEDIA_STORAGE } from '@aipowersalon/workforce';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, uploadObjectKey, UPLOAD_POLICIES } from '@aipowersalon/media';
import { MembershipsService } from '@aipowersalon/memberships';
import type { OwnerContext } from './owner.repository';
import type { OwnerPeriod, OwnerBookingPeriod } from './owner.dto';
import { combineCashSummary } from './cash-summary';
import { ListQueries } from '@aipowersalon/database';
import { OwnerControllerListQueries } from './owner.list-queries';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const PERIODS = ['today', 'week', 'month', 'quarter', 'year'];
function coercePeriod(p?: string): OwnerPeriod { return (p && PERIODS.includes(p) ? p : 'month') as OwnerPeriod; }
function coerceBookingPeriod(p?: string): OwnerBookingPeriod { return (p === 'today' ? 'today' : 'week'); }

function ctxFrom(req: any, branchId?: string): OwnerContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions || [], selectedBranchId: branchId || c.branchId || undefined };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    // the weekly paycheck errors keep their code + status (409 version conflict, 403 self-approval, 422 split invalid …)
    if (e instanceof PayrollError) throw new HttpException({ code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, e.status);
    if (e instanceof OwnerError) {
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(OwnerControllerListQueries)
@Controller('owner')
export class OwnerController {
  constructor(
    private readonly svc: OwnerService,
    private readonly cashSvc: TechCashHandoffService,
    private readonly drawerSvc: CashDrawerService,
    private readonly memberships: MembershipsService,
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null,
    @Optional() @Inject(PayrollPaycheckService) private readonly paychecks?: PayrollPaycheckService | null,
  ) {}
  private pc(): PayrollPaycheckService {
    if (!this.paychecks) throw new OwnerError('invalid', 'Weekly paychecks need the database.');
    return this.paychecks;
  }
  private payCtx(r: any) { const c = r?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: c.authz.branchIds ?? null } : null }; }

  // ── Weekly Paycheck (Oct 21 2026, §9): the owner's approval inbox — what the manager submitted, by technician, with the
  // check / cash totals and every override; APPROVE ALL / APPROVE SELECTED (hold) with the PIN; RETURN / REJECT with a note.
  @RequirePermission('owner.finance.view') @Get('payroll/paychecks/summary') paycheckSummary(@Req() r: any): Promise<PaycheckOwnerSummary> {
    return run(() => this.pc().ownerSummary(this.payCtx(r)));
  }
  @RequirePermission('owner.finance.view') @Get('payroll/paychecks/periods/:id') paycheckWeek(@Req() r: any, @Param('id') id: string, @Query() q: any): Promise<PaycheckWeek> {
    return run(() => this.pc().reviewWeek(this.payCtx(r), id, paycheckWeekFilterFromQuery(q)));   // §66/§67: exceptions only · search · branch
  }
  // close-out (Oct 27 2026, §9.5): the evidence behind one statement — services, tips, hours, adjustments, payouts (the POS drill-down, branch-scoped)
  @RequirePermission('owner.finance.view') @Get('payroll/paychecks/periods/:id/technicians/:techId/evidence') paycheckEvidence(@Req() r: any, @Param('id') id: string, @Param('techId') techId: string): Promise<PayrollTechnicianDetail> {
    return run(() => this.pc().technicianEvidence(this.payCtx(r), id, techId));
  }
  // 17.5 (Oct 27 2026): an approved statement's pay stub (PDF download from the locked snapshot) — the POS route's twin
  @RequirePermission('owner.finance.view') @Get('payroll/paychecks/statements/:statementId/pay-stub.pdf') async paycheckPayStub(@Req() r: any, @Param('statementId') sid: string, @Query() q: PayStubQuery, @Res({ passthrough: true }) res: { set(h: Record<string, string>): unknown }): Promise<StreamableFile> {
    const f = await run(() => this.pc().payStub(this.payCtx(r), sid, { lang: typeof q?.lang === 'string' ? q.lang : null, surface: 'owner' }));
    res.set(payStubHeaders(f));
    return new StreamableFile(f.buffer);   // the bytes as they are (a Buffer returned bare is JSON-serialised by Nest)
  }
  @RequirePermission('payroll.approve') @Post('payroll/paychecks/periods/:id/approve') paycheckApprove(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYCHECK_APPROVE_BODY, { strict: true })) b: any): Promise<PaycheckWeek> {
    return run(async () => { await this.svc.assertPayrollPin(ctxFrom(r), b?.pin, id, 'paycheck_approve'); return this.pc().approve(this.payCtx(r), id, { expectedVersion: b?.expectedVersion ?? null, calculationHash: b?.calculationHash ?? null, holdTechnicianIds: b?.holdTechnicianIds ?? [] }); });
  }
  @RequirePermission('payroll.approve') @Post('payroll/paychecks/periods/:id/return') paycheckReturn(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYCHECK_DECISION_BODY, { strict: true })) b: PaycheckDecisionRequest): Promise<PaycheckWeek> {
    return run(() => this.pc().decide(this.payCtx(r), id, 'returned', { note: b?.note, expectedVersion: b?.expectedVersion ?? null }));
  }
  @RequirePermission('payroll.approve') @Post('payroll/paychecks/periods/:id/reject') paycheckReject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYCHECK_DECISION_BODY, { strict: true })) b: PaycheckDecisionRequest): Promise<PaycheckWeek> {
    return run(() => this.pc().decide(this.payCtx(r), id, 'rejected', { note: b?.note, expectedVersion: b?.expectedVersion ?? null }));
  }
  @RequirePermission('payroll.approve') @Post('payroll/paychecks/statements/:statementId/approve') paycheckApproveHeld(@Req() r: any, @Param('statementId') sid: string, @Body(ValidatedBody(OWNER_PAYROLL_PIN_BODY, { strict: true })) b: any): Promise<PayStatementDetail> {
    return run(async () => { await this.svc.assertPayrollPin(ctxFrom(r), b?.pin, sid, 'paycheck_approve_held'); return this.pc().approveHeld(this.payCtx(r), sid); });
  }

  // Constitution 5 Step 8 audit (Oct 4 2026): these owner-oversight reads called the cash / drawer / memberships services
  // directly, which accept the front desk's own POS grants — so a front desk could read the owner's salon-wide cash
  // close-out and membership revenue. Keyed like the rest of this controller (OwnerService: owner.dashboard.view).
  // Owner membership rollup — reuses the tenant-scoped membership overview aggregation. branchId comes from the owner's
  // branch selector (omitted = tenant-wide across all the owner's branches); tenant_id is always enforced by the engine.
  @RequirePermission('owner.dashboard.view') @Get('memberships/overview') membershipsOverview(@Req() r: any, @Query() q: any) {
    const c = r?.ctx || {};
    const mctx = { tenantId: c.tenantId, branchId: '', userId: c.userId, role: c.role, permissions: (c.permissions || []) as string[] };
    return run(() => this.memberships.getOverview(mctx, { branchId: q?.branchId || undefined }));
  }
  // NOTE: this used to be @Get('context'), which COLLIDED with OwnerPortfolioController's @Get('context').
  // OwnerPortfolioModule is imported before OwnerModule in app.module, so the portfolio handler won the path and
  // this one never ran — owner-web's branch selector silently received the portfolio payload (no `allowedBranches`),
  // and the `owner_context_loaded` audit row was never written. The two endpoints answer genuinely different
  // questions under different auth (portfolio = "which salon is the session in?", guarded by OwnerPortfolioGuard;
  // this one = "which branches inside this salon may I see?", gated on owner.dashboard.view), so they get
  // distinct paths rather than a merged payload that would leak branch data through the laxer guard.
  @RequirePermission('owner.dashboard.view') @Get('branch-context') context(@Req() r: any) {
    return run(() => this.svc.getContext(ctxFrom(r)));
  }
  @RequirePermission('owner.dashboard.view') @Post('context/select') selectContext(@Req() r: any, @Body(ValidatedBody(OWNER_CONTEXT_SELECT_BODY, { strict: true })) body: any) {
    const mode = body?.mode === 'single' ? 'single' : 'all';
    return run(() => this.svc.recordSelection(ctxFrom(r), mode, body?.branchId, body?.pin));
  }
  @RequirePermission('owner.dashboard.view') @Get('salons/overview') salonsOverview(@Req() r: any) {
    return run(() => this.svc.getSalonsOverview(ctxFrom(r)));
  }
  // Owner Access Code provisioning (self-serve). GET reports whether one is set; POST sets/rotates it, or removes it
  // when newCode is blank. Changing it requires the current password (checked server-side in the service).
  @RequirePermission('owner.settings.edit') @Get('security') securityStatus(@Req() r: any) {
    return run(() => this.svc.getSecurityStatus(ctxFrom(r)));
  }
  @RequirePermission('owner.settings.edit') @Post('security/access-code') setAccessCode(@Req() r: any, @Body(ValidatedBody(OWNER_ACCESS_CODE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.setOwnerAccessCode(ctxFrom(r), { currentPassword: b?.currentPassword, newCode: b?.newCode }));
  }
  @RequirePermission('owner.dashboard.view') @Post('activity') recordActivity(@Req() r: any, @Body(ValidatedBody(OWNER_ACTIVITY_BODY, { strict: true })) body: any) {
    const screen = body?.screen === 'reports' ? 'reports' : 'dashboard';
    return run(() => this.svc.recordActivity(ctxFrom(r), screen, body?.branchId));
  }
  @RequirePermission('owner.dashboard.view') @Get('dashboard/state') dashboard(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getDashboard(ctxFrom(r, branchId)));
  }

  // End-of-day cash hand-off summary (read-only owner oversight; salon-wide, tenant-scoped server-side).
  @RequirePermission('owner.dashboard.view') @Get('cash-handoffs') cashHandoffs(@Req() r: any, @Query('date') date?: string) {
    return tchRun(() => this.cashSvc.posList(tchCtx(r), date));
  }

  // Front-desk cash drawer summary (read-only owner oversight; per-branch, salon-wide, tenant-scoped server-side).
  @RequirePermission('owner.dashboard.view') @Get('cash-drawer') cashDrawer(@Req() r: any, @Query('date') date?: string) {
    return drawerRun(() => this.drawerSvc.ownerList(drawerCtx(r), date));
  }

  // Daily cash close-out — combines register drawer + technician hand-offs into one position (read-only, salon-wide).
  @RequirePermission('owner.dashboard.view') @Get('cash-summary') cashSummary(@Req() r: any, @Query('date') date?: string) {
    return drawerRun(async () => {
      const [drawer, tech] = await Promise.all([this.drawerSvc.ownerList(drawerCtx(r), date), this.cashSvc.posList(tchCtx(r), date)]);
      return combineCashSummary(drawer.businessDate, drawer, tech);
    });
  }

  // Module 2 — Branch Performance (aggregates across the owner's authorized branches; tenant-scoped server-side).
  @RequirePermission('owner.branches.view') @Get('branches') branches(@Req() r: any) {
    return run(() => this.svc.getBranchList(ctxFrom(r)));
  }
  @RequirePermission('owner.branches.view') @Get('branches/performance') branchPerformance(@Req() r: any, @Query('period') period?: string) {
    return run(() => this.svc.getBranchPerformance(ctxFrom(r), coercePeriod(period)));
  }
  @RequirePermission('owner.branches.view') @Get('branches/comparison') branchComparison(@Req() r: any, @Query('period') period?: string) {
    return run(() => this.svc.getComparison(ctxFrom(r), coercePeriod(period)));
  }
  @RequirePermission('owner.branches.view') @Get('branches/:branchId/performance') branchDetail(@Req() r: any, @Param('branchId') branchId: string, @Query('period') period?: string) {
    return run(() => this.svc.getBranchDetail(ctxFrom(r), branchId, coercePeriod(period)));
  }

  // Module 3 — Booking Overview (static routes declared before :appointmentId so they aren't captured by the param route).
  @RequirePermission('owner.bookings.view') @Get('bookings/overview') bookingOverview(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getBookingOverview(ctxFrom(r), coerceBookingPeriod(period), branchId));
  }
  @RequirePermission('owner.bookings.view') @Get('bookings/trend') bookingTrend(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getBookingTrend(ctxFrom(r), branchId));
  }
  @RequirePermission('owner.bookings.view') @Get('bookings/drill-down') bookingDrillDown(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string, @Query('status') status?: string, @Query('source') source?: string, @Query('limit') limit?: string) {
    return run(() => this.svc.getBookingDrillDown(ctxFrom(r), { period: coerceBookingPeriod(period), branchId, status, source, limit: limit ? Number(limit) : undefined }));
  }
  @RequirePermission('owner.bookings.details') @Get('bookings/:appointmentId') appointment(@Req() r: any, @Param('appointmentId') appointmentId: string) {
    return run(() => this.svc.getAppointment(ctxFrom(r), appointmentId));
  }

  // Module 4 — Staff / Technician Performance (static routes before :technicianId).
  @RequirePermission('owner.staff.performance.view') @Get('staff/performance') staffPerformance(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getStaffPerformance(ctxFrom(r), coercePeriod(period), branchId));
  }
  // 200-technician mandate §62/§69/§71: every technician, searched / sorted / paged on the server (the summary keeps its top 10)
  @RequirePermission('owner.staff.performance.view') @Get('staff/performance/technicians') staffPerformanceTechnicians(@Req() r: any, @Query() q: any): Promise<OwnerStaffPerformancePage> {
    return run(() => this.svc.getStaffPerformanceTechnicians(ctxFrom(r), { period: coercePeriod(q?.period), branchId: q?.branchId || undefined, search: typeof q?.search === 'string' ? q.search : undefined,
      sort: q?.sort, dir: q?.dir, page: q?.page != null ? Number(q.page) : undefined, pageSize: q?.pageSize != null ? Number(q.pageSize) : undefined }));
  }
  @RequirePermission('owner.staff.view') @Get('staff/attendance') staffAttendance(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getStaffAttendance(ctxFrom(r), branchId));
  }
  @RequirePermission('owner.staff.performance.view') @Get('staff/:technicianId/performance') technicianDetail(@Req() r: any, @Param('technicianId') technicianId: string, @Query('period') period?: string) {
    return run(() => this.svc.getTechnicianDetail(ctxFrom(r), technicianId, coercePeriod(period)));
  }
  @RequirePermission('owner.staff.earnings.view') @Get('staff/:technicianId/earnings') technicianEarnings(@Req() r: any, @Param('technicianId') technicianId: string, @Query('period') period?: string) {
    return run(() => this.svc.getTechnicianEarnings(ctxFrom(r), technicianId, coercePeriod(period)));
  }

  // Module 5 — Finance & Reports.
  @RequirePermission('owner.finance.view') @Get('finance/summary') financeSummary(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getFinanceSummary(ctxFrom(r), coercePeriod(period), branchId));
  }
  @RequirePermission('owner.finance.view') @Get('finance/payment-mix') paymentMix(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getPaymentMix(ctxFrom(r), coercePeriod(period), branchId));
  }
  @RequirePermission('owner.reports.view') @Get('reports') reports(@Req() r: any) {
    return run(() => this.svc.getReports(ctxFrom(r)));
  }
  @AsyncExport({ kind: 'owner.reports.export' }) @RequirePermission('owner.reports.export') @Get('reports/:reportId/export') reportExport(@Req() r: any, @Param('reportId') reportId: string, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.exportReport(ctxFrom(r), reportId, coercePeriod(period), branchId));
  }

  // Module 6 — Alerts / More / Settings.
  @RequirePermission('owner.alerts.view') @Get('alerts') alerts(@Req() r: any, @Query('status') status?: string, @Query('severity') severity?: string, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return run(() => this.svc.getAlerts(ctxFrom(r), { status, severity, branchId, limit: limit ? Number(limit) : undefined }));
  }
  // merged from the developer tree (Oct 23 2026): "Mark all read" on the Owner app's Notifications screen — every NEW alert in
  // the caller's scope is acknowledged through the same transition as one tap (state machine, audit, event). Pages of 200
  // until none is left (bounded), so a long backlog is not cut at the first page.
  @RequirePermission('owner.alerts.resolve') @Post('notifications/read') markAllNotificationsRead(@Req() r: any): Promise<OwnerNotificationsReadResponse> {
    return run(async () => {
      let acknowledged = 0;
      for (let round = 0; round < 25; round++) {
        const batch = await this.svc.getAlerts(ctxFrom(r), { status: 'new', limit: 200 });
        if (!batch?.length) break;
        for (const a of batch) { await this.svc.acknowledgeAlert(ctxFrom(r), a.id); acknowledged++; }
        if (batch.length < 200) break;
      }
      return { ok: true as const, acknowledged };
    });
  }
  @RequirePermission('owner.alerts.view') @Get('alerts/summary') alertSummary(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.getAlertSummary(ctxFrom(r), branchId));
  }
  @RequirePermission('owner.alerts.resolve') @Post('alerts/:alertId/acknowledge') ackAlert(@Req() r: any, @Param('alertId') alertId: string) {
    return run(() => this.svc.acknowledgeAlert(ctxFrom(r), alertId));
  }
  @RequirePermission('owner.alerts.resolve') @Post('alerts/:alertId/resolve') resolveAlert(@Req() r: any, @Param('alertId') alertId: string) {
    return run(() => this.svc.resolveAlert(ctxFrom(r), alertId));
  }
  @RequirePermission('owner.alerts.resolve') @Post('alerts/:alertId/dismiss') dismissAlert(@Req() r: any, @Param('alertId') alertId: string) {
    return run(() => this.svc.dismissAlert(ctxFrom(r), alertId));
  }
  @RequirePermission('owner.dashboard.view') @Get('profile') profile(@Req() r: any) {
    return run(() => this.svc.getProfileCard(ctxFrom(r)));
  }
  @RequirePermission('owner.dashboard.view') @Post('profile/avatar')
  // Phase 12: the avatar policy's 10 MB limit (it was 20 MB read into memory, then refused at 10); the route reads no body, only the file
  @UseInterceptors(FilesInterceptor('file', 1, { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.avatar.maxBytes } }))
  async uploadAvatar(@Req() r: any, @UploadedFiles() files: any[]) {
    return run(async () => {
      const f = (files ?? [])[0];
      if (!f) throw withCode(new OwnerError('invalid', 'No image provided.'), 'IMAGE_REQUIRED');
      if (!this.storage) throw withCode(new OwnerError('invalid', 'Media storage is not configured.'), 'FEATURE_NOT_AVAILABLE');
      // Sep 2026 merge: the BYTES decide the type (a renamed .html is refused) and the extension comes from the sniffed type
      const v: any = validateImageUpload(f.buffer, 'avatar'); if (!v.ok) throw new BadRequestException(v.reason || 'That file is not a supported image.');
      const ext = v.ext;
      const ctx = ctxFrom(r);
      // Phase 12 (#34): the one upload policy — EXIF (GPS) stripped from this public picture, a tenant-scoped random key
      const up = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: f.buffer, filename: f.originalname, declaredType: f.mimetype, tenantId: ctx.tenantId ?? null, quotaReserved: true });
      const key = uploadObjectKey({ tenantId: ctx.tenantId ?? null, area: 'avatars', owner: ['owner', ctx.userId], ext: up.ext || ext });
      
      const oldProfile = await this.svc.getProfileCard(ctx);
      if (oldProfile?.avatarUrl) {
        const raw = oldProfile.avatarUrl;
        const oldKey = raw.includes('uploads/')
          ? raw.substring(raw.indexOf('uploads/') + 8)
          : raw.includes('tenants/')
            ? raw.substring(raw.indexOf('tenants/'))
            : raw.split('/').pop() || raw;
        await this.storage.remove(oldKey).catch(() => {});
      }

      const { url } = await this.storage.put(key, up.bytes);
      await this.svc.setAvatar(ctx, key);
      return { url };
    });
  }
  @RequirePermission('owner.settings.view') @Get('settings') settings(@Req() r: any) {
    return run(() => this.svc.getSettings(ctxFrom(r)));
  }
  @RequirePermission('owner.settings.view') @Get('audit') audit(@Req() r: any, @Query('limit') limit?: string) {
    return run(() => this.svc.getAuditLog(ctxFrom(r), limit ? Number(limit) : undefined));
  }

  // ---- Expenses ----
  @RequirePermission('owner.expenses.view') @Get('expenses') expenses(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    const ctx = ctxFrom(r, branchId);
    return run(() => this.svc.getExpenses(ctx, coercePeriod(period), ctx.selectedBranchId));
  }
  @RequirePermission('owner.expenses.view') @Get('expenses/summary') expenseSummary(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    const ctx = ctxFrom(r, branchId);
    return run(() => this.svc.getExpenseSummary(ctx, coercePeriod(period), ctx.selectedBranchId));
  }
  @RequirePermission('owner.expenses.manage') @Post('expenses') createExpense(@Req() r: any, @Body(ValidatedBody(OWNER_EXPENSE_CREATE_BODY, { strict: true })) body: any) {
    const ctx = ctxFrom(r);
    return run(() => this.svc.createExpense(ctx, { ...body, branchId: body.branchId || ctx.selectedBranchId }));
  }
  @RequirePermission('owner.expenses.manage') @Patch('expenses/:id') updateExpense(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_EXPENSE_UPDATE_BODY, { strict: true })) body: any) {
    return run(() => this.svc.updateExpense(ctxFrom(r), id, body));
  }
  @RequirePermission('owner.expenses.manage') @Delete('expenses/:id') deleteExpense(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.deleteExpense(ctxFrom(r), id));
  }

  // Ticket Oversight (read-only) — tenant + owner-branch scoped
  @RequirePermission('owner.dashboard.view') @Get('tickets') tickets(@Req() r: any, @Query('branchId') branchId?: string, @Query('status') status?: string, @Query('search') search?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return run(() => this.svc.listTickets(ctxFrom(r, branchId), { branchId: branchId || undefined, status, search, dateFrom, dateTo, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined }));
  }
  // 200-technician §2: the team (search / status) and the in-service list are server pages
  @RequirePermission('owner.dashboard.view') @Get('live') live(@Req() r: any, @Query('branchId') branchId?: string, @Query('teamPage') teamPage?: string, @Query('teamPageSize') teamPageSize?: string, @Query('teamSearch') teamSearch?: string, @Query('teamStatus') teamStatus?: string, @Query('techQueuePage') techQueuePage?: string, @Query('techQueuePageSize') techQueuePageSize?: string) {
    const n = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
    return run(() => this.svc.liveOperations(ctxFrom(r, branchId), branchId || undefined, { teamPage: n(teamPage), teamPageSize: n(teamPageSize), teamSearch: teamSearch || undefined, teamStatus: teamStatus || undefined, techQueuePage: n(techQueuePage), techQueuePageSize: n(techQueuePageSize) }));
  }
  @RequirePermission('owner.finance.view') @Get('payroll') payroll(@Req() r: any) {
    return run(() => this.svc.payrollList(ctxFrom(r)));
  }
  @RequirePermission('owner.dashboard.view') @Get('customers') customers(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.customersOverview(ctxFrom(r, branchId), (period as any) || 'month', branchId || undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('gift-cards/report') giftCardReport(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.giftCardReport(ctxFrom(r, branchId), (period as any) || 'month', branchId || undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('inventory') inventory(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.inventoryOverview(ctxFrom(r, branchId), branchId || undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('marketing') marketing(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.marketingOverview(ctxFrom(r, branchId), branchId || undefined));
  }
  @RequirePermission('owner.finance.view') @Get('payments') payments(@Req() r: any, @Query('period') period?: string, @Query('branchId') branchId?: string) {
    return run(() => this.svc.paymentsOverview(ctxFrom(r, branchId), (period as any) || 'month', branchId || undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('ai-center') aiCenter(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.aiCenterOverview(ctxFrom(r, branchId), branchId || undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('approvals') approvals(@Req() r: any) {
    return run(() => this.svc.approvals(ctxFrom(r)));
  }
  @RequirePermission('owner.dashboard.view') @Get('attention') attention(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.attention(ctxFrom(r, branchId), branchId || undefined));
  }
  @RequirePermission('owner.finance.view') @Get('payroll/periods/:id') payrollPeriod(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.payrollPeriod(ctxFrom(r), id));
  }
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/approve') approvePayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_PIN_BODY, { strict: true })) b: any) {
    return run(() => this.svc.approvePayroll(ctxFrom(r), id, b?.pin));
  }
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/lock') lockPayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_PIN_BODY, { strict: true })) b: any) {
    return run(() => this.svc.lockPayroll(ctxFrom(r), id, b?.pin));
  }
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/reopen') reopenPayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_REOPEN_BODY, { strict: true })) b: any) {
    return run(() => this.svc.reopenPayroll(ctxFrom(r), id, b?.pin, b?.reason ?? undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('tickets/:ticketId/history') ticketHistory(@Req() r: any, @Param('ticketId') ticketId: string) {
    return run(() => this.svc.ticketHistory(ctxFrom(r), ticketId));
  }
}
