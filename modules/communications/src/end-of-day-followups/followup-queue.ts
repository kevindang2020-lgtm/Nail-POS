/**
 * followup-queue.ts — Follow-Up Queue Complete Build Guide (Oct 30 2026): the operational queue at /follow-ups.
 *
 * NOT a second queue, scheduler or send path. It reads the same service_follow_up_tasks the End-of-Day center
 * (eod-center.ts) and the 8 PM job write, and every write still goes through DailyFollowUpService / claimAndSendTask.
 * What this file adds is read-side:
 *
 *   kpis              the five screen counters with ONE written basis each (guide §05) — all on the selected salon-local
 *                     DUE date (the task's business_date), so the tooltip and the report agree.
 *   list              server search / filters / basis (created · due · sent · last visit · rebooked) / numbered pages;
 *                     the operational view orders due ASC → priority DESC → completed ASC → id (guide §06 fairness),
 *                     history orders created DESC → id DESC.
 *   priority          Smart Follow-Up Priority (guide §10): High / Normal / Low from recorded facts only, every reason
 *                     with its source and timestamp. It is a tie-breaker INSIDE a due date — it never moves a newer task
 *                     above an older overdue one and never sends anything.
 *   contactCheck      Duplicate Message Protection (guide §11): one category per task (Eligible · Recently Contacted ·
 *                     Already Sent · Opted Out · Missing Contact · Blocked · Needs Approval) with the last equivalent
 *                     contact; contacts through OTHER channels (staff SMS, campaigns) are shown, not enforced (see docs).
 *   missedCalls       the Missed Call type (guide §07/§13): inbound missed calls from call_intelligence_events — a
 *                     separate source with its own state (Recovered · Replied · Awaiting callback), never merged into
 *                     after-service counts.
 *   results           outcomes (guide §14): funnel, skip reasons, by technician, queue age, associated revenue — observed
 *                     association inside a fixed window, never causation.
 *   customerHistory   a customer's follow-ups newest first (guide §13).
 */
import { sql, type Kysely } from 'kysely';
import { sourceCancelledSql } from './eod-center';

export const FUQ_PRIORITY_VERSION = 'fuq-priority-v1';
export const FUQ_KPI_BASIS = 'due_date';                  // every counter is on the task's salon-local due (business) date
export const REBOOK_WINDOW_DAYS = 30;                     // a booking / return visit counts when made within 30 days of the send
export const QUEUE_BASES = ['created', 'due', 'sent', 'last_visit', 'rebooked'] as const;
export const QUEUE_VIEWS = ['queue', 'history'] as const;
export const QUEUE_STATUS = ['all', 'unsent', 'pending', 'pending_manager_approval', 'rejected', 'sent', 'skipped', 'closed', 'expired', 'customer_not_available', 'rebooked', 'retryable'] as const;
export const QUEUE_PRIORITY = ['high', 'normal', 'low'] as const;
export const QUEUE_DUE = ['overdue', 'due_today', 'upcoming'] as const;
export const SKIP_REASONS = ['customer_declined', 'contacted_another_way', 'already_booked', 'no_follow_up_needed', 'wrong_customer', 'other'] as const;
export const CONTACT_CATEGORIES = ['eligible', 'recently_contacted', 'already_sent', 'opted_out', 'missing_contact', 'blocked', 'needs_approval', 'source_cancelled'] as const;
export type ContactCategory = typeof CONTACT_CATEGORIES[number];

const UNSENT = ['pending', 'pending_manager_approval', 'rejected'];
const SENT = ['sent', 'customer_replied', 'rebooked'];
const SKIPPED = ['skipped', 'dismissed', 'customer_not_available'];
const UPCOMING = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting'];
const PAGE_SIZES = [10, 20, 50];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const n = (v: unknown) => Number(v ?? 0) || 0;
const last4 = (p: unknown) => (p ? String(p).replace(/\D/g, '').slice(-4) || null : null);
const pageOf = (page?: number, size?: number, dflt = 20) => {
  const ps = PAGE_SIZES.includes(Number(size)) ? Number(size) : dflt;
  return { ps, pg: Math.max(1, Math.floor(Number(page)) || 1) };
};

export interface QueueQuery {
  view?: string; q?: string; status?: string; technicianId?: string; priority?: string; due?: string;
  basis?: string; from?: string; to?: string; page?: number; pageSize?: number;
}

/** reason codes are stable (the POS translates them); `at` is the source timestamp shown beside the reason */
export interface PriorityReason { code: 'overdue' | 'open_concern' | 'already_booked' | 'recently_contacted' | 'several_unanswered'; at: string | null; detail: string | null }
export function priorityOf(score: number): 'high' | 'normal' | 'low' { return score >= 2 ? 'high' : score <= -1 ? 'low' : 'normal'; }

export class FollowUpQueue {
  constructor(private readonly db: Kysely<any>) {}

  /** the per-task facts the priority and the contact check are built from — one place, so the two cannot disagree */
  private factsSql(T: string, today: string, cooldownHours: number) {
    return sql`
      left join lateral (select max(r.created_at) as at, max(r.rating) filter (where r.rating is not null) as rating from reviews r
          where r.tenant_id = ${T}::uuid and r.customer_id = f.customer_id and coalesce(r.is_spam, false) = false
            and r.created_at > now() - interval '60 days' and coalesce(r.resolution_status, '') not in ('resolved', 'closed')
            and (r.rating <= 3 or r.escalation_status in ('open', 'escalated'))) cn on true
      left join lateral (select min(ap.appt_date)::text as d from pos_tech_appointments ap where ap.tenant_id = ${T}::uuid and ap.customer_id = f.customer_id
            and ap.appt_date >= ${today}::date and ap.status = any(${UPCOMING}::text[])) bk on true
      left join lateral (select max(f2.sent_at) as at from service_follow_up_tasks f2 where f2.tenant_id = ${T}::uuid and f2.customer_id = f.customer_id
            and f2.id <> f.id and f2.sent_at is not null and f2.sent_at > now() - make_interval(hours => ${Math.max(0, cooldownHours)}::int)) rc on true
      left join lateral (select count(*)::int as n from service_follow_up_tasks f3 where f3.tenant_id = ${T}::uuid and f3.customer_id = f.customer_id
            and f3.id <> f.id and f3.sent_at is not null and f3.sent_at < coalesce(f.created_at, now())
            and not exists (select 1 from pos_tech_appointments a3 where a3.tenant_id = ${T}::uuid and a3.customer_id = f3.customer_id
                and a3.created_at > f3.sent_at and a3.created_at <= f3.sent_at + interval '30 days' and a3.status not in ('cancelled', 'no_show'))) un on true`;
  }
  private scoreSql(today: string) {
    return sql`(case when f.status = any(${UNSENT}::text[]) and f.business_date < ${today}::date then 2 else 0 end
      + case when cn.at is not null then 2 else 0 end
      - case when bk.d is not null then 2 else 0 end
      - case when rc.at is not null then 1 else 0 end
      - case when un.n >= 2 then 1 else 0 end)`;
  }
  private reasonsOf(r: any, today: string): PriorityReason[] {
    const out: PriorityReason[] = [];
    if (UNSENT.includes(r.status) && r.business_date < today) out.push({ code: 'overdue', at: iso(r.created_at), detail: r.business_date });
    if (r.cn_at) out.push({ code: 'open_concern', at: iso(r.cn_at), detail: r.cn_rating != null ? String(r.cn_rating) : null });
    if (r.bk_d) out.push({ code: 'already_booked', at: null, detail: r.bk_d });
    if (r.rc_at) out.push({ code: 'recently_contacted', at: iso(r.rc_at), detail: null });
    if (n(r.un_n) >= 2) out.push({ code: 'several_unanswered', at: null, detail: String(r.un_n) });
    return out;
  }

  /** the five counters (guide §05) on ONE basis: the task's salon-local due date = `date` */
  async kpis(T: string, B: string, tz: string, date: string, now: Date) {
    const d = YMD.test(date) ? date : null;
    if (!d) return null;
    const k = (await sql<any>`
      select count(*) filter (where f.status = any(${UNSENT}::text[]))::int as pending,
             count(*) filter (where f.status = any(${UNSENT}::text[]) and f.status = 'pending_manager_approval')::int as awaiting,
             count(*) filter (where f.status = any(${SENT}::text[]))::int as sent,
             count(*) filter (where f.status = any(${SKIPPED}::text[]))::int as skipped,
             count(*) filter (where f.status = 'expired')::int as expired,
             count(*) filter (where f.sent_at is not null and exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id
                 and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show')))::int as rebooked,
             count(*)::int as total
        from service_follow_up_tasks f
       where f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null and f.business_date = ${d}::date`.execute(this.db)).rows[0];
    const overdue = n((await sql<any>`select count(*)::int as n from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid
        and f.deleted_at is null and f.status = any(${UNSENT}::text[]) and f.business_date < ${d}::date`.execute(this.db)).rows[0].n);
    const run = (await sql<any>`select run_status, trigger_source, finished_at, candidates_count, created_count, excluded_count, exclusions_json, rule_version
        from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid and business_date = ${d}::date order by updated_at desc limit 1`.execute(this.db)).rows[0] ?? null;
    const missed = n((await sql<any>`select count(*)::int as n from call_intelligence_events ce where ce.tenant_id = ${T}::uuid and (ce.branch_id = ${B}::uuid or ce.branch_id is null)
        and ce.direction <> 'outbound' and ce.status = 'missed'
        and coalesce(ce.started_at, ce.created_at) >= (${d}::date::timestamp at time zone ${tz}) and coalesce(ce.started_at, ce.created_at) < ((${d}::date + 1)::timestamp at time zone ${tz})`.execute(this.db)).rows[0].n);
    return {
      date: d, timezone: tz, basis: FUQ_KPI_BASIS,
      pending: k.pending, awaitingApproval: k.awaiting, sent: k.sent, skipped: k.skipped, expired: k.expired, rebooked: k.rebooked, total: k.total,
      overdueEarlier: overdue, missedCalls: missed,
      generation: run ? {
        status: run.run_status, trigger: run.trigger_source, finishedAt: iso(run.finished_at), eligible: n(run.candidates_count), created: n(run.created_count),
        excluded: n(run.excluded_count), exclusions: typeof run.exclusions_json === 'string' ? JSON.parse(run.exclusions_json) : (run.exclusions_json ?? {}), ruleVersion: run.rule_version,
      } : null,
      updatedAt: now.toISOString(),
    };
  }

  /** the queue / history list (guide §06): server search, filters, basis, numbered pages, stable order */
  async list(T: string, B: string, tz: string, today: string, cooldownHours: number, f: QueueQuery) {
    const { ps, pg } = pageOf(f.page, f.pageSize);
    const view = f.view === 'history' ? 'history' : 'queue';
    const conds = [sql`f.tenant_id = ${T}::uuid`, sql`f.branch_id = ${B}::uuid`, sql`f.deleted_at is null`];
    const q = (f.q ?? '').trim().slice(0, 120);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const parts = [sql`f.customer_name_snapshot ilike ${like}`, sql`f.technician_name_snapshot ilike ${like}`, sql`f.service_name_snapshot ilike ${like}`, sql`coalesce(t.ticket_number::text, '') ilike ${like}`];
      if (digits.length >= 3) parts.push(sql`regexp_replace(coalesce(f.customer_phone_snapshot, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      if (UUID.test(q)) parts.push(sql`(f.id = ${q}::uuid or f.ticket_id = ${q}::uuid or f.appointment_id = ${q}::uuid or f.customer_id = ${q}::uuid or f.technician_id = ${q}::uuid)`);
      conds.push(sql`(${sql.join(parts, sql` or `)})`);
    }
    const st = (QUEUE_STATUS as readonly string[]).includes(f.status ?? '') ? f.status! : (view === 'queue' ? 'unsent' : 'all');
    if (st === 'unsent') conds.push(sql`f.status = any(${UNSENT}::text[])`);
    else if (st === 'sent') conds.push(sql`f.status = any(${SENT}::text[])`);
    else if (st === 'skipped') conds.push(sql`f.status = any(${SKIPPED}::text[])`);
    else if (st === 'closed') conds.push(sql`f.status = any(${['skipped', 'dismissed', 'expired', 'customer_not_available', 'failed']}::text[])`);
    else if (st === 'rebooked') conds.push(sql`f.sent_at is not null and exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id
        and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show'))`);
    // FOLLOW-UP QUEUE 12 (round 10) — the Safe Retry Console: ONLY the failed attempts the send path would accept again — a
    // "customer not available" task whose customer now has the app, whose visit still stands, who is not archived and has not
    // texted STOP; the original attempt stays as it is (Retry is the same claimAndSendTask, one task, one message)
    else if (st === 'retryable') conds.push(sql`f.status = 'customer_not_available' and f.customer_app_user_id is not null and not (${sourceCancelledSql('f')})
        and exists (select 1 from customers rc where rc.tenant_id = f.tenant_id and rc.id = f.customer_id and coalesce(rc.status, 'active') <> 'archived'
          and not exists (select 1 from notification_opt_outs ro where ro.tenant_id = f.tenant_id and ro.channel = 'sms' and coalesce(rc.normalized_phone, '') <> '' and ro.address = rc.normalized_phone))`);
    else if (st !== 'all') conds.push(sql`f.status = ${st}`);
    if (f.technicianId && UUID.test(f.technicianId)) conds.push(sql`f.technician_id = ${f.technicianId}::uuid`);
    if (f.due === 'overdue') conds.push(sql`f.status = any(${UNSENT}::text[]) and f.business_date < ${today}::date`);
    else if (f.due === 'due_today') conds.push(sql`f.business_date = ${today}::date`);
    else if (f.due === 'upcoming') conds.push(sql`f.business_date > ${today}::date`);
    const basis = (QUEUE_BASES as readonly string[]).includes(f.basis ?? '') ? f.basis! : (view === 'queue' ? 'due' : 'created');
    if (f.from && f.to && YMD.test(f.from) && YMD.test(f.to)) {
      const lo = sql`(${f.from}::date::timestamp at time zone ${tz})`, hi = sql`((${f.to}::date + 1)::timestamp at time zone ${tz})`;
      if (basis === 'due') conds.push(sql`f.business_date between ${f.from}::date and ${f.to}::date`);
      else if (basis === 'rebooked') conds.push(sql`f.sent_at is not null and exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id
          and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show') and ap.created_at >= ${lo} and ap.created_at < ${hi})`);
      else {
        const col = basis === 'sent' ? sql`f.sent_at` : basis === 'last_visit' ? sql`f.completed_at` : sql`f.created_at`;
        conds.push(sql`${col} >= ${lo} and ${col} < ${hi}`);
      }
    }
    const facts = this.factsSql(T, today, cooldownHours);
    const score = this.scoreSql(today);
    if ((QUEUE_PRIORITY as readonly string[]).includes(f.priority ?? '')) {
      conds.push(f.priority === 'high' ? sql`${score} >= 2` : f.priority === 'low' ? sql`${score} <= -1` : sql`${score} between 0 and 1`);
    }
    const where = sql.join(conds, sql` and `);
    const from = sql`service_follow_up_tasks f left join tickets t on t.id = f.ticket_id and t.tenant_id = f.tenant_id ${facts}`;
    const total = n((await sql<any>`select count(*)::int as n from ${from} where ${where}`.execute(this.db)).rows[0].n);
    const order = view === 'queue'
      ? sql`f.business_date asc, ${score} desc, f.completed_at asc nulls last, f.id asc`
      : sql`f.created_at desc, f.id desc`;
    const rows = (await sql<any>`select f.id, f.business_date::text as business_date, f.status, f.customer_id, f.customer_name_snapshot, f.customer_phone_snapshot,
          f.customer_app_user_id, f.service_name_snapshot, f.technician_id, f.technician_name_snapshot, f.completed_at, f.created_at, f.sent_at, f.skip_reason,
          f.ticket_id, f.appointment_id, t.ticket_number, cn.at as cn_at, cn.rating as cn_rating, bk.d as bk_d, rc.at as rc_at, un.n as un_n, ${score} as score
        from ${from} where ${where} order by ${order} limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({
        id: r.id, type: 'after_service', dueDate: r.business_date, overdue: UNSENT.includes(r.status) && r.business_date < today, status: r.status,
        customerId: r.customer_id, customerName: r.customer_name_snapshot, customerPhoneLast4: last4(r.customer_phone_snapshot), customerHasApp: !!r.customer_app_user_id,
        serviceName: r.service_name_snapshot, technicianId: r.technician_id, technicianName: r.technician_name_snapshot, completedAt: iso(r.completed_at),
        createdAt: iso(r.created_at), sentAt: iso(r.sent_at), reason: r.skip_reason ?? null, ticketId: r.ticket_id, ticketNumber: r.ticket_number ?? null,
        appointmentId: r.appointment_id ?? null, priority: priorityOf(n(r.score)), priorityReasons: this.reasonsOf(r, today),
      })),
      total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)), view, basis, status: st, priorityVersion: FUQ_PRIORITY_VERSION,
    };
  }

  /** Duplicate Message Protection (guide §11) for one task — read-only; the send path re-checks inside its transaction */
  async contactCheck(T: string, B: string, today: string, id: string, cooldownHours: number, requireApproval: boolean) {
    if (!UUID.test(id)) return null;
    const r = (await sql<any>`select f.id, f.status, f.customer_id, f.customer_app_user_id, f.business_date::text as business_date, f.created_at, f.approved_by_user_id,
          c.status as customer_status, c.normalized_phone, c.email, c.marketing_sms_opt_in, c.marketing_email_opt_in,
          cn.at as cn_at, cn.rating as cn_rating, bk.d as bk_d, rc.at as rc_at, un.n as un_n, ${sourceCancelledSql('f')} as source_cancelled
        from service_follow_up_tasks f left join customers c on c.id = f.customer_id and c.tenant_id = f.tenant_id ${this.factsSql(T, today, cooldownHours)}
       where f.id = ${id}::uuid and f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null`.execute(this.db)).rows[0];
    if (!r) return null;
    const lastFollowUp = (await sql<any>`select f2.id, f2.sent_at, f2.technician_name_snapshot from service_follow_up_tasks f2 where f2.tenant_id = ${T}::uuid
        and f2.customer_id = ${r.customer_id}::uuid and f2.id <> ${id}::uuid and f2.sent_at is not null order by f2.sent_at desc limit 1`.execute(this.db)).rows[0] ?? null;
    // other channels — informational only (guide §11 "show last equivalent contact"); the in-app follow-up send does not block on them
    const lastMessage = (await sql<any>`select nt.channel, nt.purpose, nt.status, nt.created_at from notifications nt where nt.tenant_id = ${T}::uuid
        and nt.customer_id = ${r.customer_id}::uuid and nt.created_at > now() - interval '30 days' order by nt.created_at desc limit 1`.execute(this.db)).rows[0] ?? null;
    const optOuts = (await sql<any>`select oo.channel, oo.opted_out_at from notification_opt_outs oo where oo.tenant_id = ${T}::uuid
        and ((oo.channel = 'sms' and ${r.normalized_phone ?? ''} <> '' and oo.address = ${r.normalized_phone ?? ''}) or (oo.channel = 'email' and ${r.email ?? ''} <> '' and lower(oo.address) = lower(${r.email ?? ''})))`.execute(this.db)).rows;
    const cats: ContactCategory[] = [];
    if (SENT.includes(r.status)) cats.push('already_sent');
    else if (r.source_cancelled) cats.push('source_cancelled');   // extras 05: the visit was voided / the line removed — never sendable
    if (r.customer_status === 'archived') cats.push('blocked');
    // Kevin's decision (Nov 12 2026): an SMS STOP blocks follow-ups too — the send path refuses it (claimAndSendTask)
    const smsStop = optOuts.some((o: any) => o.channel === 'sms');
    if (smsStop && !SENT.includes(r.status)) cats.push('opted_out');
    if (!r.customer_app_user_id) cats.push('missing_contact');
    if (r.rc_at) cats.push('recently_contacted');
    if (r.status === 'pending_manager_approval' || (requireApproval && !r.approved_by_user_id && r.status === 'pending')) cats.push('needs_approval');
    const category: ContactCategory = cats[0] ?? 'eligible';
    return {
      taskId: r.id, category, categories: cats.length ? cats : ['eligible'], channel: 'customer_app', cooldownHours,
      lastFollowUp: lastFollowUp ? { taskId: lastFollowUp.id, at: iso(lastFollowUp.sent_at), technicianName: lastFollowUp.technician_name_snapshot } : null,
      otherChannel: lastMessage ? { channel: lastMessage.channel, purpose: lastMessage.purpose ?? null, status: lastMessage.status, at: iso(lastMessage.created_at), enforced: false } : null,
      optOuts: optOuts.map((o: any) => ({ channel: o.channel, at: iso(o.opted_out_at), enforced: o.channel === 'sms' })),
      marketing: { sms: r.marketing_sms_opt_in === true, email: r.marketing_email_opt_in === true },
      // FOLLOW-UP QUEUE 07 (round 10): the permitted purpose and quiet hours, stated by the server rather than implied — a service
      // follow-up about a visit the customer had is a service message (marketing consent is not what permits it; an SMS STOP still
      // blocks it, above), and it is written only to the Customer App inbox, which sends no text or call, so quiet hours do not apply
      purpose: { code: 'service_follow_up', marketingConsentRequired: false, blockedBySmsStop: true },
      quietHours: { applies: false, reason: 'in_app_inbox_only' },
      upcomingBooking: r.bk_d ?? null,
      priority: priorityOf((UNSENT.includes(r.status) && r.business_date < today ? 2 : 0) + (r.cn_at ? 2 : 0) - (r.bk_d ? 2 : 0) - (r.rc_at ? 1 : 0) - (n(r.un_n) >= 2 ? 1 : 0)),
      priorityReasons: this.reasonsOf(r, today), priorityVersion: FUQ_PRIORITY_VERSION,
    };
  }

  /** the Missed Call type (guide §07, §13) — its own source, its own states; never counted as an after-service follow-up */
  async missedCalls(T: string, B: string, tz: string, f: { q?: string; from?: string; to?: string; state?: string; page?: number; pageSize?: number }) {
    const { ps, pg } = pageOf(f.page, f.pageSize);
    const conds = [sql`ce.tenant_id = ${T}::uuid`, sql`(ce.branch_id = ${B}::uuid or ce.branch_id is null)`, sql`ce.direction <> 'outbound'`, sql`ce.status = 'missed'`]   // outcome has no 'missed' value (CHECK);
    if (f.from && f.to && YMD.test(f.from) && YMD.test(f.to)) {
      conds.push(sql`coalesce(ce.started_at, ce.created_at) >= (${f.from}::date::timestamp at time zone ${tz}) and coalesce(ce.started_at, ce.created_at) < ((${f.to}::date + 1)::timestamp at time zone ${tz})`);
    }
    const q = (f.q ?? '').trim().slice(0, 120);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const parts = [sql`coalesce(c.full_name, '') ilike ${like}`];
      if (digits.length >= 3) parts.push(sql`regexp_replace(coalesce(ce.caller_phone, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      if (UUID.test(q)) parts.push(sql`(ce.id = ${q}::uuid or ce.customer_id = ${q}::uuid)`);
      conds.push(sql`(${sql.join(parts, sql` or `)})`);
    }
    // a reply = an outbound text / email to that customer, or an outbound call to the same number, after the missed call
    const replied = sql`(exists (select 1 from notifications nt where nt.tenant_id = ce.tenant_id and ce.customer_id is not null and nt.customer_id = ce.customer_id
          and nt.created_at > coalesce(ce.started_at, ce.created_at))
        or exists (select 1 from call_intelligence_events o where o.tenant_id = ce.tenant_id and o.direction = 'outbound'
          and right(regexp_replace(coalesce(o.caller_phone, ''), '[^0-9]', '', 'g'), 10) = right(regexp_replace(coalesce(ce.caller_phone, ''), '[^0-9]', '', 'g'), 10)
          and coalesce(o.started_at, o.created_at) > coalesce(ce.started_at, ce.created_at)))`;
    const state = sql`case when ce.recovered_appointment_id is not null then 'recovered' when ${replied} then 'replied' else 'awaiting_callback' end`;
    if (f.state === 'recovered' || f.state === 'replied' || f.state === 'awaiting_callback') conds.push(sql`${state} = ${f.state}`);
    const where = sql.join(conds, sql` and `);
    const from = sql`call_intelligence_events ce left join customers c on c.id = ce.customer_id and c.tenant_id = ce.tenant_id`;
    const total = n((await sql<any>`select count(*)::int as n from ${from} where ${where}`.execute(this.db)).rows[0].n);
    const rows = (await sql<any>`select ce.id, ce.customer_id, c.full_name, ce.caller_phone, coalesce(ce.started_at, ce.created_at) as at, ce.ai_handled, ce.recovered_appointment_id, ${state} as state
        from ${from} where ${where} order by coalesce(ce.started_at, ce.created_at) desc, ce.id desc limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({ id: r.id, type: 'missed_call', customerId: r.customer_id ?? null, customerName: r.full_name ?? null, callerLast4: last4(r.caller_phone),
        at: iso(r.at), aiHandled: !!r.ai_handled, state: r.state, recoveredAppointmentId: r.recovered_appointment_id ?? null })),
      total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)),
    };
  }

  /** outcomes (guide §14): observed association inside REBOOK_WINDOW_DAYS — never causation */
  async results(T: string, B: string, tz: string, from: string, to: string, technicianId?: string) {
    if (!YMD.test(from) || !YMD.test(to)) return null;
    const tech = technicianId && UUID.test(technicianId) ? sql`and f.technician_id = ${technicianId}::uuid` : sql``;
    const base = sql`f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null and f.business_date between ${from}::date and ${to}::date ${tech}`;
    const funnel = (await sql<any>`
      with s as (select f.* from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and ${base}),
           appts as (select distinct ap.id from s join pos_tech_appointments ap on ap.tenant_id = s.tenant_id and ap.customer_id = s.customer_id
               and s.sent_at is not null and ap.created_at > s.sent_at and ap.created_at <= s.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show')),
           visits as (select distinct tk.id, tk.total_cents from s join tickets tk on tk.tenant_id = s.tenant_id and tk.customer_id = s.customer_id
               and s.sent_at is not null and tk.status in ('closed', 'paid') and coalesce(tk.paid_at, tk.created_at) > s.sent_at
               and coalesce(tk.paid_at, tk.created_at) <= s.sent_at + interval '30 days'
               and not exists (select 1 from service_follow_up_tasks s2 where s2.tenant_id = tk.tenant_id and s2.ticket_id = tk.id))   -- a visit that is itself a follow-up's source is not a return (Nov 3 audit)
      select (select count(*)::int from s) as generated,
             (select count(*)::int from s where s.status = any(${SENT}::text[])) as sent,
             (select count(*)::int from s where s.customer_app_notification_id is not null) as delivered,
             (select count(*)::int from s where s.customer_viewed_at is not null) as viewed,
             (select count(*)::int from s where s.status = any(${SKIPPED}::text[])) as skipped,
             (select count(*)::int from s where s.status = 'expired') as expired,
             (select count(*)::int from s where s.status = any(${UNSENT}::text[])) as unsent,
             (select count(*)::int from appts) as booked_after,
             (select count(*)::int from visits) as return_visits,
             (select coalesce(sum(total_cents), 0)::bigint from visits) as revenue_cents`.execute(this.db)).rows[0];
    const eligible = n((await sql<any>`select coalesce(sum(candidates_count), 0)::int as n from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid
        and business_date between ${from}::date and ${to}::date`.execute(this.db)).rows[0].n);
    const reasons = (await sql<any>`select coalesce(nullif(f.skip_reason, ''), f.status) as why, count(*)::int as n from service_follow_up_tasks f
        where f.tenant_id = ${T}::uuid and ${base} and f.status = any(${[...SKIPPED, 'expired']}::text[]) group by 1 order by 2 desc, 1 limit 20`.execute(this.db)).rows;
    const byTech = (await sql<any>`select f.technician_id, max(f.technician_name_snapshot) as name, count(*)::int as generated,
          count(*) filter (where f.status = any(${SENT}::text[]))::int as sent, count(*) filter (where f.status = any(${SKIPPED}::text[]))::int as skipped,
          count(*) filter (where f.sent_at is not null and exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id
              and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show')))::int as booked_after
        from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and ${base} group by f.technician_id order by generated desc, name limit 50`.execute(this.db)).rows;
    const age = (await sql<any>`select count(*) filter (where now() - f.created_at < interval '24 hours')::int as lt1d,
          count(*) filter (where now() - f.created_at >= interval '24 hours' and now() - f.created_at < interval '72 hours')::int as d1to3,
          count(*) filter (where now() - f.created_at >= interval '72 hours')::int as gt3d
        from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null and f.status = any(${UNSENT}::text[]) ${tech}`.execute(this.db)).rows[0];
    return {
      from, to, timezone: tz, windowDays: REBOOK_WINDOW_DAYS,
      funnel: { eligible, generated: funnel.generated, sent: funnel.sent, deliveredToApp: funnel.delivered, viewed: funnel.viewed, bookedAfter: funnel.booked_after, returnVisits: funnel.return_visits },
      closed: { skipped: funnel.skipped, expired: funnel.expired, unsent: funnel.unsent },
      associatedRevenueCents: Number(funnel.revenue_cents),
      skipReasons: reasons.map((r: any) => ({ reason: r.why, count: r.n })),
      byTechnician: byTech.map((r: any) => ({ technicianId: r.technician_id, name: r.name, generated: r.generated, sent: r.sent, skipped: r.skipped, bookedAfter: r.booked_after, smallSample: r.generated < 5 })),
      queueAge: { under1Day: age.lt1d, oneToThreeDays: age.d1to3, overThreeDays: age.gt3d },
      notes: { causation: 'association_not_causation', sms: 'not_used', email: 'not_used', delivery: 'customer_app_inbox' },
    };
  }

  /** a customer's follow-ups, newest first (guide §13) — this branch only */
  async customerHistory(T: string, B: string, customerId: string, page = 1, pageSize = 10) {
    if (!UUID.test(customerId)) return null;
    const { ps, pg } = pageOf(page, pageSize, 10);
    const base = sql`f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null and f.customer_id = ${customerId}::uuid`;
    const total = n((await sql<any>`select count(*)::int as n from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and ${base}`.execute(this.db)).rows[0].n);
    const rows = (await sql<any>`select f.id, f.business_date::text as business_date, f.status, f.service_name_snapshot, f.technician_name_snapshot, f.created_at, f.sent_at,
          f.skip_reason, f.customer_viewed_at, coalesce(f.sent_message, f.suggested_message) as message,
          (select max(al.created_at) from audit_logs al where al.tenant_id = f.tenant_id and al.entity_id = f.id::text and al.action_type = 'customer_follow_up_replied') as replied_at,
          (select min(coalesce(tv.paid_at, tv.created_at)) from tickets tv where tv.tenant_id = f.tenant_id and tv.customer_id = f.customer_id and f.sent_at is not null and tv.removed_at is null
              and tv.status in ('paid', 'closed') and coalesce(tv.paid_at, tv.created_at) > f.sent_at and coalesce(tv.paid_at, tv.created_at) <= f.sent_at + interval '30 days') as returned_at,
          (select min(ap.created_at) from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id and f.sent_at is not null
              and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show')) as booked_at
        from service_follow_up_tasks f where f.tenant_id = ${T}::uuid and ${base} order by f.created_at desc, f.id desc limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({ id: r.id, dueDate: r.business_date, status: r.status, serviceName: r.service_name_snapshot, technicianName: r.technician_name_snapshot,
        createdAt: iso(r.created_at), sentAt: iso(r.sent_at), reason: r.skip_reason ?? null, viewedAt: iso(r.customer_viewed_at),
        messagePreview: r.message ? String(r.message).slice(0, 160) : null, bookedAfterAt: iso(r.booked_at),
        // round 10 (EOD 14): the customer's reply (in-app) and the verified outcome — a paid visit within 30 days of the message (association, not proof)
        repliedAt: iso(r.replied_at), returnedAt: iso(r.returned_at) })),
      total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)),
    };
  }

  /** Generate Now result (guide §08): the run row for that day after the existing idempotent generation ran; `created` is
   *  THIS click's count (the run row keeps the day's total as `createdToday`) */
  async generationSummary(T: string, B: string, businessDate: string, createdNow?: number) {
    const r = (await sql<any>`select business_date::text as d, run_status, candidates_count, created_count, excluded_count, exclusions_json, error_message, rule_version, finished_at
        from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid and business_date = ${businessDate}::date order by updated_at desc limit 1`.execute(this.db)).rows[0];
    if (!r) return null;
    const ex = typeof r.exclusions_json === 'string' ? JSON.parse(r.exclusions_json) : (r.exclusions_json ?? {});
    return {
      businessDate: r.d, status: r.run_status, eligible: n(r.candidates_count), created: createdNow ?? n(r.created_count), createdToday: n(r.created_count), alreadyExisted: n(ex.already_generated),
      skippedByReason: Object.fromEntries(Object.entries(ex).filter(([k]) => k !== 'already_generated').map(([k, v]) => [k, n(v)])),
      failed: r.run_status === 'failed' ? 1 : 0, error: r.error_message ? String(r.error_message).slice(0, 200) : null, ruleVersion: r.rule_version, finishedAt: iso(r.finished_at),
    };
  }
}
