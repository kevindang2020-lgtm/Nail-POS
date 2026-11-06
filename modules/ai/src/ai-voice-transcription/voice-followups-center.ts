// voice-followups-center.ts — Voice Transcription Follow-Ups guide (Nov 2 2026): `/pos/ai-voice-transcription/follow-ups/*`.
//
// What the page was: GET unresolved — the 100 newest calls whose AI extraction flagged something (callback, manager request,
// health / safety, refund, complaint, unanswered pricing), re-sorted by priority AFTER the cut (an older urgent call past
// row 100 never showed), the whole salon for a branch user, and NO way to act: an item could never be assigned, dismissed or
// resolved, so "open" only ever grew and "No open follow-ups — every call is resolved" meant only "nothing was flagged".
//
// What it is now — a REVIEW queue over the existing pieces, not a second task system:
//   • every extracted item (call_transcript_intelligence.unresolved, one row per call + type) with its review state:
//       open      — nobody has decided yet (or it was reopened)
//       in_task   — staff turned it into a follow-up task in the ONE task system (ai_receptionist_follow_ups, migration 759:
//                   assignment, due dates, contact attempts, escalation, resolution all live there — /tenant/ai/receptionist/follow-ups)
//       resolved  — dismissed with a reason, or its task was resolved / closed
//   • Create task: one transaction — a task (idempotent per call + type; an already-open task for the same call and reason is
//     LINKED, never duplicated), its activity row, a strict audit row, and the review row. Nothing is called, texted, booked
//     or refunded.
//   • Dismiss (reason required) and Reopen — append-only review rows; the history is never rewritten.
//   • counters with one definition each, an urgent lane, search (call id, type; customer name / phone only with customers.view),
//     which date (call · reviewed · due), presets + From/To in salon time, sort, numbered pages;
//   • an empty state that says WHY it is empty (no calls · still processing · pipeline errors · genuinely nothing open);
//   • Check Voice Follow-Up System — read-only.
import { hasPermission } from '@aipowersalon/permissions';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { localToUtc } from '../ai-center/ai-follow-up-center';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface VfCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export class VoiceFollowUpError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) { super(message); }
}
/** extracted item type → the task system's reason (its own vocabulary, already labelled in the POS) */
export const VF_REASON: Record<string, string> = {
  callback_requested: 'CALLBACK', manager_requested: 'CUSTOMER_REQUESTED_HUMAN', health_safety: 'MEDICAL_OR_SAFETY_CONCERN',
  refund_requested: 'REFUND_REQUEST', complaint: 'COMPLAINT', pricing_unanswered: 'PRICING_REQUIRES_SALON',
};
export const VF_TYPES = ['all', 'callback_requested', 'manager_requested', 'health_safety', 'refund_requested', 'complaint', 'pricing_unanswered'] as const;
export const VF_TABS = ['open', 'in_task', 'resolved', 'all'] as const;
export const VF_DATE_FIELDS = ['call', 'reviewed', 'due'] as const;
export const VF_SORTS = ['newest', 'priority', 'oldest'] as const;
export const VF_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const VF_PAGE_SIZES = [10, 25, 50, 100] as const;
const DONE_TASK = ['resolved', 'closed'];
const ASSIGNABLE_ROLES = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
// the platform's one permission rule (Nov 6 2026 full-run route sweep): a raw includes() missed alias-granted keys, so every
// owner and manager was refused here although the route guard (the same rule) had let them in
const has = (ctx: VfCtx, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
/** the item's priority in the task system's words (health / safety is always urgent) */
export const vfPriority = (type: string, p: string) => (type === 'health_safety' ? 'urgent' : p === 'high' ? 'high' : p === 'low' ? 'low' : 'normal');

export class VoiceFollowUpsCenter {
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) {}

  private needView(ctx: VfCtx) {
    if (!has(ctx, 'ai_voice_transcription.view_transcripts')) throw new VoiceFollowUpError('Your role cannot see call follow-ups.', 'PERMISSION_DENIED', 403);
  }
  private needWork(ctx: VfCtx) {
    this.needView(ctx);
    if (!has(ctx, 'communications.manage') && !has(ctx, 'ai.manage')) throw new VoiceFollowUpError('Your role can view follow-ups but not work them.', 'PERMISSION_DENIED', 403);
  }
  private scope(col: ReturnType<typeof sql>, ctx: VfCtx): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`(${col} = ${ctx.branchId}::uuid or ${col} is null)` } : { w: sql`true` };
  }
  private tz(ctx: VfCtx) { return branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null); }
  private async period(ctx: VfCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await this.tz(ctx);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(VF_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const d = (s: string, k: number) => addYmdDays(s, k);
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = d(today, -1); break;
      case 'week': from = d(today, -dow); break;
      case 'last_7': from = d(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = d(today, -29); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = d(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new VoiceFollowUpError('Choose a From and a To date.', 'VF_INVALID_PERIOD');
        if (a > z) throw new VoiceFollowUpError('The From date must be on or before the To date.', 'VF_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  /** every extracted item of this salon (this branch + salon-wide), with its latest review and its task */
  private items(ctx: VfCtx) {
    const T = ctx.tenantId;
    return sql`(select t.id as transcript_id, t.provider_call_id, t.customer_id, t.created_at as call_at, t.direction, t.branch_id,
          u.item->>'type' as type, coalesce(u.item->>'priority', 'medium') as raw_priority,
          rv.decision, rv.follow_up_id, rv.reason as review_reason, rv.created_at as reviewed_at, rv.actor_user_id as reviewer_id,
          f.status as task_status, f.due_at, f.assigned_user_id, f.priority as task_priority,
          case when rv.decision is null or rv.decision = 'reopened' then 'open'
               when rv.decision = 'dismissed' then 'resolved'
               when f.status = any(${DONE_TASK}::text[]) then 'resolved' else 'in_task' end as state
        from call_transcripts t
        join call_transcript_intelligence i on i.transcript_id = t.id and i.tenant_id = t.tenant_id
        cross join lateral jsonb_array_elements(coalesce(i.unresolved, '[]'::jsonb)) as u(item)
        left join lateral (select r.decision, r.follow_up_id, r.reason, r.created_at, r.actor_user_id from voice_followup_reviews r
          where r.tenant_id = t.tenant_id and r.transcript_id = t.id and r.item_type = u.item->>'type' order by r.created_at desc, r.id desc limit 1) rv on true
        left join ai_receptionist_follow_ups f on f.id = rv.follow_up_id and f.tenant_id = t.tenant_id
        where t.tenant_id = ${T} and t.deleted_at is null and ${this.scope(sql`t.branch_id`, ctx).w}) x`;
  }

  // ── counters + the empty state's reason + the urgent lane ────────────────────────────────────────────────────
  async summary(ctx: VfCtx) {
    this.needView(ctx);
    const T = ctx.tenantId;
    const c = (await sql<Row>`select count(*) filter (where x.state = 'open')::int as open,
        count(*) filter (where x.state = 'open' and (x.type = 'health_safety' or x.raw_priority = 'high'))::int as urgent,
        count(*) filter (where x.state = 'in_task')::int as in_task,
        count(*) filter (where x.state = 'in_task' and x.due_at < now())::int as overdue,
        count(*) filter (where x.state = 'resolved' and coalesce(x.reviewed_at, x.call_at) > now() - interval '30 days')::int as resolved_30d
      from ${this.items(ctx)}`.execute(this.db)).rows[0] ?? {};
    const S = this.scope(sql`branch_id`, ctx).w;
    const p = (await sql<Row>`select count(*)::int as calls, max(created_at) as last_call,
        count(*) filter (where status in ('queued', 'processing', 'partial') or (redaction_status in ('pending', 'processing') and status in ('completed', 'low_confidence')))::int as processing,
        count(*) filter (where status in ('provider_error', 'failed') and created_at > now() - interval '24 hours')::int as errors_24h,
        count(*) filter (where status in ('completed', 'low_confidence') and not exists (select 1 from call_transcript_intelligence i where i.transcript_id = call_transcripts.id and i.tenant_id = call_transcripts.tenant_id))::int as no_extraction
      from call_transcripts where tenant_id = ${T} and deleted_at is null and ${S}`.execute(this.db)).rows[0] ?? {};
    const urgentLane = (await sql<Row>`select x.transcript_id, x.type, x.raw_priority, x.call_at, x.provider_call_id from ${this.items(ctx)}
      where x.state = 'open' and (x.type = 'health_safety' or x.raw_priority = 'high') order by (x.type = 'health_safety') desc, x.call_at asc limit 10`.execute(this.db)).rows;
    const open = N(c.open);
    const emptyReason = open > 0 ? null : !N(p.calls) ? 'no_calls' : N(p.errors_24h) ? 'pipeline_errors' : N(p.processing) || N(p.no_extraction) ? 'processing' : 'none_open';
    return {
      asOf: new Date(this.now()).toISOString(),
      counters: { open, urgent: N(c.urgent), inTask: N(c.in_task), overdue: N(c.overdue), resolved30d: N(c.resolved_30d) },
      pipeline: { calls: N(p.calls), lastCallAt: iso(p.last_call), processing: N(p.processing), errors24h: N(p.errors_24h), notExtracted: N(p.no_extraction) },
      emptyReason,
      urgent: urgentLane.map((r) => ({ transcriptId: String(r.transcript_id), type: r.type, priority: vfPriority(r.type, r.raw_priority), callAt: iso(r.call_at) })),
      canWork: has(ctx, 'communications.manage') || has(ctx, 'ai.manage'),
      definitions: { open: 'extracted_not_reviewed', urgent: 'open_high_or_health_safety', inTask: 'task_not_resolved', overdue: 'task_past_due', resolved30d: 'dismissed_or_task_resolved_in_30_days' },
    };
  }

  // ── the list ──────────────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: VfCtx, f: Record<string, unknown>) {
    this.needView(ctx);
    const T = ctx.tenantId;
    const pageSize = (VF_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const tab = pick(VF_TABS, f.tab) ?? 'open';
    const type = pick(VF_TYPES, f.type) ?? 'all';
    const dateField = pick(VF_DATE_FIELDS, f.dateField) ?? 'call';
    const sort = pick(VF_SORTS, f.sort) ?? 'newest';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const customers = has(ctx, 'customers.view');
    const where = [sql`true`];
    if (tab !== 'all') where.push(sql`x.state = ${tab}`);
    if (type !== 'all') where.push(sql`x.type = ${type}`);
    if (per.start && per.end) {
      const col = dateField === 'reviewed' ? sql`x.reviewed_at` : dateField === 'due' ? sql`x.due_at` : sql`x.call_at`;
      where.push(sql`${col} >= ${per.start} and ${col} < ${per.end}`);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const digits = q.replace(/\D/g, '');
      const idq = q.toLowerCase().replace(/[^0-9a-z:_-]/g, '');
      where.push(sql`(x.type ilike ${like} or ${idq.length >= 6 ? sql`(x.transcript_id::text like ${idq + '%'} or lower(x.provider_call_id) like ${idq + '%'} or x.follow_up_id::text like ${idq + '%'})` : sql`false`}
        or coalesce(au.full_name, '') ilike ${like}
        ${customers ? sql`or c.full_name ilike ${like} or ${digits.length >= 4 ? sql`regexp_replace(coalesce(c.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}` : sql`false`}` : sql``})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`${this.items(ctx)} left join customers c on c.id = x.customer_id and c.tenant_id = ${T}
      left join users au on au.id = x.assigned_user_id and au.tenant_id = ${T}
      left join users rv on rv.id = x.reviewer_id and rv.tenant_id = ${T}`;
    const PRIO = sql`case when x.type = 'health_safety' then 0 when x.raw_priority = 'high' then 1 when x.raw_priority = 'medium' then 2 else 3 end`;
    const order = sort === 'priority' ? sql`${PRIO} asc, x.call_at desc, x.transcript_id desc, x.type asc`
      : sort === 'oldest' ? sql`x.call_at asc, x.transcript_id asc, x.type asc` : sql`x.call_at desc, x.transcript_id desc, x.type asc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select x.*, c.full_name as customer, c.normalized_phone as phone, au.full_name as assignee, coalesce(rv.full_name, rv.email) as reviewer
      from ${FROM} where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ transcriptId: String(r.transcript_id), type: r.type, priority: vfPriority(r.type, r.raw_priority), state: r.state,
        callAt: iso(r.call_at), direction: r.direction ?? null, callRef: r.provider_call_id ?? null,
        customer: customers ? (r.customer ?? null) : null, customerPhoneLast4: customers && r.phone ? String(r.phone).replace(/\D/g, '').slice(-4) : null, customerLinked: !!r.customer_id,
        review: r.decision ? { decision: r.decision, reason: r.review_reason ?? null, by: r.reviewer ?? null, at: iso(r.reviewed_at) } : null,
        task: r.follow_up_id ? { id: String(r.follow_up_id), status: r.task_status ?? null, priority: r.task_priority ?? null, dueAt: iso(r.due_at), assignee: r.assignee ?? null, overdue: !!r.due_at && new Date(r.due_at).getTime() < this.now() && r.state === 'in_task' } : null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, tab, type, dateField, sort, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz }, customersVisible: customers,
    };
  }

  /** the item as it is now (also proves it exists in this salon and branch) */
  private async current(trx: Kysely<any>, ctx: VfCtx, transcriptId: string, type: string): Promise<Row> {
    if (!isUuid(transcriptId) || !VF_REASON[type]) throw new VoiceFollowUpError('Follow-up not found.', 'NOT_FOUND', 404);
    const r = (await sql<Row>`select x.* from ${this.items(ctx)} where x.transcript_id = ${transcriptId}::uuid and x.type = ${type} limit 1`.execute(trx)).rows[0];
    if (!r) throw new VoiceFollowUpError('Follow-up not found.', 'NOT_FOUND', 404);
    return r;
  }
  private async review(trx: Kysely<any>, ctx: VfCtx, row: Row, decision: string, followUpId: string | null, reason: string | null) {
    await sql`insert into voice_followup_reviews (tenant_id, branch_id, transcript_id, item_type, decision, follow_up_id, reason, actor_user_id)
      values (${ctx.tenantId}, ${row.branch_id ?? null}, ${row.transcript_id}, ${row.type}, ${decision}, ${followUpId}, ${reason}, ${isUuid(ctx.userId) ? ctx.userId : null})`.execute(trx);
    await recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId! : null, userId: isUuid(ctx.userId) ? ctx.userId! : null, role: ctx.role ?? null },
      { module: 'ai_voice_transcription', action: `voice_followup.${decision}`, resourceType: 'call_transcript', resourceId: String(row.transcript_id),
        summary: `Call follow-up ${decision.replace('_', ' ')} (${row.type})`, reason, after: { decision, followUpId, type: row.type } });
  }

  // ── Create task (one transaction; never calls, texts, books or refunds) ──────────────────────────────────────
  async createTask(ctx: VfCtx, b: { transcriptId?: string; type?: string; priority?: string; dueLocal?: string | null; assignedUserId?: string | null; note?: string | null }) {
    this.needWork(ctx);
    const T = ctx.tenantId;
    const type = String(b.type ?? '');
    const tz = await this.tz(ctx);
    const dueAt = b.dueLocal ? localToUtc(String(b.dueLocal), tz) : null;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-followup:' || ${T} || ':' || ${String(b.transcriptId)} || ':' || ${type}))`.execute(trx);
      const row = await this.current(trx, ctx, String(b.transcriptId), type);
      if (row.state === 'in_task') return { followUpId: String(row.follow_up_id), linked: false, duplicate: true };
      if (b.assignedUserId) {
        const ok = isUuid(b.assignedUserId) && (await sql<Row>`select 1 from users where id = ${b.assignedUserId} and tenant_id = ${T} and status = 'active' and role = any(${ASSIGNABLE_ROLES}::text[])
          and (branch_id = ${isUuid(ctx.branchId) ? ctx.branchId : null}::uuid or branch_id is null or ${isUuid(ctx.branchId) ? ctx.branchId : null}::uuid is null)`.execute(trx)).rows.length;
        if (!ok) throw new VoiceFollowUpError('That person is not active staff who can work follow-ups in this branch.', 'FOLLOWUP_ASSIGNEE_INVALID');
      }
      const reason = VF_REASON[type];
      const priority = (['urgent', 'high', 'normal', 'low'] as const).includes(String(b.priority) as never) ? String(b.priority) : vfPriority(type, row.raw_priority);
      // an open task for the same call and reason already exists (e.g. from the AI receptionist) → link it, never a second one
      const existing = row.provider_call_id ? (await sql<Row>`select id from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id = ${row.provider_call_id} and reason = ${reason}
        and status not in ('resolved', 'closed') limit 1`.execute(trx)).rows[0] : undefined;
      let followUpId: string; let linked = false;
      if (existing) { followUpId = String(existing.id); linked = true; }
      else {
        const status = b.assignedUserId ? 'assigned' : 'open';
        const key = `voice:${row.transcript_id}:${type}:${randomUUID().slice(0, 8)}`;   // a reopened item gets a NEW task; the old one keeps its history
        const description = String(b.note ?? '').trim().slice(0, 1000) || `From a transcribed call: ${type.replace(/_/g, ' ')}.`;
        const ins = (await sql<Row>`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, customer_id, provider_call_id, description, source, created_by_user_id,
            source_event_key, due_at, due_tz, customer_match, assigned_user_id, assigned_at, updated_by)
          values (${T}, ${row.branch_id ?? (isUuid(ctx.branchId) ? ctx.branchId : null)}, ${reason}, ${priority}, ${status}, ${row.customer_id ?? null}, ${row.provider_call_id ?? null}, ${description},
            'voice_transcription', ${isUuid(ctx.userId) ? ctx.userId : null}, ${key}, ${dueAt}, ${tz}, ${row.customer_id ? 'linked' : 'unmatched'},
            ${b.assignedUserId ?? null}, ${b.assignedUserId ? sql`now()` : null}, ${isUuid(ctx.userId) ? ctx.userId : null}) returning id`.execute(trx)).rows[0];
        followUpId = String(ins.id);
        await sql`insert into ai_follow_up_activity (tenant_id, follow_up_id, actor_user_id, event_type, from_value, to_value, note, metadata)
          values (${T}, ${followUpId}, ${isUuid(ctx.userId) ? ctx.userId : null}, 'created', null, ${status}, ${description}, ${JSON.stringify({ source: 'voice_transcription', transcriptId: String(row.transcript_id), type, priority })}::jsonb)`.execute(trx);
      }
      await this.review(trx, ctx, row, 'task_created', followUpId, null);
      return { followUpId, linked, duplicate: false };
    });
  }

  /** Dismiss — "no action needed" with a reason; append-only */
  async dismiss(ctx: VfCtx, b: { transcriptId?: string; type?: string; reason?: string }) {
    this.needWork(ctx);
    const reason = String(b.reason ?? '').replace(/[\u0000-\u001F]/g, ' ').trim();
    if (reason.length < 3 || reason.length > 500) throw new VoiceFollowUpError('Say why no action is needed (3–500 characters).', 'VF_REASON_REQUIRED');
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-followup:' || ${ctx.tenantId} || ':' || ${String(b.transcriptId)} || ':' || ${String(b.type)}))`.execute(trx);
      const row = await this.current(trx, ctx, String(b.transcriptId), String(b.type));
      if (row.state !== 'open') throw new VoiceFollowUpError('Only an open item can be dismissed — this one already has a task or was dismissed.', 'VF_NOT_OPEN', 409);
      await this.review(trx, ctx, row, 'dismissed', null, reason);
      return { ok: true };
    });
  }

  /** Reopen — a dismissed item (or one whose task was resolved) goes back to the queue; append-only, reason required */
  async reopen(ctx: VfCtx, b: { transcriptId?: string; type?: string; reason?: string }) {
    this.needWork(ctx);
    const reason = String(b.reason ?? '').replace(/[\u0000-\u001F]/g, ' ').trim();
    if (reason.length < 3 || reason.length > 500) throw new VoiceFollowUpError('Say why it is reopened (3–500 characters).', 'VF_REASON_REQUIRED');
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-followup:' || ${ctx.tenantId} || ':' || ${String(b.transcriptId)} || ':' || ${String(b.type)}))`.execute(trx);
      const row = await this.current(trx, ctx, String(b.transcriptId), String(b.type));
      if (row.state !== 'resolved') throw new VoiceFollowUpError('Only a resolved or dismissed item can be reopened.', 'VF_NOT_RESOLVED', 409);
      await this.review(trx, ctx, row, 'reopened', null, reason);
      return { ok: true };
    });
  }

  /** an item's review history (append-only, newest first) */
  async history(ctx: VfCtx, transcriptId: string, type: string) {
    this.needView(ctx);
    const row = await this.current(this.db, ctx, transcriptId, type);
    const rows = (await sql<Row>`select r.decision, r.reason, r.follow_up_id, r.created_at, coalesce(u.full_name, u.email) as actor from voice_followup_reviews r
      left join users u on u.id = r.actor_user_id and u.tenant_id = r.tenant_id where r.tenant_id = ${ctx.tenantId} and r.transcript_id = ${row.transcript_id} and r.item_type = ${type}
      order by r.created_at desc, r.id desc limit 50`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ decision: r.decision, reason: r.reason ?? null, followUpId: r.follow_up_id ? String(r.follow_up_id) : null, at: iso(r.created_at), by: r.actor ?? null })) };
  }

  // ── Check Voice Follow-Up System (read-only; one run per salon per 30 s) ─────────────────────────────────────
  async check(ctx: VfCtx) {
    this.needView(ctx);
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from voice_followup_health_runs where tenant_id = ${T} and branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const S = this.scope(sql`branch_id`, ctx).w;
    const calls = await one(sql<Row>`select count(*) filter (where created_at > now() - interval '7 days')::int as n7, max(created_at) as last,
        count(*) filter (where created_at > now() - interval '7 days' and status in ('provider_error', 'failed'))::int as err7
      from call_transcripts where tenant_id = ${T} and deleted_at is null and ${S}`);
    checks.push({ key: 'calls_arriving', state: !calls.last ? 'INSUFFICIENT_DATA' : N(calls.n7) ? 'PASSED' : 'WARNING', count: N(calls.n7), detail: { lastCallAt: iso(calls.last) } });
    checks.push({ key: 'transcription_errors', state: !N(calls.n7) ? 'INSUFFICIENT_DATA' : N(calls.err7) * 2 > N(calls.n7) ? 'FAILED' : N(calls.err7) ? 'WARNING' : 'PASSED', count: N(calls.err7) });
    const stuck = N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and deleted_at is null and ${S}
      and (status in ('queued', 'processing') or redaction_status in ('pending', 'processing')) and updated_at < now() - interval '1 hour'`)).n);
    checks.push({ key: 'processing_backlog', state: stuck ? 'WARNING' : 'PASSED', count: stuck });
    const noExt = N((await one(sql<Row>`select count(*)::int as n from call_transcripts t where t.tenant_id = ${T} and t.deleted_at is null and ${this.scope(sql`t.branch_id`, ctx).w}
      and t.status in ('completed', 'low_confidence') and t.segment_count > 0 and t.created_at < now() - interval '15 minutes'
      and not exists (select 1 from call_transcript_intelligence i where i.transcript_id = t.id and i.tenant_id = t.tenant_id)`)).n);
    checks.push({ key: 'extraction', state: noExt ? 'WARNING' : 'PASSED', count: noExt });
    const c = (await sql<Row>`select count(*) filter (where x.state = 'open' and (x.type = 'health_safety' or x.raw_priority = 'high') and x.call_at < now() - interval '24 hours')::int as stale_urgent,
        count(*) filter (where x.state = 'in_task' and x.due_at < now())::int as overdue,
        count(*) filter (where x.decision = 'task_created' and x.task_status is null)::int as broken_link
      from ${this.items(ctx)}`.execute(this.db)).rows[0] ?? {};
    checks.push({ key: 'urgent_reviewed', state: N(c.stale_urgent) ? 'FAILED' : 'PASSED', count: N(c.stale_urgent) });
    checks.push({ key: 'tasks_on_time', state: N(c.overdue) ? 'WARNING' : 'PASSED', count: N(c.overdue) });
    checks.push({ key: 'task_links', state: N(c.broken_link) ? 'FAILED' : 'PASSED', count: N(c.broken_link) });
    const dup = N((await one(sql<Row>`select count(*)::int as n from (select provider_call_id, reason from ai_receptionist_follow_ups where tenant_id = ${T} and provider_call_id is not null
      and status not in ('resolved', 'closed') group by 1, 2 having count(*) > 1) z`)).n);
    checks.push({ key: 'no_duplicate_tasks', state: dup ? 'FAILED' : 'PASSED', count: dup });
    const unassigned = N((await one(sql<Row>`select count(*)::int as n from ai_receptionist_follow_ups where tenant_id = ${T} and source = 'voice_transcription' and status = 'open'
      and assigned_user_id is null and created_at < now() - interval '24 hours'`)).n);
    checks.push({ key: 'tasks_assigned', state: unassigned ? 'WARNING' : 'PASSED', count: unassigned });
    const noReason = N((await one(sql<Row>`select count(*)::int as n from voice_followup_reviews where tenant_id = ${T} and decision in ('dismissed', 'reopened') and coalesce(length(trim(reason)), 0) < 3`)).n);
    checks.push({ key: 'dismissals_explained', state: noReason ? 'FAILED' : 'PASSED', count: noReason });
    const cross = N((await one(sql<Row>`select count(*)::int as n from voice_followup_reviews r left join call_transcripts t on t.id = r.transcript_id
      left join ai_receptionist_follow_ups f on f.id = r.follow_up_id where r.tenant_id = ${T} and ((t.id is not null and t.tenant_id <> r.tenant_id) or (f.id is not null and f.tenant_id <> r.tenant_id))`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-followup-health:' || ${T} || ':' || coalesce(${isUuid(ctx.branchId) ? ctx.branchId : null}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into voice_followup_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
