// super-admin-loyalty.controller.ts — SuperAdminGuard-only, READ-ONLY cross-tenant Loyalty Programs overview (Phase 10).
// One route: the platform loyalty aggregation. No write routes (tenants run their own loyalty programs via the POS).
import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import type { Response } from 'express';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminLoyaltyService, type AdminCtx } from './super-admin-loyalty.service';
import { LoyaltyDashboardService } from './loyalty-dashboard.service';
import { LoyaltyActionsService } from './loyalty-actions.service';
import { LoyaltyConfigService } from './loyalty-config.service';
import { LoyaltySuspiciousService } from './loyalty-suspicious.service';
import { LoyaltyCorrectionsService } from './loyalty-corrections.service';
import { SuperAdminLoyaltyControllerListQueries } from './super-admin-loyalty.list-queries';
import { LOY_CONFIG_BODY, LOY_CORRECTION_REVIEW_BODY, LOY_SUSPICIOUS_TRANSITION_BODY, LOY_TEMPLATE_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
function scopeFrom(req: any): any { return req?.ctx?.tenantId ? { tenantId: req.ctx.tenantId } : undefined; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminLoyaltyControllerListQueries)
@Controller('super-admin/loyalty')
export class SuperAdminLoyaltyController {
  constructor(
    private readonly svc: SuperAdminLoyaltyService,
    private readonly dashboard: LoyaltyDashboardService,
    private readonly actions: LoyaltyActionsService,
    private readonly config: LoyaltyConfigService,
    private readonly suspicious: LoyaltySuspiciousService,
    private readonly corrections: LoyaltyCorrectionsService,
  ) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), { search: q?.search, status: q?.status, limit: q?.limit }).then((o) => ({ ok: true, ...o }));
  }

  @Get('dashboard') async dashboard_(@Req() r: any, @Query() q: any) {
    return { ok: true, ...(await this.dashboard.getDashboard(ctxFrom(r), { scope: scopeFrom(r), centsPerPoint: q?.centsPerPoint })) };
  }

  // Platform loyalty CAPABILITY config (limits / expiration / program types / plan features) — never tenant points.
  @Get('config') async getConfig() { return { ok: true, config: await this.config.getConfig() }; }
  @Put('config') async putConfig(@Req() r: any, @Body(ValidatedBody(LOY_CONFIG_BODY)) b: any) { return this.config.updateConfig(ctxFrom(r), b ?? {}); }
  @Get('templates') async templates() { return { ok: true, templates: await this.config.listTemplates() }; }
  @Post('templates') async createTemplate(@Req() r: any, @Body(ValidatedBody(LOY_TEMPLATE_BODY)) b: any) { return this.config.createTemplate(ctxFrom(r), b ?? {}); }

  // Suspicious-redemption review: detect runs documented heuristics over real redemptions; cases are oversight metadata.
  @Post('suspicious/detect') async detect(@Req() r: any) { return this.suspicious.detect(ctxFrom(r), scopeFrom(r)); }
  @Get('suspicious') async suspiciousList(@Req() r: any, @Query() q: any) { return { ok: true, cases: await this.suspicious.listCases(scopeFrom(r), q?.status, q?.limit) }; }
  @Post('suspicious/:id/transition') async suspiciousTransition(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(LOY_SUSPICIOUS_TRANSITION_BODY)) b: any) { return this.suspicious.transition(ctxFrom(r), id, b?.to, b?.note); }

  // Calculation-correction review: detect verifiable arithmetic inconsistencies; review records compensating metadata only.
  @Post('corrections/detect') async correctionsDetect(@Req() r: any) { return this.corrections.detect(ctxFrom(r), scopeFrom(r)); }
  @Get('corrections') async correctionsList(@Req() r: any, @Query() q: any) { return { ok: true, corrections: await this.corrections.listCorrections(scopeFrom(r), q?.status, q?.limit) }; }
  @Post('corrections/:id/review') async correctionsReview(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(LOY_CORRECTION_REVIEW_BODY)) b: any) { return this.corrections.review(ctxFrom(r), id, b ?? {}); }

  @AsyncExport({ kind: 'super-admin.loyalty.export' }) @Get('export') async export(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportCsv(ctxFrom(r), { scope: scopeFrom(r), centsPerPoint: q?.centsPerPoint });
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"` });
    return out.body;
  }
  @AsyncExport({ kind: 'super-admin.loyalty.export-xlsx' }) @Get('export-xlsx') async exportXlsx(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportXlsx(ctxFrom(r), { scope: scopeFrom(r), centsPerPoint: q?.centsPerPoint });
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Length': String(out.buffer.length) });
    return out.buffer;
  }
}
