// communications.kysely.repository.ts — Postgres adapter for the unified inbox. Appending a message inserts the row and
// updates the thread's denormalized aggregates (last message/direction, unread count). Tenant-scoped reads; platform
// read is cross-tenant (Super-Admin-guarded controller only).
import { sql, type Kysely } from 'kysely';
import { applyListQuery, parseListQuery, type DB, type ParsedListQuery } from '@aipowersalon/database';
import { THREADS_SPEC } from './communications.list-queries';
import type { CommContext, CommunicationsRepositoryPort, ThreadPage, AddMessageInput } from './communications.repository';
import type { ThreadRow, MessageRow, ThreadFilters, CreateThreadRequest, ThreadStatus, CommChannel, CommDirection, MessageStatus } from './communications.dto';
import { normalizeCommChannel, preview } from './communications.dto';
import { clampPage } from '@aipowersalon/api-contracts';
import { transitionStatus } from '@aipowersalon/database';
import { COMMUNICATION_THREAD } from '../communications-lifecycles';

const toThread = (r: any): ThreadRow => ({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, customerId: r.customer_id ?? null, customerName: r.customer_name ?? null,
  customerContact: r.customer_contact ?? null, channel: (r.channel || 'sms') as CommChannel, subject: r.subject ?? null,
  status: (r.status || 'open') as ThreadStatus, assignedTo: r.assigned_to ?? null, assignedToName: r.assigned_to_name ?? null,
  unreadCount: Number(r.unread_count || 0), lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
  lastMessagePreview: r.last_message_preview ?? null, lastDirection: (r.last_direction ?? null) as CommDirection | null,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});
const toMessage = (r: any): MessageRow => ({
  id: r.id, tenantId: r.tenant_id, threadId: r.thread_id, direction: r.direction as CommDirection, channel: (r.channel || 'sms') as CommChannel,
  body: r.body, authorUserId: r.author_user_id ?? null, authorName: r.author_name ?? null, status: (r.status || 'sent') as MessageStatus,
  createdAt: new Date(r.created_at).toISOString(),
});

export class KyselyCommunicationsRepository implements CommunicationsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async createThread(ctx: CommContext, req: CreateThreadRequest): Promise<ThreadRow> {
    const ins = await this.db.insertInto('communication_threads').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, customer_id: req.customerId ?? null, customer_name: req.customerName ?? null,
      customer_contact: req.customerContact ?? null, channel: normalizeCommChannel(req.channel), subject: req.subject ?? null, status: 'open',
    } as any).returningAll().executeTakeFirstOrThrow();
    const thread = toThread(ins);
    if (req.initialInbound) { const r = await this.addMessage(ctx, thread.id, { direction: 'inbound', body: req.initialInbound }); return r ? r.thread : thread; }
    return thread;
  }

  async getThread(ctx: CommContext, id: string): Promise<ThreadRow | null> {
    const r = await this.db.selectFrom('communication_threads').selectAll().where('id', '=', id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return r ? toThread(r) : null;
  }

  // BUILD_PLAN Phase 12 (DoD #21): the declared filters + search (THREADS_SPEC) — columns from the spec, values bound
  private applyFilters(qb: any, f: ThreadFilters, lq: ParsedListQuery): any {
    let q = applyListQuery(qb, lq, { sort: false, limit: false });
    if (f.unreadOnly) q = q.where('unread_count', '>', 0);
    return q;
  }

  private async page(baseWhere: (qb: any) => any, f: ThreadFilters): Promise<ThreadPage> {
    const lq = parseListQuery({ ...f, unreadOnly: undefined } as Record<string, unknown>, THREADS_SPEC);
    const page = clampPage(f.page);
    const pageSize = lq.limit;
    const countRow: any = await this.applyFilters(baseWhere(this.db.selectFrom('communication_threads')), f, lq).select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const totalItems = Number(countRow?.n || 0);
    const rows = await this.applyFilters(baseWhere(this.db.selectFrom('communication_threads')), f, lq).selectAll().orderBy('last_message_at', sql`desc nulls last`).limit(pageSize).offset((page - 1) * pageSize).execute().catch(() => []);
    return { items: (rows as any[]).map(toThread), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
  }

  listThreads(tenantId: string, filters: ThreadFilters): Promise<ThreadPage> {
    return this.page((qb) => qb.where('tenant_id', '=', tenantId), filters);
  }
  listPlatform(filters: ThreadFilters & { tenantId?: string }): Promise<ThreadPage> {
    return this.page((qb) => (filters.tenantId ? qb.where('tenant_id', '=', filters.tenantId) : qb), filters);
  }

  async platformMessageStats(tenantId?: string) {
    const base = () => { let q: any = this.db.selectFrom('communication_messages'); if (tenantId) q = q.where('tenant_id', '=', tenantId); return q; };
    const totalRow: any = await base().select(sql`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const ch: any[] = await base().select(['channel', sql`count(*)`.as('n'), sql`count(*) filter (where status in ('delivered','sent','read'))`.as('delivered')]).groupBy('channel').execute().catch(() => []);
    const st: any[] = await base().select(['status', sql`count(*)`.as('n')]).groupBy('status').execute().catch(() => []);
    const dir: any[] = await base().select(['direction', sql`count(*)`.as('n')]).groupBy('direction').execute().catch(() => []);
    const daily: any[] = await base().where('created_at', '>=', sql`current_date - interval '13 days'`).select([sql`to_char(created_at::date,'YYYY-MM-DD')`.as('d'), sql`count(*)`.as('n')]).groupBy(sql`created_at::date`).orderBy(sql`created_at::date`).execute().catch(() => []);
    const dirMap = new Map<string, number>(dir.map((r) => [String(r.direction), Number(r.n)]));
    return {
      total: Number(totalRow?.n ?? 0),
      byChannel: ch.map((r) => ({ channel: r.channel || 'other', count: Number(r.n), delivered: Number(r.delivered) })),
      byStatus: st.map((r) => ({ status: r.status || 'unknown', count: Number(r.n) })),
      inbound: Number(dirMap.get('inbound') || 0), outbound: Number(dirMap.get('outbound') || 0),
      daily: daily.map((r) => ({ date: String(r.d), count: Number(r.n) })),
    };
  }

  async getMessages(ctx: CommContext, threadId: string): Promise<MessageRow[]> {
    const t = await this.getThread(ctx, threadId);
    if (!t) return [];
    const rows = await this.db.selectFrom('communication_messages').selectAll().where('thread_id', '=', threadId).where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'asc').execute();
    return (rows as any[]).map(toMessage);
  }

  async addMessage(ctx: CommContext, threadId: string, msg: AddMessageInput) {
    const t = await this.getThread(ctx, threadId);
    if (!t) return null;
    const ins = await this.db.insertInto('communication_messages').values({
      tenant_id: ctx.tenantId, thread_id: threadId, direction: msg.direction, channel: msg.channel || t.channel, body: msg.body,
      author_user_id: msg.authorUserId ?? null, author_name: msg.authorName ?? null, status: msg.direction === 'outbound' ? 'sent' : 'delivered',
    } as any).returningAll().executeTakeFirstOrThrow();
    const upd: any = { last_message_at: sql`now()`, last_message_preview: preview(msg.body), last_direction: msg.direction, updated_at: sql`now()` };
    if (msg.direction === 'inbound') upd.unread_count = sql`unread_count + 1`;
    const tr = await this.db.updateTable('communication_threads').set(upd).where('id', '=', threadId).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirstOrThrow();
    return { thread: toThread(tr), message: toMessage(ins) };
  }

  async markRead(ctx: CommContext, threadId: string): Promise<ThreadRow | null> {
    const r = await this.db.updateTable('communication_threads').set({ unread_count: 0, updated_at: sql`now()` } as any).where('id', '=', threadId).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirst();
    return r ? toThread(r) : null;
  }
  async assign(ctx: CommContext, threadId: string, userId: string | null, userName: string | null): Promise<ThreadRow | null> {
    const r = await this.db.updateTable('communication_threads').set({ assigned_to: userId, assigned_to_name: userName, updated_at: sql`now()` } as any).where('id', '=', threadId).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirst();
    return r ? toThread(r) : null;
  }
  async setStatus(ctx: CommContext, threadId: string, status: ThreadStatus): Promise<ThreadRow | null> {
    // Phase 12 (#27): through the thread machine — an unknown status is a 409 INVALID_STATE_TRANSITION (it used to reach the CHECK)
    const moved = await transitionStatus(this.db as any, COMMUNICATION_THREAD, { where: { id: threadId, tenant_id: ctx.tenantId }, to: status as any, set: { updated_at: sql`now()` } });
    if (!moved) return null;
    const r = await this.db.selectFrom('communication_threads').selectAll().where('id', '=', threadId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return r ? toThread(r) : null;
  }
}
