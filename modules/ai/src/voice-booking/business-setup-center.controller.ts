// business-setup-center.controller.ts — AI Business Setup guide (Oct 30 2026): `/pos/ai/business-setup/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   ai.use     readiness · health · faqs · faqs/:id · search · history · assistant · preview (all read-only; preview
//              records a redacted test row and never books, holds, texts, calls or contacts a provider)
//   ai.manage  faqs (create draft) · faqs/:id/actions (edit / submit / approve / reject / archive / restore) — owners and
//              managers; Front Desk holds ai.use only, so it can read and preview but never publish customer-facing answers.
// The legacy `tenant/ai/receptionist/faqs` routes are retired (their only caller was this screen, rebuilt Oct 31 2026):
// they wrote is_active directly and DELETE erased history, which the approval workflow forbids.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { BusinessSetupCenter, BusinessSetupError, FAQ_ACTIONS, FAQ_STATUSES, FAQ_SORTS, FAQ_DATE_BASES, HISTORY_BASES, SEARCH_SCOPES, type BsCtx } from './business-setup-center';

export const BUSINESS_SETUP_CENTER = 'BusinessSetupCenter';

export const BS_FAQ_CREATE_BODY: BodySchema = S.object({
  question: S.text(300), answer: S.text(2000), category: S.nullable(S.text(60)), branchScope: S.nullable(S.enumOf(['all', 'branch'])),
  origin: S.nullable(S.enumOf(['pos', 'assistant'])), idempotencyKey: S.text(120),
}, ['question', 'answer', 'idempotencyKey']);
export const BS_FAQ_ACTION_BODY: BodySchema = S.object({
  action: S.enumOf([...FAQ_ACTIONS]), expectedVersion: S.integer(), question: S.nullable(S.text(300)), answer: S.nullable(S.text(2000)),
  category: S.nullable(S.text(60)), reason: S.nullable(S.text(500)), idempotencyKey: S.text(120),
}, ['action', 'expectedVersion', 'idempotencyKey']);
export const BS_PREVIEW_BODY: BodySchema = S.object({ question: S.text(300) }, ['question']);

function ctxFrom(req: any): BsCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: BsCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof BusinessSetupError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const FAQ_LIST = {
  filters: {
    status: { type: 'enum', values: FAQ_STATUSES }, category: { type: 'text' }, branch: { type: 'text' }, author: { type: 'uuid' },
    dateBasis: { type: 'enum', values: FAQ_DATE_BASES },
  },
  sorts: { newest: null, oldest: null, updated: null, approved: null, question_az: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 },
  maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const SEARCH_LIST = { filters: { scope: { type: 'enum', values: SEARCH_SCOPES } }, sorts: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
const HISTORY_LIST = { filters: { basis: { type: 'enum', values: HISTORY_BASES } }, sorts: {}, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
void FAQ_SORTS;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai/business-setup')
export class BusinessSetupCenterController {
  constructor(@Inject(BUSINESS_SETUP_CENTER) private readonly bc: BusinessSetupCenter | null) {}
  private r(): BusinessSetupCenter { if (!this.bc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Business Setup needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.bc; }

  /** the three canonical readiness rows + supplemental rows, each with source, raw vs eligible counts and exclusions */
  @Get('readiness') @RequirePermission('ai.use')
  readiness(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().readiness(c)); }

  /** Check Business Setup: non-mutating per-source diagnostics with corrective actions */
  @Get('health') @RequirePermission('ai.use')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().health(c)); }

  @Get('faqs') @RequirePermission('ai.use') @ListQuery(FAQ_LIST)
  faqs(@Req() q: any, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.r().faqs(c, { q: p?.q, status: p?.status, category: p?.category, branch: p?.branch, author: p?.author, dateBasis: p?.dateBasis, from: p?.from, to: p?.to, sort: p?.sort, page: p?.page, pageSize: p?.pageSize }));
  }

  @Get('faqs/:id') @RequirePermission('ai.use')
  faq(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().faq(c, id)); }

  /** Add FAQ: a durable DRAFT (never live until approved); the request key makes a double tap one FAQ */
  @Post('faqs') @RequirePermission('ai.manage')
  create(@Req() q: any, @Body(ValidatedBody(BS_FAQ_CREATE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.r().createFaq(c, b ?? {})); }

  @Post('faqs/:id/actions') @RequirePermission('ai.manage')
  act(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BS_FAQ_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.r().faqAction(c, id, b ?? {})); }

  /** Preview AI Knowledge: answers a sample question from approved sources only; never books, texts or calls */
  @Post('preview') @RequirePermission('ai.use')
  preview(@Req() q: any, @Body(ValidatedBody(BS_PREVIEW_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().preview(c, b ?? {})); }

  @Get('search') @RequirePermission('ai.use') @ListQuery(SEARCH_LIST)
  search(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().search(c, { scope: p?.scope, q: p?.q, page: p?.page, pageSize: p?.pageSize })); }

  @Get('history') @RequirePermission('ai.use') @ListQuery(HISTORY_LIST)
  history(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().history(c, { basis: p?.basis, from: p?.from, to: p?.to, page: p?.page, pageSize: p?.pageSize })); }

  /** Knowledge Assistant: suggestions only — nothing changes until an owner or manager acts */
  @Get('assistant') @RequirePermission('ai.use')
  assistant(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().assistant(c)); }
}
