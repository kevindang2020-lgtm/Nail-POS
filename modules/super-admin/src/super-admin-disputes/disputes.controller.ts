// disputes.controller.ts — Super Admin Chargebacks & Disputes routes, all behind SuperAdminGuard. Route order: literal
// segments (overview) before the :id param route.
import { Idempotent } from '@aipowersalon/database/nest';
import { Controller, Get, Post, Body, Param, Query, Req, Res, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DisputesService, DisputesForbiddenError, DisputesNotFoundError, DisputesValidationError, type Actor } from './disputes.service';
import { ListQueries } from '@aipowersalon/database';
import { DisputesControllerListQueries } from './disputes.list-queries';
import { DISPUTE_EXPORT_BODY, DISPUTE_FLAG_RISK_BODY, DISPUTE_NOTIFY_BODY, DISPUTE_OUTCOME_BODY, DISPUTE_REQUEST_EVIDENCE_BODY, DISPUTE_REVIEW_EVIDENCE_BODY, DISPUTE_SUBMIT_BODY, DISPUTE_UPLOAD_EVIDENCE_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@ListQueries(DisputesControllerListQueries)
@Controller('super-admin/disputes')
export class DisputesController {
  constructor(private readonly svc: DisputesService) {}

  private actor(req: any): Actor { return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] }; }
  private wrap(e: any): never {
    if (e instanceof DisputesForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DisputesNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (e instanceof DisputesValidationError) throw new HttpException(e.message, HttpStatus.UNPROCESSABLE_ENTITY);
    throw new HttpException(e?.message || 'Disputes request failed', HttpStatus.BAD_REQUEST);
  }

  @Get('overview')
  async overview(@Req() req: any) {
    try { return await this.svc.getOverview(this.actor(req)); } catch (e) { this.wrap(e); }
  }

  @Get()
  async list(@Query() q: any, @Req() req: any) {
    try { return await this.svc.listDisputes(this.actor(req), q ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get('deadlines')
  async deadlines(@Query() q: any, @Req() req: any) {
    try { return await this.svc.getDeadlines(this.actor(req), q ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post('exports')
  async exportCsv(@Body(ValidatedBody(DISPUTE_EXPORT_BODY, { strict: true })) body: any, @Query() q: any, @Req() req: any, @Res() res: any) {
    try {
      const out = await this.svc.exportCsv(this.actor(req), { ...(q ?? {}), ...(body ?? {}) });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      res.setHeader('X-Row-Count', String(out.rowCount));
      res.status(HttpStatus.OK).send(out.csv);
    } catch (e) { this.wrap(e); }
  }

  @Get('patterns')
  async patterns(@Req() req: any) {
    try { return await this.svc.getPatterns(this.actor(req)); } catch (e) { this.wrap(e); }
  }

  @Get('high-risk-merchants')
  async highRisk(@Req() req: any) {
    try { return await this.svc.getHighRiskMerchants(this.actor(req)); } catch (e) { this.wrap(e); }
  }

  @Post('merchant-risk/:tenantId/flag')
  async flagRisk(@Param('tenantId') tenantId: string, @Body(ValidatedBody(DISPUTE_FLAG_RISK_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.flagMerchantRisk(this.actor(req), tenantId, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get(':id/review')
  async review(@Param('id') id: string, @Req() req: any) {
    try { return await this.svc.getReviewWorkspace(this.actor(req), id); } catch (e) { this.wrap(e); }
  }

  @Get(':id/evidence')
  async evidence(@Param('id') id: string, @Req() req: any) {
    try { return await this.svc.listEvidence(this.actor(req), id); } catch (e) { this.wrap(e); }
  }

  @Post(':id/evidence/request')
  async requestEvidence(@Param('id') id: string, @Body(ValidatedBody(DISPUTE_REQUEST_EVIDENCE_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.requestEvidence(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post(':id/evidence')
  async uploadEvidence(@Param('id') id: string, @Body(ValidatedBody(DISPUTE_UPLOAD_EVIDENCE_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.uploadEvidence(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post(':id/evidence/:evidenceId/review')
  async reviewEvidence(@Param('id') id: string, @Param('evidenceId') evidenceId: string, @Body(ValidatedBody(DISPUTE_REVIEW_EVIDENCE_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.reviewEvidence(this.actor(req), id, evidenceId, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body(ValidatedBody(DISPUTE_SUBMIT_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.submitEvidence(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post(':id/notify-tenant')
  async notifyTenant(@Param('id') id: string, @Body(ValidatedBody(DISPUTE_NOTIFY_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.notifyTenant(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  // Phase 12: a double submit used to add the recovered funds twice — one Idempotency-Key, one outcome
  @Post(':id/outcome') @Idempotent()
  async outcome(@Param('id') id: string, @Body(ValidatedBody(DISPUTE_OUTCOME_BODY, { strict: true })) body: any, @Req() req: any) {
    try { return await this.svc.recordOutcome(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: any) {
    try { return await this.svc.getDispute(this.actor(req), id); } catch (e) { this.wrap(e); }
  }
}
