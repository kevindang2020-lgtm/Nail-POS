// communications.repository.ts — port + in-memory adapter for the unified inbox. Messages are append-only; appending a
// message maintains the thread's denormalized aggregates (last message, direction, unread count) so the inbox list is
// cheap to render. The in-memory store starts EMPTY (no mock data).
import { randomUUID } from 'crypto';
import type { ThreadRow, MessageRow, ThreadFilters, CreateThreadRequest, ThreadStatus, CommChannel, CommDirection } from './communications.dto';
import { normalizeCommChannel, preview, applyThreadFilters } from './communications.dto';
import { clampPage } from '@aipowersalon/api-contracts';

export interface CommContext { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[]; userName?: string | null }
export interface ThreadPage { items: ThreadRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }

export interface AddMessageInput { direction: CommDirection; body: string; channel?: CommChannel; authorUserId?: string | null; authorName?: string | null }

export interface CommunicationsRepositoryPort {
  createThread(ctx: CommContext, req: CreateThreadRequest): Promise<ThreadRow>;
  getThread(ctx: CommContext, id: string): Promise<ThreadRow | null>;
  listThreads(tenantId: string, filters: ThreadFilters): Promise<ThreadPage>;
  listPlatform(filters: ThreadFilters & { tenantId?: string }): Promise<ThreadPage>;
  platformMessageStats(tenantId?: string): Promise<{ total: number; byChannel: { channel: string; count: number; delivered: number }[]; byStatus: { status: string; count: number }[]; inbound: number; outbound: number; daily: { date: string; count: number }[] }>;
  getMessages(ctx: CommContext, threadId: string): Promise<MessageRow[]>;
  addMessage(ctx: CommContext, threadId: string, msg: AddMessageInput): Promise<{ thread: ThreadRow; message: MessageRow } | null>;
  markRead(ctx: CommContext, threadId: string): Promise<ThreadRow | null>;
  assign(ctx: CommContext, threadId: string, userId: string | null, userName: string | null): Promise<ThreadRow | null>;
  setStatus(ctx: CommContext, threadId: string, status: ThreadStatus): Promise<ThreadRow | null>;
}

function paginate(rows: ThreadRow[], f: ThreadFilters): ThreadPage {
  const sorted = rows.slice().sort((a, b) => Date.parse(b.lastMessageAt || b.createdAt) - Date.parse(a.lastMessageAt || a.createdAt));
  const page = clampPage(f.page);
  const pageSize = Math.min(200, Math.max(1, Number(f.pageSize) || 50));
  const totalItems = sorted.length;
  return { items: sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
}

export class InMemoryCommunicationsRepository implements CommunicationsRepositoryPort {
  private threads: ThreadRow[] = [];
  private messages: MessageRow[] = [];

  async createThread(ctx: CommContext, req: CreateThreadRequest): Promise<ThreadRow> {
    const now = new Date().toISOString();
    const thread: ThreadRow = {
      id: randomUUID(), tenantId: ctx.tenantId, branchId: ctx.branchId ?? null,
      customerId: req.customerId ?? null, customerName: req.customerName ?? null, customerContact: req.customerContact ?? null,
      channel: normalizeCommChannel(req.channel), subject: req.subject ?? null, status: 'open',
      assignedTo: null, assignedToName: null, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null, lastDirection: null,
      createdAt: now, updatedAt: now,
    };
    this.threads.push(thread);
    if (req.initialInbound) await this.addMessage(ctx, thread.id, { direction: 'inbound', body: req.initialInbound });
    return this.threads.find((t) => t.id === thread.id)!;
  }

  async getThread(ctx: CommContext, id: string): Promise<ThreadRow | null> {
    return this.threads.find((t) => t.id === id && t.tenantId === ctx.tenantId) ?? null;
  }

  async listThreads(tenantId: string, filters: ThreadFilters): Promise<ThreadPage> {
    return paginate(applyThreadFilters(this.threads.filter((t) => t.tenantId === tenantId), filters), filters);
  }

  async listPlatform(filters: ThreadFilters & { tenantId?: string }): Promise<ThreadPage> {
    const all = filters.tenantId ? this.threads.filter((t) => t.tenantId === filters.tenantId) : this.threads;
    return paginate(applyThreadFilters(all, filters), filters);
  }

  async platformMessageStats(tenantId?: string) {
    const msgs = tenantId ? this.messages.filter((m) => m.tenantId === tenantId) : this.messages;
    const byCh = new Map<string, { count: number; delivered: number }>(); const bySt = new Map<string, number>(); let inbound = 0; let outbound = 0;
    for (const m of msgs as any[]) {
      const c = m.channel || 'other'; const e = byCh.get(c) || { count: 0, delivered: 0 }; e.count++; if (['delivered', 'sent', 'read'].includes(m.status)) e.delivered++; byCh.set(c, e);
      bySt.set(m.status, (bySt.get(m.status) || 0) + 1);
      if (m.direction === 'inbound') inbound++; else outbound++;
    }
    return { total: msgs.length, byChannel: [...byCh].map(([channel, v]) => ({ channel, count: v.count, delivered: v.delivered })), byStatus: [...bySt].map(([status, count]) => ({ status, count })), inbound, outbound, daily: [] };
  }

  async getMessages(ctx: CommContext, threadId: string): Promise<MessageRow[]> {
    const t = await this.getThread(ctx, threadId);
    if (!t) return [];
    return this.messages.filter((m) => m.threadId === threadId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async addMessage(ctx: CommContext, threadId: string, msg: AddMessageInput) {
    const t = this.threads.find((x) => x.id === threadId && x.tenantId === ctx.tenantId);
    if (!t) return null;
    const now = new Date().toISOString();
    const message: MessageRow = {
      id: randomUUID(), tenantId: ctx.tenantId, threadId, direction: msg.direction, channel: msg.channel || t.channel,
      body: msg.body, authorUserId: msg.authorUserId ?? null, authorName: msg.authorName ?? null,
      status: msg.direction === 'outbound' ? 'sent' : 'delivered', createdAt: now,
    };
    this.messages.push(message);
    t.lastMessageAt = now;
    t.lastMessagePreview = preview(msg.body);
    t.lastDirection = msg.direction;
    t.updatedAt = now;
    if (msg.direction === 'inbound') t.unreadCount += 1;
    return { thread: t, message };
  }

  async markRead(ctx: CommContext, threadId: string): Promise<ThreadRow | null> {
    const t = await this.getThread(ctx, threadId);
    if (!t) return null;
    t.unreadCount = 0; t.updatedAt = new Date().toISOString();
    return t;
  }

  async assign(ctx: CommContext, threadId: string, userId: string | null, userName: string | null): Promise<ThreadRow | null> {
    const t = await this.getThread(ctx, threadId);
    if (!t) return null;
    t.assignedTo = userId; t.assignedToName = userName; t.updatedAt = new Date().toISOString();
    return t;
  }

  async setStatus(ctx: CommContext, threadId: string, status: ThreadStatus): Promise<ThreadRow | null> {
    const t = await this.getThread(ctx, threadId);
    if (!t) return null;
    t.status = status; t.updatedAt = new Date().toISOString();
    return t;
  }
}
