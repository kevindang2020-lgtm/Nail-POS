// ai-money-protection.controller.ts — GET /pos/ai-money-protection/{state,alerts} + POST /evaluate.
// Tenant/branch are server-derived from req.ctx (TenantAuthGuard) — never from the client.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { MONEY_INVESTIGATION_ASSIGN_BODY, MONEY_INVESTIGATION_CREATE_BODY, MONEY_INVESTIGATION_NOTE_BODY, MONEY_INVESTIGATION_RESOLVE_BODY, MONEY_INVESTIGATION_STATUS_BODY, MONEY_RULE_SETTING_BODY } from '../request-schemas';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import {
  MoneyProtectionService, MoneyProtectionForbiddenError, MoneyProtectionValidationError, MoneyProtectionDisabledError,
} from './ai-money-protection.service';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { MoneyProtectionExplainService } from './ai-money-protection-explain.service';
import type { MoneyProtectionContext } from './ai-money-protection.dto';
import { ListQueries } from '@aipowersalon/database';
import { MoneyProtectionControllerListQueries } from './ai-money-protection.list-queries';

function ctxFrom(req: any): MoneyProtectionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof MoneyProtectionForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof MoneyProtectionDisabledError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof MoneyProtectionValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(MoneyProtectionControllerListQueries)
@Controller('pos/ai-money-protection')
export class MoneyProtectionController {
  constructor(
    private readonly svc: MoneyProtectionService,
    private readonly inv: InvestigationService,
    private readonly explain: MoneyProtectionExplainService,
  ) {}

  @Get('state')
  @RequirePermission('ai_money_protection.view')
  state(@Req() r: any) {
    return run(() => this.svc.getState(ctxFrom(r)));
  }

  @Get('rules')
  @RequirePermission('ai_money_protection.view')
  rules(@Req() r: any) {
    return run(() => this.svc.getRules(ctxFrom(r)));
  }

  @Get('settings')
  @RequirePermission('ai_money_protection.view')
  getSettings(@Req() r: any) {
    return run(() => this.svc.getSettings(ctxFrom(r)));
  }

  @Post('settings/:ruleId')
  @RequirePermission('ai_money_protection.manage_settings')
  updateSetting(@Req() r: any, @Param('ruleId') ruleId: string, @Body(ValidatedBody(MONEY_RULE_SETTING_BODY)) b: any) {
    return run(() => this.svc.updateSetting(ctxFrom(r), ruleId, b));
  }

  @Get('alerts')
  @RequirePermission('ai_money_protection.view_alerts')
  alerts(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.listAlerts(ctxFrom(r), {
      severity: q?.severity || undefined, status: q?.status || undefined,
      alertType: q?.alertType || undefined, branchId: q?.branchId || undefined,
      limit: q?.limit ? +q.limit : undefined, cursor: q?.cursor || undefined,
    }));
  }

  // On-demand deterministic evaluation (also invoked by the background worker). Idempotent.
  @Post('evaluate')
  @RequirePermission('ai_money_protection.manage_rules')
  evaluate(@Req() r: any) {
    return run(() => this.svc.evaluateDeterministic(ctxFrom(r)));
  }

  @Post('alerts/:id/explain')
  @RequirePermission('ai_money_protection.view')
  explainAlert(@Req() r: any, @Param('id') id: string) {
    return run(() => this.explain.explainAlert(ctxFrom(r), id));
  }

  // ── Investigations ──────────────────────────────────────────────────────────
  @Get('investigations')
  @RequirePermission('ai_money_protection.view')
  listInvestigations(@Req() r: any, @Query() q: any) {
    return run(() => this.inv.list(ctxFrom(r), { status: q?.status || undefined, branchId: q?.branchId || undefined, limit: q?.limit ? +q.limit : undefined }));
  }

  @Get('investigations/:id')
  @RequirePermission('ai_money_protection.view')
  getInvestigation(@Req() r: any, @Param('id') id: string) {
    return run(() => this.inv.get(ctxFrom(r), id));
  }

  @Post('investigations')
  @RequirePermission('ai_money_protection.investigate')
  createInvestigation(@Req() r: any, @Body(ValidatedBody(MONEY_INVESTIGATION_CREATE_BODY)) b: any) {
    return run(() => this.inv.create(ctxFrom(r), { title: b?.title, category: b?.category, severity: b?.severity, branchId: b?.branchId, alertIds: b?.alertIds }));
  }

  @Post('investigations/:id/notes')
  @RequirePermission('ai_money_protection.investigate')
  addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MONEY_INVESTIGATION_NOTE_BODY)) b: any) {
    return run(() => this.inv.addNote(ctxFrom(r), id, b?.body));
  }

  @Post('investigations/:id/assign')
  @RequirePermission('ai_money_protection.investigate')
  assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MONEY_INVESTIGATION_ASSIGN_BODY)) b: any) {
    return run(() => this.inv.assign(ctxFrom(r), id, b?.assigneeUserId));
  }

  @Post('investigations/:id/status')
  @RequirePermission('ai_money_protection.investigate')
  updateStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MONEY_INVESTIGATION_STATUS_BODY)) b: any) {
    return run(() => this.inv.updateStatus(ctxFrom(r), id, b?.status));
  }

  @Post('investigations/:id/resolve')
  @RequirePermission('ai_money_protection.resolve')
  resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MONEY_INVESTIGATION_RESOLVE_BODY)) b: any) {
    return run(() => this.inv.recordResolution(ctxFrom(r), id, b?.resolution, b?.recoveryAmountCents ? +b.recoveryAmountCents : 0));
  }
}
