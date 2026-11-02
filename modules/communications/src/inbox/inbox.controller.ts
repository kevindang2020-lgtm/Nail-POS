// inbox.controller.ts — Communications / SMS Inbox (guide Oct 30 2026 §15 "suggested API contracts", adapted):
//   GET  pos/communications/inbox/threads                 list — q (name / phone / email / ids / ticket / message text), channel,
//                                                          status, assignee (me | unassigned | id), unreadOnly, awaitingOnly,
//                                                          branch (authorized only), preset/from/to + basis, sort, page, pageSize 10/20/50
//   GET  pos/communications/inbox/summary                 the 7 conversation KPIs + channel mix + today's sent evidence (SQL, whole inbox)
//   GET  pos/communications/inbox/threads/:id             conversation + customer context + latest messages + composer readiness
//   GET  pos/communications/inbox/threads/:id/messages    older messages (?before= cursor) — chronological
//   GET  pos/communications/inbox/threads/:id/timeline    unified customer timeline (?before= &sources=)
//   POST pos/communications/inbox/threads/:id/reply       Idempotency-Key REQUIRED; one Send = one message
//   POST pos/communications/inbox/threads/:id/{read|unread|assign|status|follow-up|link-customer}  (expectedVersion)
//   POST pos/communications/inbox/conversations           New Message: open / reuse a conversation (nothing is sent)
//   GET  pos/communications/inbox/{templates|customers|staff}
// Guards: TenantAuthGuard + RolePermissionGuard; tenant, branch and authorized branches from the session (req.ctx), never the body.
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, Inject } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQuery, type ListQuerySpec } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { InboxService } from './inbox.service';
import { InboxError } from './inbox-core';
import type { InboxCtx } from './inbox.repository';
import { INBOX_REPLY_BODY, INBOX_ASSIGN_BODY, INBOX_STATUS_BODY, INBOX_FOLLOW_UP_BODY, INBOX_LINK_BODY, INBOX_START_BODY, EMPTY_BODY } from '../request-schemas';

export const INBOX_SERVICE = 'InboxService';

export function inboxCtxFrom(req: any): InboxCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], userName: c.userName || c.name || null,
    authz: c.authz ? { branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
export async function runInbox<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof InboxError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    throw e;
  }
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const LIST_SPEC = {
  filters: { channel: { type: 'enum', values: ['sms', 'email', 'call'] }, status: { type: 'enum', values: ['open', 'pending', 'replied', 'missed', 'closed'] }, assignee: { type: 'text', maxLength: 40 },
    unreadOnly: { type: 'enum', values: ['true', 'false'] }, awaitingOnly: { type: 'enum', values: ['true', 'false'] }, branch: { type: 'text', maxLength: 40 },
    preset: { type: 'enum', values: ['all', 'today', 'week', 'month', 'year', 'custom'] }, basis: { type: 'enum', values: ['last_activity', 'created', 'received'] } },
  sorts: { newest: null, unread: null, oldest_unanswered: null, follow_up_due: null }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, dateRange: { maxDays: 3700 }, params: ['page'],
} satisfies ListQuerySpec;   // literal (check:list-queries evaluates it statically) — the same vocabularies as inbox-core

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('communications')
@Controller('pos/communications/inbox')
export class InboxController {
  constructor(@Inject(INBOX_SERVICE) private readonly svc: InboxService | null) {}
  private s(): InboxService { if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The inbox needs the database.' }, 503); return this.svc; }

  @Get('threads') @RequirePermission('pos.communications.view') @ListQuery(LIST_SPEC)
  list(@Req() r: any, @Query() q: any) { return runInbox(() => this.s().list(inboxCtxFrom(r), q ?? {})); }

  @Get('summary') @RequirePermission('pos.communications.view') @ListQuery({ filters: { branch: { type: 'text', maxLength: 40 } }, search: false })
  summary(@Req() r: any, @Query('branch') branch?: string) { return runInbox(() => this.s().summary(inboxCtxFrom(r), str(branch) === 'all' ? null : str(branch))); }

  @Get('templates') @RequirePermission('pos.communications.send')
  templates(@Req() r: any) { return runInbox(() => this.s().templates(inboxCtxFrom(r))); }

  @Get('customers') @RequirePermission('pos.communications.send') @ListQuery({ search: { maxLength: 100 } })
  customers(@Req() r: any, @Query('q') q?: string) { return runInbox(() => this.s().lookupCustomers(inboxCtxFrom(r), String(q ?? ''))); }

  @Get('staff') @RequirePermission('pos.communications.manage')
  staff(@Req() r: any) { return runInbox(() => this.s().staff(inboxCtxFrom(r))); }

  @Get('threads/:id') @RequirePermission('pos.communications.view')
  detail(@Req() r: any, @Param('id') id: string) { return runInbox(() => this.s().detail(inboxCtxFrom(r), id)); }

  @Get('threads/:id/messages') @RequirePermission('pos.communications.view') @ListQuery({ filters: { before: { type: 'text', maxLength: 300 } }, search: false })
  messages(@Req() r: any, @Param('id') id: string, @Query('before') before?: string) { return runInbox(() => this.s().olderMessages(inboxCtxFrom(r), id, str(before))); }

  @Get('threads/:id/timeline') @RequirePermission('pos.communications.view') @ListQuery({ filters: { before: { type: 'text', maxLength: 300 }, sources: { type: 'text', maxLength: 120 } }, search: false })
  timeline(@Req() r: any, @Param('id') id: string, @Query('before') before?: string, @Query('sources') sources?: string) {
    return runInbox(() => this.s().timeline(inboxCtxFrom(r), id, str(before), str(sources)));
  }

  @Post('threads/:id/reply') @RequirePermission('pos.communications.send') @Idempotent({ required: true })
  reply(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INBOX_REPLY_BODY, { strict: true })) b: any) {
    return runInbox(() => this.s().reply(inboxCtxFrom(r), id, b?.body, str(r?.headers?.['idempotency-key']), typeof b?.templateId === 'string' && b.templateId ? b.templateId : null));
  }
  @Post('threads/:id/read') @RequirePermission('pos.communications.view')
  read(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return runInbox(() => this.s().markRead(inboxCtxFrom(r), id)); }
  @Post('threads/:id/unread') @RequirePermission('pos.communications.view')
  unread(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { return runInbox(() => this.s().markUnread(inboxCtxFrom(r), id)); }
  @Post('threads/:id/assign') @RequirePermission('pos.communications.manage')
  assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INBOX_ASSIGN_BODY, { strict: true })) b: any) { return runInbox(() => this.s().assign(inboxCtxFrom(r), id, b ?? {})); }
  @Post('threads/:id/status') @RequirePermission('pos.communications.manage')
  status(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INBOX_STATUS_BODY, { strict: true })) b: any) { return runInbox(() => this.s().setStatus(inboxCtxFrom(r), id, b ?? {})); }
  @Post('threads/:id/follow-up') @RequirePermission('pos.communications.manage')
  followUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INBOX_FOLLOW_UP_BODY, { strict: true })) b: any) { return runInbox(() => this.s().snooze(inboxCtxFrom(r), id, b ?? {})); }
  @Post('threads/:id/link-customer') @RequirePermission('pos.communications.manage')
  link(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INBOX_LINK_BODY, { strict: true })) b: any) { return runInbox(() => this.s().linkCustomer(inboxCtxFrom(r), id, b ?? {})); }

  @Post('conversations') @RequirePermission('pos.communications.send') @Idempotent()
  start(@Req() r: any, @Body(ValidatedBody(INBOX_START_BODY, { strict: true })) b: any) { return runInbox(() => this.s().startConversation(inboxCtxFrom(r), b ?? {})); }
}
