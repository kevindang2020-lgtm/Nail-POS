// reputation-settings-center.controller.ts — Review & Reputation Settings guide (Nov 1 2026): `/pos/reputation-settings/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_review_reputation.view     state · history · history/:id · check
//   pos.ai_review_reputation.manage   save (the existing manage permission of the retired PUT /pos/ai-review-reputation/settings)
// Deliberately NOT behind the AI package gate: an unpaid or disabled salon must still see WHY the assistant is blocked.
// No route here publishes, approves, sends a message, charges or changes a subscription.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { ReputationSettingsCenter, ReputationSettingsError, RSS_EVENT_TYPES, RSS_PRESETS, RSS_TONES, RSS_CHANNELS, RSS_DELAY } from './reputation-settings-center';

export const REPUTATION_SETTINGS_CENTER = 'ReputationSettingsCenter';
export const RSS_EMPTY_BODY: BodySchema = S.object({});
const VALUES = S.object({ enabled: S.boolean(), responseTone: S.enumOf([...RSS_TONES]), approvalRequired: S.boolean(), autoResponse: S.boolean(), requestsEnabled: S.boolean(),
  channel: S.enumOf([...RSS_CHANNELS]), delayMinutes: S.integer({ minimum: RSS_DELAY.min, maximum: RSS_DELAY.max }), oneReminder: S.boolean() });
export const RSS_SAVE_BODY: BodySchema = S.object({ values: VALUES, expectedVersion: S.integer({ minimum: 0 }), reason: S.text(500) }, ['values', 'expectedVersion']);
const VIEW = 'pos.ai_review_reputation.view';
const MANAGE = 'pos.ai_review_reputation.manage';

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
    if (e instanceof ReputationSettingsError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const HISTORY = { filters: { type: { type: 'enum', values: RSS_EVENT_TYPES }, preset: { type: 'enum', values: RSS_PRESETS } }, search: { maxLength: 80 },
  sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/reputation-settings')
export class ReputationSettingsCenterController {
  constructor(@Inject(REPUTATION_SETTINGS_CENTER) private readonly rss: ReputationSettingsCenter | null) {}
  private r(): ReputationSettingsCenter { if (!this.rss) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Reputation Settings needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rss; }

  /** the eight controls with their effective values and sources, the assistant's operational state, what actually runs */
  @Get('state') @RequirePermission('pos.ai_review_reputation.view')
  state(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().state(c)); }

  /** Save Changes — salon level; validated, conflict-checked, version-checked; history + audit in the same transaction */
  @Post('save') @RequirePermission('pos.ai_review_reputation.manage')
  save(@Req() q: any, @Body(ValidatedBody(RSS_SAVE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW, MANAGE);
    return run(() => this.r().save(c, b ?? {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'ai', action: 'reputation_settings.changed', resourceType: 'tenant_ai_reputation_settings',
      resourceId: c.tenantId, summary: 'Review & Reputation settings changed for this salon', metadata: meta })));
  }

  /** settings history: search · type · date presets / range · pages (newest first) */
  @Get('history') @RequirePermission('pos.ai_review_reputation.view')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().history(c, f ?? {})); }

  /** one change: before / after per control, actor, role, version, reason, what used it since */
  @Get('history/:id') @RequirePermission('pos.ai_review_reputation.view')
  event(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().event(c, id)); }

  /** Check Reputation Settings — read-only */
  @Post('check') @RequirePermission('pos.ai_review_reputation.view')
  check(@Req() q: any, @Body(ValidatedBody(RSS_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
