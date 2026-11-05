// communications.service.ts — unified inbox business logic. Inbox state (threads + KPIs), conversation detail (thread +
// messages), and the mutating operations (send reply, mark read, assign, set status). Reply appends an OUTBOUND message
// and flips the thread to 'replied'; the actual SMS/email dispatch is a separate integration (Twilio/SendGrid) — this
// owns the conversation record + state. Permission-gated, tenant-scoped, with durable audit on mutations.
import type { CommContext, CommunicationsRepositoryPort } from './communications.repository';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import {
  type ThreadRow, type MessageRow, type ThreadFilters, type CreateThreadRequest, type ThreadStatus, type CommKpis,
  deriveCommKpis,
} from './communications.dto';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class NotFoundError extends Error { constructor(msg = 'Conversation not found') { super(msg); this.name = 'NotFoundError'; } }

export interface InboxState { kpis: CommKpis; threads: ThreadRow[]; byChannel?: { channel: string; count: number; unread: number }[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number }; messageKpis?: any; messageByChannel?: { channel: string; count: number; delivered: number }[]; channelAnalytics?: { channel: string; sent: number; delivered: number; deliveryRate: number }[]; queue?: { scheduled: number; pending: number; failed: number; draft: number }; engagementTrend?: { date: string; count: number }[]; recentActivity?: any[] }
export interface ThreadDetail { thread: ThreadRow; messages: MessageRow[] }

export class CommunicationsService {
  constructor(private readonly repo: CommunicationsRepositoryPort, private readonly auditSvc?: AuditService) {}

  private assertUser(ctx: CommContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated'); }
  private need(ctx: CommContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private audit(ctx: CommContext, action: string, id?: string, metadata?: any) {
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'communications', action, resourceType: 'thread', resourceId: id, metadata },
    );
  }

  async getInbox(ctx: CommContext, f: ThreadFilters = {}): Promise<InboxState> {
    this.need(ctx, 'pos.communications.view');
    const page = await this.repo.listThreads(ctx.tenantId, f);
    const all = (await this.repo.listThreads(ctx.tenantId, {})).items;
    return { kpis: deriveCommKpis(all), threads: page.items, pagination: page.pagination };
  }

  async getThread(ctx: CommContext, threadId: string): Promise<ThreadDetail> {
    this.need(ctx, 'pos.communications.view');
    const thread = await this.repo.getThread(ctx, threadId);
    if (!thread) throw new NotFoundError();
    const messages = await this.repo.getMessages(ctx, threadId);
    return { thread, messages };
  }

  async createThread(ctx: CommContext, req: CreateThreadRequest): Promise<ThreadRow> {
    this.need(ctx, 'pos.communications.send');
    const thread = await this.repo.createThread(ctx, req);
    this.audit(ctx, 'thread.created', thread.id, { channel: thread.channel });
    return thread;
  }

  async reply(ctx: CommContext, threadId: string, body: string): Promise<ThreadDetail> {
    this.need(ctx, 'pos.communications.send');
    if (!body || !body.trim()) throw new ValidationError('Message body is required');
    const res = await this.repo.addMessage(ctx, threadId, { direction: 'outbound', body: body.trim(), authorUserId: ctx.userId ?? null, authorName: ctx.userName ?? null });
    if (!res) throw new NotFoundError();
    // a reply marks the conversation as replied (and clears unread, since the agent has seen it)
    await this.repo.setStatus(ctx, threadId, 'replied');
    await this.repo.markRead(ctx, threadId);
    this.audit(ctx, 'thread.replied', threadId, { messageId: res.message.id });
    return this.getThread(ctx, threadId);
  }

  async markRead(ctx: CommContext, threadId: string): Promise<ThreadRow> {
    this.need(ctx, 'pos.communications.view');
    const t = await this.repo.markRead(ctx, threadId);
    if (!t) throw new NotFoundError();
    return t;
  }

  async assign(ctx: CommContext, threadId: string, userId: string | null, userName: string | null): Promise<ThreadRow> {
    this.need(ctx, 'pos.communications.manage');
    const t = await this.repo.assign(ctx, threadId, userId, userName);
    if (!t) throw new NotFoundError();
    this.audit(ctx, 'thread.assigned', threadId, { assignedTo: userId });
    return t;
  }

  async setStatus(ctx: CommContext, threadId: string, status: ThreadStatus): Promise<ThreadRow> {
    this.need(ctx, 'pos.communications.manage');
    const t = await this.repo.setStatus(ctx, threadId, status);
    if (!t) throw new NotFoundError();
    this.audit(ctx, 'thread.status_changed', threadId, { status });
    return t;
  }

  // Super-Admin cross-tenant inbox (the controller enforces the guard).
  async getPlatformInbox(f: ThreadFilters & { tenantId?: string } = {}): Promise<InboxState> {
    const all = (await this.repo.listPlatform({ tenantId: f.tenantId })).items;
    const page = await this.repo.listPlatform(f);
    // cross-tenant channel breakdown (count + unread per channel) over the unfiltered set
    const chMap = new Map<string, { count: number; unread: number }>();
    for (const t of all as ThreadRow[]) { const ch = t.channel || 'other'; const e = chMap.get(ch) || { count: 0, unread: 0 }; e.count++; e.unread += Number(t.unreadCount || 0); chMap.set(ch, e); }
    const byChannel = [...chMap.entries()].map(([channel, v]) => ({ channel, count: v.count, unread: v.unread })).sort((a, b) => b.count - a.count);
    // --- message-level stats (real, from communication_messages) for the S12 Communications Hub ---
    const ms = await this.repo.platformMessageStats(f.tenantId);
    const chCount = (c: string) => ms.byChannel.filter((x) => x.channel === c).reduce((a, x) => a + x.count, 0);
    const stCount = (s: string) => ms.byStatus.filter((x) => x.status === s).reduce((a, x) => a + x.count, 0);
    const delivered = ms.byChannel.reduce((a, x) => a + x.delivered, 0);
    const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    const threadsAll = all as ThreadRow[];
    return {
      kpis: deriveCommKpis(all), threads: page.items, byChannel, pagination: page.pagination,
      messageKpis: {
        totalMessages: ms.total, emailSent: chCount('email'), smsSent: chCount('sms'), whatsappSent: chCount('whatsapp'), callCount: chCount('call'),
        deliveryRate: pctOf(delivered, ms.total), responseRate: pctOf(ms.inbound, ms.outbound || ms.total), customerReplies: ms.inbound, outboundCount: ms.outbound,
      },
      messageByChannel: ms.byChannel,
      channelAnalytics: ms.byChannel.map((x) => ({ channel: x.channel, sent: x.count, delivered: x.delivered, deliveryRate: pctOf(x.delivered, x.count) })),
      queue: { scheduled: stCount('scheduled') + stCount('queued'), pending: stCount('pending'), failed: stCount('failed'), draft: stCount('draft') },
      engagementTrend: ms.daily,
      recentActivity: threadsAll.slice().sort((a, b) => Date.parse(b.lastMessageAt || b.createdAt) - Date.parse(a.lastMessageAt || a.createdAt)).slice(0, 6)
        .map((t) => ({ customerName: t.customerName || '—', channel: t.channel, preview: t.lastMessagePreview || '', at: t.lastMessageAt || t.updatedAt, direction: t.lastDirection })),
    };
  }
}
