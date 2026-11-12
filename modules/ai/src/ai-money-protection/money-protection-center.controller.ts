// money-protection-center.controller.ts — the six AI Money Protection guides (Nov 3 2026): `/pos/money-protection-center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from req.ctx. Permissions (re-checked in the center):
//   ai_money_protection.view           summary · investigations · investigations/timeline · rules · settings/history · detection/runs · check
//   ai_money_protection.view_alerts    alerts · alerts/detail
//   ai_money_protection.investigate    alerts/action (acknowledge · dismiss · reopen — reason; never about your own activity)
//   ai_money_protection.manage_settings rules/save (reason to turn a rule off or lower it; stale edits refused; dryRun = read-only preview)
//   ai_money_protection.manage_rules   detection/run (one recorded pass; once per 2 minutes)
// Nothing here moves money: no charge, refund, reversal, settlement or write-off.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { MoneyProtectionCenter, MoneyCenterError, MC_ALERT_GROUPS, MC_SEVERITIES, MC_CATEGORIES, MC_ALERT_DATES, MC_INV_STATUS, MC_INV_DATES, MC_PRESETS, type McCtx } from './money-protection-center';

export const MONEY_PROTECTION_CENTER = 'MoneyProtectionCenter';
const str = (max: number): BodySchema => S.nullable(S.string({ maxLength: max }));
export const MC_EMPTY_BODY: BodySchema = S.object({});
export const MC_ACTION_BODY: BodySchema = S.object({ id: str(64), action: str(20), reason: str(1000), expectedStatus: str(40) });
export const MC_RULE_BODY: BodySchema = S.object({ ruleId: str(64), enabled: S.nullable(S.boolean()), severityOverride: str(16), thresholds: S.nullable(S.bounded(S.freeObject(), 2, 40)),
  reason: str(1000), expectedUpdatedAt: str(40), dryRun: S.nullable(S.boolean()) });
function ctxFrom(req: any): McCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: McCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof MoneyCenterError) throw new HttpException({ code: e.code, message: e.message, ...e.extra }, e.status); throw e; }
}
const ALERTS = { filters: { status: { type: 'enum', values: MC_ALERT_GROUPS }, severity: { type: 'enum', values: MC_SEVERITIES }, category: { type: 'enum', values: MC_CATEGORIES },
  rule: { type: 'text' }, dateField: { type: 'enum', values: MC_ALERT_DATES }, preset: { type: 'enum', values: MC_PRESETS } },
  search: { maxLength: 80 }, sorts: { newest: null, oldest: null, severity: null, value: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const INVS = { filters: { status: { type: 'enum', values: MC_INV_STATUS }, severity: { type: 'enum', values: MC_SEVERITIES }, dateField: { type: 'enum', values: MC_INV_DATES }, preset: { type: 'enum', values: MC_PRESETS } },
  search: { maxLength: 80 }, sorts: { updated: null, newest: null, oldest: null, severity: null, value: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const PAGED = { filters: { preset: { type: 'enum', values: MC_PRESETS } }, search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/money-protection-center')
export class MoneyProtectionCenterController {
  constructor(@Inject(MONEY_PROTECTION_CENTER) private readonly mc: MoneyProtectionCenter | null) {}
  private c(): MoneyProtectionCenter { if (!this.mc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Money Protection needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.mc; }

  /** the overview cards, the last detection run, whether detection is scheduled */
  @Get('summary') @RequirePermission('ai_money_protection.view')
  summary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c)); }

  /** alerts: search · status group · severity · category · rule · which date · presets / range · sort · numbered pages */
  @Get('alerts') @RequirePermission('ai_money_protection.view_alerts') @ListQuery(ALERTS)
  alerts(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alerts(c, f ?? {})); }

  /** one alert: evidence, the source records it points at, its history */
  @Get('alerts/detail') @RequirePermission('ai_money_protection.view_alerts') @ListQuery({ maxLimit: 1, defaultLimit: 1, params: ['id'] } as const)
  alert(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alert(c, String(f?.id ?? ''))); }

  /** acknowledge · dismiss · reopen (append-only, audited) */
  @Post('alerts/action') @RequirePermission('ai_money_protection.view_alerts')
  alertAction(@Req() q: any, @Body(ValidatedBody(MC_ACTION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertAction(c, String(b?.id ?? ''), b ?? {})); }

  @Get('investigations') @RequirePermission('ai_money_protection.view') @ListQuery(INVS)
  investigations(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().investigations(c, f ?? {})); }

  /** an investigation's timeline: notes + every recorded decision, newest first; its linked alerts */
  @Get('investigations/timeline') @RequirePermission('ai_money_protection.view') @ListQuery({ maxLimit: 1, defaultLimit: 1, params: ['id'] } as const)
  timeline(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().investigationTimeline(c, String(f?.id ?? ''))); }

  @Get('rules') @RequirePermission('ai_money_protection.view')
  rules(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().rules(c)); }

  @Post('rules/save') @RequirePermission('ai_money_protection.view')
  saveRule(@Req() q: any, @Body(ValidatedBody(MC_RULE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().saveRule(c, String(b?.ruleId ?? ''), b ?? {})); }

  @Get('settings/history') @RequirePermission('ai_money_protection.view') @ListQuery(PAGED)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().settingsHistory(c, f ?? {})); }

  @Get('detection/runs') @RequirePermission('ai_money_protection.view') @ListQuery(PAGED)
  runs(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().detectionRuns(c, f ?? {})); }

  /** Run detection now — one recorded pass over all three layers */
  @Post('detection/run') @RequirePermission('ai_money_protection.view')
  detect(@Req() q: any, @Body(ValidatedBody(MC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().runDetection(c, 'manual')); }

  /** Check AI Money Protection System — read-only */
  @Post('check') @RequirePermission('ai_money_protection.view')
  check(@Req() q: any, @Body(ValidatedBody(MC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c)); }
}
