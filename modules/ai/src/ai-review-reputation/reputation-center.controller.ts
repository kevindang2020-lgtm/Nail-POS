// reputation-center.controller.ts — AI Review & Reputation guide (Nov 1 2026): `/pos/reputation/*`, the read side of the
// eight-tab workspace. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch come from the session.
//   pos.ai_review_reputation.view   summary · reviews · reviews/:id · approvals · complaints · trends · branches · requests ·
//                                   integrations · check
//   + customers.view                a review's stored customer link (otherwise "restricted")
// The writes (draft · request approval · approve · reject · publish · notes · complaint acknowledge / assign / resolve) stay
// on /pos/ai-review-reputation/* — the drafting service's state machine and safety checks.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { type RetentionContext } from '@aipowersalon/customers';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { ReputationCenter, ReputationCenterError, RC_PRESETS, RC_SOURCES, RC_RESPONSE, RC_COMPLAINT, RC_REVIEW_DATES, RC_APPROVAL_STATES, RC_COMPLAINT_STATES, RC_REQUEST_STATES } from './reputation-center';

export const REPUTATION_CENTER = 'ReputationCenter';
export const RC_EMPTY_BODY: BodySchema = S.object({});
const VIEW = 'pos.ai_review_reputation.view';

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
const can = (ctx: RetentionContext, perm: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], perm);
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ReputationCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const PERIOD = { preset: { type: 'enum', values: RC_PRESETS }, source: { type: 'enum', values: RC_SOURCES }, branch: { type: 'text', maxLength: 40 } } as const;
const SUMMARY = { filters: PERIOD, search: false, dateRange: { maxDays: 3660 } } as const;
const REVIEWS = { filters: { ...PERIOD, rating: { type: 'text', maxLength: 1 }, response: { type: 'enum', values: RC_RESPONSE }, complaint: { type: 'enum', values: RC_COMPLAINT }, dateField: { type: 'enum', values: RC_REVIEW_DATES } },
  sorts: { newest: null, oldest: null, rating_low: null, rating_high: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const APPROVALS = { filters: { state: { type: 'enum', values: RC_APPROVAL_STATES }, branch: { type: 'text', maxLength: 40 } }, sorts: { newest: null }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const COMPLAINTS = { filters: { ...PERIOD, state: { type: 'enum', values: RC_COMPLAINT_STATES }, severity: { type: 'text', maxLength: 20 } }, sorts: { newest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const TRENDS = { filters: { source: { type: 'enum', values: RC_SOURCES }, branch: { type: 'text', maxLength: 40 }, months: { type: 'text', maxLength: 2 } }, search: false } as const;
const REQUESTS = { filters: { ...PERIOD, state: { type: 'enum', values: RC_REQUEST_STATES } }, sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage('ai_review_reputation_assistant')
@Controller('pos/reputation')
export class ReputationCenterController {
  constructor(@Inject(REPUTATION_CENTER) private readonly rc: ReputationCenter | null) {}
  private r(): ReputationCenter { if (!this.rc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Review & Reputation needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rc; }

  @Get('summary') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(SUMMARY)
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().summary(c, f ?? {})); }

  @Get('reviews') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(REVIEWS)
  reviews(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().reviews(c, f ?? {})); }

  @Get('reviews/:id') @RequirePermission('pos.ai_review_reputation.view')
  review(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().review(c, id, { customerAccess: can(c, 'customers.view') })); }

  @Get('approvals') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(APPROVALS)
  approvals(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().approvals(c, f ?? {})); }

  @Get('complaints') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(COMPLAINTS)
  complaints(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().complaints(c, f ?? {})); }

  @Get('trends') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(TRENDS)
  trends(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().trends(c, f ?? {})); }

  @Get('branches') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(SUMMARY)
  branches(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().branches(c, f ?? {})); }

  @Get('requests') @RequirePermission('pos.ai_review_reputation.view') @ListQuery(REQUESTS)
  requests(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().requests(c, f ?? {})); }

  @Get('integrations') @RequirePermission('pos.ai_review_reputation.view')
  integrations(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().integrations(c)); }

  /** Check Reputation System — read-only */
  @Post('check') @RequirePermission('pos.ai_review_reputation.view')
  check(@Req() q: any, @Body(ValidatedBody(RC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
