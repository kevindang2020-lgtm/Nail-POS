// turn-queue.controller.ts — the technician TURN QUEUE HTTP surface (Fair Turn Engine mandate §90–§96, §112–§114,
// §120–§138, §139 permissions, §169–§175): `/pos/turn-queue/*` for the floor and the manager, `/tech/turn-queue` for the
// Technician App. Tenant / branch / actor come from the session (never the body); every route declares its key.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ListQueries } from '@aipowersalon/database';
import type { TurnBoardResponse, TurnHealthResponse, TurnSettingsInfo, TurnSettingsPreview, TurnHistoryResponse, TurnFairnessResponse, TurnTeamReportResponse, TurnTechnicianSummaryResponse, TurnRulesResponse, TurnCommandResult, TurnDayCloseResult, TurnRuleSaveResult, TurnRuleRetireResult, TechTurnQueueView, TurnPeriodSummary } from '@aipowersalon/api-contracts/tenant';
import { TurnQueueService, TurnQueueForbiddenError, type TurnQueueContext } from './turn-queue.service';
import { TurnQueueControllerListQueries, TechTurnQueueControllerListQueries } from './turn-queue.list-queries';
import { TURN_HOLD_BODY, TURN_RELEASE_BODY, TURN_REORDER_BODY, TURN_ADJUST_BODY, TURN_JOIN_BODY, TURN_CUSTOMER_DECLINED_BODY, TURN_DAY_CLOSE_BODY, TURN_SETTINGS_PREVIEW_BODY, TURN_RULE_BODY, TURN_RULE_RETIRE_BODY } from '../request-schemas';

function ctxFrom(req: any): TurnQueueContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof TurnQueueForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e?.name === 'TurnQueueError') throw new HttpException({ message: e.message, code: e.code }, e.status ?? HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TurnQueueControllerListQueries)
@Controller('pos/turn-queue')
export class TurnQueueController {
  constructor(private readonly svc: TurnQueueService) {}

  @Get('board') @RequirePermission('turn_queue.read') board(@Req() r: any): Promise<TurnBoardResponse> { return run(() => this.svc.board(ctxFrom(r))); }
  @Get('floor-health') @RequirePermission('turn_queue.read') health(@Req() r: any): Promise<TurnHealthResponse> { return run(() => this.svc.health(ctxFrom(r))); }
  @Get('settings') @RequirePermission('turn_queue.read') settings(@Req() r: any): Promise<TurnSettingsInfo> { return run(() => this.svc.settingsInfo(ctxFrom(r))); }
  @Post('settings/preview') @RequirePermission('turn_queue.settings.manage') preview(@Req() r: any, @Body(ValidatedBody(TURN_SETTINGS_PREVIEW_BODY, { strict: true })) b: any): Promise<TurnSettingsPreview> { return run(() => this.svc.previewSettings(ctxFrom(r), b ?? {})); }
  @Get('history') @RequirePermission('turn_queue.history.read') history(@Req() r: any, @Query() q: any): Promise<TurnHistoryResponse> {
    return run(() => this.svc.history(ctxFrom(r), { from: q.from, to: q.to, technicianId: q.technicianId, customerId: q.customerId, reasonCode: q.reasonCode, eventType: q.eventType, assignmentSource: q.assignmentSource, manualOnly: q.manualOnly === 'true', limit: q.limit ? Number(q.limit) : undefined }));
  }
  @Get('fairness') @RequirePermission('turn_queue.history.read') fairness(@Req() r: any, @Query() q: any): Promise<TurnFairnessResponse> { return run(() => this.svc.fairness(ctxFrom(r), { from: q.from, to: q.to })); }
  @Get('reports/team') @RequirePermission('turn_queue.history.read') teamReport(@Req() r: any, @Query() q: any): Promise<TurnTeamReportResponse> { return run(() => this.svc.teamReport(ctxFrom(r), { period: q.period, date: q.date })); }
  @Get('technicians/:technicianId/summary') @RequirePermission('technicians.view') summary(@Req() r: any, @Param('technicianId') id: string, @Query() q: any): Promise<TurnTechnicianSummaryResponse> { return run(() => this.svc.technicianSummary(ctxFrom(r), id, { period: q.period, date: q.date })); }
  @Get('rules') @RequirePermission('turn_queue.read') rules(@Req() r: any, @Query() q: any): Promise<TurnRulesResponse> { return run(() => this.svc.listRules(ctxFrom(r), { includeHistory: q.includeHistory === 'true' })); }

  @Post('technicians/:technicianId/hold') @RequirePermission('turn_queue.hold') hold(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TURN_HOLD_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.hold(ctxFrom(r), id, b ?? {})); }
  @Post('technicians/:technicianId/release') @RequirePermission('turn_queue.hold') release(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TURN_RELEASE_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.release(ctxFrom(r), id, b ?? {})); }
  @Post('technicians/:technicianId/reorder') @RequirePermission('turn_queue.reorder') reorder(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TURN_REORDER_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.reorder(ctxFrom(r), id, b ?? {})); }
  @Post('technicians/:technicianId/adjust') @RequirePermission('turn_queue.adjust') adjust(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TURN_ADJUST_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.adjust(ctxFrom(r), id, b ?? {})); }
  @Post('technicians/:technicianId/join') @RequirePermission('turn_queue.join') join(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TURN_JOIN_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.join(ctxFrom(r), id, b ?? {})); }
  @Post('guest-declined') @RequirePermission('turn_queue.assign') customerDeclined(@Req() r: any, @Body(ValidatedBody(TURN_CUSTOMER_DECLINED_BODY, { strict: true })) b: any): Promise<TurnCommandResult> { return run(() => this.svc.customerDeclined(ctxFrom(r), b ?? {})); }
  @Post('day/close') @RequirePermission('turn_queue.adjust') closeDay(@Req() r: any, @Body(ValidatedBody(TURN_DAY_CLOSE_BODY, { strict: true })) b: any): Promise<TurnDayCloseResult> { return run(() => this.svc.closeDay(ctxFrom(r), b ?? {})); }
  @Post('rules') @RequirePermission('turn_queue.settings.manage') saveRule(@Req() r: any, @Body(ValidatedBody(TURN_RULE_BODY, { strict: true })) b: any): Promise<TurnRuleSaveResult> { return run(() => this.svc.saveRule(ctxFrom(r), b ?? {})); }
  @Post('rules/:ruleKey/retire') @RequirePermission('turn_queue.settings.manage') retireRule(@Req() r: any, @Param('ruleKey') key: string, @Body(ValidatedBody(TURN_RULE_RETIRE_BODY, { strict: true })) b: any): Promise<TurnRuleRetireResult> { return run(() => this.svc.retireRule(ctxFrom(r), key, b ?? {})); }
}

/** §94–96: the Technician App's own view — her position, status, today's turns and her OWN money only. */
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechTurnQueueControllerListQueries)
@Controller('tech/turn-queue')
export class TechTurnQueueController {
  constructor(private readonly svc: TurnQueueService) {}
  @Get() @RequirePermission('tech.turn_queue.view') mine(@Req() r: any): Promise<TechTurnQueueView> { return run(() => this.svc.myView(ctxFrom(r))); }
  @Get('summary') @RequirePermission('tech.turn_queue.view') mySummary(@Req() r: any, @Query() q: any): Promise<TurnPeriodSummary & { technicianId: string; name: string }> { return run(() => this.svc.mySummary(ctxFrom(r), { period: q.period, date: q.date })); }
}
