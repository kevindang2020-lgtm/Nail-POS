// inbox.service.ts — the Communications / SMS Inbox use cases (guide Oct 30 2026 §5, §9, §10, §13, §16; Addendum §4).
// Permissions (existing RBAC, mapped — no new roles): read = pos.communications.view · reply / new message =
// pos.communications.send · assign / status / snooze / link customer = pos.communications.manage. Full phone / email in an
// opened conversation needs pos.customers.view (otherwise masked). Every write commits its thread event AND its audit row
// in one transaction (recordAuditStrict — a failed audit fails the change) and only then publishes the realtime event.
//
// SENDING (guide §5.3 / §10.1, owner rules): a reply goes through the ONE SMS path (TenantMessenger → notifications ledger)
// with purpose 'conversation', the conversation's branch (its own Twilio override, else the salon default) and
// requireOwnAccount — the platform's shared sender is never used. Before any provider call: the conversation must be an
// SMS conversation with a valid number, the salon's messaging readiness must not be BLOCKED, and the request carries an
// Idempotency-Key that reserves exactly one message row (a double click / retry returns the same message, never a second
// text). STOP opt-outs are enforced by the messenger (the attempt is recorded as blocked). The answer reports what the
// provider actually accepted; Delivered only ever comes from the signed status callback.
import { sql } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { recordAuditStrict } from '@aipowersalon/audit';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import type { TenantMessenger } from '@aipowersalon/notifications';
import { logException } from '@aipowersalon/observability';
import { InboxRepository, type InboxCtx, threadForNotification } from './inbox.repository';
import { recordTemplateUsage } from '../templates/message-templates';
import { InboxError, isUuid, parseInboxQuery, normalizePhone, MAX_BODY_CHARS, INBOX_STATUSES, KPI_DEFINITIONS, type InboxStatus } from './inbox-core';

/** The part of the messaging readiness service the inbox needs (TenantMessagingReadinessService.readiness). */
export interface InboxReadinessPort {
  readiness(tenantId: string, branchId: string | null, allowedBranches?: string[] | null): Promise<{ source: string; outbound: { state: string; reasonCode: string | null; blockers: string[]; warnings: string[]; deliveryTracking: boolean; fixLink?: string | null } }>;
}
export type ConversationEventKind = 'inbound' | 'outbound_submitted' | 'status_update' | 'read' | 'unread' | 'assigned' | 'status_changed' | 'snoozed' | 'customer_linked' | 'created';

const actorOf = (c: InboxCtx) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const versionOf = (v: unknown): number | null => { if (v === undefined || v === null || v === '') return null; const x = Number(v); return Number.isInteger(x) && x > 0 ? x : null; };

export class InboxService {
  constructor(
    private readonly repo: InboxRepository,
    private readonly messenger: TenantMessenger | null,
    private readonly readinessPort: InboxReadinessPort | null,
    private readonly realtime?: RealtimeEmitter | null,
  ) {}

  private need(ctx: InboxCtx, perm: string): void {
    if (!ctx?.tenantId || !ctx?.userId) throw new InboxError('Your role cannot do this.', 'PERMISSION_DENIED', 403);
    if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new InboxError('Your role cannot do this.', 'PERMISSION_DENIED', 403);
  }
  /** Ids + kind + version only; a broken bus never breaks the action (the client also polls / reconciles). The bus is per
   *  branch room: a branch conversation goes to its branch, a salon-wide one (no branch) to every branch of the salon. */
  emit(tenantId: string, branchId: string | null, threadId: string, kind: ConversationEventKind, version?: number | null): void {
    const payload = { threadId, kind, version: version ?? null };
    // §343 exempt: a momentary screen signal (this conversation changed; refetch, ids only) — the message row + audit are the fact
    const send = (b: string) => { try { this.realtime?.toTenant({ tenantId, branchId: b }, EVENTS.conversationUpdated, payload); } catch (e) { logException(e, { where: 'inbox.emit', kind }); } };
    if (!this.realtime) return;
    if (branchId) { send(branchId); return; }
    void this.repo.branchIdsOf(tenantId).then((ids) => ids.forEach(send), (e) => logException(e, { where: 'inbox.emit.branches', kind }));
  }

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: InboxCtx, q: Record<string, unknown>) {
    this.need(ctx, 'pos.communications.view');
    const query = parseInboxQuery(q);
    const page = await this.repo.list(ctx, query);
    return { ...page, filters: { channel: query.channel, status: query.status, assignee: query.assignee, unreadOnly: query.unreadOnly, awaitingOnly: query.awaitingOnly, basis: query.basis, hasSearch: !!query.search } };
  }
  async summary(ctx: InboxCtx, branch: string | null) {
    this.need(ctx, 'pos.communications.view');
    const k = await this.repo.kpis(ctx, branch);
    return { ...k, definitions: KPI_DEFINITIONS, generatedAt: new Date().toISOString() };
  }
  async detail(ctx: InboxCtx, id: string) {
    this.need(ctx, 'pos.communications.view');
    const d = await this.repo.detail(ctx, id, { showFullContact: hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.customers.view') });
    const msgs = await this.repo.messages(ctx, id, null);
    const canSend = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.communications.send');
    const canManage = hasPermission(ctx as Parameters<typeof hasPermission>[0], 'pos.communications.manage');
    return { ...d, messages: msgs.items, olderCursor: msgs.olderCursor, permissions: { canSend, canManage }, composer: await this.composerState(ctx, d.thread.channel, d.thread.branchId, d.consent.smsOptedOut, canSend) };
  }
  async olderMessages(ctx: InboxCtx, id: string, before: string | null) {
    this.need(ctx, 'pos.communications.view');
    return this.repo.messages(ctx, id, before);
  }
  async timeline(ctx: InboxCtx, id: string, before: string | null, sources: string | null) {
    this.need(ctx, 'pos.communications.view');
    return this.repo.timeline(ctx, id, before, sources);
  }
  async templates(ctx: InboxCtx) { this.need(ctx, 'pos.communications.send'); return { items: await this.repo.templates(ctx, 'sms') }; }
  async lookupCustomers(ctx: InboxCtx, q: string) { this.need(ctx, 'pos.communications.send'); return { items: await this.repo.lookupCustomers(ctx, q) }; }
  async staff(ctx: InboxCtx) { this.need(ctx, 'pos.communications.manage'); return { items: await this.repo.staff(ctx) }; }

  /** What the composer may do for this conversation — the truthful readiness, never a green light from a form. */
  async composerState(ctx: InboxCtx, channel: string, branchId: string | null, optedOut: boolean, canSend: boolean) {
    if (!canSend) return { enabled: false, reasonCode: 'NO_PERMISSION', readiness: null };
    if (channel === 'call') return { enabled: false, reasonCode: 'CALL_THREAD', readiness: null };
    if (channel === 'email') return { enabled: false, reasonCode: 'EMAIL_NOT_CONFIGURED', readiness: null };
    if (optedOut) return { enabled: false, reasonCode: 'OPTED_OUT', readiness: null };
    const r = await this.readiness(ctx, branchId);
    return { enabled: r.ok, reasonCode: r.ok ? null : r.reasonCode, readiness: r };
  }
  private async readiness(ctx: InboxCtx, branchId: string | null): Promise<{ ok: boolean; reasonCode: string | null; state: string; warnings: string[]; deliveryTracking: boolean; fixLink: string | null }> {
    if (!this.readinessPort) return { ok: false, reasonCode: 'READINESS_UNAVAILABLE', state: 'unknown', warnings: [], deliveryTracking: false, fixLink: null };
    try {
      const v = await this.readinessPort.readiness(ctx.tenantId, branchId, null);
      if (v.source === 'none') return { ok: false, reasonCode: 'NO_SALON_SENDER', state: 'blocked', warnings: [], deliveryTracking: false, fixLink: '/tenant/communications/messaging-setup' };
      const ok = v.outbound.state !== 'blocked';
      return { ok, reasonCode: ok ? null : (v.outbound.blockers[0] ?? v.outbound.reasonCode ?? 'SENDER_NOT_READY'), state: v.outbound.state, warnings: v.outbound.warnings ?? [],
        deliveryTracking: !!v.outbound.deliveryTracking, fixLink: v.outbound.fixLink ?? '/tenant/communications/messaging-setup' };
    } catch (e) {
      logException(e, { where: 'inbox.readiness' });
      return { ok: false, reasonCode: 'READINESS_UNAVAILABLE', state: 'unknown', warnings: [], deliveryTracking: false, fixLink: null };
    }
  }

  // ── reply / new message ───────────────────────────────────────────────────────────────────────────────────────
  async reply(ctx: InboxCtx, threadId: string, bodyRaw: unknown, key: string | null, templateId: string | null = null) {
    this.need(ctx, 'pos.communications.send');
    const body = typeof bodyRaw === 'string' ? bodyRaw.trim() : '';
    if (!body) throw new InboxError('Type a message first.', 'MESSAGE_BODY_REQUIRED', 400);
    if (body.length > MAX_BODY_CHARS) throw new InboxError(`Messages can be at most ${MAX_BODY_CHARS} characters.`, 'INBOX_BODY_TOO_LONG', 400);
    if (!key || key.length < 8 || key.length > 200) throw new InboxError('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED', 400);
    const t = await this.repo.mustThread(ctx, threadId);
    if (t.channel !== 'sms') throw new InboxError(t.channel === 'email' ? 'Email replies are not set up for this salon.' : 'A call conversation cannot be answered here — text the caller instead.', 'INBOX_CHANNEL_NOT_SUPPORTED', 409, { channel: t.channel });
    const to = t.contact_normalized ?? normalizePhone(t.customer_contact);
    if (!to) throw new InboxError('This conversation has no valid phone number.', 'SMS_PHONE_INVALID', 400);
    const branchId: string | null = t.branch_id ? String(t.branch_id) : null;

    // one Send = one message: the key reserves the row before anything leaves (a retry returns the same message)
    const res = await this.repo.reserveOutbound(ctx, threadId, body, key, 'sms');
    if (res.existing) return { message: await this.repo.message(ctx, res.id), duplicate: true, thread: await this.threadVersion(ctx, threadId) };

    const ready = await this.readiness(ctx, branchId);
    let outcome: { status: 'sent' | 'failed' | 'blocked'; notificationId: string | null; errorCode: string | null };
    if (!ready.ok) outcome = { status: 'blocked', notificationId: null, errorCode: ready.reasonCode };
    else if (!this.messenger) outcome = { status: 'blocked', notificationId: null, errorCode: 'MESSENGER_UNAVAILABLE' };
    else {
      try {
        const r = await this.messenger.sendSms({ tenantId: ctx.tenantId, branchId, to, body, purpose: 'conversation', customerId: t.customer_id ? String(t.customer_id) : null, meter: true, requireOwnAccount: true, source: { type: 'thread', id: String(t.id) } });
        outcome = r.sent ? { status: 'sent', notificationId: r.notificationId ?? null, errorCode: null }
          : { status: r.status === 'blocked' ? 'blocked' : 'failed', notificationId: r.notificationId ?? null, errorCode: (r.reason ?? 'send_failed').slice(0, 80) };
      } catch (e) {
        logException(e, { where: 'inbox.reply.send' });
        outcome = { status: 'failed', notificationId: null, errorCode: 'send_failed' };
      }
    }
    const fin = await this.repo.finalizeOutbound(ctx, threadId, res.id, { ...outcome, body });
    await recordAuditStrict(this.repo.db, actorOf(ctx), { module: 'communications', action: 'inbox.reply.' + outcome.status, resourceType: 'communication_thread', resourceId: threadId,
      summary: outcome.status === 'sent' ? 'SMS reply handed to the provider' : `SMS reply not sent (${outcome.errorCode ?? outcome.status})`, status: outcome.status === 'sent' ? 'success' : 'failure',
      severity: outcome.status === 'sent' ? 'info' : 'warning', metadata: { messageId: res.id, notificationId: outcome.notificationId, reason: outcome.errorCode, chars: body.length } });
    // Message Templates (740): a reply that came from one of the salon's ACTIVE templates records that exact version, the
    // text actually sent (staff may have edited it) and the ledger row — the template's usage history. Platform templates
    // and hand-typed texts stay unlinked. A usage write never turns a sent reply into an error.
    if (templateId) {
      try {
        const tpl = (await sql<{ current_version: number; status: string }>`select current_version, status from pos_message_templates where tenant_id = ${ctx.tenantId} and id = ${templateId}`.execute(this.repo.db)).rows[0];
        if (tpl && tpl.status === 'active') {
          await recordTemplateUsage(this.repo.db, { tenantId: ctx.tenantId, branchId, templateId, version: Number(tpl.current_version) || 1, workflow: 'sms_inbox', channel: 'sms',
            customerId: t.customer_id ? String(t.customer_id) : null, threadId, messageId: res.id, notificationId: outcome.notificationId, recipientMasked: to ? `••• ${to.replace(/\D/g, '').slice(-4)}` : null,
            body, outcome: outcome.status === 'sent' ? 'submitted' : outcome.status, reason: outcome.errorCode, actorId: ctx.userId ?? null });
        }
      } catch (e) { logException(e, { where: 'inbox.reply.template_usage' }); }
    }
    this.emit(ctx.tenantId, branchId, threadId, 'outbound_submitted', Number(fin.thread?.record_version ?? 0) || null);
    return { message: await this.repo.message(ctx, res.id), duplicate: false, thread: await this.threadVersion(ctx, threadId), readiness: { state: ready.state, warnings: ready.warnings, deliveryTracking: ready.deliveryTracking } };
  }
  private async threadVersion(ctx: InboxCtx, id: string) { const t = await this.repo.mustThread(ctx, id); return { id, version: Number(t.record_version) || 1, status: String(t.status), unreadCount: Number(t.unread_count) || 0 }; }

  /** New Message: open (or reuse) this salon's SMS conversation with a customer / number. Nothing is sent here. */
  async startConversation(ctx: InboxCtx, b: { customerId?: unknown; phone?: unknown }) {
    this.need(ctx, 'pos.communications.send');
    const customerId = isUuid(b?.customerId) ? String(b.customerId) : null;
    const phone = typeof b?.phone === 'string' ? b.phone : null;
    if (!customerId && !phone) throw new InboxError('Choose a customer or enter a phone number.', 'VALIDATION_FAILED', 400, { field: 'customerId' });
    const r = await this.repo.findOrCreateSmsThread(ctx, { customerId, phone });
    if (r.created) {
      await recordAuditStrict(this.repo.db, actorOf(ctx), { module: 'communications', action: 'inbox.conversation.created', resourceType: 'communication_thread', resourceId: r.id, summary: 'SMS conversation opened from the inbox', metadata: { byCustomer: !!customerId } });
      const t = await this.repo.mustThread(ctx, r.id); this.emit(ctx.tenantId, t.branch_id ? String(t.branch_id) : null, r.id, 'created', Number(t.record_version));
    }
    return { threadId: r.id, created: r.created };
  }

  // ── conversation actions (version-checked; audited in the same transaction) ───────────────────────────────────
  private async mutate(ctx: InboxCtx, perm: string, threadId: string, action: string, kind: ConversationEventKind,
    fn: (trx: any) => Promise<{ before: any; after: any }>, meta: (b: any, a: any) => Record<string, unknown>) {
    this.need(ctx, perm);
    if (!isUuid(threadId)) throw new InboxError('That conversation could not be found.', 'CONVERSATION_NOT_FOUND', 404);
    const out = await this.repo.db.transaction().execute(async (trx: any) => {
      const r = await fn(trx);
      if (r.after !== r.before) {
        await recordAuditStrict(trx, actorOf(ctx), { module: 'communications', action, resourceType: 'communication_thread', resourceId: threadId,
          summary: `Conversation ${action.split('.').pop()}`, metadata: meta(r.before, r.after) });
      }
      return r;
    });
    if (out.after !== out.before) this.emit(ctx.tenantId, out.after.branch_id ? String(out.after.branch_id) : null, threadId, kind, Number(out.after.record_version));
    return { id: threadId, version: Number(out.after.record_version) || 1, status: String(out.after.status), unreadCount: Number(out.after.unread_count) || 0,
      assignedTo: out.after.assigned_to ? String(out.after.assigned_to) : null, assignedToName: out.after.assigned_to_name ?? null,
      followUpDueAt: out.after.follow_up_due_at ? new Date(out.after.follow_up_due_at).toISOString() : null, customerId: out.after.customer_id ? String(out.after.customer_id) : null, changed: out.after !== out.before };
  }
  markRead(ctx: InboxCtx, id: string) {
    return this.mutate(ctx, 'pos.communications.view', id, 'inbox.read', 'read', (trx) => this.repo.setRead(trx, ctx, id, true), (b) => ({ unreadBefore: Number(b.unread_count) || 0 }));
  }
  markUnread(ctx: InboxCtx, id: string) {
    return this.mutate(ctx, 'pos.communications.view', id, 'inbox.unread', 'unread', (trx) => this.repo.setRead(trx, ctx, id, false), () => ({}));
  }
  assign(ctx: InboxCtx, id: string, b: { userId?: unknown; expectedVersion?: unknown }) {
    const userId = b?.userId === null || b?.userId === '' ? null : isUuid(b?.userId) ? String(b.userId) : undefined;
    if (userId === undefined) throw new InboxError('Choose a team member of this salon.', 'INBOX_ASSIGNEE_INVALID', 400);
    return this.mutate(ctx, 'pos.communications.manage', id, 'inbox.assigned', 'assigned', (trx) => this.repo.assign(trx, ctx, id, userId, versionOf(b?.expectedVersion)),
      (bf, af) => ({ from: bf.assigned_to ?? null, to: af.assigned_to ?? null }));
  }
  setStatus(ctx: InboxCtx, id: string, b: { status?: unknown; expectedVersion?: unknown }) {
    const status = typeof b?.status === 'string' && (INBOX_STATUSES as readonly string[]).includes(b.status) ? (b.status as InboxStatus) : null;
    if (!status) throw new InboxError('Choose Open, Waiting, Replied, Missed or Closed.', 'VALIDATION_FAILED', 400, { field: 'status' });
    return this.mutate(ctx, 'pos.communications.manage', id, 'inbox.status_changed', 'status_changed', (trx) => this.repo.setStatus(trx, ctx, id, status, versionOf(b?.expectedVersion)),
      (bf) => ({ from: bf.status, to: status }));
  }
  snooze(ctx: InboxCtx, id: string, b: { dueAt?: unknown; expectedVersion?: unknown; reason?: unknown }) {
    let dueAt: string | null = null;
    if (b?.dueAt !== null && b?.dueAt !== undefined && b?.dueAt !== '') {
      const d = new Date(String(b.dueAt));
      if (Number.isNaN(d.getTime())) throw new InboxError('Enter a valid date and time.', 'DATE_INVALID', 400, { field: 'dueAt' });
      if (d.getTime() > Date.now() + 366 * 86_400_000) throw new InboxError('Choose a follow-up time within a year.', 'DATE_RANGE_TOO_LARGE', 400);
      dueAt = d.toISOString();
    }
    const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 200) || null : null;
    return this.mutate(ctx, 'pos.communications.manage', id, 'inbox.follow_up_set', 'snoozed', (trx) => this.repo.snooze(trx, ctx, id, dueAt, versionOf(b?.expectedVersion), reason),
      () => ({ dueAt, hasReason: !!reason }));
  }
  linkCustomer(ctx: InboxCtx, id: string, b: { customerId?: unknown; expectedVersion?: unknown }) {
    if (!isUuid(b?.customerId)) throw new InboxError('Choose a customer of this salon.', 'CUSTOMER_NOT_FOUND', 404);
    return this.mutate(ctx, 'pos.communications.manage', id, 'inbox.customer_linked', 'customer_linked', (trx) => this.repo.linkCustomer(trx, ctx, id, String(b.customerId), versionOf(b?.expectedVersion)),
      (bf) => ({ previousCustomerId: bf.customer_id ?? null, customerId: String(b.customerId), previousMatch: bf.customer_match ?? null }));
  }

  /** A provider status callback moved a ledger row — tell the inbox showing that conversation (ids only). */
  async notifyDeliveryStatus(tenantId: string, notificationId: string): Promise<void> {
    try { const t = await threadForNotification(this.repo.db, tenantId, notificationId); if (t) this.emit(tenantId, t.branchId, t.threadId, 'status_update'); }
    catch (e) { logException(e, { where: 'inbox.notifyDeliveryStatus' }); }
  }
}

