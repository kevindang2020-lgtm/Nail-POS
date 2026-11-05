import { RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { OWNER_ACCESS_CODE_BODY, OWNER_ACTIVITY_BODY, OWNER_CONTEXT_SELECT_BODY, OWNER_EXPENSE_CREATE_BODY, OWNER_EXPENSE_UPDATE_BODY, OWNER_PAYROLL_PIN_BODY, OWNER_PAYROLL_REOPEN_BODY } from '../request-schemas';
import type { OwnerNotificationsView, OwnerNotificationsReadResult } from '@aipowersalon/api-contracts/tenant';   // wire contracts (typing ratchet)
import { validateImageUpload } from '@aipowersalon/workforce';
/* owner.controller.ts — Owner App HTTP surface (/owner/*). Thin: derives ctx (incl. optional ?branchId) from the
 * session, calls OwnerService, maps OwnerError → HTTP (forbidden → 403, not_found → 404, invalid → 400). */
import { CashDrawerService, drawerCtx, drawerRun } from '@aipowersalon/checkout';
import { TechCashHandoffService, tchCtx, tchRun } from '@aipowersalon/workforce';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
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

const PERIODS = ['today', 'week', 'month', 'quarter', 'year'];
function coercePeriod(p?: string): OwnerPeriod { return (p && PERIODS.includes(p) ? p : 'month') as OwnerPeriod; }
function coerceBookingPeriod(p?: string): OwnerBookingPeriod { return (p === 'today' ? 'today' : 'week'); }

function ctxFrom(req: any, branchId?: string): OwnerContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions || [], selectedBranchId: branchId || c.branchId || undefined };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
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
  ) {}

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
  @RequirePermission('owner.dashboard.view') @Post('context/select') selectContext(@Req() r: any, @Body(ValidatedBody(OWNER_CONTEXT_SELECT_BODY)) body: any) {
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
  @RequirePermission('owner.settings.edit') @Post('security/access-code') setAccessCode(@Req() r: any, @Body(ValidatedBody(OWNER_ACCESS_CODE_BODY)) b: any) {
    return run(() => this.svc.setOwnerAccessCode(ctxFrom(r), { currentPassword: b?.currentPassword, newCode: b?.newCode }));
  }
  @RequirePermission('owner.dashboard.view') @Post('activity') recordActivity(@Req() r: any, @Body(ValidatedBody(OWNER_ACTIVITY_BODY)) body: any) {
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
  @RequirePermission('owner.finance.view') @Get('finance/summary') financeSummary(
    @Req() r: any,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const s = startDate || dateFrom || from;
    const e = endDate || dateTo || to;
    return run(() => this.svc.getFinanceSummary(ctxFrom(r), coercePeriod(period), branchId, s && e ? { startDate: s, endDate: e } : undefined));
  }
  @RequirePermission('owner.finance.view') @Get('finance/payment-mix') paymentMix(
    @Req() r: any,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const s = startDate || dateFrom || from;
    const e = endDate || dateTo || to;
    return run(() => this.svc.getPaymentMix(ctxFrom(r), coercePeriod(period), branchId, s && e ? { startDate: s, endDate: e } : undefined));
  }
  @RequirePermission('owner.reports.view') @Get('reports') reports(@Req() r: any) {
    return run(() => this.svc.getReports(ctxFrom(r)));
  }
  @AsyncExport({ kind: 'owner.reports.export' }) @RequirePermission('owner.reports.export') @Get('reports/:reportId/export') reportExport(
    @Req() r: any,
    @Param('reportId') reportId: string,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const s = startDate || dateFrom || from;
    const e = endDate || dateTo || to;
    return run(() => this.svc.exportReport(ctxFrom(r), reportId, coercePeriod(period), branchId, s && e ? { startDate: s, endDate: e } : undefined));
  }

  // Module 6 — Alerts / More / Settings.
  @RequirePermission('owner.alerts.view') @Get('alerts') alerts(@Req() r: any, @Query('status') status?: string, @Query('severity') severity?: string, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return run(() => this.svc.getAlerts(ctxFrom(r), { status, severity, branchId, limit: limit ? Number(limit) : undefined }));
  }
  @RequirePermission('owner.alerts.view') @Get('notifications') notifications(@Req() r: any): Promise<OwnerNotificationsView> {
    return run(async () => {
      const alerts = await this.svc.getAlerts(ctxFrom(r), { status: 'open' });
      const items = (alerts || []).map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body || '',
        category: a.category,
        severity: a.severity,
        readAt: a.status === 'new' ? null : (a.resolvedAt || a.createdAt),
        createdAt: a.createdAt,
      }));
      return {
        unreadCount: items.filter((i) => !i.readAt).length,
        items,
      };
    });
  }
  @RequirePermission('owner.alerts.resolve') @Post('notifications/read') markAllNotificationsRead(@Req() r: any): Promise<OwnerNotificationsReadResult> {
    return run(async () => {
      const alerts = await this.svc.getAlerts(ctxFrom(r), { status: 'new' });
      for (const a of alerts || []) {
        await this.svc.acknowledgeAlert(ctxFrom(r), a.id).catch(() => {});
      }
      return { ok: true as const };
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
      if (!f) throw new OwnerError('invalid', 'No image provided.');
      if (!this.storage) throw new OwnerError('invalid', 'Media storage is not configured.');
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
  @RequirePermission('owner.expenses.view') @Get('expenses') expenses(
    @Req() r: any,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const ctx = ctxFrom(r, branchId);
    const s = startDate || dateFrom || from;
    const e = endDate || dateTo || to;
    const customRange = s && e ? { startDate: s, endDate: e } : undefined;
    return run(() => this.svc.getExpenses(ctx, coercePeriod(period), ctx.selectedBranchId, customRange));
  }
  @RequirePermission('owner.expenses.view') @Get('expenses/summary') expenseSummary(
    @Req() r: any,
    @Query('period') period?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const ctx = ctxFrom(r, branchId);
    const s = startDate || dateFrom || from;
    const e = endDate || dateTo || to;
    const customRange = s && e ? { startDate: s, endDate: e } : undefined;
    return run(() => this.svc.getExpenseSummary(ctx, coercePeriod(period), ctx.selectedBranchId, customRange));
  }
  @RequirePermission('owner.expenses.manage') @Post('expenses') createExpense(@Req() r: any, @Body(ValidatedBody(OWNER_EXPENSE_CREATE_BODY)) body: any) {
    const ctx = ctxFrom(r);
    return run(() => this.svc.createExpense(ctx, { ...body, branchId: body.branchId || ctx.selectedBranchId }));
  }
  @RequirePermission('owner.expenses.manage') @Patch('expenses/:id') updateExpense(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_EXPENSE_UPDATE_BODY)) body: any) {
    return run(() => this.svc.updateExpense(ctxFrom(r), id, body));
  }
  @RequirePermission('owner.expenses.manage') @Delete('expenses/:id') deleteExpense(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.deleteExpense(ctxFrom(r), id));
  }

  // Ticket Oversight (read-only) — tenant + owner-branch scoped
  @RequirePermission('owner.dashboard.view') @Get('tickets') tickets(@Req() r: any, @Query('branchId') branchId?: string, @Query('status') status?: string, @Query('search') search?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return run(() => this.svc.listTickets(ctxFrom(r, branchId), { branchId: branchId || undefined, status, search, dateFrom, dateTo, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined }));
  }
  @RequirePermission('owner.dashboard.view') @Get('live') live(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.liveOperations(ctxFrom(r, branchId), branchId || undefined));
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
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/approve') approvePayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_PIN_BODY)) b: any) {
    return run(() => this.svc.approvePayroll(ctxFrom(r), id, b?.pin));
  }
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/lock') lockPayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_PIN_BODY)) b: any) {
    return run(() => this.svc.lockPayroll(ctxFrom(r), id, b?.pin));
  }
  @RequirePermission('payroll.manage') @Post('payroll/periods/:id/reopen') reopenPayroll(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OWNER_PAYROLL_REOPEN_BODY)) b: any) {
    return run(() => this.svc.reopenPayroll(ctxFrom(r), id, b?.pin, b?.reason ?? undefined));
  }
  @RequirePermission('owner.dashboard.view') @Get('tickets/:ticketId/history') ticketHistory(@Req() r: any, @Param('ticketId') ticketId: string) {
    return run(() => this.svc.ticketHistory(ctxFrom(r), ticketId));
  }
}
