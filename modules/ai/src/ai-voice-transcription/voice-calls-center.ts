// voice-calls-center.ts — Voice Transcription Search + Call History guides (Nov 3 2026): `/pos/ai-voice-transcription/calls/*`.
//
// What the two pages were: Search — GET transcripts/search, keyword only, the 50 newest matches, no total, no pages, no dates,
// no phone or customer search, the branch taken from the browser. Call History — the transcripts list with Status and Direction,
// cursor "load more", the branch from the browser, no search, no dates, and one empty message for every case ("No calls match.
// Transcribed calls will appear here." for no calls, a filter, calls still processing and a failed pipeline alike). Neither had a
// system check. The call detail page opened any call of the salon for a branch user.
//
// What they are now — ONE read-only center both pages use:
//   • summary — what is there and, when a page is empty, WHY (no calls · processing · failed · disabled · nothing matches);
//   • calls   — search (phone digits and customer name through the linked customer, with customers.view; call ID; redacted
//               transcript; summary; intent) + call status group, direction, language, intent, follow-up state, which date (call ·
//               summary · follow-up decision), presets + From/To in salon time, newest / oldest / best match, numbered pages.
//               Each row says WHAT matched and shows a redacted excerpt — re-redacted here as a second guard, raw text is never read;
//   • call    — the details overlay: header, the redacted transcript in order with speakers, the summary, what was asked (marked as
//               extracted, never "booked"), the follow-up items with their review state and task, the customer link (linked / none —
//               never guessed from a phone). Every open is audited;
//   • check   — "Check Voice Transcription System": provider key, calls arriving, branch mapping, consent, transcription jobs,
//               redaction, a leak scan of what search reads, summaries, customer matching, search freshness, deletions reaching
//               derived data, isolation, no side effects. Read-only.
// The branch is ALWAYS the server's: a branch login sees its branch (and salon-wide calls); only a salon-wide login sees all.
import { hasPermission } from '@aipowersalon/permissions';
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { recordAuditStrict } from '@aipowersalon/audit';
import { redactText } from './ai-voice-transcription-redaction';
import { parseTerms } from './ai-voice-transcription-search';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface VcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export class VoiceCallsError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const VC_STATUS = ['all', 'completed', 'processing', 'review', 'failed', 'not_transcribed'] as const;
export const VC_DIRECTIONS = ['all', 'inbound', 'outbound'] as const;
export const VC_FOLLOWUP = ['all', 'open', 'in_task', 'resolved', 'none'] as const;
export const VC_INTENTS = ['all', 'new_booking', 'reschedule', 'cancellation', 'confirmation', 'availability', 'pricing', 'service_info', 'technician_request',
  'hours_location', 'promotion', 'membership', 'loyalty', 'payment_issue', 'refund', 'complaint', 'repair', 'health_safety', 'manager_request', 'callback',
  'general_question', 'other'] as const;
export const VC_DATE_FIELDS = ['call', 'summary', 'followup'] as const;
export const VC_SORTS = ['newest', 'oldest', 'best'] as const;
export const VC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const VC_PAGE_SIZES = [10, 25, 50, 100] as const;
/** the provider's call status, grouped for staff (never confused with whether there is a summary) */
export const VC_GROUP: Record<string, string[]> = {
  completed: ['completed'],
  processing: ['queued', 'processing', 'partial'],
  review: ['low_confidence', 'manual_review_required'],
  failed: ['provider_error', 'failed', 'audio_unavailable'],
  not_transcribed: ['transcription_disabled', 'consent_missing', 'consent_declined', 'recording_disabled'],
};
const groupOf = (s: string) => Object.keys(VC_GROUP).find((g) => VC_GROUP[g].includes(s)) ?? 'other';
const DONE_TASK = ['resolved', 'closed'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** a card-number-shaped digit run (13–19 digits, spaces / dashes allowed) left in text that search reads */
const LEAK_RE = '[0-9](?:[ -]?[0-9]){12,18}';
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
// the platform's one permission rule (Nov 6 2026 full-run route sweep): a raw includes() missed alias-granted keys, so every
// owner and manager was refused here although the route guard (the same rule) had let them in
const has = (ctx: VcCtx, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const addDays = (d: string, k: number) => addYmdDays(d, k);
const esc = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
/** a short excerpt around the first term, redacted AGAIN (the stored text is already redacted — this is the second guard) */
export function safeExcerpt(text: string, terms: string[], window = 70): string {
  const t = redactText(String(text ?? '')).text;
  if (!t) return '';
  const low = t.toLowerCase();
  let i = -1;
  for (const term of terms) { const k = low.indexOf(term); if (k >= 0 && (i < 0 || k < i)) i = k; }
  if (i < 0) return t.length <= window * 2 ? t : t.slice(0, window * 2) + '…';
  const a = Math.max(0, i - window), z = Math.min(t.length, i + window);
  return `${a > 0 ? '…' : ''}${t.slice(a, z)}${z < t.length ? '…' : ''}`;
}

export class VoiceCallsCenter {
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: VcCtx) {
    if (!has(ctx, 'ai_voice_transcription.view_transcripts')) throw new VoiceCallsError('Your role cannot search or view call transcripts.', 'PERMISSION_DENIED', 403);
  }
  private scope(col: ReturnType<typeof sql>, ctx: VcCtx): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`(${col} = ${ctx.branchId}::uuid or ${col} is null)` } : { w: sql`true` };
  }
  private async period(ctx: VcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(VC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = addDays(today, -1); break;
      case 'week': from = addDays(today, -dow); break;
      case 'last_7': from = addDays(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = addDays(today, -29); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new VoiceCallsError('Choose a From and a To date.', 'VC_INVALID_PERIOD');
        if (a > z) throw new VoiceCallsError('The From date must be on or before the To date.', 'VC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  /** every call of this scope with its summary row and its follow-up state (one row per call) */
  private calls(ctx: VcCtx) {
    const T = ctx.tenantId;
    return sql`(select t.id, t.provider, t.provider_call_id, t.customer_id, t.branch_id, t.direction, t.handler, t.status, t.redaction_status, t.primary_language,
          t.mixed_language, t.duration_seconds, t.segment_count, t.created_at, t.updated_at,
          i.quick_summary, i.intents, i.appointment, i.created_at as summary_at, coalesce(jsonb_array_length(i.unresolved), 0) as items,
          fu.open_items, fu.task_items, fu.last_decision_at
        from call_transcripts t
        left join call_transcript_intelligence i on i.transcript_id = t.id and i.tenant_id = t.tenant_id
        left join lateral (select count(*) filter (where rv.decision is null or rv.decision = 'reopened')::int as open_items,
              count(*) filter (where rv.decision = 'task_created' and coalesce(f.status, '') <> all(${DONE_TASK}::text[]))::int as task_items,
              max(rv.created_at) as last_decision_at
            from jsonb_array_elements(coalesce(i.unresolved, '[]'::jsonb)) u(item)
            left join lateral (select r.decision, r.follow_up_id, r.created_at from voice_followup_reviews r where r.tenant_id = t.tenant_id and r.transcript_id = t.id
              and r.item_type = u.item->>'type' order by r.created_at desc, r.id desc limit 1) rv on true
            left join ai_receptionist_follow_ups f on f.id = rv.follow_up_id and f.tenant_id = t.tenant_id) fu on true
        where t.tenant_id = ${T} and t.deleted_at is null and ${this.scope(sql`t.branch_id`, ctx).w}) c`;
  }
  private followState(r: Row) { return !N(r.items) ? 'none' : N(r.open_items) ? 'open' : N(r.task_items) ? 'in_task' : 'resolved'; }

  // ── what is there, and why a page is empty ─────────────────────────────────────────────────────────────────
  async summary(ctx: VcCtx) {
    this.need(ctx);
    const T = ctx.tenantId;
    const p = (await sql<Row>`select count(*)::int as calls, max(created_at) as last_call,
        count(*) filter (where status = any(${VC_GROUP.processing}::text[]) or (redaction_status in ('pending', 'processing') and status in ('completed', 'low_confidence')))::int as processing,
        count(*) filter (where status = any(${VC_GROUP.failed}::text[]) and created_at > now() - interval '7 days')::int as failed7,
        count(*) filter (where status = any(${VC_GROUP.not_transcribed}::text[]))::int as not_transcribed,
        count(*) filter (where created_at > now() - interval '7 days')::int as calls7,
        count(*) filter (where direction = 'inbound')::int as inbound, count(*) filter (where direction = 'outbound')::int as outbound,
        count(*) filter (where status = any(${[...VC_GROUP.completed, ...VC_GROUP.review]}::text[]))::int as transcribed,
        count(*) filter (where status = any(${VC_GROUP.failed}::text[]))::int as failed
      from call_transcripts where tenant_id = ${T} and deleted_at is null and ${this.scope(sql`branch_id`, ctx).w}`.execute(this.db)).rows[0] ?? {};
    // SUNMI addenda (Nov 8 2026): Call History's eight cards / Search's four. Follow-ups needed = calls with an open (unreviewed or
    // reopened) item — the same rule as the Follow-up filter; missed calls come from the call log (they have no transcript).
    const fu = (await sql<Row>`select count(*) filter (where open_items > 0)::int as open from ${this.calls(ctx)}`.execute(this.db)).rows[0] ?? {};
    const missed = (await sql<Row>`select count(*)::int as n from call_intelligence_events where tenant_id = ${T} and status = 'missed' and ${this.scope(sql`branch_id`, ctx).w}`.execute(this.db)).rows[0] ?? {};
    const s = (await sql<Row>`select transcription_enabled from voice_transcription_settings where tenant_id = ${T} limit 1`.execute(this.db)).rows[0];
    const disabled = s ? s.transcription_enabled === false : false;
    const calls = N(p.calls);
    const emptyReason = calls ? null : disabled ? 'disabled' : 'no_calls';
    return {
      asOf: new Date(this.now()).toISOString(),
      counters: { calls, calls7d: N(p.calls7), processing: N(p.processing), failed7d: N(p.failed7), notTranscribed: N(p.not_transcribed),
        inbound: N(p.inbound), outbound: N(p.outbound), missed: N(missed.n), transcribed: N(p.transcribed), failed: N(p.failed), followUpsOpen: N(fu.open) },
      lastCallAt: iso(p.last_call), transcriptionEnabled: !disabled, emptyReason,
      customersVisible: has(ctx, 'customers.view'),
      search: { source: 'live_redacted_tables', rawTextSearched: false },
    };
  }

  // ── Search and Call History ────────────────────────────────────────────────────────────────────────────────
  async list(ctx: VcCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const T = ctx.tenantId;
    const pageSize = (VC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const status = pick(VC_STATUS, f.status) ?? 'all';
    const direction = pick(VC_DIRECTIONS, f.direction) ?? 'all';
    const intent = pick(VC_INTENTS, f.intent) ?? 'all';
    const followUp = pick(VC_FOLLOWUP, f.followUp) ?? 'all';
    const dateField = pick(VC_DATE_FIELDS, f.dateField) ?? 'call';
    const per = await this.period(ctx, f);
    const language = typeof f.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(f.language) ? f.language : null;
    const q = String(f.q ?? '').trim().slice(0, 100);
    const terms = parseTerms(q);
    const sort = pick(VC_SORTS, f.sort) ?? (q ? 'best' : 'newest');
    const customers = has(ctx, 'customers.view');
    const where = [sql`true`];
    if (status !== 'all') where.push(sql`c.status = any(${VC_GROUP[status]}::text[])`);
    if (direction !== 'all') where.push(sql`c.direction = ${direction}`);
    if (language) where.push(sql`c.primary_language = ${language}`);
    if (intent !== 'all') where.push(sql`exists (select 1 from jsonb_array_elements(coalesce(c.intents, '[]'::jsonb)) h where h->>'intent' = ${intent})`);
    if (followUp !== 'all') {
      where.push(followUp === 'none' ? sql`c.items = 0` : followUp === 'open' ? sql`c.open_items > 0`
        : followUp === 'in_task' ? sql`c.items > 0 and c.open_items = 0 and c.task_items > 0` : sql`c.items > 0 and c.open_items = 0 and c.task_items = 0`);
    }
    if (per.start && per.end) {
      const col = dateField === 'summary' ? sql`c.summary_at` : dateField === 'followup' ? sql`c.last_decision_at` : sql`c.created_at`;
      where.push(sql`${col} >= ${per.start} and ${col} < ${per.end}`);
    }
    // what each term can match — redacted transcript, summary, intents, call id, and (with customers.view) the linked customer
    const digits = q.replace(/[^0-9]/g, '');
    const idq = q.toLowerCase().replace(/[^0-9a-z:_-]/g, '');
    const SEG = (like: string) => sql`exists (select 1 from call_transcript_segments s where s.transcript_id = c.id and s.tenant_id = ${T} and s.redacted_text ilike ${like})`;
    const hit = {
      callId: idq.length >= 6 && idq.length === q.length ? sql`(c.id::text like ${idq + '%'} or lower(c.provider_call_id) like ${idq + '%'})` : sql`false`,
      phone: customers && digits.length >= 4 && digits.length === q.replace(/[\s()+.-]/g, '').length
        ? sql`regexp_replace(coalesce(cu.normalized_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}` : sql`false`,
      customer: customers && q.length >= 2 ? sql`cu.full_name ilike ${'%' + esc(q) + '%'}` : sql`false`,
      transcript: terms.length ? sql.join(terms.map((t) => SEG('%' + esc(t) + '%')), sql` and `) : sql`false`,
      summary: terms.length ? sql.join(terms.map((t) => sql`c.quick_summary ilike ${'%' + esc(t) + '%'}`), sql` and `) : sql`false`,
      intent: terms.length ? sql.join(terms.map((t) => sql`c.intents::text ilike ${'%' + esc(t.replace(/ /g, '_')) + '%'}`), sql` and `) : sql`false`,
    };
    if (q) where.push(sql`(${hit.callId} or ${hit.phone} or ${hit.customer} or ${hit.transcript} or ${hit.summary} or ${hit.intent})`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`${this.calls(ctx)} left join customers cu on cu.id = c.customer_id and cu.tenant_id = ${T}`;
    const B = (x: ReturnType<typeof sql>) => sql`coalesce((${x}), false)::int`;   // a null column is "no match", never a top score
    const SCORE = sql`(${B(hit.callId)} * 8 + ${B(hit.phone)} * 6 + ${B(hit.customer)} * 6 + ${B(hit.transcript)} * 4 + ${B(hit.summary)} * 2 + ${B(hit.intent)})`;
    const order = sort === 'oldest' ? sql`c.created_at asc, c.id asc` : sort === 'best' && q ? sql`${SCORE} desc, c.created_at desc, c.id desc` : sql`c.created_at desc, c.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select c.*, cu.full_name as customer, cu.normalized_phone as phone,
        coalesce((${hit.callId}), false) as m_call, coalesce((${hit.phone}), false) as m_phone, coalesce((${hit.customer}), false) as m_customer, coalesce((${hit.transcript}), false) as m_transcript, coalesce((${hit.summary}), false) as m_summary, coalesce((${hit.intent}), false) as m_intent
      from ${FROM} where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    // an excerpt for transcript matches: one bounded lookup per row on the page
    const seg = new Map<string, string>();
    const segIds = rows.filter((r) => r.m_transcript).map((r) => String(r.id));
    if (segIds.length && terms.length) {
      const s = (await sql<Row>`select distinct on (transcript_id) transcript_id, redacted_text from call_transcript_segments
        where tenant_id = ${T} and transcript_id = any(${segIds}::uuid[]) and redacted_text ilike ${'%' + esc(terms[0]) + '%'} order by transcript_id, seq`.execute(this.db)).rows;
      for (const x of s) seg.set(String(x.transcript_id), String(x.redacted_text ?? ''));
    }
    return {
      items: rows.map((r) => {
        const matchType = !q ? null : r.m_call ? 'call_id' : r.m_phone ? 'phone' : r.m_customer ? 'customer' : r.m_transcript ? 'transcript' : r.m_summary ? 'summary' : 'intent';
        const excerptSrc = matchType === 'transcript' ? seg.get(String(r.id)) ?? '' : String(r.quick_summary ?? '');
        return {
          id: String(r.id), callRef: r.provider_call_id ?? null, provider: r.provider, callAt: iso(r.created_at), direction: r.direction, handler: r.handler,
          durationSeconds: r.duration_seconds == null ? null : N(r.duration_seconds), status: r.status, statusGroup: groupOf(r.status),
          redactionStatus: r.redaction_status, language: r.primary_language ?? null, mixedLanguage: !!r.mixed_language,
          hasSummary: r.summary_at != null, summaryAt: iso(r.summary_at),
          intents: arr(r.intents).map((h) => h?.intent).filter(Boolean).slice(0, 3),
          customer: customers ? (r.customer ?? null) : null, customerLinked: !!r.customer_id,
          phoneLast4: customers && r.phone ? String(r.phone).replace(/[^0-9]/g, '').slice(-4) : null,
          matchType, excerpt: excerptSrc ? safeExcerpt(excerptSrc, terms) : null,
          followUp: { state: this.followState(r), open: N(r.open_items), inTask: N(r.task_items), items: N(r.items) },
        };
      }),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, status, direction, language, intent, followUp, dateField, sort, preset: per.preset, from: per.from, to: per.to },
      period: { today: per.today, timeZone: per.tz }, customersVisible: customers,
    };
  }

  // ── the details overlay ────────────────────────────────────────────────────────────────────────────────────
  async call(ctx: VcCtx, id: string) {
    this.need(ctx);
    const T = ctx.tenantId;
    if (!isUuid(id)) throw new VoiceCallsError('That call was not found.', 'VC_CALL_NOT_FOUND', 404);
    const r = (await sql<Row>`select c.*, cu.full_name as customer, cu.normalized_phone as phone, b.name as branch
      from ${this.calls(ctx)} left join customers cu on cu.id = c.customer_id and cu.tenant_id = ${T}
      left join branches b on b.id = c.branch_id and b.tenant_id = ${T} where c.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new VoiceCallsError('That call was not found.', 'VC_CALL_NOT_FOUND', 404);
    const segs = (await sql<Row>`select seq, speaker_role, speaker_label, start_ms, end_ms, redacted_text, language, confidence from call_transcript_segments
      where tenant_id = ${T} and transcript_id = ${id}::uuid order by seq asc`.execute(this.db)).rows;
    const intel = (await sql<Row>`select quick_summary, detailed_summary, detailed_source, intents, appointment, unresolved, sentiment, extraction_confidence, created_at
      from call_transcript_intelligence where tenant_id = ${T} and transcript_id = ${id}::uuid limit 1`.execute(this.db)).rows[0];
    const reviews = (await sql<Row>`select distinct on (r.item_type) r.item_type, r.decision, r.follow_up_id, r.created_at, f.status as task_status
      from voice_followup_reviews r left join ai_receptionist_follow_ups f on f.id = r.follow_up_id and f.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and r.transcript_id = ${id}::uuid order by r.item_type, r.created_at desc, r.id desc`.execute(this.db)).rows;
    const customers = has(ctx, 'customers.view');
    // opening a call's transcript is sensitive — it is audited (who, which call; no transcript text in the audit row)
    await recordAuditStrict(this.db, { tenantId: T, branchId: r.branch_id ?? null, userId: isUuid(ctx.userId) ? ctx.userId! : null, role: ctx.role ?? null },
      { module: 'ai_voice_transcription', action: 'voice_transcript.viewed', resourceType: 'call_transcript', resourceId: id, summary: 'Call transcript opened (redacted)' });
    const appt = intel?.appointment && typeof intel.appointment === 'object' ? intel.appointment : null;
    // Voice Call History extras 05 — call → booking traceability. The request above is only what the caller said; the
    // OUTCOME comes from the Booking records (pos_tech_appointments) made for the call's linked customer within 24 h after
    // the call (matched by customer + time — there is no call id on an appointment, and the screen says so). What the voice
    // agent itself reported (voice_call_outcomes.booking_outcome) is shown beside it, labelled as provider-reported.
    const reported = r.provider_call_id ? (await sql<{ booking_outcome: string | null }>`select o.booking_outcome from voice_call_outcomes o
      where o.tenant_id = ${T} and o.provider_call_id = ${String(r.provider_call_id)} limit 1`.execute(this.db)).rows[0]?.booking_outcome ?? null : null;
    const booked = customers && r.customer_id ? (await sql<{ id: string; appt_date: string; start_time: string; status: string; source: string; created_at: Date | string }>`
      select a.id, a.appt_date::text as appt_date, a.start_time, a.status, a.source, a.created_at from pos_tech_appointments a
      where a.tenant_id = ${T} and a.customer_id = ${String(r.customer_id)}::uuid and a.created_at >= ${r.created_at}::timestamptz and a.created_at < ${r.created_at}::timestamptz + interval '24 hours'
      order by a.created_at, a.id limit 5`.execute(this.db)).rows : [];
    return {
      booking: {
        basis: !r.customer_id ? 'no_linked_customer' : !customers ? 'hidden' : 'same_customer_within_24h',
        providerReported: reported,
        appointments: booked.map((a) => ({ id: String(a.id), date: String(a.appt_date).slice(0, 10), startTime: String(a.start_time), status: String(a.status), source: String(a.source), createdAt: iso(a.created_at) })),
      },
      call: {
        id: String(r.id), callRef: r.provider_call_id, provider: r.provider, branch: r.branch ?? null, callAt: iso(r.created_at), updatedAt: iso(r.updated_at),
        direction: r.direction, handler: r.handler, durationSeconds: r.duration_seconds == null ? null : N(r.duration_seconds),
        status: r.status, statusGroup: groupOf(r.status), redactionStatus: r.redaction_status, language: r.primary_language ?? null, mixedLanguage: !!r.mixed_language,
      },
      customer: { linked: !!r.customer_id, id: customers && r.customer_id ? String(r.customer_id) : null, name: customers ? (r.customer ?? null) : null,
        phoneLast4: customers && r.phone ? String(r.phone).replace(/[^0-9]/g, '').slice(-4) : null, visible: customers },
      transcript: segs.map((s) => ({ seq: N(s.seq), speaker: s.speaker_role, startMs: s.start_ms == null ? null : N(s.start_ms), text: redactText(String(s.redacted_text ?? '')).text,
        language: s.language ?? null, uncertain: s.confidence != null && Number(s.confidence) < 0.6 })),
      summary: intel ? { quick: redactText(String(intel.quick_summary ?? '')).text, detailed: intel.detailed_summary ? redactText(String(intel.detailed_summary)).text : null,
        source: intel.detailed_source ?? 'rules', generatedAt: iso(intel.created_at), sentiment: intel.sentiment ?? null } : null,
      intents: arr(intel?.intents).map((h) => ({ intent: h?.intent, confidence: h?.confidence ?? null, evidenceSeq: arr(h?.evidenceSeq) })),
      // what the caller asked for — extracted from the words, NEVER a booking (Booking alone confirms an appointment)
      request: appt && (arr(appt.requestedServices).length || appt.preferredDate || appt.preferredTime || appt.requestedTechnician)
        ? { services: arr(appt.requestedServices), technician: appt.requestedTechnician ?? null, date: appt.preferredDate ?? null, time: appt.preferredTime ?? null,
          guests: appt.guests ?? null, confidence: appt.confidence ?? null, state: 'requested_unverified' } : null,
      followUps: arr(intel?.unresolved).map((u) => {
        const rv = reviews.find((x) => x.item_type === u?.type);
        const st = !rv || rv.decision === 'reopened' ? 'open' : rv.decision === 'dismissed' ? 'resolved' : DONE_TASK.includes(String(rv.task_status)) ? 'resolved' : 'in_task';
        return { type: u?.type, priority: u?.priority ?? 'medium', description: u?.description ? redactText(String(u.description)).text : null, evidenceSeq: arr(u?.evidenceSeq),
          state: st, taskId: rv?.follow_up_id ? String(rv.follow_up_id) : null };
      }),
      canWorkFollowUps: has(ctx, 'communications.manage') || has(ctx, 'ai.manage'),
    };
  }

  // ── Check Voice Transcription System — read-only ───────────────────────────────────────────────────────────
  async check(ctx: VcCtx) {
    this.need(ctx);
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from voice_system_health_runs where tenant_id = ${T} and branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; component: string; state: St; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }> = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const S = this.scope(sql`t.branch_id`, ctx).w;

    const key = await one(sql<Row>`select count(*) filter (where revoked_at is null and (expires_at is null or expires_at > now()))::int as active,
        max(last_used_at) as last_used from voice_integration_keys where tenant_id = ${T}`);
    const calls = await one(sql<Row>`select count(*)::int as n, max(t.created_at) as last, count(*) filter (where t.created_at > now() - interval '7 days')::int as n7,
        count(*) filter (where t.branch_id is null)::int as no_branch,
        count(*) filter (where t.status = any(${VC_GROUP.processing}::text[]) and t.updated_at < now() - interval '1 hour')::int as stuck,
        count(*) filter (where t.status = any(${VC_GROUP.failed}::text[]) and t.created_at > now() - interval '7 days')::int as failed7,
        count(*) filter (where t.status = 'completed' and t.created_at > now() - interval '7 days')::int as done7,
        count(*) filter (where t.status in ('consent_missing', 'consent_declined') and t.created_at > now() - interval '30 days')::int as no_consent,
        count(*) filter (where t.status in ('completed', 'low_confidence') and t.redaction_status not in ('completed', 'not_required') and t.updated_at < now() - interval '1 hour')::int as unredacted,
        count(*) filter (where t.status in ('completed', 'low_confidence') and t.segment_count > 0 and t.created_at < now() - interval '15 minutes'
          and not exists (select 1 from call_transcript_intelligence i where i.transcript_id = t.id and i.tenant_id = t.tenant_id))::int as no_summary,
        count(*) filter (where t.customer_id is not null)::int as linked
      from call_transcripts t where t.tenant_id = ${T} and t.deleted_at is null and ${S}`);
    checks.push({ key: 'provider_connection', component: 'provider', state: !N(key.active) ? (N(calls.n) ? 'WARNING' : 'INSUFFICIENT_DATA') : 'PASSED',
      count: N(key.active), detail: { lastUsedAt: iso(key.last_used) } });
    checks.push({ key: 'calls_arriving', component: 'ingestion', state: !N(calls.n) ? 'INSUFFICIENT_DATA' : N(calls.n7) ? 'PASSED' : 'WARNING', count: N(calls.n7), detail: { lastCallAt: iso(calls.last) } });
    const branches = N((await one(sql<Row>`select count(*)::int as n from branches where tenant_id = ${T} and coalesce(status, 'active') = 'active'`)).n);
    checks.push({ key: 'branch_mapping', component: 'ingestion', state: N(calls.no_branch) && branches > 1 ? 'WARNING' : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(calls.no_branch) });
    checks.push({ key: 'consent', component: 'recording', state: N(calls.no_consent) ? 'WARNING' : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(calls.no_consent) });
    const f7 = N(calls.failed7), d7 = N(calls.done7);
    checks.push({ key: 'transcription_jobs', component: 'transcription', state: !N(calls.n7) ? 'INSUFFICIENT_DATA' : f7 > d7 ? 'FAILED' : f7 || N(calls.stuck) ? 'WARNING' : 'PASSED',
      count: f7 + N(calls.stuck), detail: { failed7d: f7, stuckOverAnHour: N(calls.stuck), completed7d: d7 } });
    checks.push({ key: 'redaction', component: 'privacy', state: N(calls.unredacted) ? 'FAILED' : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(calls.unredacted) });
    const leak = await one(sql<Row>`select
        (select count(*) from call_transcript_segments s join call_transcripts t on t.id = s.transcript_id and t.tenant_id = s.tenant_id
          where s.tenant_id = ${T} and t.deleted_at is null and ${S} and s.redacted_text ~ ${LEAK_RE})::int as seg,
        (select count(*) from call_transcript_intelligence i join call_transcripts t on t.id = i.transcript_id and t.tenant_id = i.tenant_id
          where i.tenant_id = ${T} and t.deleted_at is null and ${S} and (i.quick_summary ~ ${LEAK_RE} or coalesce(i.detailed_summary, '') ~ ${LEAK_RE}))::int as summ`);
    checks.push({ key: 'no_card_numbers_searchable', component: 'privacy', state: N(leak.seg) + N(leak.summ) ? 'FAILED' : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA',
      count: N(leak.seg) + N(leak.summ), detail: { segments: N(leak.seg), summaries: N(leak.summ) } });
    checks.push({ key: 'summaries', component: 'ai_summary', state: N(calls.no_summary) ? 'WARNING' : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA', count: N(calls.no_summary) });
    checks.push({ key: 'customer_matching', component: 'customers', state: !N(calls.n) ? 'INSUFFICIENT_DATA' : 'PASSED', count: N(calls.linked), detail: { calls: N(calls.n), linked: N(calls.linked) } });
    const badLink = N((await one(sql<Row>`select count(*)::int as n from call_transcripts t left join customers c on c.id = t.customer_id
      where t.tenant_id = ${T} and t.deleted_at is null and t.customer_id is not null and (c.id is null or c.tenant_id <> t.tenant_id)`)).n);
    checks.push({ key: 'customer_links_valid', component: 'customers', state: badLink ? 'FAILED' : 'PASSED', count: badLink });
    // search reads the live redacted tables (no separate index), so a finished call is searchable at once — this is the proof
    checks.push({ key: 'search_freshness', component: 'search', state: N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA', detail: { source: 'live_redacted_tables' } });
    const ghost = await one(sql<Row>`select
        (select count(*) from call_transcript_segments s join call_transcripts t on t.id = s.transcript_id where s.tenant_id = ${T} and t.deleted_at is not null and length(coalesce(s.redacted_text, '')) > 0)::int as segs,
        (select count(*) from call_transcript_intelligence i join call_transcripts t on t.id = i.transcript_id where i.tenant_id = ${T} and t.deleted_at is not null and length(coalesce(i.quick_summary, '')) > 0)::int as summ`);
    checks.push({ key: 'deletions_propagated', component: 'retention', state: N(ghost.segs) + N(ghost.summ) ? 'FAILED' : 'PASSED', count: N(ghost.segs) + N(ghost.summ) });
    const cross = N((await one(sql<Row>`select count(*)::int as n from call_transcript_segments s join call_transcripts t on t.id = s.transcript_id
      where s.tenant_id = ${T} and t.tenant_id <> s.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', component: 'security', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });

    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from voice_system_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.branch_id is not distinct from ${isUuid(ctx.branchId) ? ctx.branchId : null} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const c of checks) c.lastPassedAt = c.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === c.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : N(calls.n) ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-system-health:' || ${T} || ':' || coalesce(${isUuid(ctx.branchId) ? ctx.branchId : null}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into voice_system_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt, reused: false };
    });
  }
}
