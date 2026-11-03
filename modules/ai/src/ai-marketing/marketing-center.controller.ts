// marketing-center.controller.ts — AI Marketing Assistant family guides (Nov 3 2026): `/pos/ai-marketing/center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch from req.ctx, never the client.
//   pos.marketing.view    summary · recommendations · eligibility · estimate · check
//   pos.marketing.manage  save-draft (an UNSENT audience + an UNAPPROVED Campaign Center draft)
// Nothing here sends, schedules or approves a campaign — that stays in Campaign Center.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { MarketingCenter, MarketingCenterError, MKC_PRESETS, type McCtx } from './marketing-center';

export const MARKETING_CENTER = 'MarketingCenter';
const str = (max: number): BodySchema => S.nullable(S.string({ maxLength: max }));
export const MKC_EMPTY_BODY: BodySchema = S.object({});
export const MKC_ELIGIBILITY_BODY: BodySchema = S.object({ kind: str(20), channel: str(10) });
export const MKC_ESTIMATE_BODY: BodySchema = S.object({ channel: str(10), body: str(1600), recipients: S.nullable(S.integer({ minimum: 0, maximum: 1000000 })), budgetCents: S.nullable(S.cents()) });
export const MKC_SAVE_BODY: BodySchema = S.object({ kind: str(20), channel: str(10), name: str(120), message: str(1600), subject: str(200), budgetCents: S.nullable(S.cents()), idempotencyKey: str(100) });
function ctxFrom(req: any): McCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function authed(ctx: McCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof MarketingCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    // the Retention / Segments / Campaign Center refusals carry their own code and status
    if (e && typeof e.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.code) && e.name !== 'HttpException') throw new HttpException({ code: e.code, message: String(e.message ?? '') }, Number(e.status) || HttpStatus.BAD_REQUEST);
    throw e;
  }
}
const SUMMARY = { filters: { preset: { type: 'enum', values: MKC_PRESETS } }, dateRange: { maxDays: 3660 } } as const;
const RECS = { filters: { channel: { type: 'enum', values: ['sms', 'email'] } } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-marketing/center')
export class MarketingCenterController {
  constructor(@Inject(MARKETING_CENTER) private readonly mc: MarketingCenter | null) {}
  private c(): MarketingCenter { if (!this.mc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Marketing needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.mc; }

  /** the seven cards (period in salon time), Reach & Consent, budget vs money spent */
  @Get('summary') @RequirePermission('pos.marketing.view') @ListQuery(SUMMARY)
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c, f ?? {})); }

  /** rebooking · win-back · birthday — evaluated now from the Retention rule and the Segments consent verdict */
  @Get('recommendations') @RequirePermission('pos.marketing.view') @ListQuery(RECS)
  recommendations(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().recommendations(c, f ?? {})); }

  /** the eligibility funnel for one goal: matched → each exclusion reason → eligible (per channel; unique people for both) */
  @Post('eligibility') @RequirePermission('pos.marketing.view')
  eligibility(@Req() q: any, @Body(ValidatedBody(MKC_ELIGIBILITY_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().eligibility(c, b ?? {})); }

  /** characters · encoding · segments · platform price · estimated cost · within budget */
  @Post('estimate') @RequirePermission('pos.marketing.view')
  estimate(@Req() q: any, @Body(ValidatedBody(MKC_ESTIMATE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().estimate(c, b ?? {})); }

  /** save a rebooking / win-back recommendation as an unsent audience + an unapproved Campaign Center draft */
  @Post('save-draft') @RequirePermission('pos.marketing.manage')
  saveDraft(@Req() q: any, @Body(ValidatedBody(MKC_SAVE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().saveDraft(c, b ?? {})); }

  /** Check AI Marketing System — read-only */
  @Post('check') @RequirePermission('pos.marketing.view')
  check(@Req() q: any, @Body(ValidatedBody(MKC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c)); }
}
