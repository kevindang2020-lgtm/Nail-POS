import { RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { HELP_ARTICLE_FEEDBACK_BODY, HELP_ASK_BODY, HELP_ATTACHMENT_BODY, HELP_ESCALATE_BODY, HELP_SESSION_BODY, HELP_TICKET_ASSIGN_BODY, HELP_TICKET_CREATE_BODY, HELP_TICKET_CSAT_BODY, HELP_TICKET_NOTIFY_BODY, HELP_TICKET_PRIORITY_BODY, HELP_TICKET_REPLY_BODY, HELP_TICKET_STATUS_BODY, HELP_VIDEO_PROGRESS_BODY } from '../request-schemas';
// help.controller.ts — Help Center knowledge base read endpoints (tenant-session scoped via TenantContextMiddleware).
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { HelpService, type HelpCtx } from './help.service';
import { HelpAssistantService, buildEscalationTicket } from './help-assistant.service';
import { HelpConversationsService } from './help-conversations.service';
import { SupportAttachmentsService } from './support-attachments.service';
import { SupportTicketsService, type TicketInput, buildTicketNotification } from './support-tickets.service';
import { StatusService } from './status.service';
import { SupportSessionsService, type SessionInput } from './support-sessions.service';
import { NotificationsService } from '@aipowersalon/communications';
import { ListQueries } from '@aipowersalon/database';
import { HelpControllerListQueries } from './help.list-queries';

function ctxFrom(r: any): HelpCtx {
  const c = r?.ctx || {};
  return { tenantId: c.tenantId || '', branchId: c.branchId || '', userId: c.userId, role: c.role || '', permissions: c.permissions || [] };
}

@ListQueries(HelpControllerListQueries)
@Controller('tenant/help')
export class HelpController {
  constructor(
    private readonly svc: HelpService,
    private readonly assistant: HelpAssistantService,
    private readonly conversations: HelpConversationsService,
    private readonly tickets: SupportTicketsService,
    private readonly status: StatusService,
    private readonly sessions: SupportSessionsService,
    private readonly notifications: NotificationsService,
    private readonly attachments: SupportAttachmentsService,
  ) {}

  @RequirePermission('help.view') @Get('categories') categories() { return this.svc.categories(); }

  @RequirePermission('help.view') @Get('articles') articles(@Req() r: any, @Query('category') category?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.svc.articles(ctxFrom(r), { category, q, limit: limit ? Number(limit) : undefined });
  }

  @RequirePermission('help.view') @Get('articles/:id') article(@Req() r: any, @Param('id') id: string) {
    return this.svc.article(ctxFrom(r), id);
  }

  @RequirePermission('help.view') @Get('videos') videos(@Req() r: any, @Query('category') category?: string, @Query('limit') limit?: string) {
    return this.svc.videos(ctxFrom(r), { category, limit: limit ? Number(limit) : undefined });
  }

  @RequirePermission('help.view') @Get('videos/:id') video(@Req() r: any, @Param('id') id: string) {
    return this.svc.video(ctxFrom(r), id);
  }

  @RequirePermission('help.view') @Post('articles/:id/view') recordView(@Req() r: any, @Param('id') id: string) {
    return this.svc.recordArticleView(ctxFrom(r), id);
  }

  @RequirePermission('help.view') @Post('articles/:id/feedback') feedback(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_ARTICLE_FEEDBACK_BODY, { strict: true })) body: { helpful?: boolean; comment?: string }) {
    return this.svc.submitArticleFeedback(ctxFrom(r), id, !!body?.helpful, body?.comment ?? null);
  }

  @RequirePermission('help.view') @Post('videos/:id/progress') progress(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_VIDEO_PROGRESS_BODY, { strict: true })) body: { positionSeconds?: number; completed?: boolean }) {
    return this.svc.recordVideoProgress(ctxFrom(r), id, Number(body?.positionSeconds || 0), !!body?.completed);
  }

  @RequirePermission('help.view') @Post('assistant/ask') ask(@Req() r: any, @Body(ValidatedBody(HELP_ASK_BODY, { strict: true })) body: { question?: string; conversationId?: string | null }) {
    return this.assistant.ask(ctxFrom(r), String(body?.question ?? ''), body?.conversationId ?? null);
  }

  // Create a support ticket from an assistant exchange — only on explicit user confirmation (§14). Bundles the
  // question + the assistant's reply, then links the resulting ticket back to the conversation.
  @RequirePermission('help.request') @Post('assistant/escalate') async escalate(@Req() r: any, @Body(ValidatedBody(HELP_ESCALATE_BODY, { strict: true })) body: { conversationId?: string | null; question?: string; answer?: string }) {
    const ctx = ctxFrom(r);
    const draft = buildEscalationTicket(String(body?.question ?? ''), body?.answer ?? null);
    const res = await this.tickets.createTicket(ctx, draft as TicketInput);
    if (res.ok && res.ticket && body?.conversationId) {
      await this.conversations.linkTicket(ctx, String(body.conversationId), res.ticket.id);
    }
    return { ...res, conversationId: body?.conversationId ?? null };
  }

  @RequirePermission('help.view') @Get('tickets') listTickets(@Req() r: any) { return this.tickets.listTickets(ctxFrom(r)); }
  @RequirePermission('help.view') @Get('tickets/stats') ticketStats(@Req() r: any) { return this.tickets.ticketStats(ctxFrom(r)); }
  @AsyncExport({ kind: 'tenant.help.tickets-export' }) @RequirePermission('help.view') @Get('tickets/export') exportTickets(@Req() r: any) { return this.tickets.exportTickets(ctxFrom(r)); }
  @RequirePermission('help.view') @Get('tickets/:id') getTicket(@Req() r: any, @Param('id') id: string) { return this.tickets.getTicket(ctxFrom(r), id); }
  @RequirePermission('help.request') @Post('tickets') createTicket(@Req() r: any, @Body(ValidatedBody(HELP_TICKET_CREATE_BODY, { strict: true })) body: TicketInput) { return this.tickets.createTicket(ctxFrom(r), body || {}); }
  @RequirePermission('help.request') @Post('tickets/:id/reply') replyTicket(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_REPLY_BODY, { strict: true })) body: { body?: string }) {
    return this.tickets.replyTicket(ctxFrom(r), id, String(body?.body ?? ''));
  }
  @RequirePermission('help.request') @Post('tickets/:id/csat') submitCsat(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_CSAT_BODY, { strict: true })) b: { score?: number; comment?: string }) {
    return this.tickets.submitCsat(ctxFrom(r), id, Number(b?.score), b?.comment);
  }
  @RequirePermission('help.triage') @Post('tickets/:id/status') ticketStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_STATUS_BODY, { strict: true })) body: { status?: string; note?: string }) {
    return this.tickets.transitionStatus(ctxFrom(r), id, String(body?.status ?? ''), body?.note);
  }
  @RequirePermission('help.triage') @Post('tickets/:id/assign') ticketAssign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_ASSIGN_BODY, { strict: true })) body: { agent?: string }) {
    return this.tickets.assignTicket(ctxFrom(r), id, String(body?.agent ?? ''));
  }
  @RequirePermission('help.triage') @Post('tickets/:id/priority') ticketPriority(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_PRIORITY_BODY, { strict: true })) body: { priority?: string }) {
    return this.tickets.setPriority(ctxFrom(r), id, String(body?.priority ?? ''));
  }

  // ── Ticket attachments (§ Support Center storage) — metadata never carries the private storage key. ──
  @RequirePermission('help.view') @Get('tickets/:id/attachments') listAttachments(@Req() r: any, @Param('id') id: string) {
    return this.attachments.list(ctxFrom(r), id);
  }
  @RequirePermission('help.request') @Post('tickets/:id/attachments') uploadAttachment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_ATTACHMENT_BODY, { strict: true })) body: { fileName?: string; contentType?: string; data?: string }) {
    return this.attachments.upload(ctxFrom(r), id, body || {});
  }
  @RequirePermission('help.view') @Get('tickets/:id/attachments/:attachmentId/download') downloadAttachment(@Req() r: any, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.attachments.download(ctxFrom(r), id, attachmentId);
  }
  @RequirePermission('help.request') @Post('tickets/:id/attachments/:attachmentId/delete') deleteAttachment(@Req() r: any, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.attachments.remove(ctxFrom(r), id, attachmentId);
  }

  // Triager-initiated customer notification — reuses the metered/opt-out/logged NotificationsService (Mock
  // senders when no Twilio/SendGrid creds). Returns the honest send status; on success, logs a system note.
  @RequirePermission('help.triage') @Post('tickets/:id/notify') async ticketNotify(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_TICKET_NOTIFY_BODY, { strict: true })) body: { channel?: string; to?: string; body?: string }) {
    const ctx = ctxFrom(r);
    const t = await this.tickets.getTicket(ctx, id);
    if (!t) return { sent: false, status: 'failed', reason: 'not_found' };
    if (!t.canTriage) return { sent: false, status: 'blocked', reason: 'forbidden' };
    const to = String(body?.to ?? '').trim();
    if (!to) return { sent: false, status: 'failed', reason: 'missing_recipient' };
    const n = buildTicketNotification(t.ticketNumber, t.status, body?.channel, body?.body);
    const result = await this.notifications.send(
      { tenantId: ctx.tenantId, userId: ctx.userId || '', role: ctx.role },
      { channel: n.channel, to, subject: n.subject, body: n.body },
    );
    if (result.sent) await this.tickets.recordSystemNote(ctx, id, `Notified customer via ${n.channel} to ${to}`);
    return result;
  }

  @RequirePermission('help.view') @Get('status') systemStatus() { return this.status.status(); }
  @RequirePermission('help.view') @Get('updates') productUpdates(@Query('limit') limit?: string) { return this.status.updates(limit ? Number(limit) : 8); }

  @RequirePermission('help.view') @Get('sessions') listSessions(@Req() r: any) { return this.sessions.listSessionRequests(ctxFrom(r)); }
  @RequirePermission('help.request') @Post('sessions') createSession(@Req() r: any, @Body(ValidatedBody(HELP_SESSION_BODY, { strict: true })) body: SessionInput) { return this.sessions.createSessionRequest(ctxFrom(r), body || {}); }
}
