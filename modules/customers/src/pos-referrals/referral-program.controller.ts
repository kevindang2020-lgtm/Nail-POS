// referral-program.controller.ts — Referral Program guide (Oct 30 2026): `/pos/referral-program/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   pos.marketing.view                         summary · referrals · approvals · referrals/:id · codes · health · settings · check
//   + pos.customers.view                       the overlay shows full phone / email (otherwise masked); the open is audited
//   pos.marketing.manage                       record · review (approve / reject / investigate) · issue retry · reverse · code status ·
//                                              policy · assistant (an UNSENT audience only — Campaign Center sends after approval)
// Every manager action and every sensitive read writes an audit row in the same transaction (fail-closed).
import { ListQuery } from '@aipowersalon/database';
import type { ReferralHealthRun, ReferralHealthResult, ReferralFilterOptions } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { SegmentsError } from '../segments/segments.repository';
import { ReferralProgram, RP_RISK_FILTER, ReferralProgramError, RP_TABS, RP_SORTS, RP_BASES, RP_PRESETS, RP_REWARD_TYPES, RP_GOALS, RP_REVIEW_ACTIONS } from './referral-program';

export const REFERRAL_PROGRAM = 'ReferralProgram';

const txt = (max: number): BodySchema => S.nullable(S.text(max));
export const RP_CHECK_BODY: BodySchema = S.object({ code: S.text(40), referredCustomerId: S.nullable(S.uuid()) }, ['code']);
export const RP_RECORD_BODY: BodySchema = S.object({ code: S.text(40), referredCustomerId: S.uuid(), idempotencyKey: S.text(120) }, ['code', 'referredCustomerId', 'idempotencyKey']);
export const RP_REVIEW_BODY: BodySchema = S.object({ action: S.enumOf([...RP_REVIEW_ACTIONS]), reason: txt(500), expectedVersion: S.nullable(S.integer()) }, ['action']);
export const RP_REASON_BODY: BodySchema = S.object({ reason: S.text(500) }, ['reason']);
export const RP_CODE_STATUS_BODY: BodySchema = S.object({ status: S.enumOf(['active', 'disabled']), reason: txt(300), expectedVersion: S.integer() }, ['status', 'expectedVersion']);
export const RP_SETTINGS_BODY: BodySchema = S.object({
  enabled: S.nullable(S.boolean()), rewardType: S.nullable(S.enumOf([...RP_REWARD_TYPES])), rewardPoints: S.nullable(S.integer()), rewardCents: S.nullable(S.integer()),
  requiresApproval: S.nullable(S.boolean()), separationOfDuties: S.nullable(S.boolean()), minQualifyingSpendCents: S.nullable(S.integer()), qualificationWindowDays: S.nullable(S.integer()),
  recordGraceHours: S.nullable(S.integer()), expectedVersion: S.integer(),
  // Refer a Friend build (Nov 5 2026): two-sided salon vouchers + the hard campaign budget
  friendRewardCents: S.nullable(S.integer()), referrerRewardCents: S.nullable(S.integer()), voucherMinSpendCents: S.nullable(S.integer()), voucherExpiryDays: S.nullable(S.integer()),
  budgetTotalCents: S.nullable(S.integer()), budgetMonthlyCents: S.nullable(S.integer()), perReferrerCap: S.nullable(S.integer()), budgetWarnPercent: S.nullable(S.integer()),
}, ['expectedVersion']);
export const RP_ASSIST_BODY: BodySchema = S.object({ goal: S.enumOf([...RP_GOALS]), channel: S.nullable(S.enumOf(['sms', 'email'])), budgetCents: S.nullable(S.integer()) }, ['goal']);
export const RP_ASSIST_SAVE_BODY: BodySchema = S.object({ goal: S.enumOf([...RP_GOALS]), channel: S.nullable(S.enumOf(['sms', 'email'])), message: txt(1000), idempotencyKey: S.text(120) }, ['goal', 'idempotencyKey']);

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
    if (e instanceof ReferralProgramError || e instanceof SegmentsError) throw new HttpException({ code: e.code, message: e.message, details: (e as ReferralProgramError).details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: { tab: { type: 'enum', values: RP_TABS }, basis: { type: 'enum', values: RP_BASES }, preset: { type: 'enum', values: RP_PRESETS }, rewardType: { type: 'enum', values: RP_REWARD_TYPES },
    branch: { type: 'text', maxLength: 40 }, eligibility: { type: 'enum', values: RP_RISK_FILTER }, creator: { type: 'uuid' }, reviewer: { type: 'uuid' } },
  sorts: { newest: null, oldest: null, name_asc: null, name_desc: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/referral-program')
export class ReferralProgramController {
  constructor(@Inject(REFERRAL_PROGRAM) private readonly rp: ReferralProgram | null) {}
  private r(): ReferralProgram { if (!this.rp) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The Referral Program needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rp; }
  private audit(c: RetentionContext, action: string, resourceType: string, resourceId: string | null, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'marketing', action, resourceType, resourceId, summary, metadata: meta });
  }

  /** the KPI row — every number reconciles to source rows (guide §15) */
  @Get('summary') @RequirePermission('pos.marketing.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().summary(c)); }

  /** Referral History: tab · search (code / names / phone / email / IDs / ticket / booking / reward) · reward type · date basis + range · sort · pages 10/20/50 */
  @Get('referrals') @RequirePermission('pos.marketing.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().list(c, f ?? {})); }

  /** Pending Reward Reviews — oldest first (operational order, not newest-first) */
  @Get('approvals') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: {}, sorts: { oldest: null }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  approvals(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().list(c, f ?? {}, { approvals: true })); }

  /** the referral / customer / reward overlay — full contact only with pos.customers.view; the open is audited (fail-closed) */
  @Get('referrals/:id') @RequirePermission('pos.marketing.view')
  async detail(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    const showContact = hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    return run(async () => {
      const d = await this.r().detail(c, id, { full: true, showContact });
      await recordAuditStrict(this.r().db, actor(c), { module: 'marketing', action: 'referrals.referral.viewed', resourceType: 'referral', resourceId: id, summary: showContact ? 'Referral details opened (full contact)' : 'Referral details opened (masked contact)' });
      return d;
    });
  }

  /** Check Referral Eligibility — read-only; never records, issues or sends */
  @Post('check') @RequirePermission('pos.marketing.view')
  check(@Req() q: any, @Body(ValidatedBody(RP_CHECK_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().check(c, b)); }

  /** Record a Referral — ONE canonical referral; the same request again (or a racing duplicate) returns the same referral */
  @Post('referrals') @RequirePermission('pos.marketing.manage')
  record(@Req() q: any, @Body(ValidatedBody(RP_RECORD_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.manage'); return run(() => this.r().record(c, b)); }

  @Post('referrals/:id/review') @RequirePermission('pos.marketing.manage')
  review(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RP_REVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().review(c, id, b, this.audit(c, `referrals.review.${String(b?.action)}`, 'referral', id, 'Referral reviewed')));
  }

  /** retry an approved / failed reward — the same issuance key, so never a second reward */
  @Post('rewards/:id/issue') @RequirePermission('pos.marketing.manage')
  issue(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(async () => { const out = await this.r().retryIssue(c, id); await recordAuditStrict(this.r().db, actor(c), { module: 'marketing', action: 'referrals.reward.issued', resourceType: 'referral_reward', resourceId: id, summary: `Referral reward issuance retried → ${out.state}` }); return out; });
  }

  @Post('rewards/:id/reverse') @RequirePermission('pos.marketing.manage')
  reverse(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RP_REASON_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().reverse(c, id, b, this.audit(c, 'referrals.reward.reversed', 'referral_reward', id, 'Referral reward reversed')));
  }

  @Get('codes') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: {}, sorts: { newest: null }, search: { maxLength: 60 }, maxLimit: 50, defaultLimit: 20, params: ['page'] })
  codes(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().codes(c, f ?? {})); }

  @Put('codes/:id/status') @RequirePermission('pos.marketing.manage')
  codeStatus(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RP_CODE_STATUS_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().setCodeStatus(c, id, b, this.audit(c, 'referrals.code.status', 'referral_code', id, `Referral code ${String(b?.status)}`)));
  }

  /** A18 Nov 6: run the check AND record it; the last recorded run; the filter people / branches */
  @Post('health/run') @RequirePermission('pos.marketing.view')
  healthRun(@Req() q: any): Promise<ReferralHealthResult> { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().health(c, { record: true })); }
  @Get('health/last') @RequirePermission('pos.marketing.view')
  healthLast(@Req() q: any): Promise<ReferralHealthRun | null> { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().lastHealth(c)); }
  @Get('filter-options') @RequirePermission('pos.marketing.view')
  filterOptions(@Req() q: any): Promise<ReferralFilterOptions> { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().filterOptions(c)); }

  /** Check Referral System — non-mutating */
  @Get('health') @RequirePermission('pos.marketing.view')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().health(c)); }

  @Get('settings') @RequirePermission('pos.marketing.view')
  settings(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().settings(c)); }

  @Put('settings') @RequirePermission('pos.marketing.manage')
  saveSettings(@Req() q: any, @Body(ValidatedBody(RP_SETTINGS_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().saveSettings(c, b, this.audit(c, 'referrals.policy.updated', 'referral_program_settings', null, 'Referral reward policy updated')));
  }

  /** AI Referral Growth Assistant — a proposal + preview; nothing is sent */
  @Post('assistant/plan') @RequirePermission('pos.marketing.manage')
  plan(@Req() q: any, @Body(ValidatedBody(RP_ASSIST_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.manage'); return run(() => this.r().assistantPlan(c, b)); }

  /** saves an UNSENT audience for Campaign Center (approval + sending stay there) */
  @Post('assistant/save') @RequirePermission('pos.marketing.manage')
  save(@Req() q: any, @Body(ValidatedBody(RP_ASSIST_SAVE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().assistantSave(c, b, this.audit(c, 'referrals.assistant.audience_saved', 'segment_audience_draft', null, 'Referral assistant saved an unsent audience')));
  }
}
