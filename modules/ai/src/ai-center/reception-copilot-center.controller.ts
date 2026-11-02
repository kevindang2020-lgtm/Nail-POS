// reception-copilot-center.controller.ts — /pos/ai/copilot-center/* (Reception Copilot Complete Build Guide). Tenant and
// branch come from the session only; every route also needs the Reception Copilot AI package (global entitlement guard,
// honouring AI_ENTITLEMENT_ENFORCEMENT). Prepare has no side effect; confirm runs through the existing action spine.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { RequiresAiPackage, EnforceAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { ReceptionCopilotCenter, CopilotCenterError, COPILOT_CENTER, CC_PACKAGE, CC_SCOPES, CC_STATES, CC_ACTION_TYPES, CC_PERIODS, type CcCtx } from './reception-copilot-center';
import type { CopilotAction } from './reception-copilot-action.service';

const ACTION_SCHEMA = S.object({
  type: S.enumOf([...CC_ACTION_TYPES]),
  appointmentId: S.nullable(S.text(64)), reason: S.nullable(S.text(500)), startTime: S.nullable(S.text(8)), date: S.nullable(S.text(10)), technicianId: S.nullable(S.text(64)),
  customerName: S.nullable(S.text(120)), customerId: S.nullable(S.text(64)), customerPhone: S.nullable(S.text(32)), serviceIds: S.nullable(S.array(S.text(64), { maxItems: 20 })), holdToken: S.nullable(S.text(2000)),
  to: S.nullable(S.text(32)), body: S.nullable(S.text(640)),
}, ['type']);
export const CC_PREPARE_BODY: BodySchema = S.object({ action: ACTION_SCHEMA }, ['action']);
export const CC_CONFIRM_BODY: BodySchema = S.object({ action: ACTION_SCHEMA, token: S.text(2000) }, ['action', 'token']);

function ctxFrom(req: any): CcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: CcCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof CopilotCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
/** null fields from the strict body schema are dropped so the action matches what the spine expects */
function actionFrom(b: any): CopilotAction {
  const a = b?.action ?? {};
  return Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined)) as unknown as CopilotAction;
}
const ACTIVITY_LIST = {
  filters: { state: { type: 'enum', values: CC_STATES }, type: { type: 'enum', values: CC_ACTION_TYPES }, period: { type: 'enum', values: CC_PERIODS } },
  sorts: { newest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const SEARCH_LIST = { filters: { scope: { type: 'enum', values: CC_SCOPES } }, sorts: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage(CC_PACKAGE)
@Controller('pos/ai/copilot-center')
export class ReceptionCopilotCenterController {
  constructor(@Inject(COPILOT_CENTER) private readonly cc: ReceptionCopilotCenter | null) {}
  private c(): ReceptionCopilotCenter { if (!this.cc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The Reception Copilot center needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cc; }

  /** live status strip with a freshness timestamp */
  @Get('overview') @RequirePermission('reception_copilot.use')
  overview(@Req() q: any) { const x = ctxFrom(q); need(x, 'reception_copilot.use'); return run(() => this.c().overview(x)); }

  /** step 1–4 of the guide's transaction pattern: re-read, validate, preview — NO side effect */
  @EnforceAiPackage() @Post('actions/prepare') @RequirePermission('reception_copilot.use')
  prepare(@Req() q: any, @Body(ValidatedBody(CC_PREPARE_BODY, { strict: true })) b: any) { const x = ctxFrom(q); need(x, 'reception_copilot.use'); return run(() => this.c().prepare(x, actionFrom(b))); }

  /** steps 5–8: explicit confirmation of the exact reviewed payload → spine → verify from the persisted record */
  @EnforceAiPackage() @Post('actions/confirm') @RequirePermission('reception_copilot.use')
  confirm(@Req() q: any, @Body(ValidatedBody(CC_CONFIRM_BODY, { strict: true })) b: any) { const x = ctxFrom(q); need(x, 'reception_copilot.use'); return run(() => this.c().confirm(x, actionFrom(b), String(b?.token ?? ''))); }

  @Get('activity') @RequirePermission('reception_copilot.use') @ListQuery(ACTIVITY_LIST)
  activity(@Req() q: any, @Query() p: any) {
    const x = ctxFrom(q); need(x, 'reception_copilot.use');
    return run(() => this.c().activity(x, { q: p?.q, state: p?.state, type: p?.type, period: p?.period, from: p?.from, to: p?.to, page: p?.page, pageSize: p?.pageSize }));
  }

  @Get('search') @RequirePermission('reception_copilot.view_customer_context') @ListQuery(SEARCH_LIST)
  search(@Req() q: any, @Query() p: any) { const x = ctxFrom(q); need(x, 'reception_copilot.view_customer_context'); return run(() => this.c().search(x, { scope: p?.scope, q: p?.q, page: p?.page, pageSize: p?.pageSize })); }

  /** Check Copilot System — read-only; sends nothing, books nothing, calls no paid AI */
  @Post('health') @RequirePermission('reception_copilot.use')
  health(@Req() q: any) { const x = ctxFrom(q); need(x, 'reception_copilot.use'); return run(() => this.c().health(x)); }

  @Get('priorities') @RequirePermission('reception_copilot.view_recommendations')
  priorities(@Req() q: any) { const x = ctxFrom(q); need(x, 'reception_copilot.view_recommendations'); return run(() => this.c().priorities(x)); }

  /** Full Customer & Reception Activity Overlay — the view itself is audited */
  @Get('customers/:id') @RequirePermission('reception_copilot.view_customer_context')
  overlay(@Req() q: any, @Param('id') id: string) { const x = ctxFrom(q); need(x, 'reception_copilot.view_customer_context'); return run(() => this.c().overlay(x, id)); }
}
