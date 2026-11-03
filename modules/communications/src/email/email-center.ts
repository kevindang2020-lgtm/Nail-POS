// email-center.ts — Communications → Email: the Email Management & Delivery Center (Email Complete Build Guide, Oct 31 2026).
// A READ model over the ONE ledger (`notifications`, channel 'email') plus its verified provider events, and four actions
// that all go through the ONE email path (NotificationsService.sendEmail) or the existing protected resend:
//   check provider   the provider's own credential check (never a send), recorded append-only (748 email_health_checks)
//   test email       to a staff member of THIS salon only (controlled recipient), confirmed, one key → one attempt
//   compose          to a customer of THIS salon — the address is read from the customer record, never typed by the client
//   resend           CustomerNotificationsCenter.retry (741): confirmed, idempotent, re-validated, one per failed email
// Honesty rules (§05 / §12): "Sent" = accepted by the provider; "Delivered" only from signed provider events — with no event
// source the page says N/A, never 0 and never a green badge; a saved credential alone is "not checked", never "healthy".
import { sql, type Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { hasPermission } from '@aipowersalon/permissions';
type PermCtx = Parameters<typeof hasPermission>[0];
import { recordAuditStrict } from '@aipowersalon/audit';
type AuditActor = Parameters<typeof recordAuditStrict>[1];
import { isNotConfiguredSender, isSimulatedSender, emailFromAddress, type EmailSender, type TenantEmailRequest, type TenantSendResult } from '@aipowersalon/notifications';
import { CnError, type CustomerNotificationsCenter, type CnContext } from '../notifications/customer-notifications';
import { type EmailPolicyPort, EMAIL_RE } from './email-policy';

export type EcContext = CnContext;
export interface EcMessenger { sendEmail(req: TenantEmailRequest): Promise<TenantSendResult & { duplicate?: boolean }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const err = (msg: string, code: string, status = 400, extra: Record<string, unknown> = {}) => withCode(new CnError(msg, code, status, extra), code as Parameters<typeof withCode>[1]);
const STATUSES = ['accepted', 'delivered', 'failed', 'bounced', 'blocked', 'suppressed', 'simulated'] as const;
const CATEGORIES = ['booking', 'receipt', 'reminder', 'follow_up', 'marketing', 'manual'] as const;
const BASES = ['created', 'sent', 'event', 'booking', 'receipt'] as const;
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(String(v ?? '') as T) ? (String(v) as T) : d);
const mask = (e: string) => { const [u, d] = String(e ?? '').split('@'); return d ? `${u.slice(0, 1)}•••@${d}` : '•••'; };

/** how a ledger row reads on the page (pure; tested) — provider-derived, never optimistic */
export function emailDisplayStatus(r: { status: string; failure_reason?: string | null }): (typeof STATUSES)[number] {
  const s = String(r.status); const why = String(r.failure_reason ?? '');
  if (s === 'delivered') return 'delivered';
  if (s === 'sent') return 'accepted';
  if (s === 'simulated') return 'simulated';
  if (s === 'failed') return /^bounced|^blocked/.test(why) ? 'bounced' : 'failed';
  return /opted_out|disabled/.test(why) ? 'suppressed' : 'blocked';
}
export function emailCategory(r: { purpose?: string | null; source_type?: string | null }): (typeof CATEGORIES)[number] {
  if (r.source_type === 'appointment') return 'booking';
  if (r.purpose === 'receipt') return 'receipt';
  if (r.purpose === 'reminder') return 'reminder';
  if (r.purpose === 'followup' || r.source_type === 'follow_up') return 'follow_up';
  if (r.purpose === 'marketing' || r.source_type === 'campaign') return 'marketing';
  return 'manual';
}

export class EmailCenter {
  constructor(private readonly db: Kysely<any>, private readonly cn: CustomerNotificationsCenter, private readonly messenger: EcMessenger | null,
    private readonly sender: EmailSender | null, private readonly policy: EmailPolicyPort | null, private readonly env: NodeJS.ProcessEnv = process.env, private readonly now: () => number = Date.now) {}

  private need(ctx: EcContext, p: string) { if (!hasPermission(ctx as unknown as PermCtx, p)) throw err('You do not have permission to do this.', 'PERMISSION_DENIED', 403); }
  private audit(ctx: EcContext, action: string, id: string | null, summary: string, metadata: Record<string, unknown> = {}, status: 'success' | 'failure' = 'success') {
    const actor: AuditActor = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null };
    return recordAuditStrict(this.db, actor, { module: 'communications', action, resourceType: 'email', resourceId: id, summary, status, severity: status === 'success' ? 'info' : 'warning', metadata });
  }
  private inP(col: any, p: { from: string | null; to: string | null; tz: string }) {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  private basisCol(basis: string) {
    if (basis === 'event') return sql`(select max(e.received_at) from notification_delivery_events e where e.tenant_id = n.tenant_id and e.notification_id = n.id)`;
    if (basis === 'booking') return sql`(select (a.appt_date + a.start_time) at time zone coalesce(b.timezone, 'America/New_York') from pos_tech_appointments a left join branches b on b.id = a.branch_id
        where a.tenant_id = n.tenant_id and n.source_type = 'appointment' and a.id::text = n.source_id)`;
    if (basis === 'receipt') return sql`(select min(r.created_at) from receipts r where r.tenant_id = n.tenant_id and n.source_type = 'ticket' and r.ticket_id::text = n.source_id)`;
    if (basis === 'sent') return sql`(case when n.status in ('sent', 'delivered', 'simulated') then n.created_at end)`;
    return sql`n.created_at`;
  }
  private async callbacksConfigured(): Promise<boolean> { return String(this.env.SENDGRID_WEBHOOK_VERIFICATION_KEY ?? '').trim().length > 40; }

  // ── settings (the photographed fields, as the send path honours them) ───────────────────────────────────────────────
  async settings(ctx: EcContext) {
    this.need(ctx, 'pos.communications.view');
    if (!this.policy) throw err('Email settings are not available here.', 'EMAIL_NOT_AVAILABLE', 503);
    const s = await this.policy.settings(ctx.tenantId, ctx.branchId ?? null);
    const row = (await sql<any>`select max(updated_at) as at from tenant_settings where tenant_id = ${ctx.tenantId}::uuid and category = 'notifications'
        and (branch_id is null or ${ctx.branchId && UUID.test(ctx.branchId) ? sql`branch_id = ${ctx.branchId}::uuid` : sql`false`})`.execute(this.db)).rows[0];
    return { ...s, fromAddress: emailFromAddress(this.env), savedAt: iso(row?.at), canEdit: hasPermission(ctx as unknown as PermCtx, 'settings.edit') };
  }

  // ── KPIs (§12 dashboard math) ────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: EcContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.cn.period(ctx, q, 'month');
    const r = (await sql<any>`select count(*) filter (where n.status in ('sent', 'delivered'))::int as accepted, count(*) filter (where n.status = 'delivered')::int as delivered,
        count(*) filter (where n.status = 'failed' and coalesce(n.failure_reason, '') !~ '^(bounced|blocked)')::int as failed, count(*) filter (where n.status = 'failed' and n.failure_reason ~ '^(bounced|blocked)')::int as bounced,
        count(*) filter (where n.status = 'blocked')::int as blocked, count(*) filter (where n.status = 'simulated')::int as simulated,
        count(distinct n.source_id) filter (where n.source_type = 'appointment')::int as booking, count(*) filter (where n.purpose = 'receipt')::int as receipts,
        count(*) filter (where (n.status in ('sent', 'delivered') or (n.status = 'failed' and n.failure_reason ~ '^(bounced|blocked)')) and exists (select 1 from notification_delivery_events e where e.tenant_id = n.tenant_id and e.notification_id = n.id))::int as with_events
      from notifications n where n.tenant_id = ${T}::uuid and n.channel = 'email' and ${this.inP(sql`n.created_at`, p)}`.execute(this.db)).rows[0] ?? {};
    const everEvents = N((await sql<any>`select count(*)::int as n from notification_delivery_events e join notifications n on n.id = e.notification_id and n.tenant_id = e.tenant_id
        where e.tenant_id = ${T}::uuid and n.channel = 'email'`.execute(this.db)).rows[0]?.n) > 0;
    const health = await this.health(ctx);
    // Delivered / rate exist only where verified events exist; otherwise N/A (null), never 0
    const eventsKnown = everEvents && (await this.callbacksConfigured());
    return {
      window: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today, basis: 'created' },
      provider: health.overall,
      accepted: N(r.accepted), delivered: eventsKnown ? N(r.delivered) : null, failed: N(r.failed), bounced: N(r.bounced), blocked: N(r.blocked), simulated: N(r.simulated),
      bookingConfirmations: N(r.booking), receipts: N(r.receipts),
      deliveryRate: eventsKnown && N(r.with_events) > 0 ? Math.round((N(r.delivered) / N(r.with_events)) * 1000) / 10 : null,
      deliveryRateDenominator: eventsKnown ? 'emails the provider accepted that have at least one verified provider event — delivered, still pending, or bounced / blocked by the receiver (emails with no event yet are excluded as Unknown)' : null,
      definitions: { accepted: 'handed to the provider and accepted (not proof of delivery)', delivered: 'verified provider "delivered" events only', bounced: 'provider bounce / block events', blocked: 'never handed to the provider (setting off, suppressed, not configured, invalid address)' },
    };
  }

  // ── health (§05 state machine; recommendation 4.1) ──────────────────────────────────────────────────────────────────
  async health(ctx: EcContext) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId;
    const configured = !!this.sender && !isNotConfiguredSender(this.sender); const testSender = !!this.sender && isSimulatedSender(this.sender);
    const configuration = !this.sender || !configured ? 'not_configured' : testSender ? 'incomplete' : 'ready_to_check';
    const last = (await sql<any>`select provider_health, issue_code, detail, checked_at from email_health_checks where tenant_id = ${T}::uuid order by checked_at desc limit 1`.execute(this.db)).rows[0];
    const lastOk = (await sql<any>`select checked_at from email_health_checks where tenant_id = ${T}::uuid and provider_health = 'healthy' order by checked_at desc limit 1`.execute(this.db)).rows[0];
    const stale = last ? this.now() - new Date(last.checked_at).getTime() > 24 * 3600_000 : true;
    const provider = !configured ? 'unknown' : !last ? 'not_checked' : stale ? 'unknown' : String(last.provider_health);
    const ev = (await sql<any>`select max(e.received_at) as at from notification_delivery_events e join notifications n on n.id = e.notification_id and n.tenant_id = e.tenant_id where e.tenant_id = ${T}::uuid and n.channel = 'email'`.execute(this.db)).rows[0];
    const cbConfigured = await this.callbacksConfigured();
    const callbacks = !cbConfigured ? 'not_configured' : !ev?.at ? 'unknown' : this.now() - new Date(ev.at).getTime() > 7 * 24 * 3600_000 ? 'stale' : 'receiving';
    const f = (await sql<any>`select count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status in ('sent', 'delivered', 'failed'))::int as attempts, max(created_at) filter (where status = 'failed') as last_fail,
        (select failure_reason from notifications where tenant_id = ${T}::uuid and channel = 'email' and status = 'failed' order by created_at desc limit 1) as last_reason
      from notifications where tenant_id = ${T}::uuid and channel = 'email' and created_at >= now() - interval '24 hours'`.execute(this.db)).rows[0] ?? {};
    const degraded = N(f.failed) >= 3 && N(f.failed) / Math.max(1, N(f.attempts)) >= 0.25;
    const layers = [
      { key: 'configuration', state: configuration, detail: configuration === 'not_configured' ? 'No email provider is configured for this platform (SENDGRID_API_KEY is not set).' : testSender ? 'Test sender — emails are recorded, nothing leaves this environment.' : 'A provider API key is configured (its value is never shown).', next: configuration === 'not_configured' ? 'configure_provider' : null },
      { key: 'sender_identity', state: 'unknown', detail: `From ${emailFromAddress(this.env)} with your salon's display name. Domain authentication (SPF / DKIM / DMARC) is checked in the provider's account and cannot be read from here.`, next: 'verify_domain' },
      { key: 'provider_health', state: provider, detail: last ? String(last.detail ?? '') : 'Never checked.', checkedAt: iso(last?.checked_at), lastSuccessAt: iso(lastOk?.checked_at), next: provider === 'healthy' ? null : last?.issue_code === 'auth_failed' ? 'correct_credentials' : 'retry_health_check' },
      { key: 'callbacks', state: callbacks, detail: !cbConfigured ? 'Signed delivery events are not set up (SENDGRID_WEBHOOK_VERIFICATION_KEY is not set) — delivery cannot be confirmed.' : ev?.at ? `Last verified event ${iso(ev.at)}.` : 'No verified delivery event has arrived yet.', lastEventAt: iso(ev?.at), next: callbacks === 'receiving' ? null : 'check_webhook' },
      { key: 'recent_failures', state: degraded ? 'degraded' : 'ok', detail: `${N(f.failed)} of ${N(f.attempts)} email attempts failed in the last 24 hours.`, lastReason: f.last_reason ?? null, lastFailedAt: iso(f.last_fail), next: degraded ? 'open_failures' : null },
    ];
    // a test sender never reads Ready: nothing it 'sends' leaves this environment
    const overall = configuration === 'not_configured' ? 'setup_required' : !last ? 'unknown' : provider === 'healthy' && callbacks === 'receiving' && !degraded && !testSender ? 'ready' : 'attention_required';
    return { overall, layers, fromAddress: emailFromAddress(this.env), lastCheckedAt: iso(last?.checked_at), lastSuccessAt: iso(lastOk?.checked_at) };
  }

  async checkHealth(ctx: EcContext) {
    this.need(ctx, 'pos.communications.manage');
    const T = ctx.tenantId;
    const recent = (await sql<any>`select 1 from email_health_checks where tenant_id = ${T}::uuid and trigger_type = 'manual' and checked_at > now() - interval '60 seconds'`.execute(this.db)).rows.length;
    if (recent) throw err('A check ran less than a minute ago. Try again shortly.', 'EMAIL_HEALTH_RATE_LIMITED', 429);
    const configured = !!this.sender && !isNotConfiguredSender(this.sender);
    const v = configured && this.sender?.verify ? await this.sender.verify() : null;
    const provider = !configured ? 'unknown' : !v ? 'unknown' : v.status === 'healthy' ? 'healthy' : 'down';   // auth_failed and down are both 'down'; issue_code keeps which (the next step differs)
    const cb = await this.callbacksConfigured();
    const overall = !configured ? 'setup_required' : provider === 'healthy' && cb ? 'ready' : 'attention_required';
    await sql`insert into email_health_checks (tenant_id, trigger_type, configuration, sender_identity, provider_health, callbacks, overall, issue_code, detail, checked_by)
      values (${T}::uuid, 'manual', ${!configured ? 'not_configured' : isSimulatedSender(this.sender) ? 'incomplete' : 'ready_to_check'}, 'unknown', ${provider}, ${cb ? 'unknown' : 'not_configured'}, ${overall},
              ${v?.status && v.status !== 'healthy' ? v.status : !configured ? 'not_configured' : null}, ${v?.detail ?? (configured ? 'The provider cannot report a status.' : 'No email provider is configured.')}, ${UUID.test(String(ctx.userId)) ? ctx.userId : null}::uuid)`.execute(this.db);
    await this.audit(ctx, 'email.health_checked', null, `Email provider check: ${provider}`, { provider, overall });
    return this.health(ctx);
  }

  // ── history (§07 / §08) ─────────────────────────────────────────────────────────────────────────────────────────────
  async history(ctx: EcContext, q: Record<string, unknown> = {}) {
    this.need(ctx, 'pos.communications.view');
    const T = ctx.tenantId; const p = await this.cn.period(ctx, q, 'month');
    const basis = oneOf(q.basis, BASES, 'created'); const status = q.status ? oneOf(q.status, STATUSES, 'accepted') : null; const category = q.category ? oneOf(q.category, CATEGORIES, 'manual') : null;
    const pageSize = [10, 20, 50].includes(Number(q.pageSize)) ? Number(q.pageSize) : 20;
    const text = String(q.q ?? '').trim().slice(0, 120);
    const parts: any[] = [sql`n.tenant_id = ${T}::uuid`, sql`n.channel = 'email'`, this.inP(this.basisCol(basis), p)];
    if (basis !== 'created') parts.push(sql`${this.basisCol(basis)} is not null`);
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (m) => '\\' + m)}%`; const digits = text.replace(/\D/g, '');
      // a masked viewer (no pos.communications.manage) sees e@… only, so the address is not searchable for them either — searching it
      // would confirm an address they are not allowed to see
      const unmasked = hasPermission(ctx as unknown as PermCtx, 'pos.communications.manage');
      const ors: any[] = [sql`c.full_name ilike ${like}`, unmasked ? sql`n.to_address ilike ${like}` : sql`false`, sql`coalesce(n.subject, '') ilike ${like}`, sql`coalesce(n.provider_id, '') ilike ${like}`,
        sql`exists (select 1 from receipts r where r.tenant_id = n.tenant_id and n.source_type = 'ticket' and r.ticket_id::text = n.source_id and r.receipt_number ilike ${like})`];
      if (digits.length >= 4) ors.push(sql`regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`);
      if (UUID.test(text)) ors.push(sql`(n.id = ${text}::uuid or n.customer_id = ${text}::uuid or n.source_id = ${text})`);
      else if (/^[0-9a-f]{6,8}$/i.test(text)) ors.push(sql`n.source_id ilike ${text.toLowerCase() + '%'}`);   // a booking reference (first 8 of the id)
      parts.push(sql`(${sql.join(ors, sql` or `)})`);
    }
    if (status === 'accepted') parts.push(sql`n.status = 'sent'`);
    else if (status === 'delivered') parts.push(sql`n.status = 'delivered'`);
    else if (status === 'simulated') parts.push(sql`n.status = 'simulated'`);
    else if (status === 'failed') parts.push(sql`n.status = 'failed' and coalesce(n.failure_reason, '') !~ '^(bounced|blocked)'`);
    else if (status === 'bounced') parts.push(sql`n.status = 'failed' and n.failure_reason ~ '^(bounced|blocked)'`);
    else if (status === 'suppressed') parts.push(sql`n.status = 'blocked' and n.failure_reason ~ '(opted_out|disabled)'`);
    else if (status === 'blocked') parts.push(sql`n.status = 'blocked' and coalesce(n.failure_reason, '') !~ '(opted_out|disabled)'`);
    if (category === 'booking') parts.push(sql`n.source_type = 'appointment'`);
    else if (category === 'receipt') parts.push(sql`n.purpose = 'receipt'`);
    else if (category === 'reminder') parts.push(sql`n.purpose = 'reminder'`);
    else if (category === 'follow_up') parts.push(sql`(n.purpose = 'followup' or n.source_type = 'follow_up')`);
    else if (category === 'marketing') parts.push(sql`(n.purpose = 'marketing' or n.source_type = 'campaign')`);
    else if (category === 'manual') parts.push(sql`coalesce(n.source_type, '') not in ('appointment', 'follow_up', 'campaign') and coalesce(n.purpose, '') not in ('receipt', 'reminder', 'followup', 'marketing')`);
    const where = sql.join(parts, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from notifications n left join customers c on c.id = n.customer_id and c.tenant_id = n.tenant_id where ${where}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(Math.max(1, Math.floor(N(q.page) || 1)), totalPages);
    const rows = (await sql<any>`select n.id, n.created_at, n.to_address, n.subject, n.status, n.failure_reason, n.purpose, n.source_type, n.source_id, n.customer_id, n.retry_of_notification_id, n.delivered_at, c.full_name
        from notifications n left join customers c on c.id = n.customer_id and c.tenant_id = n.tenant_id where ${where} order by n.created_at desc, n.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const full = hasPermission(ctx as unknown as PermCtx, 'pos.communications.manage');
    return {
      items: rows.map((r: any) => ({ id: String(r.id), createdAt: iso(r.created_at), to: full ? r.to_address : mask(r.to_address), customer: r.customer_id ? { id: String(r.customer_id), name: r.full_name ?? null } : null,
        subject: r.subject ?? null, category: emailCategory(r), status: emailDisplayStatus(r), reason: r.failure_reason ?? null, deliveredAt: iso(r.delivered_at), resendOf: r.retry_of_notification_id ?? null,
        source: r.source_type ? { type: r.source_type, id: r.source_id } : null })),
      total, page, pageSize, totalPages, sort: 'newest', basis, window: { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today }, masked: !full,
    };
  }

  async detail(ctx: EcContext, id: string) {
    this.need(ctx, 'pos.communications.view');
    if (!UUID.test(String(id))) throw err('That email was not found.', 'EMAIL_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const r = (await sql<any>`select n.id, n.created_at, n.status, n.failure_reason, n.purpose, n.source_type, n.source_id, n.to_address, n.subject, n.body, n.customer_id, n.branch_id, n.provider_id, n.delivered_at, n.retry_of_notification_id,
        c.full_name, b.name as branch_name from notifications n left join customers c on c.id = n.customer_id and c.tenant_id = n.tenant_id
        left join branches b on b.id = n.branch_id and b.tenant_id = n.tenant_id where n.tenant_id = ${T}::uuid and n.id = ${id}::uuid and n.channel = 'email'`.execute(this.db)).rows[0];
    if (!r) throw err('That email was not found.', 'EMAIL_NOT_FOUND', 404);
    const events = (await sql<any>`select provider_status, error_code, applied, signature_verified, received_at from notification_delivery_events where tenant_id = ${T}::uuid and notification_id = ${id}::uuid order by received_at asc limit 100`.execute(this.db)).rows;
    let rootId = String(r.id); let cur: any = r;
    for (let i = 0; i < 10 && cur?.retry_of_notification_id; i++) { rootId = String(cur.retry_of_notification_id); cur = (await sql<any>`select id, retry_of_notification_id from notifications where tenant_id = ${T}::uuid and id = ${rootId}::uuid`.execute(this.db)).rows[0]; }
    const attempts = (await sql<any>`with recursive chain as (select id, created_at, status, failure_reason, retry_of_notification_id, 0 as depth from notifications where tenant_id = ${T}::uuid and id = ${rootId}::uuid
        union all select n.id, n.created_at, n.status, n.failure_reason, n.retry_of_notification_id, chain.depth + 1 from notifications n join chain on n.retry_of_notification_id = chain.id where n.tenant_id = ${T}::uuid and chain.depth < 10)
        select * from chain order by created_at asc`.execute(this.db)).rows;
    const receipts = r.source_type === 'ticket' ? (await sql<any>`select receipt_number, created_at from receipts where tenant_id = ${T}::uuid and ticket_id::text = ${r.source_id} order by created_at asc limit 10`.execute(this.db)).rows : [];
    const full = hasPermission(ctx as unknown as PermCtx, 'pos.communications.manage');
    await this.audit(ctx, 'email.viewed', String(id), 'Opened an email record', { full });
    const settings = this.policy ? await this.policy.settings(T, r.branch_id ?? null) : null;
    return {
      id: String(r.id), createdAt: iso(r.created_at), status: emailDisplayStatus(r), rawStatus: r.status, reason: r.failure_reason ?? null, category: emailCategory(r), purpose: r.purpose ?? null,
      consent: r.purpose === 'marketing' ? 'marketing (consent + unsubscribe required)' : 'transactional',
      from: { address: emailFromAddress(this.env), name: settings?.senderName ?? null }, replyTo: settings?.replyTo ?? null,
      to: full ? r.to_address : mask(r.to_address), subject: r.subject ?? null, body: full ? String(r.body ?? '') : null,
      customer: r.customer_id ? { id: String(r.customer_id), name: r.full_name ?? null } : null, branch: r.branch_id ? { id: String(r.branch_id), name: r.branch_name ?? null } : null,
      links: { appointmentId: r.source_type === 'appointment' ? r.source_id : null, ticketId: r.source_type === 'ticket' ? r.source_id : null, receipts: receipts.map((x: any) => ({ number: x.receipt_number, at: iso(x.created_at) })) },
      providerReference: r.provider_id ?? null, deliveredAt: iso(r.delivered_at),
      events: events.map((e: any) => ({ status: e.provider_status, code: e.error_code ?? null, applied: !!e.applied, verified: !!e.signature_verified, at: iso(e.received_at) })),
      attempts: attempts.map((a: any) => ({ id: String(a.id), at: iso(a.created_at), status: emailDisplayStatus(a), reason: a.failure_reason ?? null, isThis: String(a.id) === String(id) })),
      // a bounce / receiver block is never retried (the resend path refuses it), so the button is not offered
      canResend: full && r.status === 'failed' && !/^(bounced|blocked)/.test(String(r.failure_reason ?? '')),
    };
  }

  // ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async resend(ctx: EcContext, id: string, body: { idempotencyKey?: unknown; confirm?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    if (!UUID.test(String(id))) throw err('That email was not found.', 'EMAIL_NOT_FOUND', 404);
    const r = (await sql<any>`select channel from notifications where tenant_id = ${ctx.tenantId}::uuid and id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r || r.channel !== 'email') throw err('That email was not found.', 'EMAIL_NOT_FOUND', 404);
    return this.cn.retry(ctx, id, body);   // the ONE protected resend (741): confirm, idempotency, re-validation, audit
  }

  private async sendGuard(ctx: EcContext, body: { idempotencyKey?: unknown; confirm?: unknown }) {
    const key = String(body?.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 120) throw err('This action needs a request id. Try again.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (body?.confirm !== true) throw err('Confirm the send first.', 'EMAIL_CONFIRM_REQUIRED');
    if (!this.messenger) throw err('Sending email is not available here.', 'EMAIL_NOT_AVAILABLE', 503);
    return key;
  }
  private result(r: TenantSendResult & { duplicate?: boolean }) {
    return { outcome: r.sent ? (r.simulated ? 'simulated' : 'accepted') : r.status, reason: r.reason ?? null, notificationId: r.notificationId ?? null, providerReference: r.providerId ?? null, replayed: !!r.duplicate };
  }

  /** one-time authorized test (§06): a staff member of THIS salon only; never a customer */
  async test(ctx: EcContext, body: { to?: unknown; idempotencyKey?: unknown; confirm?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    const key = await this.sendGuard(ctx, body);
    const to = String(body?.to ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw err('Enter a valid email address.', 'EMAIL_RECIPIENT_INVALID');
    const staff = (await sql<any>`select 1 from users where tenant_id = ${ctx.tenantId}::uuid and lower(email) = ${to} and coalesce(role, '') <> 'CUSTOMER' and coalesce(status, 'active') = 'active'`.execute(this.db)).rows.length > 0;
    if (!staff) throw err('Test emails go only to a staff member of this salon.', 'EMAIL_TEST_RECIPIENT_NOT_STAFF');
    const r = await this.messenger!.sendEmail({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, to, subject: 'Test email from your salon', body: 'This is a test email from AI PowerSalon. If you can read this, your salon email is working.\n\nNo customer received this message.',
      purpose: 'notification', category: 'test', source: { type: 'template_test', id: String(ctx.userId) }, idempotencyKey: `test:${key}` });
    await this.audit(ctx, 'email.test_sent', r.notificationId ?? null, `Test email (${r.sent ? 'accepted' : r.status})`, { outcome: r.status, replayed: !!r.duplicate });
    return this.result(r);
  }

  /** a staff email to ONE customer of this salon; the address comes from the customer record (no free-text recipients) */
  async compose(ctx: EcContext, body: { customerId?: unknown; subject?: unknown; body?: unknown; idempotencyKey?: unknown; confirm?: unknown }) {
    this.need(ctx, 'pos.communications.manage');
    const key = await this.sendGuard(ctx, body);
    const cid = String(body?.customerId ?? '');
    if (!UUID.test(cid)) throw err('Choose a customer.', 'EMAIL_RECIPIENT_INVALID');
    const subject = String(body?.subject ?? '').trim(); const text = String(body?.body ?? '').trim();
    if (!subject || subject.length > 150 || /[\r\n]/.test(subject)) throw err('Enter a subject (up to 150 characters).', 'EMAIL_SUBJECT_INVALID');
    if (!text || text.length > 5000) throw err('Write a message (up to 5,000 characters).', 'EMAIL_BODY_INVALID');
    const c = (await sql<any>`select id, email from customers where tenant_id = ${ctx.tenantId}::uuid and id = ${cid}::uuid and coalesce(status, 'active') <> 'archived'`.execute(this.db)).rows[0];
    if (!c) throw err('That customer was not found.', 'CUSTOMER_NOT_FOUND', 404);
    if (!EMAIL_RE.test(String(c.email ?? ''))) throw err('This customer has no valid email address.', 'EMAIL_RECIPIENT_INVALID');
    const r = await this.messenger!.sendEmail({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, customerId: cid, to: String(c.email), subject, body: text,
      purpose: 'notification', category: 'manual', source: { type: 'manual', id: String(ctx.userId) }, idempotencyKey: `compose:${key}`, meter: true });
    await this.audit(ctx, 'email.composed', r.notificationId ?? null, `Staff email to a customer (${r.sent ? 'accepted' : r.status})`, { outcome: r.status, replayed: !!r.duplicate, customerId: cid });
    return this.result(r);
  }
}
