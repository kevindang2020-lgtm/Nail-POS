// customer-ai-settings-center.controller.ts — Customer AI Settings guide (Nov 1 2026): `/pos/customer-ai-settings/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_customer_profile.view    state · history · history/:id · preview · check
//   pos.ai_customer_profile.churn   assistant (Disable / Enable for this salon) · thresholds (change / reset) — the existing
//                                   manage permission of the old PUT /pos/ai-customer-profile/settings/:level, which this replaces
// Writes are salon-level only, version-checked, recorded in append-only history and audited fail-closed. No route here books,
// texts, bills, changes a subscription or reaches another salon.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { CustomerAiSettingsCenter, CustomerAiSettingsError, CAS_EVENT_TYPES, CAS_PRESETS } from './customer-ai-settings-center';

export const CUSTOMER_AI_SETTINGS_CENTER = 'CustomerAiSettingsCenter';
export const CAS_EMPTY_BODY: BodySchema = S.object({});
export const CAS_ASSISTANT_BODY: BodySchema = S.object({ enabled: S.boolean(), expectedVersion: S.integer({ minimum: 0 }), reason: S.text(500) }, ['enabled', 'expectedVersion']);
const VALUES = S.object({ minVisitsForServicePref: S.integer({ minimum: 1, maximum: 20 }), minVisitsForTechPref: S.integer({ minimum: 1, maximum: 20 }), minVisitsForCadence: S.integer({ minimum: 2, maximum: 20 }),
  inactiveDays: S.integer({ minimum: 14, maximum: 730 }), longTermInactiveDays: S.integer({ minimum: 30, maximum: 1095 }) });
export const CAS_THRESHOLDS_BODY: BodySchema = S.object({ values: VALUES, reset: S.boolean(), expectedVersion: S.integer({ minimum: 0 }), reason: S.text(500) }, ['expectedVersion']);
export const CAS_PREVIEW_BODY: BodySchema = S.object({ values: VALUES }, ['values']);
const VIEW = 'pos.ai_customer_profile.view';
const MANAGE = 'pos.ai_customer_profile.churn';

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof CustomerAiSettingsError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const HISTORY = { filters: { type: { type: 'enum', values: CAS_EVENT_TYPES }, preset: { type: 'enum', values: CAS_PRESETS } }, search: { maxLength: 80 },
  sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-ai-settings')
export class CustomerAiSettingsCenterController {
  constructor(@Inject(CUSTOMER_AI_SETTINGS_CENTER) private readonly cas: CustomerAiSettingsCenter | null) {}
  private r(): CustomerAiSettingsCenter { if (!this.cas) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer AI Settings needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cas; }
  private audit(c: RetentionContext, action: string, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'ai', action, resourceType: 'ai_customer_profile_settings', resourceId: c.tenantId, summary, metadata: meta });
  }

  /** effective values + provenance, the assistant's operational state (salon / branch / user / package / subscription), propagation */
  @Get('state') @RequirePermission('pos.ai_customer_profile.view')
  state(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().state(c)); }

  /** Disable / Enable for this salon — version-checked, history + audit */
  @Post('assistant') @RequirePermission('pos.ai_customer_profile.churn')
  assistant(@Req() q: any, @Body(ValidatedBody(CAS_ASSISTANT_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW, MANAGE);
    return run(() => this.r().setAssistant(c, b ?? {}, this.audit(c, b?.enabled ? 'customer_ai_settings.enabled' : 'customer_ai_settings.disabled', 'Customer AI assistant switched for this salon')));
  }

  /** change or reset the salon's thresholds — validated, ordered, version-checked, history + audit */
  @Post('thresholds') @RequirePermission('pos.ai_customer_profile.churn')
  thresholds(@Req() q: any, @Body(ValidatedBody(CAS_THRESHOLDS_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW, MANAGE);
    return run(() => this.r().setThresholds(c, b ?? {}, this.audit(c, 'customer_ai_settings.thresholds_changed', 'Customer AI thresholds changed for this salon')));
  }

  /** read-only estimate of the customers a proposed value moves across a boundary */
  @Post('preview') @RequirePermission('pos.ai_customer_profile.view')
  preview(@Req() q: any, @Body(ValidatedBody(CAS_PREVIEW_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().preview(c, b ?? {})); }

  /** change history: search · type · date presets / range · pages (newest first) */
  @Get('history') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().history(c, f ?? {})); }

  /** one change: before / after, actor, version and whether the evaluations picked it up */
  @Get('history/:id') @RequirePermission('pos.ai_customer_profile.view')
  event(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().event(c, id)); }

  /** Check Customer AI System — read-only */
  @Post('check') @RequirePermission('pos.ai_customer_profile.view')
  check(@Req() q: any, @Body(ValidatedBody(CAS_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
