// scheduling-center.ts — AI Scheduling Optimizer guide (Nov 2 2026): `/pos/ai-scheduling-optimizer/center/*`, the READ side of
// the optimizer page.
//
// Everything is read from the optimizer's existing tables (migrations 345 / 528: schedule_optimization_runs / _recommendations,
// schedule_recommendation_decisions, schedule_change_proposals / _applications, schedule_conflicts) and the booking calendar's
// own appointments (pos_tech_appointments). Nothing here generates, decides, sends, applies or moves an appointment — those stay
// on the engine routes (AiSchedulingService → BookingService). What this adds:
//   • the four photographed counters with one stated definition each, computed by the server for the session's scope (they
//     used to be three `limit=1` list calls in the browser, and "Open" counted only review_required); expired-but-not-yet-swept
//     suggestions are counted apart, never as open; the module's effective state is split into its parts (switch · emergency
//     stop · platform stop · subscription · scan worker) instead of one word;
//   • the recommendation queue the old list could not give: search (recommendation / appointment id, technician, service, and —
//     with customers.view — customer name or phone), status groups, WHICH date the filter means (created · appointment ·
//     decided · applied), presets and a From/To range in the salon's time zone, numbered pages (the old list stopped at 50);
//     each row says whether the appointment has changed since the suggestion was computed (stale = apply will refuse);
//   • History as an append-only event trail (generated · each staff decision · each customer decision · each apply attempt),
//     newest first — the old tab listed runs only;
//   • Check Scheduling System — read-only, evidence-backed; never generates, never applies.
// Branch scope is the engine's rule: a branch session sees its branch; a salon-wide session (no branch) sees the salon.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

type Row = Record<string, any>;
export interface ScCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export interface ScEffective { enabled: boolean; killed: boolean; platformKilled: boolean; automationAllowed: boolean }
export interface ScDeps {
  /** the engine's resolved settings for the session branch (platform → salon → location) */
  effective: (ctx: ScCtx) => Promise<ScEffective>;
  /** the AI entitlement gate's decision for the optimizer package */
  entitlement: (ctx: ScCtx) => Promise<{ allowed: boolean; reason: string; subscriptionStatus: string } | null>;
  /** whether the platform kill switch can be read right now */
  switchReadable: () => Promise<boolean>;
  /** may this person see customer names / phones (customers.view) */
  canSeeCustomers: (ctx: ScCtx) => boolean;
}
export class SchedulingCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export const SC_GROUPS = ['all', 'open', 'customer', 'accepted', 'applied', 'failed', 'closed', 'stale'] as const;
export const SC_DATE_FIELDS = ['created', 'appointment', 'decided', 'applied'] as const;
export const SC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'custom'] as const;
export const SC_PAGE_SIZES = [10, 25, 50, 100] as const;
export const SC_EVENT_KINDS = ['all', 'generated', 'staff', 'customer', 'apply'] as const;
/** waiting on a person at the salon (review, or accepted and not applied yet) */
export const OPEN_STATES = ['generated', 'review_required', 'review_in_progress', 'needs_revision', 'accepted', 'partially_accepted', 'customer_approved', 'application_pending'];
const GROUP_STATES: Record<string, string[]> = {
  open: OPEN_STATES,
  customer: ['customer_approval_required'],
  accepted: ['accepted', 'partially_accepted', 'customer_approved', 'application_pending'],
  applied: ['applied'],
  failed: ['application_failed'],
  closed: ['rejected', 'expired', 'superseded', 'rolled_back'],
};
const LIVE_STATES = [...OPEN_STATES, 'customer_approval_required'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
/** a jsonb column (the driver already parses it); anything else is not an object */
const obj = (v: unknown): Row | null => (v != null && typeof v === 'object' ? v as Row : null);

export class SchedulingCenter {
  constructor(private readonly db: Kysely<any>, private readonly deps: ScDeps, private readonly now: () => number = () => Date.now()) {}

  /** the branch predicate for `col` — returned wrapped (a bare RawBuilder must never be awaited) */
  private scope(ctx: ScCtx, col: ReturnType<typeof sql>): { w: ReturnType<typeof sql> } {
    return isUuid(ctx.branchId) ? { w: sql`${col} = ${ctx.branchId}::uuid` } : { w: sql`true` };
  }
  private tz(ctx: ScCtx): Promise<string> { return branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null); }
  private async period(ctx: ScCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await this.tz(ctx);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(SC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const d = (s: string, n: number) => addYmdDays(s, n);
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = d(today, -1); to = from; break;
      case 'last_7': from = d(today, -6); break;
      case 'week': from = d(today, -dow); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = d(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'last_30': from = d(today, -29); break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new SchedulingCenterError('Choose a From and a To date.', 'SC_INVALID_PERIOD');
        if (a > z) throw new SchedulingCenterError('The From date must be on or before the To date.', 'SC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    // inclusive salon-local days → [start, end) instants (DST-correct: Postgres resolves each midnight in the zone)
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  // ── the four counters (one definition each) + what stands behind "Module" ─────────────────────────────────────
  async summary(ctx: ScCtx) {
    const T = ctx.tenantId;
    const S = this.scope(ctx, sql`r.branch_id`).w;
    const c = (await sql<Row>`select
        count(*) filter (where r.status = any(${OPEN_STATES}::text[]) and (r.expires_at is null or r.expires_at > now()))::int as open,
        count(*) filter (where r.status = 'customer_approval_required' and (r.expires_at is null or r.expires_at > now())
          and exists (select 1 from schedule_change_proposals p where p.tenant_id = r.tenant_id and p.recommendation_id = r.id and p.status in ('proposed', 'customer_notified')
                        and (p.expires_at is null or p.expires_at > now())))::int as awaiting_customer,
        count(*) filter (where r.status = any(${LIVE_STATES}::text[]) and r.expires_at <= now())::int as past_expiry,
        count(*) filter (where r.status = 'application_failed')::int as apply_failed,
        count(*) filter (where r.status = 'applied' and r.applied_at >= now() - interval '30 days')::int as applied_30d
      from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}`.execute(this.db)).rows[0] ?? {};
    const RS = this.scope(ctx, sql`branch_id`).w;
    const lastOk = (await sql<Row>`select id, completed_at, run_date, run_trigger, gap_count, conflict_count, metrics from schedule_optimization_runs
      where tenant_id = ${T} and ${RS} and status = 'completed' order by completed_at desc nulls last, started_at desc limit 1`.execute(this.db)).rows[0];
    const lastAny = (await sql<Row>`select status, error_code, started_at from schedule_optimization_runs where tenant_id = ${T} and ${RS} order by started_at desc limit 1`.execute(this.db)).rows[0];
    const conflicts = N((await sql<Row>`select count(*)::int as n from schedule_conflicts where tenant_id = ${T} and ${RS} and resolved = false`.execute(this.db)).rows[0]?.n);
    const AS = this.scope(ctx, sql`branch_id`).w;
    const fresh = (await sql<Row>`select
        (select max(updated_at) from pos_tech_appointments where tenant_id = ${T} and ${AS}) as booking,
        (select max(updated_at) from technician_time_off where tenant_id = ${T}) as time_off,
        (select max(created_at) from technician_shifts where tenant_id = ${T}) as shifts`.execute(this.db)).rows[0] ?? {};
    let eff: ScEffective | null = null; let effErr = false;
    try { eff = await this.deps.effective(ctx); } catch { effErr = true; }
    let ent: Awaited<ReturnType<ScDeps['entitlement']>> = null; let entErr = false;
    try { ent = await this.deps.entitlement(ctx); } catch { entErr = true; }
    // automatic optimization — the EFFECTIVE mode (never a stored toggle on its own)
    const automation = effErr || !eff ? 'unknown' : eff.platformKilled ? 'platform_stopped' : eff.killed ? 'emergency_stopped' : !eff.enabled ? 'module_off' : eff.automationAllowed ? 'on' : 'off';
    const module = effErr || !eff ? 'unknown' : eff.platformKilled ? 'platform_stopped' : eff.killed ? 'emergency_stopped' : !eff.enabled ? 'disabled'
      : entErr || !ent ? 'subscription_unknown' : !ent.allowed ? 'subscription_restricted' : 'enabled';
    return {
      asOf: new Date(this.now()).toISOString(),
      counters: { openRecommendations: N(c.open), awaitingCustomer: N(c.awaiting_customer), automation, module },
      more: { pastExpiry: N(c.past_expiry), applyFailed: N(c.apply_failed), applied30d: N(c.applied_30d), openConflicts: conflicts, gaps: lastOk ? N(lastOk.gap_count) : null },
      moduleParts: {
        enabled: eff ? eff.enabled : null, emergencyStop: eff ? eff.killed : null, platformStop: eff ? eff.platformKilled : null,
        subscription: ent ? { allowed: ent.allowed, reason: ent.reason, status: ent.subscriptionStatus } : null,
        lastRun: lastAny ? { status: lastAny.status, errorCode: lastAny.error_code ?? null, at: iso(lastAny.started_at) } : null,
      },
      lastEvaluation: lastOk ? { runId: String(lastOk.id), at: iso(lastOk.completed_at), date: lastOk.run_date ? String(lastOk.run_date).slice(0, 10) : null, trigger: lastOk.run_trigger,
        utilizationPct: obj(lastOk.metrics)?.utilizationPct ?? null } : null,
      freshness: { booking: iso(fresh.booking), timeOff: iso(fresh.time_off), shifts: iso(fresh.shifts) },
      definitions: {
        openRecommendations: 'waiting_on_staff_not_expired', awaitingCustomer: 'proposal_sent_customer_not_answered_not_expired',
        automation: 'effective_mode', module: 'switch_stop_platform_subscription',
      },
    };
  }

  // ── the recommendation queue ──────────────────────────────────────────────────────────────────────────────────
  async recommendations(ctx: ScCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (SC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const group = pick(SC_GROUPS, f.group) ?? 'all';
    const dateField = pick(SC_DATE_FIELDS, f.dateField) ?? 'created';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    const customers = this.deps.canSeeCustomers(ctx);
    const where = [sql`r.tenant_id = ${T}`, this.scope(ctx, sql`r.branch_id`).w];
    // "stale" = still live but the appointment moved since the suggestion was computed (apply would refuse it)
    const staleExpr = sql`(a.id is null or a.version <> coalesce((r.current_state->>'version')::int, a.version) or a.status <> coalesce(r.current_state->>'status', a.status))`;
    if (group === 'stale') where.push(sql`r.status = any(${LIVE_STATES}::text[]) and ${staleExpr}`);
    else if (group === 'open') where.push(sql`r.status = any(${OPEN_STATES}::text[]) and (r.expires_at is null or r.expires_at > now())`);
    else if (group !== 'all') where.push(sql`r.status = any(${GROUP_STATES[group]}::text[])`);
    if (per.start && per.end) {
      if (dateField === 'appointment') where.push(sql`(r.current_state->>'date') >= ${per.from} and (r.current_state->>'date') <= ${per.to}`);
      else if (dateField === 'decided') where.push(sql`r.decided_at >= ${per.start} and r.decided_at < ${per.end}`);
      else if (dateField === 'applied') where.push(sql`r.applied_at >= ${per.start} and r.applied_at < ${per.end}`);
      else where.push(sql`r.created_at >= ${per.start} and r.created_at < ${per.end}`);
    }
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const digits = q.replace(/\D/g, '');
      const idq = q.toLowerCase();
      where.push(sql`(r.id::text = ${idq} or r.id::text like ${idq.replace(/[^0-9a-f-]/g, '') ? idq.replace(/[^0-9a-f-]/g, '') + '%' : '\u0000'}
        or r.affected_appointment_ids @> ${JSON.stringify([q])}::jsonb
        or t.full_name ilike ${like} or pt.full_name ilike ${like} or a.services::text ilike ${like}
        ${customers ? sql`or a.customer_name ilike ${like} or ${digits.length >= 4 ? sql`regexp_replace(coalesce(a.customer_phone, ''), '[^0-9]', '', 'g') like ${'%' + digits + '%'}` : sql`false`}` : sql``})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`schedule_optimization_recommendations r
      left join pos_tech_appointments a on a.tenant_id = r.tenant_id and a.id::text = r.current_state->>'appointmentId'
      left join technicians t on t.tenant_id = r.tenant_id and t.id::text = r.current_state->>'technicianId'
      left join technicians pt on pt.tenant_id = r.tenant_id and pt.id::text = r.proposed_state->>'technicianId'
      left join branches b on b.tenant_id = r.tenant_id and b.id = r.branch_id`;
    // newest event first with a stable tie; the date the filter means is the date the list sorts by
    const order = dateField === 'appointment' ? sql`r.current_state->>'date' desc nulls last, r.current_state->>'startTime' desc nulls last, r.id desc`
      : dateField === 'decided' ? sql`r.decided_at desc nulls last, r.id desc` : dateField === 'applied' ? sql`r.applied_at desc nulls last, r.id desc` : sql`r.created_at desc, r.id desc`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select r.id, r.type, r.status, r.current_state, r.proposed_state, r.confidence, r.requires_customer_approval, r.touches_confirmed_appointment,
        r.version, r.expires_at, r.created_at, r.decided_at, r.applied_at, r.automated, r.rule_version, r.engine_version, r.run_id,
        a.id as appt_id, a.version as appt_version, a.status as appt_status, a.customer_name, a.customer_phone, a.services, t.full_name as tech, pt.full_name as proposed_tech, b.name as branch,
        ${staleExpr} as stale
      from ${FROM} where ${W} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const nowMs = this.now();
    // extras (AI Scheduling Optimizer 13 · 11) — "What changed?": for a LIVE suggestion, the appointment's own recorded
    // changes (append-only appointment_change_log) made AFTER the suggestion was computed, newest first, ≤ 5 each. Read
    // only; values that are record ids stay out of the response. Shift / queue events are not in this log and are not shown.
    const liveIds = rows.filter((r) => LIVE_STATES.includes(String(r.status)) && r.appt_id).map((r) => ({ rec: String(r.id), appt: String(r.appt_id), since: r.created_at }));
    const changedBy = new Map<string, { changeType: string; field: string | null; oldValue: string | null; newValue: string | null; at: string | null; actorType: string | null }[]>();
    if (liveIds.length) {
      const chg = (await sql<{ rec_id: string; change_type: string; field: string | null; old_value: string | null; new_value: string | null; actor_type: string | null; created_at: unknown; rn: number }>`
        select x.rec_id, x.change_type, x.field, x.old_value, x.new_value, x.actor_type, x.created_at, x.rn from (
          select w.rec as rec_id, l.change_type, l.field, l.old_value, l.new_value, l.actor_type, l.created_at,
            row_number() over (partition by w.rec order by l.created_at desc, l.id desc) as rn
          from jsonb_to_recordset(${JSON.stringify(liveIds)}::jsonb) as w(rec text, appt text, since timestamptz)
          join appointment_change_log l on l.tenant_id = ${T} and l.appointment_id::text = w.appt and l.created_at > w.since
        ) x where x.rn <= 5 order by x.created_at desc`.execute(this.db)).rows;
      const idLike = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
      for (const c of chg) {
        const k = String(c.rec_id); if (!changedBy.has(k)) changedBy.set(k, []);
        const safe = (v: string | null) => (v != null && idLike.test(v) ? '(record)' : v);
        changedBy.get(k)!.push({ changeType: String(c.change_type), field: c.field ?? null, oldValue: safe(c.old_value ?? null), newValue: safe(c.new_value ?? null), at: iso(c.created_at), actorType: c.actor_type ?? null });
      }
    }
    return {
      items: rows.map((r) => {
        const cur = obj(r.current_state); const prop = obj(r.proposed_state);
        const live = LIVE_STATES.includes(String(r.status));
        const services = Array.isArray(obj(r.services)) ? (obj(r.services) as unknown as Row[]).map((s) => String(s?.name ?? s?.serviceName ?? '')).filter(Boolean) : [];
        return {
          id: String(r.id), type: r.type, status: r.status, branch: r.branch ?? null, runId: r.run_id ? String(r.run_id) : null,
          appointmentId: cur?.appointmentId ?? null, customer: customers ? (r.customer_name ?? null) : null, customerPhoneLast4: customers && r.customer_phone ? String(r.customer_phone).replace(/\D/g, '').slice(-4) : null,
          services,
          before: cur ? { date: cur.date ?? null, start: cur.startTime ?? null, end: cur.endTime ?? null, technicianId: cur.technicianId ?? null, technician: r.tech ?? null } : null,
          after: prop ? { date: prop.date ?? null, start: prop.startTime ?? null, end: prop.endTime ?? null, technicianId: prop.technicianId ?? null, technician: r.proposed_tech ?? null } : null,
          confidence: r.confidence == null ? null : Number(r.confidence),
          needsCustomer: !!r.requires_customer_approval, touchesConfirmed: !!r.touches_confirmed_appointment, automated: !!r.automated,
          version: N(r.version), ruleVersion: r.rule_version ?? null, engineVersion: r.engine_version ?? null,
          createdAt: iso(r.created_at), decidedAt: iso(r.decided_at), appliedAt: iso(r.applied_at), expiresAt: iso(r.expires_at),
          // live rows only: a closed row's appointment is expected to have moved
          stale: live && !!r.stale, appointmentMissing: live && !r.appt_id,
          pastExpiry: live && !!r.expires_at && new Date(r.expires_at).getTime() <= nowMs,
          changedSince: live ? (changedBy.get(String(r.id)) ?? []) : null,
        };
      }),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, group, dateField, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
      customersVisible: customers,
    };
  }

  // ── History: the append-only event trail (newest first) ───────────────────────────────────────────────────────
  async history(ctx: ScCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (SC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const kind = pick(SC_EVENT_KINDS, f.kind) ?? 'all';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80).toLowerCase();
    const S = this.scope(ctx, sql`r.branch_id`).w;
    // two existing append-only sources, one shape: generated (the row itself) · every decision edge (staff · customer · apply)
    const EVENTS = sql`(
        select 'generated' as kind, r.id as rec_id, r.created_at as at, 'generated' as action, null::text as outcome, null::uuid as actor_id,
               case when r.automated then 'automation' else null end as actor_ref, null::text as reason, r.rule_version as ref
          from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}
        union all
        -- every decision edge is already one append-only row (customer answers and apply attempts included)
        select case when left(d.action, 9) = 'customer_' then 'customer'
                    when d.action in ('queue_application', 'apply_ok', 'apply_fail', 'retry', 'rollback') then 'apply' else 'staff' end,
               d.recommendation_id, d.created_at, d.action, d.after_snapshot->>'status', d.actor_user_id,
               case when d.actor_user_id is null and r.automated then 'automation' else null end, d.reason, null
          from schedule_recommendation_decisions d join schedule_optimization_recommendations r on r.id = d.recommendation_id and r.tenant_id = d.tenant_id
         where d.tenant_id = ${T} and ${S}
      ) e`;
    const where = [sql`true`];
    if (kind !== 'all') where.push(sql`e.kind = ${kind}`);
    if (per.start && per.end) where.push(sql`e.at >= ${per.start} and e.at < ${per.end}`);
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      where.push(sql`(e.rec_id::text like ${q.replace(/[^0-9a-f-]/g, '') ? q.replace(/[^0-9a-f-]/g, '') + '%' : '\u0000'} or lower(e.action) like ${like} or lower(coalesce(e.outcome, '')) like ${like}
        or lower(coalesce(u.full_name, u.email, '')) like ${like} or lower(coalesce(e.reason, '')) like ${like})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`${EVENTS} left join users u on u.id = e.actor_id and u.tenant_id = ${T}`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.kind, e.rec_id, e.at, e.action, e.outcome, e.actor_ref, e.reason, e.ref, coalesce(u.full_name, u.email) as actor
      from ${FROM} where ${W} order by e.at desc nulls last, e.rec_id desc, e.action desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => ({ kind: r.kind, recommendationId: String(r.rec_id), at: iso(r.at), action: r.action, outcome: r.outcome ?? null,
        actor: r.actor ?? r.actor_ref ?? (r.kind === 'customer' ? 'customer' : null), reason: r.reason ?? null, ref: r.ref ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, kind, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
    };
  }

  // ── Check Scheduling System (read-only; one run per salon per 30 s) ──────────────────────────────────────────
  async check(ctx: ScCtx) {
    const T = ctx.tenantId; const HB = isUuid(ctx.branchId) ? ctx.branchId : null;   // runs are per branch (Nov 3 audit)
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from scheduling_optimizer_health_runs where tenant_id = ${T}
      and branch_id is not distinct from ${HB} and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const S = this.scope(ctx, sql`r.branch_id`).w;
    const BS = this.scope(ctx, sql`branch_id`).w;
    // subscription / AI gateway authorization
    let ent: Awaited<ReturnType<ScDeps['entitlement']>> = null; let entErr = false;
    try { ent = await this.deps.entitlement(ctx); } catch { entErr = true; }
    checks.push({ key: 'subscription', state: entErr || !ent ? 'UNAVAILABLE' : ent.allowed ? 'PASSED' : 'FAILED', detail: { reason: ent?.reason ?? (entErr ? 'unreadable' : 'unknown'), status: ent?.subscriptionStatus ?? null } });
    // the switches: module on, no emergency stop, platform stop readable
    let eff: ScEffective | null = null;
    try { eff = await this.deps.effective(ctx); } catch { eff = null; }
    checks.push({ key: 'module_switch', state: !eff ? 'UNAVAILABLE' : eff.platformKilled || eff.killed ? 'WARNING' : eff.enabled ? 'PASSED' : 'WARNING',
      detail: eff ? { enabled: eff.enabled, emergencyStop: eff.killed, platformStop: eff.platformKilled, automation: eff.automationAllowed } : { reason: 'unreadable' } });
    let readable = false; try { readable = await this.deps.switchReadable(); } catch { readable = false; }
    checks.push({ key: 'platform_switch_readable', state: readable ? 'PASSED' : 'FAILED' });
    // booking source: appointments the optimizer reads
    // the SALON's today (Nov 3 audit: current_date is the database's day) and the branch scope on every read
    const salonToday = sql`(now() at time zone ${await this.tz(ctx)})::date`;
    const appts = N((await one(sql<Row>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and ${BS} and appt_date >= ${salonToday} - 30`)).n);
    checks.push({ key: 'booking_source', state: appts ? 'PASSED' : 'INSUFFICIENT_DATA', count: appts });
    // shifts and time off: a time-off row whose end precedes its start would open a false slot
    const badOff = N((await one(sql<Row>`select count(*)::int as n from technician_time_off where tenant_id = ${T} and ${BS} and status = 'approved' and ends_at <= starts_at`)).n);
    checks.push({ key: 'time_off_valid', state: badOff ? 'FAILED' : 'PASSED', count: badOff });
    const shifts = N((await one(sql<Row>`select count(*)::int as n from technician_shifts where tenant_id = ${T} and ${BS} and shift_date >= ${salonToday} - 7 and status <> 'cancelled'`)).n);
    checks.push({ key: 'shift_data', state: shifts ? 'PASSED' : 'INSUFFICIENT_DATA', count: shifts, detail: { fallback: shifts ? null : 'weekly_schedule_or_store_hours' } });
    // the scan worker: a completed run in the last 36 h, failures in 7 days, jobs that failed or are lagging
    const runs = await one(sql<Row>`select max(completed_at) filter (where status = 'completed') as last_ok,
        count(*) filter (where status = 'failed' and started_at > now() - interval '7 days')::int as failed,
        count(*) filter (where status = 'completed' and started_at > now() - interval '7 days')::int as ok,
        count(*) filter (where status = 'started' and started_at < now() - interval '30 minutes')::int as stuck
      from schedule_optimization_runs where tenant_id = ${T} and ${BS}`);
    const lastOk = runs.last_ok ? new Date(runs.last_ok).getTime() : null;
    checks.push({ key: 'scan_worker', state: !lastOk && !N(runs.failed) ? 'INSUFFICIENT_DATA' : N(runs.failed) > N(runs.ok) ? 'FAILED' : !lastOk || this.now() - lastOk > 36 * 3_600_000 || N(runs.failed) || N(runs.stuck) ? 'WARNING' : 'PASSED',
      count: N(runs.failed), detail: { lastSuccess: iso(runs.last_ok), succeeded7d: N(runs.ok), stuck: N(runs.stuck) } });
    const jobs = await one(sql<Row>`select count(*) filter (where status = 'dead' and created_at > now() - interval '7 days')::int as failed,
        count(*) filter (where status = 'queued' and run_after < now() - interval '15 minutes')::int as lagging
      from jobs where tenant_id = ${T} and job_type like 'ai.scheduling.%'`);
    checks.push({ key: 'job_queue', state: N(jobs.failed) ? 'WARNING' : N(jobs.lagging) ? 'WARNING' : 'PASSED', count: N(jobs.failed), detail: { lagging: N(jobs.lagging) } });
    // the expiry sweep: a live suggestion more than 15 minutes past its expiry means the sweep is not running
    const pastExpiry = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}
      and r.status = any(${LIVE_STATES}::text[]) and r.expires_at < now() - interval '15 minutes'`)).n);
    checks.push({ key: 'expiry_sweep', state: pastExpiry ? 'WARNING' : 'PASSED', count: pastExpiry });
    // the core rules: nothing applied without a staff decision; a customer-approval change only after the customer said yes
    const noStaff = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}
      and r.status in ('applied', 'rolled_back') and r.automated = false and r.decided_by_user_id is null
      and not exists (select 1 from schedule_recommendation_decisions d where d.tenant_id = r.tenant_id and d.recommendation_id = r.id and d.action in ('accept', 'partial_accept'))`)).n);
    checks.push({ key: 'apply_needs_staff_decision', state: noStaff ? 'FAILED' : 'PASSED', count: noStaff });
    const noCustomer = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}
      and r.status in ('applied', 'rolled_back') and r.requires_customer_approval = true
      and not exists (select 1 from schedule_change_proposals p where p.tenant_id = r.tenant_id and p.recommendation_id = r.id and p.status in ('customer_approved', 'applied'))`)).n);
    checks.push({ key: 'apply_needs_customer_approval', state: noCustomer ? 'FAILED' : 'PASSED', count: noCustomer });
    const autoConfirmed = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S}
      and r.automated = true and r.status in ('applied', 'rolled_back') and r.touches_confirmed_appointment = true`)).n);
    checks.push({ key: 'no_silent_confirmed_change', state: autoConfirmed ? 'FAILED' : 'PASSED', count: autoConfirmed });
    const doubleApply = N((await one(sql<Row>`select count(*)::int as n from (select x.recommendation_id from schedule_change_applications x where x.tenant_id = ${T} and x.status = 'applied' and x.rolled_back_at is null
      group by x.recommendation_id having count(*) > 1) z`)).n);
    checks.push({ key: 'no_double_apply', state: doubleApply ? 'FAILED' : 'PASSED', count: doubleApply });
    const appliedNoRecord = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S} and r.status = 'applied'
      and not exists (select 1 from schedule_change_applications x where x.tenant_id = r.tenant_id and x.recommendation_id = r.id and x.status = 'applied')`)).n);
    checks.push({ key: 'applied_has_booking_record', state: appliedNoRecord ? 'WARNING' : 'PASSED', count: appliedNoRecord });
    const conflicts = N((await one(sql<Row>`select count(*)::int as n from schedule_conflicts where tenant_id = ${T} and ${BS} and resolved = false`)).n);
    checks.push({ key: 'open_conflicts', state: conflicts ? 'WARNING' : 'PASSED', count: conflicts });
    const failed = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r where r.tenant_id = ${T} and ${S} and r.status = 'application_failed'`)).n);
    checks.push({ key: 'apply_failures', state: failed ? 'WARNING' : 'PASSED', count: failed });
    // tenant isolation: a suggestion pointing at another salon's appointment or technician
    const cross = N((await one(sql<Row>`select count(*)::int as n from schedule_optimization_recommendations r
      left join pos_tech_appointments a on a.id::text = r.current_state->>'appointmentId'
      left join technicians t on t.id::text = r.proposed_state->>'technicianId'
      where r.tenant_id = ${T} and ((a.id is not null and a.tenant_id <> r.tenant_id) or (t.id is not null and t.tenant_id <> r.tenant_id))`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('scheduling-optimizer-health:' || ${T} || ':' || coalesce(${HB}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into scheduling_optimizer_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
