// message-templates.controller.ts — HTTP surface of message-templates.ts (Message Templates & Automation Center guide, 740).
// Tenant and branch come ONLY from the session (req.ctx); bodies are strict; the guards check the permission and every service
// method checks it again. Nothing here sends a message except POST templates/:id/test, the separate, confirmed, idempotent Test
// Send (Idempotency-Key header).
import { Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Optional, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { EMPTY_BODY, MT_BIND_BODY, MT_CREATE_BODY, MT_PREVIEW_BODY, MT_RENDER_FOR_THREAD_BODY, MT_STATUS_BODY, MT_TEST_BODY, MT_UNBIND_BODY, MT_UPDATE_BODY } from '../request-schemas';
import { asHttp, type MessageTemplatesCenter, type TemplatesContext } from './message-templates';

export const MESSAGE_TEMPLATES_CENTER = 'MESSAGE_TEMPLATES_CENTER';
function ctxOf(req: any): TemplatesContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { return asHttp(e); } }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const LIST_SPEC = {
  filters: {
    preset: PRESET, status: { type: 'enum', values: ['current', 'all', 'draft', 'active', 'inactive', 'archived'] }, channel: { type: 'enum', values: ['sms', 'email'] },
    category: { type: 'enum', values: ['booking_confirmation', 'appointment_reminder', 'reschedule_cancellation', 'customer_follow_up', 'missed_call_follow_up', 'review_request', 'birthday', 'loyalty_rewards', 'membership', 'receipt', 'promotions', 'general'] },
    basis: { type: 'enum', values: ['created', 'updated', 'last_used'] },
  },
  sort: { allowed: ['newest', 'oldest', 'name', 'updated', 'most_used'], default: 'newest' }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const USAGE_SPEC = {
  filters: {
    preset: PRESET, channel: { type: 'enum', values: ['sms', 'email'] }, status: { type: 'enum', values: ['all', 'submitted', 'delivered', 'failed', 'blocked', 'unknown', 'simulated'] },
    workflow: { type: 'enum', values: ['sms_inbox', 'appointment_reminder', 'reschedule_cancellation', 'booking_confirmation', 'end_of_day_follow_up', 'missed_call_follow_up', 'marketing_campaigns', 'membership', 'receipt', 'test_send'] },
    basis: { type: 'enum', values: ['created', 'sent', 'provider_event'] }, templateId: { type: 'text', maxLength: 80 },
  },
  search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const CONNECTIONS_SPEC = { filters: { templateId: { type: 'text', maxLength: 80 } } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/message-templates')
export class MessageTemplatesController {
  private readonly center: MessageTemplatesCenter | null;
  constructor(@Optional() @Inject(MESSAGE_TEMPLATES_CENTER) center: MessageTemplatesCenter | null) { this.center = center; }
  private c(): MessageTemplatesCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'TEMPLATES_NOT_AVAILABLE', message: 'Message templates are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'TEMPLATES_NOT_AVAILABLE');
    return this.center;
  }

  @Get('summary') @RequirePermission('pos.communications.view')
  summary(@Req() r: any) { return run(() => this.c().summary(ctxOf(r))); }

  @Get('templates') @RequirePermission('pos.communications.view') @ListQuery(LIST_SPEC)
  list(@Req() r: any, @Query() q: any) {
    return run(() => this.c().list(ctxOf(r), { q: s(q?.q), channel: s(q?.channel), status: s(q?.status), category: s(q?.category), basis: s(q?.basis), sort: s(q?.sort), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize }));
  }

  @Post('templates') @RequirePermission('pos.communications.manage')
  create(@Req() r: any, @Body(ValidatedBody(MT_CREATE_BODY, { strict: true })) b: any) { return run(() => this.c().create(ctxOf(r), b || {})); }

  @Get('templates/:id') @RequirePermission('pos.communications.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }

  @Patch('templates/:id') @RequirePermission('pos.communications.manage')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MT_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.c().update(ctxOf(r), id, b || {})); }

  @Post('templates/:id/duplicate') @RequirePermission('pos.communications.manage')
  duplicate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().duplicate(ctxOf(r), id)); }

  @Post('templates/:id/status') @RequirePermission('pos.communications.manage')
  status(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MT_STATUS_BODY, { strict: true })) b: any) { return run(() => this.c().setStatus(ctxOf(r), id, b || {})); }

  @Post('templates/:id/test') @RequirePermission('pos.communications.manage')
  test(@Req() r: any, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @Body(ValidatedBody(MT_TEST_BODY, { strict: true })) b: any) {
    return run(() => this.c().testSend(ctxOf(r), id, b || {}, key ?? null));
  }

  @Post('preview') @RequirePermission('pos.communications.view')
  preview(@Req() r: any, @Body(ValidatedBody(MT_PREVIEW_BODY, { strict: true })) b: any) { return run(() => this.c().preview(ctxOf(r), b || {})); }

  @Get('connections') @RequirePermission('pos.communications.view') @ListQuery(CONNECTIONS_SPEC)
  connections(@Req() r: any, @Query() q: any) { return run(() => this.c().connections(ctxOf(r), s(q?.templateId) ?? null)); }

  @Post('connections') @RequirePermission('pos.communications.manage')
  bind(@Req() r: any, @Body(ValidatedBody(MT_BIND_BODY, { strict: true })) b: any) { return run(() => this.c().bind(ctxOf(r), b || {})); }

  @Post('connections/:id/disconnect') @RequirePermission('pos.communications.manage')
  unbind(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MT_UNBIND_BODY, { strict: true })) b: any) { return run(() => this.c().unbind(ctxOf(r), id, b || {})); }

  @Get('usage') @RequirePermission('pos.communications.view') @ListQuery(USAGE_SPEC)
  usage(@Req() r: any, @Query() q: any) {
    return run(() => this.c().usage(ctxOf(r), { q: s(q?.q), templateId: s(q?.templateId), channel: s(q?.channel), status: s(q?.status), workflow: s(q?.workflow), basis: s(q?.basis), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize }));
  }

  @Post('health-check') @RequirePermission('pos.communications.view')
  health(@Req() r: any, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return run(() => this.c().healthCheck(ctxOf(r))); }

  /** the SMS Inbox composer: a template rendered for THAT conversation's customer (text only — the reply route sends) */
  @Post('render-for-thread/:threadId') @RequirePermission('pos.communications.send')
  renderForThread(@Req() r: any, @Param('threadId') threadId: string, @Body(ValidatedBody(MT_RENDER_FOR_THREAD_BODY, { strict: true })) b: any) {
    return run(() => this.c().renderForConversation(ctxOf(r), threadId, String(b?.templateId ?? '')));
  }
}
