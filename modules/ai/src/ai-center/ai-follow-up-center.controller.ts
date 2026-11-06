// ai-follow-up-center.controller.ts — /pos/ai/follow-ups-center/* (AI Follow-Ups & Human Handoff Center). Tenant and branch
// come from the session only. NOT gated on the AI package: existing and manual follow-ups must stay workable when the AI
// receptionist subscription lapses (guide T40/T41) — new AI-generated tasks stop at the source because the paid voice side
// stops. Writes need ai.use + communications.manage (Front Desk holds both); overrides need ai.manage.
import type { FollowUpImportResult, FollowUpRecommendedAssignee, FollowUpHealthHistory } from '@aipowersalon/api-contracts/tenant';
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { AiFollowUpCenter, FollowUpCenterError, AI_FOLLOW_UP_CENTER, FU_STATUS_CHIPS, FU_PRIORITIES, FU_SOURCES, FU_BASES, FU_SORTS, FU_CREATE_REASONS, FU_RESOLUTIONS,
  FU_ATTEMPT_CHANNELS, FU_ATTEMPT_OUTCOMES, FU_PERIODS, type FuCtx } from './ai-follow-up-center';
import { AI_RECEPTIONIST_FOLLOW_UP } from '../ai-lifecycles';

export const FU_CREATE_BODY: BodySchema = S.object({
  reason: S.enumOf([...FU_CREATE_REASONS]), description: S.text(1000), priority: S.nullable(S.enumOf([...FU_PRIORITIES])), dueLocal: S.nullable(S.text(16)),
  customerId: S.nullable(S.text(64)), callerPhone: S.nullable(S.text(32)), assignedUserId: S.nullable(S.text(64)), providerCallId: S.nullable(S.text(128)), appointmentId: S.nullable(S.text(64)),
  idempotencyKey: S.text(120),
}, ['reason', 'description', 'idempotencyKey']);
export const FU_ASSIGN_BODY: BodySchema = S.object({ assignedUserId: S.nullable(S.text(64)), version: S.nullable(S.integer({ minimum: 1, maximum: 1_000_000 })), note: S.nullable(S.text(500)) }, []);
export const FU_STATUS_BODY: BodySchema = S.object({
  to: S.enumOf([...AI_RECEPTIONIST_FOLLOW_UP.states]), version: S.nullable(S.integer({ minimum: 1, maximum: 1_000_000 })), reason: S.nullable(S.text(500)),
  resolutionCategory: S.nullable(S.enumOf([...FU_RESOLUTIONS])), note: S.nullable(S.text(1000)), waitingUntilLocal: S.nullable(S.text(16)),
}, ['to']);
export const FU_NOTE_BODY: BodySchema = S.object({ note: S.text(1000), version: S.nullable(S.integer({ minimum: 1, maximum: 1_000_000 })) }, ['note']);
export const FU_EDIT_BODY: BodySchema = S.object({ description: S.nullable(S.text(1000)), dueLocal: S.nullable(S.text(40)), version: S.integer({ minimum: 1, maximum: 1_000_000 }) }, ['version']);
export const FU_PRIORITY_BODY: BodySchema = S.object({ priority: S.nullable(S.enumOf([...FU_PRIORITIES])), reason: S.text(500), version: S.nullable(S.integer({ minimum: 1, maximum: 1_000_000 })), escalate: S.nullable(S.boolean()) }, ['reason']);
export const FU_ATTEMPT_BODY: BodySchema = S.object({
  channel: S.enumOf([...FU_ATTEMPT_CHANNELS]), outcome: S.enumOf([...FU_ATTEMPT_OUTCOMES]), note: S.nullable(S.text(1000)), nextAttemptLocal: S.nullable(S.text(16)), idempotencyKey: S.text(120),
}, ['channel', 'outcome', 'idempotencyKey']);
export const FU_TEXT_PREPARE_BODY: BodySchema = S.object({ body: S.text(640), overrideReason: S.nullable(S.text(300)) }, ['body']);
export const FU_TEXT_CONFIRM_BODY: BodySchema = S.object({ body: S.text(640), token: S.text(2000), idempotencyKey: S.text(120), overrideReason: S.nullable(S.text(300)) }, ['body', 'token', 'idempotencyKey']);
export const FU_DECIDE_BODY: BodySchema = S.object({ taskId: S.text(64), signal: S.text(40), decision: S.enumOf(['accept', 'dismiss', 'escalate']), note: S.nullable(S.text(300)), version: S.nullable(S.integer({ minimum: 1, maximum: 1_000_000 })) }, ['taskId', 'signal', 'decision']);

const LIST = {
  filters: {
    status: { type: 'enum', values: FU_STATUS_CHIPS }, priority: { type: 'enum', values: FU_PRIORITIES }, source: { type: 'enum', values: FU_SOURCES },
    basis: { type: 'enum', values: FU_BASES }, preset: { type: 'enum', values: FU_PERIODS }, overdue: { type: 'enum', values: ['1', 'true'] },
  },
  sorts: { newest: null, priority: null, due: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page', 'assignee'],
} as const;
void FU_SORTS;

function ctxFrom(req: any): FuCtx {
  const c = req?.ctx || {};
  if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof FollowUpCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}

const HEALTH_HISTORY_LIST = { filters: {}, sorts: {}, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai/follow-ups-center')
export class AiFollowUpCenterController {
  constructor(@Inject(AI_FOLLOW_UP_CENTER) private readonly fc: AiFollowUpCenter | null) {}
  private c(): AiFollowUpCenter { if (!this.fc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The follow-up center needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.fc; }

  @Get('kpis') @RequirePermission('ai.use')
  kpis(@Req() q: any) { return run(() => this.c().kpis(ctxFrom(q))); }

  @Get('tasks') @RequirePermission('ai.use') @ListQuery(LIST)
  list(@Req() q: any, @Query() p: any) {
    return run(() => this.c().list(ctxFrom(q), { q: p?.q, status: p?.status, priority: p?.priority, source: p?.source, assignee: p?.assignee, overdue: p?.overdue, basis: p?.basis,
      preset: p?.preset, from: p?.from, to: p?.to, sort: p?.sort, page: p?.page, pageSize: p?.pageSize }));
  }

  @Get('staff') @RequirePermission('ai.use')
  staff(@Req() q: any) { return run(() => this.c().staff(ctxFrom(q))); }

  @Post('tasks') @RequirePermission('ai.use')
  create(@Req() q: any, @Body(ValidatedBody(FU_CREATE_BODY, { strict: true })) b: any) { return run(() => this.c().create(ctxFrom(q), b)); }

  @Get('tasks/:id') @RequirePermission('ai.use')
  detail(@Req() q: any, @Param('id') id: string) { return run(() => this.c().detail(ctxFrom(q), id)); }

  @Post('tasks/:id/assign') @RequirePermission('ai.use')
  assign(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.c().assign(ctxFrom(q), id, b)); }

  @Post('tasks/:id/status') @RequirePermission('ai.use')
  status(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_STATUS_BODY, { strict: true })) b: any) { return run(() => this.c().transition(ctxFrom(q), id, b)); }

  @Post('tasks/:id/note') @RequirePermission('ai.use')
  note(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_NOTE_BODY, { strict: true })) b: any) { return run(() => this.c().note(ctxFrom(q), id, b)); }

  @Post('tasks/:id/edit') @RequirePermission('ai.use')
  edit(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_EDIT_BODY, { strict: true })) b: any) { return run(() => this.c().edit(ctxFrom(q), id, b)); }

  @Post('tasks/:id/priority') @RequirePermission('ai.use')
  priority(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_PRIORITY_BODY, { strict: true })) b: any) { return run(() => this.c().setPriority(ctxFrom(q), id, b)); }

  @Post('tasks/:id/attempts') @RequirePermission('ai.use')
  attempt(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_ATTEMPT_BODY, { strict: true })) b: any) { return run(() => this.c().recordAttempt(ctxFrom(q), id, b)); }

  @Post('tasks/:id/text/prepare') @RequirePermission('ai.use')
  textPrepare(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_TEXT_PREPARE_BODY, { strict: true })) b: any) { return run(() => this.c().prepareText(ctxFrom(q), id, b)); }

  @Post('tasks/:id/text/confirm') @RequirePermission('ai.use')
  textConfirm(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(FU_TEXT_CONFIRM_BODY, { strict: true })) b: any) { return run(() => this.c().confirmText(ctxFrom(q), id, b)); }

  @Post('health') @RequirePermission('ai.use')
  health(@Req() q: any) { return run(() => this.c().health(ctxFrom(q))); }

  /** A13 Nov 6: bring in missed AI calls and failed Copilot actions now (the 5-minute job also does it) */
  @Post('import-sources') @RequirePermission('ai.use')
  importSources(@Req() q: any): Promise<FollowUpImportResult> { return run(() => { const c = ctxFrom(q); this.c().needWork(c); return this.c().importSources(c); }); }
  /** A13 Nov 6: who to give the next task to (fewest open tasks) — a suggestion only */
  @Get('recommended-assignee') @RequirePermission('ai.use')
  recommended(@Req() q: any): Promise<FollowUpRecommendedAssignee | null> { return run(() => this.c().recommendAssignee(ctxFrom(q))); }
  /** A13 Nov 6: every recorded Check Follow-Up System run, newest first */
  @Get('health/history') @RequirePermission('ai.use') @ListQuery(HEALTH_HISTORY_LIST)
  healthHistory(@Req() q: any, @Query() p: any): Promise<FollowUpHealthHistory> { return run(() => this.c().healthHistory(ctxFrom(q), { page: p?.page, pageSize: p?.pageSize })); }

  @Get('priorities') @RequirePermission('ai.use')
  priorities(@Req() q: any) { return run(() => this.c().priorities(ctxFrom(q))); }

  @Post('priorities/decide') @RequirePermission('ai.use')
  decide(@Req() q: any, @Body(ValidatedBody(FU_DECIDE_BODY, { strict: true })) b: any) { return run(() => this.c().decide(ctxFrom(q), b)); }
}
