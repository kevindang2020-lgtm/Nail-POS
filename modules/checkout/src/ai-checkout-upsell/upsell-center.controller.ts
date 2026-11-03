// upsell-center.controller.ts — Checkout Upsell Assistant Settings guide (Nov 2 2026): `/pos/ai-checkout-upsell/center/*`, the
// settings page's read side. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the session (req.ctx).
//   pos.ai_checkout_upsell.view   summary · activity · history · check
// Not behind the AI package gate on purpose: when the subscription lapses the page must SAY so (and keep its history readable)
// instead of answering 403. Settings are saved on PUT settings/:level (merged, versioned, history-backed); nothing here writes.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { UpsellCenter, UpsellCenterError, UC_TYPES, UC_STATUSES, UC_PRESETS, type UcCtx } from './upsell-center';

export const UPSELL_CENTER = 'UpsellCenter';
export const UC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): UcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: UcCtx) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.ai_checkout_upsell.view')) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof UpsellCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const ACTIVITY = { filters: { preset: { type: 'enum', values: UC_PRESETS }, type: { type: 'enum', values: UC_TYPES }, status: { type: 'enum', values: UC_STATUSES } },
  search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const HISTORY = { filters: { preset: { type: 'enum', values: UC_PRESETS } }, search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-checkout-upsell/center')
export class UpsellCenterController {
  constructor(@Inject(UPSELL_CENTER) private readonly uc: UpsellCenter | null) {}
  private c(): UpsellCenter { if (!this.uc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The upsell assistant needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.uc; }

  /** the status row: effective state + why, subscription, the seven categories (and whether each is connected), the limits, counts */
  @Get('summary') @RequirePermission('pos.ai_checkout_upsell.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c); return run(() => this.c().summary(c)); }

  /** Suggestion Activity: search · category · status · presets / range · numbered pages (newest first) */
  @Get('activity') @RequirePermission('pos.ai_checkout_upsell.view') @ListQuery(ACTIVITY)
  activity(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.c().activity(c, f ?? {})); }

  /** Settings History: every save, before → after, newest first */
  @Get('history') @RequirePermission('pos.ai_checkout_upsell.view') @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.c().history(c, f ?? {})); }

  /** Check Checkout Upsell System — read-only */
  @Post('check') @RequirePermission('pos.ai_checkout_upsell.view')
  check(@Req() q: any, @Body(ValidatedBody(UC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c); return run(() => this.c().check(c)); }
}
