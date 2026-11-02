// campaign-center.controller.ts — HTTP surface of campaign-center.ts (Campaign Center Complete Build Guide, 739).
// Tenant and branch come ONLY from the session (req.ctx); bodies are strict; the guards check the permission and every
// service method checks it again. Nothing here sends a message: Launch moves an approved campaign to 'scheduled' and the
// existing send sweep does the rest.
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { CC_ASSISTANT_DRAFT_BODY, CC_ASSISTANT_SUGGEST_BODY, CC_AUDIENCE_BODY, CC_DRAFT_CREATE_BODY, CC_DRAFT_UPDATE_BODY, CC_HEALTH_BODY, CC_LAUNCH_BODY, EMPTY_BODY } from '../request-schemas';
import { asHttp, type CampaignCenter, CC_CHANNELS, CC_DATE_BASES, CC_SORTS, CC_STATUSES, CC_RECIPIENT_STATUSES } from './campaign-center';
import type { CampaignsContext } from './campaigns.repository';

export const CAMPAIGN_CENTER = 'CAMPAIGN_CENTER';
function ctxOf(req: any): CampaignsContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { return asHttp(e); } }

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const LIST_SPEC = {
  filters: { preset: PRESET, status: { type: 'enum', values: CC_STATUSES }, channel: { type: 'enum', values: CC_CHANNELS }, basis: { type: 'enum', values: CC_DATE_BASES }, branchId: { type: 'uuid' } },
  sort: { allowed: CC_SORTS, default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const OVERVIEW_SPEC = { filters: { preset: PRESET, channel: { type: 'enum', values: CC_CHANNELS }, basis: { type: 'enum', values: CC_DATE_BASES } }, dateRange: { maxDays: 3700 } } as const;
const RECIPIENT_SEARCH_SPEC = { filters: { preset: PRESET, campaignId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const RECIPIENTS_SPEC = { filters: { status: { type: 'enum', values: CC_RECIPIENT_STATUSES } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const EVENTS_SPEC = { maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const SOURCES_SPEC = { filters: { channel: { type: 'enum', values: CC_CHANNELS } }, maxLimit: 20, defaultLimit: 20 } as const;
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('marketing')
@Controller('pos/campaign-center')
export class CampaignCenterController {
  private readonly center: CampaignCenter | null;
  constructor(@Optional() @Inject(CAMPAIGN_CENTER) center: CampaignCenter | null) { this.center = center; }
  private c(): CampaignCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'CAMPAIGNS_NOT_AVAILABLE', message: 'Campaign Center is not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'CAMPAIGNS_NOT_AVAILABLE');
    return this.center;
  }

  @Get('overview') @RequirePermission('pos.marketing.view') @ListQuery(OVERVIEW_SPEC)
  overview(@Req() r: any, @Query() q: any) { return run(() => this.c().overview(ctxOf(r), { preset: s(q?.preset), from: s(q?.from), to: s(q?.to), channel: s(q?.channel), basis: s(q?.basis) })); }

  @Get('campaigns') @RequirePermission('pos.marketing.view') @ListQuery(LIST_SPEC)
  list(@Req() r: any, @Query() q: any) { return run(() => this.c().list(ctxOf(r), { q: s(q?.q), status: s(q?.status), channel: s(q?.channel), basis: s(q?.basis), branchId: s(q?.branchId), sort: s(q?.sort), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize })); }

  @Get('recipients') @RequirePermission('pos.marketing.view') @ListQuery(RECIPIENT_SEARCH_SPEC)
  searchRecipients(@Req() r: any, @Query() q: any) { return run(() => this.c().searchRecipients(ctxOf(r), { q: s(q?.q), campaignId: s(q?.campaignId), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize })); }

  @Get('audience-sources') @RequirePermission('pos.marketing.view') @ListQuery(SOURCES_SPEC)
  sources(@Req() r: any, @Query() q: any) { return run(() => this.c().audienceSources(ctxOf(r), String(s(q?.channel) ?? 'sms'))); }

  @Post('health-check') @RequirePermission('pos.marketing.view')
  health(@Req() r: any, @Body(ValidatedBody(CC_HEALTH_BODY, { strict: true })) b: any) { return run(() => this.c().healthCheck(ctxOf(r), b || {})); }

  @Post('assistant/suggest') @RequirePermission('pos.marketing.view')
  suggest(@Req() r: any, @Body(ValidatedBody(CC_ASSISTANT_SUGGEST_BODY, { strict: true })) b: any) { return run(() => this.c().assistantSuggest(ctxOf(r), String(b?.goal ?? ''))); }

  @Post('assistant/draft') @RequirePermission('pos.marketing.manage')
  assistantDraft(@Req() r: any, @Body(ValidatedBody(CC_ASSISTANT_DRAFT_BODY, { strict: true })) b: any) { return run(() => this.c().assistantSaveDraft(ctxOf(r), b || {})); }

  @Post('campaigns') @RequirePermission('pos.marketing.manage')
  create(@Req() r: any, @Body(ValidatedBody(CC_DRAFT_CREATE_BODY, { strict: true })) b: any) { return run(() => this.c().createDraft(ctxOf(r), b || {})); }

  @Get('campaigns/:id') @RequirePermission('pos.marketing.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Patch('campaigns/:id') @RequirePermission('pos.marketing.manage')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CC_DRAFT_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.c().updateDraft(ctxOf(r), id, b || {})); }

  @Get('campaigns/:id/recipients') @RequirePermission('pos.marketing.view') @ListQuery(RECIPIENTS_SPEC)
  recipients(@Req() r: any, @Param('id') id: string, @Query() q: any) { return run(() => this.c().recipients(ctxOf(r), id, { q: s(q?.q), status: s(q?.status), page: q?.page, pageSize: q?.pageSize })); }

  @Get('campaigns/:id/events') @RequirePermission('pos.marketing.view') @ListQuery(EVENTS_SPEC)
  events(@Req() r: any, @Param('id') id: string, @Query() q: any) { return run(() => this.c().events(ctxOf(r), id, { page: q?.page, pageSize: q?.pageSize })); }

  @Get('campaigns/:id/audit') @RequirePermission('pos.marketing.view')
  audit(@Req() r: any, @Param('id') id: string) { return run(() => this.c().audit(ctxOf(r), id)); }

  @Post('campaigns/:id/audience') @RequirePermission('pos.marketing.manage')
  audience(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CC_AUDIENCE_BODY, { strict: true })) b: any) { return run(() => this.c().setAudience(ctxOf(r), id, b || {})); }

  @Post('campaigns/:id/preview') @RequirePermission('pos.marketing.view')
  preview(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().preview(ctxOf(r), id)); }

  @Post('campaigns/:id/submit') @RequirePermission('pos.marketing.manage')
  submit(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().submit(ctxOf(r), id)); }

  @Post('campaigns/:id/approve') @RequirePermission('pos.marketing.manage')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().approve(ctxOf(r), id)); }

  @Post('campaigns/:id/launch') @RequirePermission('pos.marketing.manage')
  launch(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CC_LAUNCH_BODY, { strict: true })) b: any) { return run(() => this.c().launch(ctxOf(r), id, b || {})); }

  @Post('campaigns/:id/unschedule') @RequirePermission('pos.marketing.manage')
  unschedule(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().unschedule(ctxOf(r), id)); }

  @Post('campaigns/:id/duplicate') @RequirePermission('pos.marketing.manage')
  duplicate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().duplicate(ctxOf(r), id)); }
}
