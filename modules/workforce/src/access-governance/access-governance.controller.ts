// access-governance.controller.ts — BUILD_PLAN Phase 9 (Constitution 2 §153): the owner's security reports and access
// reviews. Every route declares its key; recording a review decision (which can revoke or change someone's access) needs
// a fresh step-up, like every other change that hands out or takes away authority.
//   GET  /pos/security/access-reviews                 AccessReviewView[]        [access_review.view]
//   POST /pos/security/access-reviews                 { dueAt? } → AccessReviewView   [access_review.manage]
//   GET  /pos/security/access-reviews/:id             AccessReviewView          [access_review.view]
//   POST /pos/security/access-reviews/:id/decisions   AccessReviewDecision      [access_review.manage, step-up]
//   POST /pos/security/access-reviews/:id/complete    AccessReviewView          [access_review.manage]
//   GET  /pos/security/high-risk                      HighRiskAccessReport      [security_reports.view]
//   GET  /pos/security/dormant?days=60                DormantAccountsReport     [security_reports.view]
//   GET  /pos/security/denials?from&to                PermissionDenialMetrics   [security_reports.view]
import { Body, Controller, Get, HttpException, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AccessGovernanceService, GovernanceError, type GovernanceActor } from './access-governance.service';
import { ListQueries } from '@aipowersalon/database';
import { AccessGovernanceControllerListQueries } from './access-governance.list-queries';
import { ACCESS_REVIEW_DECISION_BODY, ACCESS_REVIEW_START_BODY } from '../request-schemas';

export const ACCESS_GOVERNANCE_SERVICE = 'ACCESS_GOVERNANCE_SERVICE';
const actorOf = (req: any): GovernanceActor => { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : [], ip: typeof req?.ip === 'string' && req.ip ? req.ip : null }; };
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof GovernanceError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(AccessGovernanceControllerListQueries)
@Controller('pos/security')
export class AccessGovernanceController {
  constructor(@Optional() @Inject(ACCESS_GOVERNANCE_SERVICE) private readonly svc?: AccessGovernanceService | null) {}
  private s(): AccessGovernanceService { if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Security reports need a database.' }, 503); return this.svc; }

  @Get('access-reviews') @RequirePermission('access_review.view')
  reviews(@Req() r: any) { return run(() => this.s().listReviews(actorOf(r))); }

  @Post('access-reviews') @RequirePermission('access_review.manage')
  start(@Req() r: any, @Body(ValidatedBody(ACCESS_REVIEW_START_BODY)) b: any) { return run(() => this.s().startReview(actorOf(r), b ?? {})); }

  @Get('access-reviews/:id') @RequirePermission('access_review.view')
  review(@Req() r: any, @Param('id') id: string) { return run(() => this.s().getReview(actorOf(r), id)); }

  @Post('access-reviews/:id/decisions') @RequirePermission('access_review.manage') @RequireStepUp()
  decide(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(ACCESS_REVIEW_DECISION_BODY)) b: any) { return run(() => this.s().decide(actorOf(r), id, b ?? {})); }

  @Post('access-reviews/:id/complete') @RequirePermission('access_review.manage')
  complete(@Req() r: any, @Param('id') id: string) { return run(() => this.s().complete(actorOf(r), id)); }

  @Get('high-risk') @RequirePermission('security_reports.view')
  highRisk(@Req() r: any) { return run(() => this.s().highRisk(actorOf(r))); }

  @Get('dormant') @RequirePermission('security_reports.view')
  dormant(@Req() r: any, @Query('days') days?: string) { return run(() => this.s().dormant(actorOf(r), days)); }

  @Get('denials') @RequirePermission('security_reports.view')
  denials(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string) { return run(() => this.s().denials(actorOf(r), from, to)); }
}
