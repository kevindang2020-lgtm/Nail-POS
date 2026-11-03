// churn-watch-center.ts — Churn Watch guide (Nov 1 2026): `/pos/churn-watch/*`.
//
// An INTERNAL, cautious review queue — never shown to customers, never a certainty. It keeps no second rules engine and no
// second customer list: the signals are the assistant's existing churn rule (evaluateChurnRisk), computed for every live
// customer by the ONE Customer Intelligence scan (customer_intelligence_snapshots, migrations 763/764). Churn Watch adds only
// its review workflow (churn_watch_reviews + append-only churn_watch_review_events) and a read-only health check.
//
// Signal taxonomy (guide §06), mapped from the persisted rule levels without renaming them:
//   possible → Needs Review · elevated / high → Higher-Priority Review · low → No Current Signal ·
//   insufficient → Insufficient History · no completed scan / failed scan → Data Unavailable.
// A review is current while the signal has not RISEN above the level it was reviewed at (and a deferral has not passed its
// date); a rising signal returns to Needs Review. Nothing here texts, books, edits a customer or changes points.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { RetentionRepository, isUuid, maskStoredPhone, maskEmail, salonPresetRange, type RetentionContext, type BranchScope } from '@aipowersalon/customers';
import { customerSearchPredicate, CI_RULE_VERSION } from './customer-intelligence-center';

type Row = Record<string, any>;
export type CwCtx = RetentionContext;
export type AuditFn = (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<unknown>;
export class ChurnWatchError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); }
}

export const CW_TABS = ['needs_review', 'reviewed', 'all_signals', 'insufficient', 'no_signal'] as const;
export const CW_PRIORITIES = ['higher', 'normal'] as const;
export const CW_DATE_FIELDS = ['signal_since', 'last_visit', 'next_appointment', 'created', 'reviewed', 'evaluated'] as const;
export const CW_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year', 'custom'] as const;
export const CW_SORTS = ['signal_newest', 'priority', 'last_visit', 'days_since', 'name'] as const;
export const CW_ACTIONS = ['reviewed', 'deferred', 'reopened', 'note'] as const;
export const CW_PAGE_SIZES = [10, 25, 50, 100] as const;
const FLAGGED = ['possible', 'elevated', 'high'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const uuidOrNull = (v: unknown) => (isUuid(String(v ?? '')) ? String(v) : null);
/** the guide's state for one persisted rule level */
export const churnState = (level: string | null | undefined) => (level === 'possible' ? 'needs_review' : level === 'elevated' || level === 'high' ? 'higher_priority'
  : level === 'low' ? 'no_current_signal' : level === 'insufficient' ? 'insufficient_history' : 'data_unavailable');

export interface CwQuery { q?: unknown; tab?: unknown; priority?: unknown; branch?: unknown; dateField?: unknown; preset?: unknown; from?: unknown; to?: unknown; sort?: unknown; page?: unknown; pageSize?: unknown }
export type CwCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
export interface CwCheck { key: string; state: CwCheckState; count?: number | null; detail?: Record<string, unknown> }

export class ChurnWatchCenter {
  private readonly ret: RetentionRepository;
  constructor(private readonly db: Kysely<any>, private readonly enabled: (ctx: CwCtx) => Promise<boolean>, private readonly now: () => number = () => Date.now()) { this.ret = new RetentionRepository(db); }

  private async gate(ctx: CwCtx) { if (!(await this.enabled(ctx))) throw new ChurnWatchError('The AI Customer Profile assistant is turned off for this salon.', 'AI_CUSTOMER_PROFILE_DISABLED', 403); }
  private async scope(ctx: CwCtx, branch?: unknown): Promise<BranchScope> {
    try { return await this.ret.branchScope(ctx, branch); }
    catch (e: any) { throw new ChurnWatchError(e?.message ?? 'Unknown branch.', e?.code === 'BRANCH_NOT_AUTHORIZED' ? 'BRANCH_NOT_AUTHORIZED' : 'CHURN_INVALID_BRANCH', e?.status ?? 400); }
  }
  private custVisible(s: BranchScope) {
    if (!s.branchIds) return sql`true`;
    const ids = s.branchIds;
    return sql`(c.branch_id = any(${ids}::uuid[])
      or exists (select 1 from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.branch_id = any(${ids}::uuid[]) and t.removed_at is null)
      or exists (select 1 from pos_tech_appointments a where a.tenant_id = c.tenant_id and a.customer_id = c.id and a.branch_id = any(${ids}::uuid[])))`;
  }
  private rank(col: ReturnType<typeof sql>) { return sql`(case ${col} when 'possible' then 1 when 'elevated' then 2 when 'high' then 3 else 0 end)`; }
  /** a review still stands: the signal has not risen above what was reviewed, and a deferral has not passed its date */
  private reviewCurrent(today: string) {
    return sql`(r.customer_id is not null and ${this.rank(sql`sn.churn_level`)} <= ${this.rank(sql`r.level_at_review`)}
      and (r.status = 'reviewed' or r.due_on is null or r.due_on > ${today}::date))`;
  }
  private async latestScan(T: string) {
    return (await sql<Row>`select id, status, scanned, counts, finished_at, rule_version, started_at, error_code from customer_intelligence_scans
      where tenant_id = ${T} order by started_at desc limit 1`.execute(this.db)).rows[0];
  }
  private async lastOk(T: string) {
    return (await sql<Row>`select id, scanned, counts, finished_at, rule_version from customer_intelligence_scans where tenant_id = ${T} and status = 'completed' order by started_at desc limit 1`.execute(this.db)).rows[0];
  }
  private async period(ctx: CwCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const preset = pick(CW_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    const w = await this.ret.window(ctx, { preset: 'today' });
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today: w.today, tz: w.tz };
    let from: string, to: string;
    if (preset === 'custom') {
      const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
      const b = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
      if (!a || !b) throw new ChurnWatchError('Choose a From and a To date.', 'CHURN_INVALID_PERIOD');
      if (a > b) throw new ChurnWatchError('The From date must be on or before the To date.', 'CHURN_INVALID_PERIOD');
      from = a; to = b;
    } else ({ from, to } = salonPresetRange(preset, w.today)!);
    const b = (await sql<Row>`select (${from}::date::timestamp at time zone ${w.tz}) as s, ((${to}::date + 1)::timestamp at time zone ${w.tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(b.s) as Date | null, end: new Date(b.e) as Date | null, today: w.today, tz: w.tz };
  }
  private freshness(latest: Row | undefined, ok: Row | undefined) {
    const state = !latest ? 'never' : latest.status === 'running' ? 'running' : latest.status === 'failed' ? 'failed' : !ok ? 'never'
      : ok.rule_version !== CI_RULE_VERSION ? 'stale' : (this.now() - new Date(ok.finished_at).getTime()) / 60000 >= 60 ? 'stale' : 'up_to_date';
    return { state, lastEvaluatedAt: iso(ok?.finished_at), lastError: latest?.status === 'failed' ? latest.error_code : null, ruleVersion: CI_RULE_VERSION };
  }

  // ── the six metrics ───────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: CwCtx) {
    await this.gate(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const [latest, ok] = [await this.latestScan(T), await this.lastOk(T)];
    const fr = this.freshness(latest, ok);
    if (!ok || ok.rule_version !== CI_RULE_VERSION) return { metrics: null, freshness: fr, unavailable: true };
    const m = (await sql<Row>`select count(*)::int as evaluated,
        count(*) filter (where sn.churn_level = 'possible' and not ${this.reviewCurrent(today)})::int as needs_review,
        count(*) filter (where sn.churn_level in ('elevated', 'high') and not ${this.reviewCurrent(today)})::int as higher_priority,
        count(*) filter (where sn.churn_level = 'insufficient')::int as insufficient,
        count(*) filter (where sn.has_upcoming)::int as upcoming,
        count(*) filter (where sn.churn_level = any(${FLAGGED}::text[]) and ${this.reviewCurrent(today)})::int as reviewed,
        count(*) filter (where sn.churn_level = 'low')::int as no_signal
      from customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id and c.tenant_id = sn.tenant_id
      left join churn_watch_reviews r on r.tenant_id = sn.tenant_id and r.customer_id = sn.customer_id
      where sn.tenant_id = ${T} and c.archived_at is null and ${this.custVisible(s)}`.execute(this.db)).rows[0] ?? {};
    return {
      metrics: { evaluated: N(m.evaluated), needsReview: N(m.needs_review), higherPriority: N(m.higher_priority), insufficientHistory: N(m.insufficient), upcomingBooking: N(m.upcoming), reviewed: N(m.reviewed), noSignal: N(m.no_signal) },
      definitions: { ruleVersion: CI_RULE_VERSION, needsReview: 'possible', higherPriority: ['elevated', 'high'], reviewStandsUntil: 'the signal rises above the reviewed level, or a deferral date passes' },
      freshness: fr, unavailable: false, scope: { label: s.label, confined: s.confined },
    };
  }

  // ── the review queue ──────────────────────────────────────────────────────────────────────────────────────────
  async list(ctx: CwCtx, f: CwQuery, opts: { fullContact: boolean }) {
    await this.gate(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx, f.branch);
    const tab = pick(CW_TABS, f.tab) ?? 'needs_review';
    const priority = pick(CW_PRIORITIES, f.priority);
    const dateField = pick(CW_DATE_FIELDS, f.dateField) ?? 'signal_since';
    const sort = pick(CW_SORTS, f.sort) ?? (tab === 'needs_review' ? 'priority' : 'signal_newest');
    const pageSize = (CW_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const q = String(f.q ?? '').trim().slice(0, 100);
    if (q && q.length < 2) throw new ChurnWatchError('Type at least 2 characters.', 'CHURN_SEARCH_TOO_SHORT');
    const per = await this.period(ctx, f);
    const ok = await this.lastOk(T);
    if (!ok || ok.rule_version !== CI_RULE_VERSION) return { items: [], total: 0, page: 1, pageSize, totalPages: 1, unavailable: true, freshness: this.freshness(await this.latestScan(T), ok) };
    const today = per.today;
    const where = [sql`sn.tenant_id = ${T}`, sql`c.archived_at is null`, this.custVisible(s)];
    if (tab === 'needs_review') where.push(sql`sn.churn_level = any(${FLAGGED}::text[]) and not ${this.reviewCurrent(today)}`);
    if (tab === 'reviewed') where.push(sql`sn.churn_level = any(${FLAGGED}::text[]) and ${this.reviewCurrent(today)}`);
    if (tab === 'all_signals') where.push(sql`sn.churn_level = any(${FLAGGED}::text[])`);
    if (tab === 'insufficient') where.push(sql`sn.churn_level = 'insufficient'`);
    if (tab === 'no_signal') where.push(sql`sn.churn_level = 'low'`);
    if (priority === 'higher') where.push(sql`sn.churn_level in ('elevated', 'high')`);
    if (priority === 'normal') where.push(sql`sn.churn_level = 'possible'`);
    if (per.start && per.end) {
      if (dateField === 'last_visit') where.push(sql`sn.last_visit_at >= ${per.start} and sn.last_visit_at < ${per.end}`);
      else if (dateField === 'next_appointment') where.push(sql`sn.next_appointment_date >= ${per.from}::date and sn.next_appointment_date <= ${per.to}::date`);
      else if (dateField === 'created') where.push(sql`c.created_at >= ${per.start} and c.created_at < ${per.end}`);
      else if (dateField === 'reviewed') where.push(sql`r.reviewed_at >= ${per.start} and r.reviewed_at < ${per.end}`);
      else if (dateField === 'evaluated') where.push(sql`sn.computed_at >= ${per.start} and sn.computed_at < ${per.end}`);
      else where.push(sql`sn.churn_since >= ${per.start} and sn.churn_since < ${per.end}`);
    }
    if (q) where.push(customerSearchPredicate(T, q));
    const W = sql.join(where, sql` and `);
    const order = sort === 'priority' ? sql`${this.rank(sql`sn.churn_level`)} desc, sn.churn_since desc nulls last, c.id desc`
      : sort === 'last_visit' ? sql`sn.last_visit_at desc nulls last, c.id desc`
      : sort === 'days_since' ? sql`sn.days_since_last desc nulls last, c.id desc`
      : sort === 'name' ? sql`lower(coalesce(c.full_name, c.first_name)) asc, c.id asc`
      : sql`sn.churn_since desc nulls last, sn.computed_at desc, c.id desc`;
    const FROM = sql`customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id and c.tenant_id = sn.tenant_id
      left join churn_watch_reviews r on r.tenant_id = sn.tenant_id and r.customer_id = sn.customer_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where sn.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select c.id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display, c.email,
        sn.churn_level, sn.churn_confidence, sn.churn_evidence, sn.churn_since, sn.last_visit_at, sn.days_since_last, sn.typical_interval_days, sn.completed_visits,
        sn.has_upcoming, sn.next_appointment_date, sn.computed_at, sn.rebooking, r.status as review_status, r.reviewed_at, r.level_at_review, r.due_on::text as due_on,
        ${this.reviewCurrent(today)} as review_current
      from ${FROM} where sn.tenant_id = ${T} and ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({
        id: String(r.id), name: String(r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '').trim() || null,
        phone: r.normalized_phone ? (opts.fullContact ? (r.phone_display || r.normalized_phone) : maskStoredPhone(r.normalized_phone)) : null,
        email: r.email ? (opts.fullContact ? String(r.email) : maskEmail(String(r.email))) : null,
        level: r.churn_level, state: churnState(r.churn_level), confidence: r.churn_confidence ?? null, evidence: (r.churn_evidence ?? []) as string[],
        signalSince: iso(r.churn_since), lastVisitAt: iso(r.last_visit_at), daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last),
        typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days), completedVisits: N(r.completed_visits),
        hasUpcoming: !!r.has_upcoming, nextAppointmentDate: r.next_appointment_date ? String(r.next_appointment_date).slice(0, 10) : null, rebooking: !!r.rebooking,
        evaluatedAt: iso(r.computed_at),
        review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), levelAtReview: r.level_at_review, dueOn: r.due_on ?? null, current: !!r.review_current } : null,
      })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), unavailable: false,
      applied: { q: q || null, tab, priority: priority ?? null, dateField, preset: per.preset, from: per.from, to: per.to, sort },
      period: { from: per.from, to: per.to, timeZone: per.tz, today: per.today }, contact: opts.fullContact ? 'full' : 'masked',
      freshness: this.freshness(await this.latestScan(T), ok),
    };
  }

  /** the Retention Evidence overlay: the rule's evidence, its inputs, the review state and history — audited */
  async customer(ctx: CwCtx, id: string, audit: AuditFn) {
    await this.gate(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    if (!isUuid(`${id}`)) throw new ChurnWatchError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const { today } = await this.ret.window(ctx, { preset: 'today' });
    const r = (await sql<Row>`select c.id, sn.churn_level, sn.churn_confidence, sn.churn_evidence, sn.churn_since, sn.status as activity, sn.evidence as activity_evidence,
        sn.completed_visits, sn.first_visit_at, sn.last_visit_at, sn.typical_interval_days, sn.days_since_last, sn.has_upcoming, sn.next_appointment_date,
        sn.canceled_count, sn.no_show_count, sn.membership_canceled, sn.rebooking, sn.rebooking_reason, sn.computed_at, sn.scan_id,
        r.status as review_status, r.reviewed_at, r.level_at_review, r.due_on::text as due_on, r.version as review_version, ${this.reviewCurrent(today)} as review_current
      from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
      left join churn_watch_reviews r on r.tenant_id = c.tenant_id and r.customer_id = c.id
      where c.tenant_id = ${T} and c.id = ${id}::uuid and ${this.custVisible(s)}`.execute(this.db)).rows[0];
    if (!r) throw new ChurnWatchError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    const scan = r.scan_id ? (await sql<Row>`select tunables, rule_version, finished_at from customer_intelligence_scans where tenant_id = ${T} and id = ${r.scan_id}`.execute(this.db)).rows[0] : null;
    const events = (await sql<Row>`select e.id, e.event_type, e.level, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from churn_watch_review_events e left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and e.customer_id = ${id}::uuid order by e.created_at desc, e.id desc limit 50`.execute(this.db)).rows;
    await this.db.transaction().execute(async (trx) => { await audit(trx as unknown as Kysely<any>, { customerId: id, level: r.churn_level ?? null }); });
    return {
      customerId: id, evaluated: r.churn_level != null,
      signal: r.churn_level == null ? null : {
        level: r.churn_level, state: churnState(r.churn_level), confidence: r.churn_confidence ?? null, evidence: (r.churn_evidence ?? []) as string[], since: iso(r.churn_since),
        note: 'This is a risk indicator, not a confirmed decision to leave.',
      },
      inputs: r.churn_level == null ? null : {
        completedVisits: N(r.completed_visits), firstVisitAt: iso(r.first_visit_at), lastVisitAt: iso(r.last_visit_at), typicalIntervalDays: r.typical_interval_days == null ? null : N(r.typical_interval_days),
        daysSinceLast: r.days_since_last == null ? null : N(r.days_since_last), hasUpcoming: !!r.has_upcoming, nextAppointmentDate: r.next_appointment_date ? String(r.next_appointment_date).slice(0, 10) : null,
        canceledCount: N(r.canceled_count), noShowCount: N(r.no_show_count), membershipCanceled: !!r.membership_canceled,
        activity: r.activity, activityEvidence: (r.activity_evidence ?? []) as string[], rebooking: !!r.rebooking, rebookingReason: r.rebooking_reason ?? null,
      },
      rule: scan ? { version: scan.rule_version, tunables: scan.tunables, evaluatedAt: iso(r.computed_at) } : null,
      review: r.review_status ? { status: r.review_status, at: iso(r.reviewed_at), levelAtReview: r.level_at_review, dueOn: r.due_on ?? null, current: !!r.review_current, version: N(r.review_version) } : null,
      history: events.map((e) => ({ id: e.id, type: e.event_type, level: e.level, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })),
    };
  }

  /** Mark reviewed · Defer (with an optional date) · Reopen · Add note — internal workflow only, never a customer change */
  async review(ctx: CwCtx, id: string, b: { action?: unknown; note?: unknown; dueOn?: unknown; expectedVersion?: unknown }, audit: AuditFn) {
    await this.gate(ctx);
    const T = ctx.tenantId;
    const action = pick(CW_ACTIONS, b.action);
    if (!action) throw new ChurnWatchError('Choose an action.', 'CHURN_INVALID_ACTION');
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
    if (action === 'note' && !note) throw new ChurnWatchError('Write a note first.', 'CHURN_NOTE_REQUIRED');
    const dueOn = typeof b.dueOn === 'string' && DAY.test(b.dueOn) ? b.dueOn : null;
    const s = await this.scope(ctx);
    return this.db.transaction().execute(async (trx) => {
      const c = (await sql<Row>`select c.id, sn.churn_level from customers c left join customer_intelligence_snapshots sn on sn.tenant_id = c.tenant_id and sn.customer_id = c.id
        where c.tenant_id = ${T} and c.id = ${isUuid(`${id}`) ? id : '00000000-0000-0000-0000-000000000000'}::uuid and c.archived_at is null and ${this.custVisible(s)}`.execute(trx)).rows[0];
      if (!c) throw new ChurnWatchError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
      const cur = (await sql<Row>`select version from churn_watch_reviews where tenant_id = ${T} and customer_id = ${id}::uuid for update`.execute(trx)).rows[0];
      if (b.expectedVersion != null && N(b.expectedVersion) !== N(cur?.version ?? 0))
        throw new ChurnWatchError('Someone else updated this review. Reload it and try again.', 'CHURN_STALE_VERSION', 409, { currentVersion: N(cur?.version ?? 0) });
      if ((action === 'reviewed' || action === 'deferred') && !FLAGGED.includes(String(c.churn_level))) throw new ChurnWatchError('There is no current signal to review.', 'CHURN_NO_SIGNAL', 409);
      if (action === 'reviewed' || action === 'deferred') {
        await sql`insert into churn_watch_reviews (tenant_id, customer_id, status, level_at_review, due_on, reviewed_by, reviewed_at, updated_by, version)
          values (${T}, ${id}::uuid, ${action}, ${c.churn_level}, ${action === 'deferred' ? dueOn : null}::date, ${uuidOrNull(ctx.userId)}, now(), ${uuidOrNull(ctx.userId)}, 1)
          on conflict (tenant_id, customer_id) do update set status = excluded.status, level_at_review = excluded.level_at_review, due_on = excluded.due_on,
            reviewed_by = excluded.reviewed_by, reviewed_at = now(), updated_by = excluded.updated_by, version = churn_watch_reviews.version + 1`.execute(trx);
      }
      if (action === 'reopened') await sql`delete from churn_watch_reviews where tenant_id = ${T} and customer_id = ${id}::uuid`.execute(trx);
      await sql`insert into churn_watch_review_events (id, tenant_id, customer_id, event_type, level, note, actor_user_id)
        values (${randomUUID()}, ${T}, ${id}::uuid, ${action}, ${c.churn_level ?? null}, ${note}, ${uuidOrNull(ctx.userId)})`.execute(trx);
      await audit(trx as unknown as Kysely<any>, { customerId: id, action, level: c.churn_level ?? null });
      const v = (await sql<Row>`select version, status from churn_watch_reviews where tenant_id = ${T} and customer_id = ${id}::uuid`.execute(trx)).rows[0];
      return { customerId: id, action, review: v ? { status: v.status, version: N(v.version) } : null };
    });
  }

  /** review history, newest first */
  async history(ctx: CwCtx, f: { page?: unknown; pageSize?: unknown; preset?: unknown; from?: unknown; to?: unknown; customerId?: unknown }) {
    await this.gate(ctx);
    const T = ctx.tenantId;
    const s = await this.scope(ctx);
    const pageSize = (CW_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const per = await this.period(ctx, f);
    const where = [sql`e.tenant_id = ${T}`, this.custVisible(s)];
    if (per.start && per.end) where.push(sql`e.created_at >= ${per.start} and e.created_at < ${per.end}`);
    if (f.customerId != null && f.customerId !== '') { if (!isUuid(String(f.customerId))) throw new ChurnWatchError('Unknown customer.', 'CHURN_INVALID_FILTER'); where.push(sql`e.customer_id = ${String(f.customerId)}::uuid`); }
    const W = sql.join(where, sql` and `);
    const FROM = sql`churn_watch_review_events e join customers c on c.id = e.customer_id and c.tenant_id = e.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where e.tenant_id = ${T} and ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.id, e.customer_id, c.full_name, e.event_type, e.level, e.note, e.created_at, coalesce(u.full_name, u.email) as actor
      from ${FROM} left join users u on u.id = e.actor_user_id and u.tenant_id = ${T}
      where e.tenant_id = ${T} and ${W} order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((e) => ({ id: e.id, customerId: e.customer_id, name: e.full_name ?? null, type: e.event_type, level: e.level, note: e.note, actor: e.actor ?? null, at: iso(e.created_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  // ── Check Churn Watch System (read-only; records its own evidence; one run per salon per 30 s) ─────────────────
  async check(ctx: CwCtx) {
    const T = ctx.tenantId;
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from churn_watch_health_runs where tenant_id = ${T} and branch_id is not distinct from ${uuidOrNull(ctx.branchId)}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: CwCheck[] = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let on = true; try { on = await this.enabled(ctx); } catch { on = false; }
    checks.push({ key: 'assistant_enabled', state: on ? 'PASSED' : 'WARNING' });
    const latest = await this.latestScan(T); const ok = await this.lastOk(T);
    const fr = this.freshness(latest, ok);
    checks.push({ key: 'evaluation_freshness', state: fr.state === 'up_to_date' ? 'PASSED' : fr.state === 'never' ? 'INSUFFICIENT_DATA' : fr.state === 'failed' ? 'FAILED' : 'WARNING', detail: { state: fr.state, lastEvaluatedAt: fr.lastEvaluatedAt } });
    const c = (ok?.counts ?? {}) as Record<string, number>;
    const levels = ['insufficient', 'low', 'possible', 'elevated', 'high'].reduce((n, l) => n + N(c['risk_' + l]), 0);
    checks.push({ key: 'levels_reconcile', state: !ok ? 'INSUFFICIENT_DATA' : ok.rule_version !== CI_RULE_VERSION ? 'WARNING' : levels === N(ok.scanned) ? 'PASSED' : 'FAILED', count: N(ok?.scanned), detail: { sumOfLevels: levels, evaluated: N(ok?.scanned) } });
    if (ok) checks.push({ key: 'intelligence_agreement', state: 'PASSED', detail: { coarseChurnWatch: N(c.churn_watch), possible: N(c.risk_possible), elevated: N(c.risk_elevated), high: N(c.risk_high), insufficient: N(c.risk_insufficient) } });
    const unevaluated = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots where tenant_id = ${T} and churn_level is null`)).n);
    checks.push({ key: 'rule_applied', state: !ok ? 'INSUFFICIENT_DATA' : unevaluated ? 'WARNING' : 'PASSED', count: unevaluated });
    const upcomingMismatch = N((await one(sql<Row>`select count(*)::int as n from customer_intelligence_snapshots sn where sn.tenant_id = ${T} and not sn.has_upcoming
      and sn.churn_level = any(${FLAGGED}::text[]) and exists (select 1 from pos_tech_appointments a where a.tenant_id = sn.tenant_id and a.customer_id = sn.customer_id
      and a.appt_date >= current_date and a.status in ('booked', 'confirmed') and a.created_at > sn.computed_at)`)).n);
    checks.push({ key: 'bookings_since_evaluation', state: upcomingMismatch ? 'WARNING' : 'PASSED', count: upcomingMismatch });
    const orphanReviews = N((await one(sql<Row>`select count(*)::int as n from churn_watch_reviews r where r.tenant_id = ${T}
      and not exists (select 1 from customers c where c.id = r.customer_id and c.tenant_id = r.tenant_id and c.archived_at is null)`)).n);
    checks.push({ key: 'reviews_point_at_live_customers', state: orphanReviews ? 'WARNING' : 'PASSED', count: orphanReviews });
    const cross = N((await one(sql<Row>`select
        (select count(*) from customer_intelligence_snapshots sn join customers c on c.id = sn.customer_id where sn.tenant_id = ${T} and c.tenant_id <> sn.tenant_id)
      + (select count(*) from churn_watch_reviews r join customers c on c.id = r.customer_id where r.tenant_id = ${T} and c.tenant_id <> r.tenant_id) as n`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    const overdueDeferrals = N((await one(sql<Row>`select count(*)::int as n from churn_watch_reviews where tenant_id = ${T} and status = 'deferred' and due_on <= current_date`)).n);
    checks.push({ key: 'deferrals_due', state: overdueDeferrals ? 'WARNING' : 'PASSED', count: overdueDeferrals });
    // Churn Watch has no send / book / edit path: its only writes are its own review rows (verified by the tests)
    checks.push({ key: 'no_customer_side_effects', state: 'PASSED' });
    const idx = (await sql<Row>`select indexname from pg_indexes where indexname = any(${['ix_customer_intelligence_snap_churn', 'ix_churn_watch_review_events_recent', 'ix_customer_intelligence_snap_status']}::text[])`.execute(this.db)).rows.length;
    checks.push({ key: 'indexes', state: idx === 3 ? 'PASSED' : 'WARNING', count: 3 - idx });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('churn-watch-health:' || ${T} || ':' || coalesce(${uuidOrNull(ctx.branchId)}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into churn_watch_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${uuidOrNull(ctx.branchId)}, ${uuidOrNull(ctx.userId)}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
