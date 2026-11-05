// ai-business.controller.ts — read-only AI Business Assistant endpoints (spec §7 read-only-by-default).
//   GET /pos/ai-business/metrics            — permission-filtered metric definitions (the registry)
//   GET /pos/ai-business/metrics/:id        — one metric definition
//   GET /pos/ai-business/metrics/:id/freshness — freshness for a metric (spec §24)
// Feature-level endpoints are gated by pos.ai_business.view (a dedicated capability granted to OWNER + MANAGER — the
// "owners and authorized managers" audience), decoupled from the generic ai.use. Data-bearing tools additionally gate
// on the relevant pos.reports.* capability, so revenue/customer/technician data requires that reporting permission.
// Per-metric permission is additionally enforced in the service. Tenant/branch/role/permissions come ONLY from
// req.ctx (server-derived); nothing is trusted from body/query/header (spec §5).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_BUSINESS_ALERT_CREATE_BODY, AI_BUSINESS_ALERT_UPDATE_BODY, AI_BUSINESS_ASK_BODY, AI_BUSINESS_REPORT_BODY, AI_BUSINESS_SAVED_QUESTION_BODY } from '../request-schemas';
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { AiBusinessService } from './ai-business.service';
import { AiBusinessRevenueService } from './ai-business-revenue.service';
import { AiBusinessBriefService } from './ai-business-brief.service';
import { AiBusinessAppointmentsService } from './ai-business-appointments.service';
import { AiBusinessBranchesService } from './ai-business-branches.service';
import { AiBusinessCustomersService } from './ai-business-customers.service';
import { AiBusinessTechniciansService } from './ai-business-technicians.service';
import { AiBusinessAssistantService } from './ai-business-assistant.service';
import { AiBusinessSavedQuestionsService } from './ai-business-saved-questions.service';
import { AiBusinessAlertsService } from './ai-business-alerts.service';
import { AiBusinessReportsService } from './ai-business-reports.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';
import { ListQueries } from '@aipowersalon/database';
import { AiBusinessControllerListQueries } from './ai-business.list-queries';

function ctxFrom(req: any): AiBusinessContext {
  const c = req?.ctx || {};
  return {
    tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId,
    role: c.role, permissions: c.permissions || [],
  };
}

// Map a stable error code → HTTP status. Everything else surfaces as 500 with a safe generic message.
function statusFor(code: AiBusinessErrorCode): HttpStatus {
  switch (code) {
    case AiBusinessErrorCode.INSUFFICIENT_PERMISSION:
    case AiBusinessErrorCode.BRANCH_NOT_AUTHORIZED:
    case AiBusinessErrorCode.EXPORT_NOT_AUTHORIZED:
      return HttpStatus.FORBIDDEN;
    case AiBusinessErrorCode.METRIC_NOT_FOUND:
    case AiBusinessErrorCode.TENANT_NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case AiBusinessErrorCode.INVALID_DATE_RANGE:
    case AiBusinessErrorCode.DATE_RANGE_TOO_LARGE:
    case AiBusinessErrorCode.METRIC_NOT_AVAILABLE:
    case AiBusinessErrorCode.INSUFFICIENT_SAMPLE_SIZE:
      return HttpStatus.BAD_REQUEST;
    case AiBusinessErrorCode.DISABLED:
      return HttpStatus.FORBIDDEN;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

function toHttp(e: unknown): HttpException {
  if (e instanceof AiBusinessError) {
    return new HttpException({ code: e.code, message: e.message }, statusFor(e.code));
  }
  return new HttpException({ code: AiBusinessErrorCode.INTERNAL_ERROR, message: 'Internal error' }, HttpStatus.INTERNAL_SERVER_ERROR);
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(AiBusinessControllerListQueries)
@Controller('pos/ai-business')
export class AiBusinessController {
  constructor(
    private readonly svc: AiBusinessService,
    private readonly revenue: AiBusinessRevenueService,
    private readonly brief: AiBusinessBriefService,
    private readonly appointments: AiBusinessAppointmentsService,
    private readonly branches: AiBusinessBranchesService,
    private readonly customers: AiBusinessCustomersService,
    private readonly technicians: AiBusinessTechniciansService,
    private readonly assistant: AiBusinessAssistantService,
    private readonly saved: AiBusinessSavedQuestionsService,
    private readonly alerts: AiBusinessAlertsService,
    private readonly reports: AiBusinessReportsService,
  ) {}

  // ---- generated reports (§36): create (generates inline), list, get by id ----
  @Post('reports') @RequirePermission('pos.ai_business.view')
  async createReport(@Req() r: any, @Body(ValidatedBody(AI_BUSINESS_REPORT_BODY)) body: { reportType: string }) {
    try { return await this.reports.create(ctxFrom(r), (body || ({} as any)).reportType); }
    catch (e) { throw toHttp(e); }
  }

  @Get('reports') @RequirePermission('pos.ai_business.view')
  async listReports(@Req() r: any) {
    try { return await this.reports.list(ctxFrom(r)); }
    catch (e) { throw toHttp(e); }
  }

  @Get('reports/:id') @RequirePermission('pos.ai_business.view')
  async getReport(@Req() r: any, @Param('id') id: string) {
    try {
      const job = await this.reports.get(ctxFrom(r), id);
      if (!job) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Report not found');
      return job;
    } catch (e) { throw toHttp(e); }
  }

  // ---- business alerts (§34): CRUD + evaluate-now; scheduled dispatch is a later worker slice ----
  @Get('alerts') @RequirePermission('pos.ai_business.view')
  async listAlerts(@Req() r: any) {
    try { return await this.alerts.list(ctxFrom(r)); }
    catch (e) { throw toHttp(e); }
  }

  @Post('alerts') @RequirePermission('pos.ai_business.view')
  async createAlert(@Req() r: any, @Body(ValidatedBody(AI_BUSINESS_ALERT_CREATE_BODY)) body: any) {
    try { return await this.alerts.create(ctxFrom(r), body || {}); }
    catch (e) { throw toHttp(e); }
  }

  @Patch('alerts/:id') @RequirePermission('pos.ai_business.view')
  async updateAlert(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AI_BUSINESS_ALERT_UPDATE_BODY)) body: { active?: boolean; threshold?: number; title?: string }) {
    try { return await this.alerts.update(ctxFrom(r), id, body || {}); }
    catch (e) { throw toHttp(e); }
  }

  @Delete('alerts/:id') @RequirePermission('pos.ai_business.view')
  async deleteAlert(@Req() r: any, @Param('id') id: string) {
    try { return await this.alerts.remove(ctxFrom(r), id); }
    catch (e) { throw toHttp(e); }
  }

  @Post('alerts/:id/evaluate') @RequirePermission('pos.ai_business.view')
  async evaluateAlert(@Req() r: any, @Param('id') id: string) {
    try { return await this.alerts.evaluateNow(ctxFrom(r), id); }
    catch (e) { throw toHttp(e); }
  }

  // ---- saved questions (§35): create/list/delete/use, tenant + user scoped ----
  @Get('saved-questions') @RequirePermission('pos.ai_business.view')
  async listSaved(@Req() r: any) {
    try { return await this.saved.list(ctxFrom(r)); }
    catch (e) { throw toHttp(e); }
  }

  @Post('saved-questions') @RequirePermission('pos.ai_business.view')
  async createSaved(@Req() r: any, @Body(ValidatedBody(AI_BUSINESS_SAVED_QUESTION_BODY)) body: { title: string; intent: string; preset?: string; comparePreset?: string; question?: string; sharingScope?: 'private' | 'tenant' }) {
    try { return await this.saved.create(ctxFrom(r), body || ({} as any)); }
    catch (e) { throw toHttp(e); }
  }

  @Delete('saved-questions/:id') @RequirePermission('pos.ai_business.view')
  async deleteSaved(@Req() r: any, @Param('id') id: string) {
    try { return await this.saved.remove(ctxFrom(r), id); }
    catch (e) { throw toHttp(e); }
  }

  @Post('saved-questions/:id/use') @RequirePermission('pos.ai_business.view')
  async useSaved(@Req() r: any, @Param('id') id: string) {
    try { return await this.saved.touch(ctxFrom(r), id); }
    catch (e) { throw toHttp(e); }
  }

  @Get('metrics') @RequirePermission('pos.ai_business.view')
  listMetrics(@Req() r: any, @Query('category') category?: string) {
    try { return this.svc.listMetrics(ctxFrom(r), category); }
    catch (e) { throw toHttp(e); }
  }

  // ---- appointment analysis: funnel + trend + walk-ins (§13, §29) ----
  @Get('appointments/metrics') @RequirePermission('pos.ai_business.view')
  async appointmentMetrics(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.appointments.getAppointmentMetrics(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  // ---- branch comparison over AUTHORIZED branches only, totals + normalized (§14, §30) ----
  @Get('branches/compare') @RequirePermission('pos.ai_business.view')
  async compareBranches(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.branches.compareBranches(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  // ---- customer growth + retention (§15, §31) ----
  @Get('customers/growth') @RequirePermission('pos.ai_business.view')
  async customerGrowth(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.customers.getCustomerGrowth(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  // ---- technician operational performance: operational only, sample-size + fairness guarded (§16, §32, §47) ----
  @Get('technicians/performance') @RequirePermission('pos.ai_business.view')
  async technicianPerformance(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.technicians.getTechnicianPerformance(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  // ---- owner/manager daily brief: composes sales + bookings + queue (§11) ----
  @Get('daily-brief') @RequirePermission('pos.ai_business.view')
  async dailyBrief(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.brief.getDailyBrief(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  // ---- authorized revenue data tools (reuse ReportsService; financial permission enforced there) ----
  @Get('revenue/summary') @RequirePermission('pos.ai_business.view')
  async revenueSummary(@Req() r: any, @Query('preset') preset?: string) {
    try { return await this.revenue.getRevenueSummary(ctxFrom(r), preset); }
    catch (e) { throw toHttp(e); }
  }

  @Get('revenue/explain-change') @RequirePermission('pos.ai_business.view')
  async revenueExplainChange(@Req() r: any, @Query('preset') preset?: string, @Query('comparePreset') comparePreset?: string) {
    try { return await this.revenue.explainRevenueChange(ctxFrom(r), preset, comparePreset); }
    catch (e) { throw toHttp(e); }
  }

  @Get('metrics/:id') @RequirePermission('pos.ai_business.view')
  metric(@Req() r: any, @Param('id') id: string) {
    try { return this.svc.getMetricDefinition(ctxFrom(r), id); }
    catch (e) { throw toHttp(e); }
  }

  @Get('metrics/:id/freshness') @RequirePermission('pos.ai_business.view')
  freshness(@Req() r: any, @Param('id') id: string, @Query('includesCurrentDay') includesCurrentDay?: string) {
    try { return this.svc.getDataFreshness(ctxFrom(r), id, { includesCurrentDay: includesCurrentDay === 'true' }); }
    catch (e) { throw toHttp(e); }
  }

  // ---- natural-language assistant: bounded intent → authorized tool → model explanation (§19, §26) ----
  @Post('ask') @RequirePermission('pos.ai_business.view')
  async ask(@Req() r: any, @Body(ValidatedBody(AI_BUSINESS_ASK_BODY)) body: { question?: string; intent?: string; preset?: string; comparePreset?: string }) {
    try { return await this.assistant.ask(ctxFrom(r), body || {}); }
    catch (e) { throw toHttp(e); }
  }
}
