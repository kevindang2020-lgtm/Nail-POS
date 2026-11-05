// inbox.repository.ts — the Communications / SMS Inbox read model and its writes (Communications guide Oct 30 2026 §5–§16,
// Addendum §4.1–§4.3). Raw SQL only. EVERY statement on a tenant table carries `alias.tenant_id = ${tenantId}` from the
// session; the authorized branches come from the session too (authz.branchIds: null = all). A conversation with no branch
// (salon-wide number) is visible to every authorized user of the salon; one with a branch only to users of that branch.
//
// One store per fact (guide §14 "adapt, do not duplicate"):
//   conversations + their turns   communication_threads / communication_messages (existing, extended by migration 730)
//   delivery of a staff reply     the SMS ledger row the send created (notifications, moved by signed Twilio callbacks)
//   timeline                      a READ-TIME union of the canonical rows (messages, ledger, review_requests,
//                                 call_intelligence_events + transcript summary, ai_receptionist_follow_ups,
//                                 pos_tech_appointments) — nothing is copied into a second store.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { isValidTimeZone, canMoveToSql } from '@aipowersalon/database';
import { hasPermission } from '@aipowersalon/permissions';
import { parseInboundKeyword } from '../notifications/notifications-core';
import { COMMUNICATION_THREAD, COMMUNICATION_MESSAGE } from '../communications-lifecycles';
import {
  InboxError, isUuid, normalizePhone, last10, maskPhone, maskEmail, preview, likeOf, deliveryState, answersCustomer, blockReasonCode,
  automatedType, mergeTimeline, decodeCursor, encodeCursor, resolveInboxPeriod, TIMELINE_PAGE, TIMELINE_SOURCES,
  type InboxQuery, type TimelineSource, type DeliveryState,
} from './inbox-core';
import type { InboxPeriod, InboxTimelineEvent } from '@aipowersalon/api-contracts/tenant';

export interface InboxCtx {
  tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; userName?: string | null;
  authz: { branchIds: string[] | null } | null;
}
export type Db = Kysely<any>;
type Raw = RawBuilder<unknown>;
const DEFAULT_TZ = 'America/New_York';
const iso = (v: unknown): string | null => { if (v == null || v === '') return null; const d = v instanceof Date ? v : new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const csv = (ids: string[]) => ids.join(',');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw SQL rows are mapped field by field right below
type Row = Record<string, any>;
/** the thread columns this read model uses (response-exposure: never a whole-row read) */
const T_COLS = sql`t.id, t.tenant_id, t.branch_id, t.customer_id, t.customer_name, t.customer_contact, t.contact_normalized, t.customer_match, t.channel, t.status,
  t.assigned_to, t.assigned_to_name, t.unread_count, t.last_message_at, t.last_message_preview, t.last_direction, t.last_inbound_at, t.awaiting_reply_since,
  t.follow_up_due_at, t.record_version, t.closed_at, t.created_at`;
const M_COLS = sql`m.id, m.thread_id, m.direction, m.channel, m.body, m.author_kind, m.author_name, m.status, m.notification_id, m.error_code, m.media_count, m.created_at`;

export interface ThreadListItem {
  id: string; branchId: string | null; branchName: string | null; customerId: string | null; displayName: string | null;
  identity: 'linked' | 'ambiguous' | 'unknown'; contactMasked: string | null; channel: string; status: string;
  assignedTo: string | null; assignedToName: string | null; unreadCount: number; lastActivityAt: string | null;
  lastMessagePreview: string | null; lastDirection: string | null; awaitingSince: string | null; followUpDueAt: string | null;
  version: number; createdAt: string;
}
export interface MessageView {
  id: string; threadId: string; direction: 'inbound' | 'outbound'; channel: string; body: string; authorKind: string;
  authorName: string | null; createdAt: string; delivery: DeliveryState; reasonCode: string | null; providerErrorCode: string | null;
  deliveredAt: string | null; mediaCount: number;
}

export class InboxRepository {
  constructor(readonly db: Db) {}

  // ── scope ─────────────────────────────────────────────────────────────────────────────────────────────────────
  allowed(ctx: InboxCtx): string[] | null { const b = ctx.authz?.branchIds; return Array.isArray(b) ? b.filter(isUuid) : null; }

  /** ?branch= → one branch the session may see (403 otherwise); '' / 'all' → every authorized branch. */
  async resolveBranch(ctx: InboxCtx, requested: string | null): Promise<string | null> {
    if (!requested) return null;
    const allowed = this.allowed(ctx);
    if (!isUuid(requested) || (allowed && !allowed.includes(requested))) throw new InboxError('You do not have access to that branch.', 'INBOX_BRANCH_NOT_AUTHORIZED', 403);
    const r = await sql<Row>`SELECT 1 FROM branches b WHERE b.tenant_id = ${ctx.tenantId} AND b.id = ${requested}::uuid LIMIT 1`.execute(this.db);
    if (!r.rows.length) throw new InboxError('You do not have access to that branch.', 'INBOX_BRANCH_NOT_AUTHORIZED', 403);
    return requested;
  }
  /** The branch-visibility predicate for the thread alias `t` (the tenant is written out at every call site). */
  private branchScope(ctx: InboxCtx, branch: string | null): Raw {
    if (branch) return sql`t.branch_id = ${branch}::uuid`;
    const allowed = this.allowed(ctx);
    if (allowed) return allowed.length ? sql`(t.branch_id IS NULL OR t.branch_id = ANY(string_to_array(${csv(allowed)}, ',')::uuid[]))` : sql`t.branch_id IS NULL`;
    return sql`true`;
  }
  /** branch visibility for a timeline source row with a nullable branch_id column (`col` is a fixed column fragment) */
  private branchOk(ctx: InboxCtx, col: Raw): Raw {
    const allowed = this.allowed(ctx);
    if (!allowed) return sql`true`;
    return allowed.length ? sql`(${col} IS NULL OR ${col} = ANY(string_to_array(${csv(allowed)}, ',')::uuid[]))` : sql`${col} IS NULL`;
  }

  /** every branch of the salon — a salon-wide conversation's live event goes to each branch room (the bus is per branch) */
  async branchIdsOf(tenantId: string): Promise<string[]> {
    const r = await sql<Row>`SELECT b.id FROM branches b WHERE b.tenant_id = ${tenantId} AND b.deleted_at IS NULL ORDER BY b.created_at ASC LIMIT 500`.execute(this.db);
    return r.rows.map((x) => String(x.id));
  }

  async salonTimeZone(tenantId: string): Promise<string> {
    const r = await sql<{ timezone: string | null }>`SELECT b.timezone FROM branches b WHERE b.tenant_id = ${tenantId} AND b.deleted_at IS NULL ORDER BY b.created_at ASC LIMIT 5`.execute(this.db);
    return (r.rows as Row[]).map((x) => x.timezone).find((z: unknown) => typeof z === 'string' && isValidTimeZone(z)) ?? DEFAULT_TZ;
  }

  // ── list ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private activity(): Raw { return sql`COALESCE(t.last_message_at, t.created_at)`; }
  private awaiting(): Raw { return sql`(CASE WHEN t.status <> 'closed' THEN t.awaiting_reply_since END)`; }

  private searchSql(ctx: InboxCtx, q: InboxQuery): Raw {
    const s = q.search; if (!s) return sql`true`;
    const tid = ctx.tenantId; const like = likeOf(s.text); const parts: Raw[] = [];
    // C2 audit (Nov 4 2026): a viewer who sees contacts masked (no pos.customers.view) searches by name / id only — matching a
    // full phone number or e-mail would reveal whose it is (the leak B16 closed on the Email screen)
    const full = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view');
    parts.push(sql`t.customer_name ILIKE ${like}`, sql`c.full_name ILIKE ${like}`);
    if (full) parts.push(sql`t.customer_contact ILIKE ${like}`);
    if (s.digits && full) {
      const dl = likeOf(s.digits);
      parts.push(sql`right(regexp_replace(COALESCE(t.contact_normalized, t.customer_contact, ''), '[^0-9]', '', 'g'), 10) LIKE ${dl}`);
      parts.push(sql`right(regexp_replace(COALESCE(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) LIKE ${dl}`);
    }
    if (s.email && full) parts.push(sql`lower(c.email) LIKE ${likeOf(s.email)}`);
    if (s.uuid) {
      parts.push(sql`t.id = ${s.uuid}::uuid`, sql`t.customer_id = ${s.uuid}::uuid`);
      parts.push(sql`EXISTS (SELECT 1 FROM communication_messages mi WHERE mi.tenant_id = ${tid} AND mi.thread_id = t.id AND mi.id = ${s.uuid}::uuid)`);
      parts.push(sql`EXISTS (SELECT 1 FROM pos_tech_appointments ap WHERE ap.tenant_id = ${tid} AND ap.id = ${s.uuid}::uuid AND ap.customer_id = t.customer_id)`);
      parts.push(sql`EXISTS (SELECT 1 FROM tickets tk WHERE tk.tenant_id = ${tid} AND tk.id = ${s.uuid}::uuid AND tk.customer_id = t.customer_id)`);
    }
    if (s.ref) parts.push(sql`EXISTS (SELECT 1 FROM tickets tk WHERE tk.tenant_id = ${tid} AND tk.customer_id = t.customer_id AND tk.ticket_number::text = ${s.ref})`);
    if (s.text.length >= 3 && !s.digits && !s.uuid) parts.push(sql`EXISTS (SELECT 1 FROM communication_messages mb WHERE mb.tenant_id = ${tid} AND mb.thread_id = t.id AND mb.body ILIKE ${like})`);
    return sql`(${sql.join(parts, sql` OR `)})`;
  }

  private whereSql(ctx: InboxCtx, q: InboxQuery, branch: string | null, period: InboxPeriod): Raw {
    const w: Raw[] = [sql`t.tenant_id = ${ctx.tenantId}`, this.branchScope(ctx, branch)];
    if (q.channel) w.push(sql`t.channel = ${q.channel}`);
    if (q.status) w.push(sql`t.status = ${q.status}`);
    if (q.assignee === 'me') w.push(sql`t.assigned_to = ${ctx.userId}::uuid`);
    else if (q.assignee === 'unassigned') w.push(sql`t.assigned_to IS NULL`);
    else if (q.assignee) w.push(sql`t.assigned_to = ${q.assignee}::uuid`);
    if (q.unreadOnly) w.push(sql`t.unread_count > 0`);
    if (q.awaitingOnly) w.push(sql`${this.awaiting()} IS NOT NULL`);
    // C2 gap (Nov 5 2026): conversations that came from a campaign — the customer was SENT that campaign's text, and the
    // conversation had activity from the send up to 14 days after it (the attribution window, stated on the screen)
    if (q.campaign?.kind === 'rsms') w.push(sql`EXISTS (SELECT 1 FROM retention_sms_recipients rr WHERE rr.tenant_id = ${ctx.tenantId} AND rr.campaign_id = ${q.campaign.id}::uuid
        AND rr.customer_id = t.customer_id AND rr.status = 'sent' AND rr.sent_at IS NOT NULL AND ${this.activity()} >= rr.sent_at AND ${this.activity()} < rr.sent_at + interval '14 days')`);
    if (q.campaign?.kind === 'cc') w.push(sql`EXISTS (SELECT 1 FROM campaigns cc JOIN campaign_recipients cr ON cr.tenant_id = cc.tenant_id AND cr.campaign_id = cc.id AND cr.snapshot_version = cc.snapshot_version
        WHERE cc.tenant_id = ${ctx.tenantId} AND cc.id = ${q.campaign.id}::uuid AND cr.customer_id = t.customer_id AND cr.eligibility = 'eligible' AND cc.status IN ('in_progress', 'completed')
          AND ${this.activity()} >= COALESCE(cc.scheduled_at, cc.approved_at, cc.created_at) AND ${this.activity()} < COALESCE(cc.completed_at, cc.scheduled_at, cc.approved_at, cc.created_at) + interval '14 days')`);
    if (period.from && period.to) {
      const col = q.basis === 'created' ? sql`t.created_at` : q.basis === 'received' ? sql`t.last_inbound_at` : this.activity();
      w.push(sql`(${col} >= (${period.from}::date)::timestamp AT TIME ZONE ${period.tz} AND ${col} < ((${period.to}::date + 1))::timestamp AT TIME ZONE ${period.tz})`);
    }
    w.push(this.searchSql(ctx, q));
    return sql.join(w, sql` AND `);
  }
  private orderSql(q: InboxQuery): Raw {
    switch (q.sort) {
      case 'unread': return sql`(t.unread_count > 0) DESC, ${this.activity()} DESC, t.id DESC`;
      case 'oldest_unanswered': return sql`(${this.awaiting()} IS NULL) ASC, ${this.awaiting()} ASC, ${this.activity()} DESC, t.id ASC`;
      case 'follow_up_due': return sql`(t.follow_up_due_at IS NULL) ASC, t.follow_up_due_at ASC, ${this.activity()} DESC, t.id ASC`;
      default: return sql`${this.activity()} DESC, t.id DESC`;
    }
  }
  private item(r: Row): ThreadListItem {
    const identity = r.customer_id ? 'linked' : r.customer_match === 'ambiguous' ? 'ambiguous' : 'unknown';
    const contactMasked = r.channel === 'email' ? maskEmail(r.customer_contact) : maskPhone(r.contact_normalized ?? r.customer_contact);
    return {
      id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null, customerId: r.customer_id ? String(r.customer_id) : null,
      displayName: r.customer_id ? (r.customer_full_name ?? r.customer_name ?? null) : null, identity, contactMasked, channel: String(r.channel), status: String(r.status),
      assignedTo: r.assigned_to ? String(r.assigned_to) : null, assignedToName: r.assigned_to_name ?? null, unreadCount: n(r.unread_count),
      lastActivityAt: iso(r.activity_at), lastMessagePreview: r.last_message_preview ?? null, lastDirection: r.last_direction ?? null,
      awaitingSince: r.status !== 'closed' ? iso(r.awaiting_reply_since) : null, followUpDueAt: iso(r.follow_up_due_at), version: n(r.record_version) || 1, createdAt: iso(r.created_at)!,
    };
  }

  /** C2 gap (Nov 5 2026): the campaigns of the last 90 days a conversation can come from (the inbox's source filter) */
  async sourceCampaigns(ctx: InboxCtx): Promise<{ items: Array<{ value: string; name: string; kind: 'rsms' | 'cc'; sentAt: string | null }>; windowDays: number }> {
    const T = ctx.tenantId;
    const r = await sql<Row>`SELECT 'rsms' AS kind, c.id, COALESCE(c.label, 'Win-back text') AS name, max(rr.sent_at) AS sent_at FROM retention_sms_campaigns c JOIN retention_sms_recipients rr ON rr.campaign_id = c.id AND rr.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${T} AND rr.status = 'sent' AND rr.sent_at > now() - interval '90 days' GROUP BY c.id, c.label
      UNION ALL
      SELECT 'cc', cc.id, cc.name, COALESCE(cc.scheduled_at, cc.approved_at, cc.created_at) FROM campaigns cc
        WHERE cc.tenant_id = ${T} AND cc.channel = 'sms' AND cc.status IN ('in_progress', 'completed') AND COALESCE(cc.scheduled_at, cc.approved_at, cc.created_at) > now() - interval '90 days'
      ORDER BY 4 DESC NULLS LAST LIMIT 100`.execute(this.db);
    return { items: (r.rows as Row[]).map((x) => ({ value: `${x.kind}:${x.id}`, name: String(x.name ?? ''), kind: x.kind === 'cc' ? 'cc' : 'rsms', sentAt: iso(x.sent_at) })), windowDays: 14 };
  }

  async list(ctx: InboxCtx, q: InboxQuery): Promise<{ items: ThreadListItem[]; total: number; page: number; pageSize: number; pageCount: number; sort: string; period: InboxPeriod; branch: string | null }> {
    const branch = await this.resolveBranch(ctx, q.branch);
    const period = resolveInboxPeriod(q, await this.salonTimeZone(ctx.tenantId));
    const where = this.whereSql(ctx, q, branch, period);
    const from = sql`FROM communication_threads t
      LEFT JOIN customers c ON c.tenant_id = ${ctx.tenantId} AND c.id = t.customer_id
      LEFT JOIN branches b ON b.tenant_id = ${ctx.tenantId} AND b.id = t.branch_id`;
    const cnt = await sql<Row>`SELECT count(*)::int AS n ${from} WHERE ${where}`.execute(this.db);
    const total = n((cnt.rows[0] as Row | undefined)?.n);
    const pageCount = Math.max(1, Math.ceil(total / q.pageSize));
    const page = Math.min(q.page, pageCount);
    const rows = await sql<Row>`SELECT t.id, t.branch_id, t.customer_id, t.customer_name, t.customer_contact, t.contact_normalized, t.customer_match, t.channel, t.status,
        t.assigned_to, t.assigned_to_name, t.unread_count, ${this.activity()} AS activity_at, t.last_message_preview, t.last_direction, t.awaiting_reply_since,
        t.follow_up_due_at, t.record_version, t.created_at, c.full_name AS customer_full_name, b.name AS branch_name
      ${from} WHERE ${where} ORDER BY ${this.orderSql(q)} LIMIT ${q.pageSize} OFFSET ${(page - 1) * q.pageSize}`.execute(this.db);
    return { items: (rows.rows as Row[]).map((r) => this.item(r)), total, page, pageSize: q.pageSize, pageCount, sort: q.sort, period, branch };
  }

  // ── KPIs (the 7 conversation tiles + today's outbound evidence) — counted in SQL over the whole visible inbox ──
  async kpis(ctx: InboxCtx, branchReq: string | null) {
    const branch = await this.resolveBranch(ctx, branchReq);
    const tz = await this.salonTimeZone(ctx.tenantId);
    const k: Row = (await sql<Row>`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE t.status IN ('open', 'pending'))::int AS open,
        count(*) FILTER (WHERE t.unread_count > 0)::int AS unread_threads,
        COALESCE(sum(t.unread_count), 0)::int AS unread_messages,
        count(*) FILTER (WHERE t.status = 'replied')::int AS replied,
        count(*) FILTER (WHERE t.status = 'missed')::int AS missed,
        count(*) FILTER (WHERE t.channel = 'sms')::int AS sms,
        count(*) FILTER (WHERE t.channel = 'email')::int AS email,
        count(*) FILTER (WHERE t.channel = 'call')::int AS call,
        count(*) FILTER (WHERE ${this.awaiting()} IS NOT NULL)::int AS awaiting,
        min(${this.awaiting()}) AS oldest_awaiting
      FROM communication_threads t WHERE t.tenant_id = ${ctx.tenantId} AND ${this.branchScope(ctx, branch)}`.execute(this.db)).rows[0] ?? {};
    // Messages sent today (salon-local day): staff replies from this inbox, split by what the provider has confirmed
    // C2 audit: "sent" counts only texts that left (a failed / blocked reply never left — it is counted under failed only)
    const m: Row = (await sql<Row>`SELECT count(*) FILTER (WHERE NOT (m.status IN ('failed', 'blocked') OR coalesce(nt.status, '') IN ('failed', 'blocked')))::int AS total,
        count(*) FILTER (WHERE m.notification_id IS NOT NULL AND nt.status IN ('sent', 'delivered'))::int AS submitted,
        count(*) FILTER (WHERE nt.status = 'delivered' OR nt.provider_status = 'delivered')::int AS delivered,
        count(*) FILTER (WHERE m.status IN ('failed', 'blocked') OR nt.status IN ('failed', 'blocked'))::int AS failed,
        count(*) FILTER (WHERE nt.status = 'simulated')::int AS simulated
      FROM communication_messages m JOIN communication_threads t ON t.tenant_id = ${ctx.tenantId} AND t.id = m.thread_id
      LEFT JOIN notifications nt ON nt.tenant_id = ${ctx.tenantId} AND nt.id = m.notification_id
      WHERE m.tenant_id = ${ctx.tenantId} AND t.tenant_id = ${ctx.tenantId} AND m.direction = 'outbound' AND ${this.branchScope(ctx, branch)}
        AND m.created_at >= (${sql`(now() AT TIME ZONE ${tz})::date`})::timestamp AT TIME ZONE ${tz}`.execute(this.db)).rows[0] ?? {};
    // C2 audit (Nov 4 2026): "Missed" = calls missed today (salon day) from the call ledger — the tile counted threads in a
    // 'missed' status nothing ever sets, so it was always 0. The threads count stays beside it.
    const mc: Row = (await sql<Row>`SELECT count(*)::int AS n FROM call_intelligence_events ce
      WHERE ce.tenant_id = ${ctx.tenantId} AND (ce.status = 'missed' OR ce.outcome = 'missed')
        AND ${branch ? sql`ce.branch_id = ${branch}::uuid` : this.branchOk(ctx, sql`ce.branch_id`)}
        AND COALESCE(ce.started_at, ce.created_at) >= (${sql`(now() AT TIME ZONE ${tz})::date`})::timestamp AT TIME ZONE ${tz}`.execute(this.db).catch(() => ({ rows: [{ n: null }] }))).rows[0] ?? {};
    return {
      scope: { branch, tz },
      conversations: { total: n(k.total), open: n(k.open), unreadThreads: n(k.unread_threads), unreadMessages: n(k.unread_messages), replied: n(k.replied),
        missed: mc.n == null ? null : n(mc.n), missedThreads: n(k.missed), awaiting: n(k.awaiting), oldestAwaitingSince: iso(k.oldest_awaiting) },
      channelMix: [{ channel: 'sms', count: n(k.sms) }, { channel: 'email', count: n(k.email) }, { channel: 'call', count: n(k.call) }],
      sentToday: { total: n(m.total), submitted: n(m.submitted), delivered: n(m.delivered), failed: n(m.failed), simulated: n(m.simulated) },
    };
  }

  // ── one conversation ──────────────────────────────────────────────────────────────────────────────────────────
  /** The thread row if the session may see it — another salon's / branch's conversation is "not found" (no existence leak). */
  async visibleThread(ctx: InboxCtx, id: string, db: Db = this.db, lock = false): Promise<Row | null> {
    if (!isUuid(id)) return null;
    const r = await sql<Row>`SELECT ${T_COLS} FROM communication_threads t WHERE t.tenant_id = ${ctx.tenantId} AND t.id = ${id}::uuid AND ${this.branchScope(ctx, null)} ${lock ? sql`FOR UPDATE` : sql``}`.execute(db);
    return (r.rows[0] as Row | undefined) ?? null;
  }
  async mustThread(ctx: InboxCtx, id: string, db: Db = this.db, lock = false): Promise<Row> {
    const t = await this.visibleThread(ctx, id, db, lock);
    if (!t) throw new InboxError('That conversation could not be found.', 'CONVERSATION_NOT_FOUND', 404);
    return t;
  }

  private messageView(r: Row): MessageView {
    const d = deliveryState({ direction: r.direction, messageStatus: r.status, notificationId: r.notification_id ? String(r.notification_id) : null,
      ledgerStatus: r.n_status ?? null, providerStatus: r.n_provider_status ?? null, failureReason: r.n_failure ?? null, providerErrorCode: r.n_error ?? null });
    return {
      id: String(r.id), threadId: String(r.thread_id), direction: r.direction === 'inbound' ? 'inbound' : 'outbound', channel: String(r.channel), body: String(r.body ?? ''),
      authorKind: r.author_kind ?? (r.direction === 'inbound' ? 'customer' : 'staff'), authorName: r.author_name ?? null, createdAt: iso(r.created_at)!, delivery: d,
      reasonCode: d === 'blocked' || d === 'failed' || d === 'undelivered' ? blockReasonCode(r.n_failure ?? r.error_code) : null,
      providerErrorCode: r.n_error ?? null, deliveredAt: iso(r.n_delivered_at), mediaCount: n(r.media_count),
    };
  }
  /** Messages of one thread, chronological; `before` loads the page of OLDER ones (the reader's position is kept). */
  async messages(ctx: InboxCtx, threadId: string, before: string | null, limit = TIMELINE_PAGE): Promise<{ items: MessageView[]; olderCursor: string | null }> {
    await this.mustThread(ctx, threadId);
    const cur = decodeCursor(before);
    const rows = await sql<Row>`SELECT ${M_COLS}, nt.status AS n_status, nt.provider_status AS n_provider_status, nt.failure_reason AS n_failure, nt.provider_error_code AS n_error, nt.delivered_at AS n_delivered_at
      FROM communication_messages m LEFT JOIN notifications nt ON nt.tenant_id = ${ctx.tenantId} AND nt.id = m.notification_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.thread_id = ${threadId}::uuid
        ${cur ? sql`AND (m.created_at < ${cur.at}::timestamptz OR (m.created_at = ${cur.at}::timestamptz AND m.id::text < ${cur.id}))` : sql``}
      ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1}`.execute(this.db);
    const all = rows.rows as Row[];
    const page = all.slice(0, limit).reverse().map((r) => this.messageView(r));
    const oldest = page[0];
    return { items: page, olderCursor: all.length > limit && oldest ? encodeCursor({ at: oldest.createdAt, id: oldest.id, source: 'message' }) : null };
  }
  async message(ctx: InboxCtx, id: string): Promise<MessageView | null> {
    const rows = await sql<Row>`SELECT ${M_COLS}, nt.status AS n_status, nt.provider_status AS n_provider_status, nt.failure_reason AS n_failure, nt.provider_error_code AS n_error, nt.delivered_at AS n_delivered_at
      FROM communication_messages m LEFT JOIN notifications nt ON nt.tenant_id = ${ctx.tenantId} AND nt.id = m.notification_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.id = ${id}::uuid`.execute(this.db);
    return rows.rows[0] ? this.messageView(rows.rows[0]) : null;
  }

  /** Conversation header + customer context (guide §5.2): identity, consent / opt-out, branch, related appointment. */
  async detail(ctx: InboxCtx, threadId: string, opts: { showFullContact: boolean }) {
    const t = await this.mustThread(ctx, threadId);
    const tid = ctx.tenantId;
    const cu: Row | null | undefined = t.customer_id ? (await sql<Row>`SELECT c.id, c.full_name, c.phone_display, c.normalized_phone, c.email, c.marketing_sms_opt_in, c.marketing_opt_in, c.archived_at
      FROM customers c WHERE c.tenant_id = ${tid} AND c.id = ${t.customer_id}::uuid`.execute(this.db)).rows[0] : null;
    const contact = t.channel === 'email' ? (t.customer_contact ?? null) : (t.contact_normalized ?? normalizePhone(t.customer_contact) ?? t.customer_contact ?? null);
    const optedOut = contact && t.channel !== 'email'
      ? (await sql<Row>`SELECT 1 FROM notification_opt_outs o WHERE o.tenant_id = ${tid} AND o.channel = 'sms' AND o.address = ${contact} LIMIT 1`.execute(this.db)).rows.length > 0 : false;
    const next: Row | null | undefined = t.customer_id ? (await sql<Row>`SELECT a.id, to_char(a.appt_date, 'YYYY-MM-DD') AS appt_date_text, a.start_time, a.status, a.branch_id FROM pos_tech_appointments a
      WHERE a.tenant_id = ${tid} AND a.customer_id = ${t.customer_id}::uuid AND a.appt_date >= (now() AT TIME ZONE ${await this.salonTimeZone(tid)})::date
        AND a.status NOT IN ('cancelled', 'canceled', 'no_show', 'completed') AND ${this.branchOk(ctx, sql`a.branch_id`)}
      ORDER BY a.appt_date ASC, a.start_time ASC LIMIT 1`.execute(this.db)).rows[0] : null;
    let candidates = 0;
    if (!t.customer_id && t.customer_match === 'ambiguous' && contact) {
      const cr: Row | undefined = (await sql<Row>`SELECT count(*)::int AS n FROM customers c WHERE c.tenant_id = ${tid} AND c.archived_at IS NULL
        AND right(regexp_replace(COALESCE(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) = ${last10(contact)}`.execute(this.db)).rows[0];
      candidates = n(cr?.n);
    }
    const br: Row | null | undefined = t.branch_id ? (await sql<Row>`SELECT b.name FROM branches b WHERE b.tenant_id = ${tid} AND b.id = ${t.branch_id}::uuid`.execute(this.db)).rows[0] : null;
    const item = this.item({ ...t, activity_at: t.last_message_at ?? t.created_at, customer_full_name: cu?.full_name ?? null, branch_name: br?.name ?? null });
    return {
      thread: { ...item, contact: opts.showFullContact ? contact : item.contactMasked, customerMatch: t.customer_match ?? null, closedAt: iso(t.closed_at), lastInboundAt: iso(t.last_inbound_at) },
      customer: cu ? {
        id: String(cu.id), name: cu.full_name ?? null, phone: opts.showFullContact ? (cu.phone_display ?? cu.normalized_phone ?? null) : maskPhone(cu.normalized_phone ?? cu.phone_display),
        email: opts.showFullContact ? (cu.email ?? null) : maskEmail(cu.email), marketingSmsOptIn: !!(cu.marketing_sms_opt_in ?? cu.marketing_opt_in), archived: !!cu.archived_at,
      } : null,
      consent: { smsOptedOut: optedOut, marketingSmsOptIn: cu ? !!(cu.marketing_sms_opt_in ?? cu.marketing_opt_in) : null },
      nextAppointment: next ? { id: String(next.id), date: String(next.appt_date_text), startTime: next.start_time ?? null, status: next.status } : null,
      ambiguousCandidates: candidates,
    };
  }

  // ── unified customer timeline (guide §9.1 / Addendum §4.1) ───────────────────────────────────────────────────
  async timeline(ctx: InboxCtx, threadId: string, beforeRaw: string | null, sourcesRaw: string | null): Promise<{ customerId: string | null; scope: 'customer' | 'contact'; events: InboxTimelineEvent[]; olderCursor: string | null; sources: TimelineSource[] }> {
    const t = await this.mustThread(ctx, threadId);
    const tid = ctx.tenantId; const cid: string | null = t.customer_id ? String(t.customer_id) : null;
    const contact: string | null = t.contact_normalized ?? null;
    const want = new Set<TimelineSource>((sourcesRaw ? sourcesRaw.split(',').map((s) => s.trim()) : [...TIMELINE_SOURCES]).filter((s): s is TimelineSource => (TIMELINE_SOURCES as readonly string[]).includes(s)));
    const cur = decodeCursor(beforeRaw);
    const before = (col: Raw, idCol: Raw): Raw => cur ? sql`AND (${col} < ${cur.at}::timestamptz OR (${col} = ${cur.at}::timestamptz AND ${idCol}::text < ${cur.id}))` : sql``;
    const L = TIMELINE_PAGE + 1;
    const lists: InboxTimelineEvent[][] = [];
    const ev = (e: Partial<InboxTimelineEvent> & Pick<InboxTimelineEvent, 'id' | 'source' | 'type' | 'at'>): InboxTimelineEvent => ({ channel: 'none', direction: 'none', actorKind: 'system', actorName: null, state: null, body: null, summary: null, ref: null, threadId: null, errorCode: null, ...e });

    if (want.has('message')) {
      // every conversation of THIS customer the session may see (or only this one for an unlinked contact)
      const r = await sql<Row>`SELECT ${M_COLS}, nt.status AS n_status, nt.provider_status AS n_provider_status, nt.failure_reason AS n_failure, nt.provider_error_code AS n_error, nt.delivered_at AS n_delivered_at
        FROM communication_messages m JOIN communication_threads t ON t.tenant_id = ${tid} AND t.id = m.thread_id
        LEFT JOIN notifications nt ON nt.tenant_id = ${tid} AND nt.id = m.notification_id
        WHERE m.tenant_id = ${tid} AND t.tenant_id = ${tid} AND ${this.branchScope(ctx, null)} AND ${cid ? sql`t.customer_id = ${cid}::uuid` : sql`t.id = ${threadId}::uuid`} ${before(sql`m.created_at`, sql`m.id`)}
        ORDER BY m.created_at DESC, m.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => { const v = this.messageView(x); return ev({ id: v.id, source: 'message', type: v.direction === 'inbound' ? 'customer_message' : v.authorKind === 'ai' ? 'ai_reply' : v.authorKind === 'system' ? 'automated_reply' : 'staff_reply',
        channel: (v.channel === 'email' ? 'email' : v.channel === 'call' ? 'call' : 'sms'), direction: v.direction, actorKind: (['customer', 'staff', 'ai', 'system'].includes(v.authorKind) ? v.authorKind : 'staff') as InboxTimelineEvent['actorKind'], actorName: v.authorName, at: v.createdAt, state: v.delivery, body: v.body, threadId: v.threadId, errorCode: v.reasonCode }); }));
    }
    if (want.has('automated') && cid) {
      // ledger rows for this customer that are NOT already an inbox message (no double counting)
      const r = await sql<Row>`SELECT nt.id, nt.channel, nt.subject, nt.body, nt.status, nt.provider_status, nt.failure_reason, nt.purpose, nt.created_at, nt.delivered_at
        FROM notifications nt WHERE nt.tenant_id = ${tid} AND nt.customer_id = ${cid}::uuid AND ${this.branchOk(ctx, sql`nt.branch_id`)}   -- C2 audit: another branch's receipts / reminders stay hidden
          AND NOT EXISTS (SELECT 1 FROM communication_messages mx WHERE mx.tenant_id = ${tid} AND mx.notification_id = nt.id) ${before(sql`nt.created_at`, sql`nt.id`)}
        ORDER BY nt.created_at DESC, nt.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => { const k = automatedType(x.purpose); const st = deliveryState({ direction: 'outbound', messageStatus: 'sent', notificationId: String(x.id), ledgerStatus: x.status, providerStatus: x.provider_status, failureReason: x.failure_reason, providerErrorCode: null });
        return ev({ id: String(x.id), source: 'automated', type: k.type, channel: x.channel === 'email' ? 'email' : 'sms', direction: 'outbound', actorKind: 'system', at: iso(x.created_at)!, state: st,
          body: k.showBody ? String(x.body ?? '') : null, summary: x.channel === 'email' ? (x.subject ?? null) : null, ref: { kind: 'notification', id: String(x.id) }, errorCode: st === 'failed' || st === 'blocked' ? blockReasonCode(x.failure_reason) : null }); }));
    }
    if (want.has('review_request') && cid) {
      const r = await sql<Row>`SELECT rr.id, rr.channel, rr.status, rr.appointment_id, COALESCE(rr.sent_at, rr.created_at) AS at FROM review_requests rr
        WHERE rr.tenant_id = ${tid} AND rr.customer_id = ${cid}::uuid AND ${this.branchOk(ctx, sql`rr.branch_id`)} ${before(sql`COALESCE(rr.sent_at, rr.created_at)`, sql`rr.id`)}
        ORDER BY COALESCE(rr.sent_at, rr.created_at) DESC, rr.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => ev({ id: String(x.id), source: 'review_request', type: 'review_request', channel: x.channel === 'email' ? 'email' : x.channel === 'sms' ? 'sms' : 'app', direction: 'outbound', at: iso(x.at)!, state: String(x.status ?? ''), ref: x.appointment_id ? { kind: 'appointment', id: String(x.appointment_id) } : null })));
    }
    if (want.has('call') && (cid || contact)) {
      // AI Receptionist / phone calls — the summary only while the transcript is retained (not deleted, not expired)
      const who = cid ? sql`ce.customer_id = ${cid}::uuid` : sql`right(regexp_replace(COALESCE(ce.caller_phone, ''), '[^0-9]', '', 'g'), 10) = ${last10(contact)}`;
      const r = await sql<Row>`SELECT ce.id, ce.direction, ce.status, ce.ai_handled, ce.intent, ce.outcome, ce.duration_seconds, ce.provider_call_id, ce.recovered_appointment_id, COALESCE(ce.started_at, ce.created_at) AS at,
          (SELECT ti.quick_summary FROM call_transcript_intelligence ti JOIN call_transcripts ct ON ct.tenant_id = ${tid} AND ct.id = ti.transcript_id
             WHERE ti.tenant_id = ${tid} AND ti.provider_call_id = ce.provider_call_id AND ct.deleted_at IS NULL AND (ct.retention_expires_at IS NULL OR ct.retention_expires_at > now())
             ORDER BY ti.created_at DESC LIMIT 1) AS summary
        FROM call_intelligence_events ce WHERE ce.tenant_id = ${tid} AND ${who} AND ${this.branchOk(ctx, sql`ce.branch_id`)} ${before(sql`COALESCE(ce.started_at, ce.created_at)`, sql`ce.id`)}
        ORDER BY COALESCE(ce.started_at, ce.created_at) DESC, ce.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => ev({ id: String(x.id), source: 'call', type: x.status === 'missed' || x.outcome === 'missed' ? 'missed_call' : x.ai_handled ? 'ai_call' : 'call', channel: 'call',
        direction: x.direction === 'outbound' ? 'outbound' : 'inbound', actorKind: x.ai_handled ? 'ai' : 'customer', at: iso(x.at)!, state: String(x.outcome ?? x.status ?? ''),
        summary: x.summary ? preview(x.summary, 400) : null, ref: x.recovered_appointment_id ? { kind: 'appointment', id: String(x.recovered_appointment_id) } : { kind: 'call', id: String(x.id) } })));
    }
    if (want.has('ai_follow_up') && cid) {
      const r = await sql<Row>`SELECT f.id, f.reason, f.priority, f.status, f.due_at, f.appointment_id, f.created_at FROM ai_receptionist_follow_ups f
        WHERE f.tenant_id = ${tid} AND f.customer_id = ${cid}::uuid AND ${this.branchOk(ctx, sql`f.branch_id`)} ${before(sql`f.created_at`, sql`f.id`)}
        ORDER BY f.created_at DESC, f.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => ev({ id: String(x.id), source: 'ai_follow_up', type: 'follow_up_task', actorKind: 'ai', at: iso(x.created_at)!, state: String(x.status ?? ''),
        summary: x.reason ? preview(x.reason, 200) : null, ref: x.appointment_id ? { kind: 'appointment', id: String(x.appointment_id) } : null })));
    }
    if (want.has('appointment') && cid) {
      const r = await sql<Row>`SELECT a.id, to_char(a.appt_date, 'YYYY-MM-DD') AS appt_date_text, a.start_time, a.status, a.source, a.created_at FROM pos_tech_appointments a
        WHERE a.tenant_id = ${tid} AND a.customer_id = ${cid}::uuid AND ${this.branchOk(ctx, sql`a.branch_id`)} ${before(sql`a.created_at`, sql`a.id`)}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${L}`.execute(this.db);
      lists.push((r.rows as Row[]).map((x) => ev({ id: String(x.id), source: 'appointment', type: 'appointment_booked', actorKind: 'staff', at: iso(x.created_at)!, state: String(x.status ?? ''),
        summary: `${String(x.appt_date_text)} ${x.start_time ?? ''}`.trim(), ref: { kind: 'appointment', id: String(x.id) } })));
    }
    const merged = mergeTimeline(lists, TIMELINE_PAGE);
    return { customerId: cid, scope: cid ? 'customer' : 'contact', events: merged.events, olderCursor: merged.olderCursor, sources: [...want] };
  }

  // ── writes: read / unread / assign / status / snooze / link (version-checked, evented, audited by the caller) ──
  private async bump(db: Db, ctx: InboxCtx, id: string, set: Raw, expectedVersion: number | null, guard: Raw = sql`true`): Promise<Row> {
    const r = await sql<Row>`UPDATE communication_threads t SET ${set}, record_version = t.record_version + 1, updated_at = now(), updated_by = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid
      WHERE t.tenant_id = ${ctx.tenantId} AND t.id = ${id}::uuid AND ${guard} ${expectedVersion != null ? sql`AND t.record_version = ${expectedVersion}` : sql``} RETURNING ${T_COLS}`.execute(db);
    if (!r.rows.length) throw new InboxError('Someone else changed this conversation. It has been refreshed — try again.', 'INBOX_VERSION_CONFLICT', 409);
    return r.rows[0];
  }
  async event(db: Db, ctx: InboxCtx, threadId: string, type: string, prev: unknown, next: unknown, reason?: string | null, actorKind: 'staff' | 'system' = 'staff'): Promise<void> {
    await sql<Row>`INSERT INTO communication_thread_events (tenant_id, thread_id, event_type, actor_user_id, actor_kind, previous_value, new_value, reason)
      VALUES (${ctx.tenantId}, ${threadId}::uuid, ${type}, ${isUuid(ctx.userId) ? ctx.userId : null}::uuid, ${actorKind}, ${prev == null ? null : String(prev)}, ${next == null ? null : String(next)}, ${reason ?? null})`.execute(db);
  }
  async setRead(db: Db, ctx: InboxCtx, id: string, read: boolean): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    if (read && n(before.unread_count) === 0) return { before, after: before };
    if (!read && n(before.unread_count) > 0) return { before, after: before };
    const after = await this.bump(db, ctx, id, read ? sql`unread_count = 0` : sql`unread_count = 1`, null);
    await this.event(db, ctx, id, read ? 'read' : 'unread', before.unread_count, after.unread_count);
    return { before, after };
  }
  async assign(db: Db, ctx: InboxCtx, id: string, userId: string | null, expectedVersion: number | null): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    let name: string | null = null;
    if (userId) {
      const u: Row | undefined = (await sql<Row>`SELECT u.id, COALESCE(u.full_name, trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) AS name FROM users u
        WHERE u.tenant_id = ${ctx.tenantId} AND u.id = ${userId}::uuid AND COALESCE(u.status, 'active') NOT IN ('disabled', 'deleted', 'archived')`.execute(db)).rows[0];
      if (!u) throw new InboxError('Choose a team member of this salon.', 'INBOX_ASSIGNEE_INVALID', 400);
      name = u.name || null;
    }
    const after = await this.bump(db, ctx, id, sql`assigned_to = ${userId}::uuid, assigned_to_name = ${name}`, expectedVersion);
    await this.event(db, ctx, id, 'assigned', before.assigned_to, userId);
    return { before, after };
  }
  async setStatus(db: Db, ctx: InboxCtx, id: string, status: string, expectedVersion: number | null): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    if (before.status === status) return { before, after: before };
    const closing = status === 'closed';
    const after = await this.bump(db, ctx, id, sql`status = ${status}, closed_at = ${closing ? sql`now()` : sql`NULL`}`, expectedVersion, canMoveToSql(COMMUNICATION_THREAD, status, 't'));
    await this.event(db, ctx, id, 'status_changed', before.status, status);
    return { before, after };
  }
  async snooze(db: Db, ctx: InboxCtx, id: string, dueAt: string | null, expectedVersion: number | null, reason: string | null): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    const after = await this.bump(db, ctx, id, sql`follow_up_due_at = ${dueAt}::timestamptz`, expectedVersion);
    await this.event(db, ctx, id, 'snoozed', iso(before.follow_up_due_at), dueAt, reason);
    return { before, after };
  }
  async linkCustomer(db: Db, ctx: InboxCtx, id: string, customerId: string, expectedVersion: number | null): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    const c: Row | undefined = (await sql<Row>`SELECT c.id, c.full_name FROM customers c WHERE c.tenant_id = ${ctx.tenantId} AND c.id = ${customerId}::uuid AND c.archived_at IS NULL`.execute(db)).rows[0];
    if (!c) throw new InboxError('That customer could not be found.', 'CUSTOMER_NOT_FOUND', 404);
    const after = await this.bump(db, ctx, id, sql`customer_id = ${customerId}::uuid, customer_name = ${c.full_name ?? null}, customer_match = 'manual'`, expectedVersion);
    await this.event(db, ctx, id, 'customer_linked', before.customer_id, customerId);
    return { before, after };
  }

  /** C2 audit (Nov 4 2026) §9.3: a booking made from this conversation is linked to it — the appointment must be this salon's
   *  and, when the conversation has a customer, that customer's. Once per appointment (a retry changes nothing). */
  async linkBooking(db: Db, ctx: InboxCtx, id: string, appointmentId: string): Promise<{ before: Row; after: Row }> {
    const before = await this.mustThread(ctx, id, db, true);
    const a: Row | undefined = (await sql<Row>`SELECT a.id, a.customer_id FROM pos_tech_appointments a WHERE a.tenant_id = ${ctx.tenantId} AND a.id = ${appointmentId}::uuid`.execute(db)).rows[0];
    if (!a || (before.customer_id && a.customer_id && String(a.customer_id) !== String(before.customer_id))) throw new InboxError('That appointment could not be found for this conversation.', 'APPOINTMENT_NOT_FOUND', 404);
    const dup = (await sql<Row>`SELECT 1 FROM communication_thread_events WHERE tenant_id = ${ctx.tenantId} AND thread_id = ${id}::uuid AND event_type = 'booking_created' AND new_value = ${appointmentId}`.execute(db)).rows.length;
    if (dup) return { before, after: before };
    const after = await this.bump(db, ctx, id, sql`last_message_at = t.last_message_at`, null);
    await this.event(db, ctx, id, 'booking_created', null, appointmentId);
    return { before, after };
  }

  // ── outbound: reserve → provider → finalize (one staff Send = one message, whatever the retries) ─────────────────
  async reserveOutbound(ctx: InboxCtx, threadId: string, body: string, key: string, channel: string): Promise<{ id: string; existing: boolean }> {
    const ins = await sql<Row>`INSERT INTO communication_messages (tenant_id, thread_id, direction, channel, body, author_user_id, author_name, author_kind, status, idempotency_key)
      VALUES (${ctx.tenantId}, ${threadId}::uuid, 'outbound', ${channel}, ${body}, ${isUuid(ctx.userId) ? ctx.userId : null}::uuid,
        COALESCE(${ctx.userName ?? null}, (SELECT NULLIF(trim(COALESCE(u.full_name, COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))), '') FROM users u WHERE u.tenant_id = ${ctx.tenantId} AND u.id = ${isUuid(ctx.userId) ? ctx.userId : null}::uuid)),
        'staff', 'pending', ${key})
      ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`.execute(this.db);
    if (ins.rows.length) return { id: String((ins.rows[0] as Row).id), existing: false };
    const ex: Row | undefined = (await sql<Row>`SELECT m.id, m.thread_id FROM communication_messages m WHERE m.tenant_id = ${ctx.tenantId} AND m.idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (!ex || String(ex.thread_id) !== threadId) throw new InboxError('This request id was already used for another message. Refresh and try again.', 'INBOX_IDEMPOTENCY_REUSED', 409);
    return { id: String(ex.id), existing: true };
  }
  async finalizeOutbound(ctx: InboxCtx, threadId: string, messageId: string, out: { status: 'sent' | 'failed' | 'blocked'; notificationId: string | null; errorCode: string | null; body: string }): Promise<{ thread: Row }> {
    return this.db.transaction().execute(async (trx: Db) => {
      // the reserved row moves pending → sent | failed | blocked through its machine (never back, never twice)
      await sql<Row>`UPDATE communication_messages m SET status = ${out.status}, notification_id = ${out.notificationId}::uuid, error_code = ${out.errorCode}
        WHERE m.tenant_id = ${ctx.tenantId} AND m.id = ${messageId}::uuid AND ${canMoveToSql(COMMUNICATION_MESSAGE, out.status, 'm')}`.execute(trx);
      const t = await this.mustThread(ctx, threadId, trx, true);
      const left = out.status === 'sent';
      await sql<Row>`UPDATE communication_threads t SET last_message_at = now(), last_message_preview = ${preview(out.body)}, last_direction = 'outbound',
          last_outbound_at = ${left ? sql`now()` : sql`t.last_outbound_at`}, awaiting_reply_since = ${left ? sql`NULL` : sql`t.awaiting_reply_since`},
          unread_count = 0, record_version = t.record_version + 1, updated_at = now()
        WHERE t.tenant_id = ${ctx.tenantId} AND t.id = ${threadId}::uuid`.execute(trx);
      // a reply that left answers the customer: open / waiting / missed → replied, through the thread machine
      if (left && ['open', 'pending', 'missed'].includes(String(t.status))) {
        await sql<Row>`UPDATE communication_threads t SET status = 'replied' WHERE t.tenant_id = ${ctx.tenantId} AND t.id = ${threadId}::uuid AND ${canMoveToSql(COMMUNICATION_THREAD, 'replied', 't')}`.execute(trx);
        await this.event(trx, ctx, threadId, 'status_changed', t.status, 'replied', 'staff_reply', 'staff');
      }
      return { thread: await this.mustThread(ctx, threadId, trx) };
    });
  }

  // ── start a conversation (New Message) ────────────────────────────────────────────────────────────────────────
  async findOrCreateSmsThread(ctx: InboxCtx, input: { customerId: string | null; phone: string | null }): Promise<{ id: string; created: boolean }> {
    const tid = ctx.tenantId;
    let customer: Row | null = null; let phone: string | null = null;
    if (input.customerId) {
      customer = (await sql<Row>`SELECT c.id, c.full_name, c.normalized_phone, c.phone_display FROM customers c WHERE c.tenant_id = ${tid} AND c.id = ${input.customerId}::uuid AND c.archived_at IS NULL`.execute(this.db)).rows[0];
      if (!customer) throw new InboxError('That customer could not be found.', 'CUSTOMER_NOT_FOUND', 404);
      phone = normalizePhone(customer.normalized_phone ?? customer.phone_display);
      if (!phone) throw new InboxError('This customer has no valid mobile number on file.', 'SMS_PHONE_INVALID', 400);
    } else {
      phone = normalizePhone(input.phone);
      if (!phone) throw new InboxError('Enter a valid phone number to send a text message.', 'SMS_PHONE_INVALID', 400);
    }
    const ex: Row | undefined = (await sql<Row>`SELECT t.id FROM communication_threads t WHERE t.tenant_id = ${tid} AND ${this.branchScope(ctx, null)} AND t.channel = 'sms' AND t.contact_normalized = ${phone}
      ${customer ? sql`AND (t.customer_id = ${customer.id}::uuid OR t.customer_id IS NULL)` : sql``}
      ORDER BY (t.status <> 'closed') DESC, COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT 1`.execute(this.db)).rows[0];
    if (ex) return { id: String(ex.id), created: false };
    let match = customer ? 'exact_phone' : 'none'; let name: string | null = customer?.full_name ?? null; let cid: string | null = customer ? String(customer.id) : null;
    if (!customer) {
      const m = (await sql<Row>`SELECT c.id, c.full_name FROM customers c WHERE c.tenant_id = ${tid} AND c.archived_at IS NULL
        AND right(regexp_replace(COALESCE(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) = ${last10(phone)} LIMIT 2`.execute(this.db)).rows as Row[];
      if (m.length === 1) { match = 'exact_phone'; cid = String(m[0].id); name = m[0].full_name ?? null; } else if (m.length > 1) match = 'ambiguous';
    }
    const branch = ctx.branchId && isUuid(ctx.branchId) && (!this.allowed(ctx) || this.allowed(ctx)!.includes(ctx.branchId)) ? ctx.branchId : null;
    const r: Row = (await sql<Row>`INSERT INTO communication_threads (tenant_id, branch_id, customer_id, customer_name, customer_contact, contact_normalized, customer_match, channel, status, updated_by)
      VALUES (${tid}, ${branch}::uuid, ${cid}::uuid, ${name}, ${phone}, ${phone}, ${match}, 'sms', 'open', ${isUuid(ctx.userId) ? ctx.userId : null}::uuid) RETURNING id`.execute(this.db)).rows[0];
    return { id: String(r.id), created: true };
  }

  // ── composer helpers ──────────────────────────────────────────────────────────────────────────────────────────
  /** Published SMS templates this salon may use: its own + platform ones (tenant_id NULL), current published version. */
  async templates(ctx: InboxCtx, channel: 'sms' | 'email' = 'sms'): Promise<{ id: string; name: string; category: string | null; body: string; scope: 'salon' | 'platform' }[]> {
    const r = await sql<Row>`SELECT mt.id, mt.name, mt.category, mt.tenant_id, v.body FROM message_templates mt
      JOIN message_template_versions v ON v.template_id = mt.id AND v.version = mt.current_version AND v.status = 'published'
      WHERE (mt.tenant_id = ${ctx.tenantId} OR mt.tenant_id IS NULL) AND mt.status = 'published' AND mt.channel = ${channel}
      ORDER BY (mt.tenant_id IS NULL) ASC, mt.name ASC LIMIT 100`.execute(this.db);
    // the salon's own templates from POS → Settings → Message Templates (pos_message_templates) come first
    // 740: only ACTIVE templates are offered for new messages (drafts, deactivated and archived ones are not)
    const own = await sql<Row>`SELECT p.id, p.name, p.category, p.body FROM pos_message_templates p
      WHERE p.tenant_id = ${ctx.tenantId}::uuid AND p.channel = ${channel} AND p.status = 'active'
        AND ${ctx.branchId && isUuid(ctx.branchId) ? sql`(p.branch_id IS NULL OR p.branch_id = ${ctx.branchId}::uuid)` : sql`true`} ORDER BY lower(p.name), p.id LIMIT 100`.execute(this.db);
    return [
      ...(own.rows as Row[]).map((x) => ({ id: String(x.id), name: String(x.name), category: x.category ?? null, body: String(x.body ?? ''), scope: 'salon' as const })),
      ...(r.rows as Row[]).map((x) => ({ id: String(x.id), name: String(x.name), category: x.category ?? null, body: String(x.body ?? ''), scope: (x.tenant_id ? 'salon' : 'platform') as 'salon' | 'platform' })),
    ];
  }
  /** Customer lookup for Link Customer / New Message — this salon's customers only; phones masked in the list. */
  async lookupCustomers(ctx: InboxCtx, raw: string): Promise<{ id: string; name: string | null; phoneMasked: string | null; hasPhone: boolean; emailMasked: string | null }[]> {
    const q = String(raw ?? '').trim().slice(0, 100);
    if (q.length < 2) return [];
    const d = q.replace(/\D/g, ''); const digits = /^[\d\s()+.\-]+$/.test(q) && d.length >= 4 ? d.slice(-10) : null;
    const r = await sql<Row>`SELECT c.id, c.full_name, c.normalized_phone, c.phone_display, c.email FROM customers c
      WHERE c.tenant_id = ${ctx.tenantId} AND c.archived_at IS NULL AND (
        ${digits ? sql`right(regexp_replace(COALESCE(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) LIKE ${likeOf(digits)}` : sql`c.full_name ILIKE ${likeOf(q)} OR lower(c.email) LIKE ${likeOf(q.toLowerCase())}`}
        ${isUuid(q) ? sql`OR c.id = ${q}::uuid` : sql``})
      ORDER BY c.full_name ASC NULLS LAST, c.id ASC LIMIT 10`.execute(this.db);
    return (r.rows as Row[]).map((x) => ({ id: String(x.id), name: x.full_name ?? null, phoneMasked: maskPhone(x.normalized_phone ?? x.phone_display), hasPhone: !!normalizePhone(x.normalized_phone ?? x.phone_display), emailMasked: maskEmail(x.email) }));
  }
  async staff(ctx: InboxCtx): Promise<{ id: string; name: string }[]> {
    const r = await sql<Row>`SELECT u.id, COALESCE(u.full_name, trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) AS name FROM users u
      WHERE u.tenant_id = ${ctx.tenantId} AND COALESCE(u.status, 'active') NOT IN ('disabled', 'deleted', 'archived') AND COALESCE(u.role, '') NOT IN ('CUSTOMER', 'SUPER_ADMIN')
      ORDER BY 2 ASC LIMIT 200`.execute(this.db);
    return (r.rows as Row[]).map((x) => ({ id: String(x.id), name: String(x.name || '—') }));
  }
}

// ── inbound SMS (called by the signed Twilio webhook, AFTER signature + tenant resolution) ─────────────────────────
export interface InboundRecord { tenantId: string; from: string; to: string; body: string; messageSid: string | null; numMedia: number }
export interface InboundOutcome { threadId: string; messageId: string | null; branchId: string | null; duplicate: boolean; customerMatch: string }
/** Store one inbound text in the salon's inbox — idempotent on the Twilio MessageSid (a retried webhook is one message).
 *  The customer link is made only when exactly ONE customer of this salon has the number; a name never links. */
export async function recordInboundSms(db: Db, i: InboundRecord): Promise<InboundOutcome> {
  const contact = normalizePhone(i.from) ?? String(i.from || '').trim();
  const body = String(i.body ?? '').slice(0, 5000);
  return db.transaction().execute(async (trx: Db) => {
    const num: Row | undefined = (await sql<Row>`SELECT n.branch_id FROM tenant_messaging_numbers n WHERE n.tenant_id = ${i.tenantId} AND n.phone_number = ${i.to} LIMIT 1`.execute(trx)).rows[0] as Row | undefined;
    const branchId: string | null = num?.branch_id ? String(num.branch_id) : null;
    // C4 audit: a text to a BRANCH's own number joins that branch's conversation only (answered from that number); a text to
    // the salon number joins the customer's latest conversation wherever it is (as before)
    let t = (await sql<Row>`SELECT ${T_COLS} FROM communication_threads t WHERE t.tenant_id = ${i.tenantId} AND t.channel = 'sms' AND t.contact_normalized = ${contact}
        AND ${branchId ? sql`t.branch_id = ${branchId}::uuid` : sql`true`}
      ORDER BY (t.status <> 'closed') DESC, COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT 1 FOR UPDATE`.execute(trx)).rows[0] as Row | undefined;
    let match = t?.customer_match ?? 'none';
    if (!t || !t.customer_id) {
      const m = (await sql<Row>`SELECT c.id, c.full_name FROM customers c WHERE c.tenant_id = ${i.tenantId} AND c.archived_at IS NULL
        AND right(regexp_replace(COALESCE(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) = ${last10(contact)} LIMIT 2`.execute(trx)).rows as Row[];
      const cid = m.length === 1 ? String(m[0].id) : null; const name = m.length === 1 ? (m[0].full_name ?? null) : null;
      match = m.length === 1 ? 'exact_phone' : m.length > 1 ? 'ambiguous' : 'none';
      if (!t) {
        t = (await sql<Row>`INSERT INTO communication_threads AS t (tenant_id, branch_id, customer_id, customer_name, customer_contact, contact_normalized, customer_match, channel, status)
          VALUES (${i.tenantId}, ${branchId}::uuid, ${cid}::uuid, ${name}, ${contact}, ${contact}, ${match}, 'sms', 'open') RETURNING ${T_COLS}`.execute(trx)).rows[0] as Row;
      } else if (cid || match !== t.customer_match) {
        t = (await sql<Row>`UPDATE communication_threads t SET customer_id = ${cid}::uuid, customer_name = COALESCE(${name}, t.customer_name), customer_match = ${match}
          WHERE t.tenant_id = ${i.tenantId} AND t.id = ${t.id}::uuid RETURNING ${T_COLS}`.execute(trx)).rows[0] as Row;
      }
    }
    const thread = t as Row;
    const ins = await sql<Row>`INSERT INTO communication_messages (tenant_id, thread_id, direction, channel, body, author_kind, status, provider_message_sid, media_count)
      VALUES (${i.tenantId}, ${thread.id}::uuid, 'inbound', 'sms', ${body}, 'customer', 'delivered', ${i.messageSid}, ${i.numMedia || null})
      ${i.messageSid ? sql`ON CONFLICT (tenant_id, provider_message_sid) WHERE provider_message_sid IS NOT NULL AND direction = 'inbound' DO NOTHING` : sql``} RETURNING id`.execute(trx);
    if (!ins.rows.length) return { threadId: String(thread.id), messageId: null, branchId: thread.branch_id ? String(thread.branch_id) : null, duplicate: true, customerMatch: match };
    // C2 audit (Nov 4 2026): STOP / UNSUBSCRIBE … is kept in the conversation but is not a message waiting for an answer — it
    // no longer reopens the thread, counts as unread or tops "Longest unanswered" (the composer is blocked for that number)
    const optOut = parseInboundKeyword(body) === 'stop';
    await sql<Row>`UPDATE communication_threads t SET last_message_at = now(), last_message_preview = ${preview(body)}, last_direction = 'inbound', last_inbound_at = now(),
        unread_count = t.unread_count + ${optOut ? 0 : 1}, awaiting_reply_since = ${optOut ? sql`NULL` : sql`COALESCE(t.awaiting_reply_since, now())`}, record_version = t.record_version + 1, updated_at = now()
      WHERE t.tenant_id = ${i.tenantId} AND t.id = ${thread.id}::uuid`.execute(trx);
    // a customer writing again reopens a closed / replied / waiting conversation — through the thread machine
    if (!optOut && ['closed', 'replied', 'pending'].includes(String(thread.status))) {
      await sql<Row>`UPDATE communication_threads t SET status = 'open', closed_at = NULL WHERE t.tenant_id = ${i.tenantId} AND t.id = ${thread.id}::uuid AND ${canMoveToSql(COMMUNICATION_THREAD, 'open', 't')}`.execute(trx);
      await sql<Row>`INSERT INTO communication_thread_events (tenant_id, thread_id, event_type, actor_kind, previous_value, new_value, reason)
        VALUES (${i.tenantId}, ${thread.id}::uuid, 'status_changed', 'system', ${String(thread.status)}, 'open', 'customer_message')`.execute(trx);
    }
    return { threadId: String(thread.id), messageId: String((ins.rows[0] as Row).id), branchId: thread.branch_id ? String(thread.branch_id) : null, duplicate: false, customerMatch: match };
  });
}

/** The thread whose staff reply a ledger row belongs to (status callbacks → live update of the right conversation). */
export async function threadForNotification(db: Db, tenantId: string, notificationId: string): Promise<{ threadId: string; branchId: string | null } | null> {
  const r: Row | undefined = (await sql<Row>`SELECT m.thread_id, t.branch_id FROM communication_messages m JOIN communication_threads t ON t.tenant_id = ${tenantId} AND t.id = m.thread_id
    WHERE m.tenant_id = ${tenantId} AND m.notification_id = ${notificationId}::uuid LIMIT 1`.execute(db)).rows[0];
  return r ? { threadId: String(r.thread_id), branchId: r.branch_id ? String(r.branch_id) : null } : null;
}
export const answers = answersCustomer;
