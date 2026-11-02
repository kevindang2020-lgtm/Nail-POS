// commission-review.controller.ts — `/pos/commission-discrepancies/*` (F1 + F2, Finish the Five, 30 Oct 2026): the
// persisted Commission Discrepancy Review. Tenant and branch come from the session (never the body); the repository
// re-checks every permission, the state machine, expectedVersion (409) and the own-pay rule. Workflow only — no route
// here moves money.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { CommissionReviewRepository, REVIEW_STATUSES, FINDING_TYPES, type ReviewAction } from './commission-review.repository';
import { teamCtx, per } from './technicians-screen.controller';
import { requestIdOf } from './audit-rows';
import { CDR_ASSIGN_BODY, CDR_INVESTIGATE_BODY, CDR_NOTE_BODY, CDR_POLICY_BODY, CDR_REASON_BODY, CDR_RESOLVE_BODY, CDR_RUN_BODY } from '../request-schemas';

export const COMMISSION_REVIEW = 'CommissionReviewRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const LIST = { filters: { status: { type: 'enum', values: [...REVIEW_STATUSES, 'open_all', 'all'] }, severity: { type: 'enum', values: ['low', 'medium', 'high'] }, type: { type: 'enum', values: FINDING_TYPES },
  assignee: { type: 'text', maxLength: 64 }, from: { type: 'text', maxLength: 10 }, to: { type: 'text', maxLength: 10 } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 8, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/commission-discrepancies')
export class CommissionReviewController {
  constructor(@Inject(COMMISSION_REVIEW) private readonly repo: CommissionReviewRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The discrepancy review needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('') @RequirePermission('pos.reports.view') @ListQuery(LIST)
  list(@Req() req: any, @Query() q: any) {
    return this.r().list(teamCtx(req), { status: s(q?.status), severity: s(q?.severity), type: s(q?.type), assignee: s(q?.assignee), q: s(q?.q), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize });
  }
  @Get('assignees') @RequirePermission('pos.reports.view')
  assignees(@Req() req: any, @Query('q') q?: string) { return this.r().assignees(teamCtx(req), s(q)); }

  @Post('run-check') @RequirePermission('pos.reports.view')
  run(@Req() req: any, @Body(ValidatedBody(CDR_RUN_BODY, { strict: true })) b: any) { return this.r().runCheck(teamCtx(req), per(b ?? {}), requestIdOf(req)); }

  @Put('refund-policy') @RequirePermission('pos.reports.view')
  policy(@Req() req: any, @Body(ValidatedBody(CDR_POLICY_BODY, { strict: true })) b: any) { return this.r().setRefundPolicy(teamCtx(req), b?.policy, requestIdOf(req)); }

  @Get(':id') @RequirePermission('pos.reports.view')
  detail(@Req() req: any, @Param('id') id: string, @Query() q: any) { return this.r().detail(teamCtx(req), id, { page: q?.page, pageSize: q?.pageSize }); }

  @Post(':id/assign') @RequirePermission('pos.reports.view')
  assign(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_ASSIGN_BODY, { strict: true })) b: any) { return this.act(req, id, 'assign', b); }
  @Post(':id/investigate') @RequirePermission('pos.reports.view')
  investigate(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_INVESTIGATE_BODY, { strict: true })) b: any) { return this.act(req, id, 'investigate', b); }
  @Post(':id/notes') @RequirePermission('pos.reports.view')
  note(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_NOTE_BODY, { strict: true })) b: any) { return this.act(req, id, 'note', b); }
  @Post(':id/resolve') @RequirePermission('pos.reports.view')
  resolve(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_RESOLVE_BODY, { strict: true })) b: any) { return this.act(req, id, 'resolve', b); }
  @Post(':id/dismiss') @RequirePermission('pos.reports.view')
  dismiss(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_REASON_BODY, { strict: true })) b: any) { return this.act(req, id, 'dismiss', b); }
  @Post(':id/reopen') @RequirePermission('pos.reports.view')
  reopen(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(CDR_REASON_BODY, { strict: true })) b: any) { return this.act(req, id, 'reopen', b); }

  private act(req: any, id: string, a: ReviewAction, b: any) { return this.r().act(teamCtx(req), id, a, b ?? {}, requestIdOf(req)); }
}
