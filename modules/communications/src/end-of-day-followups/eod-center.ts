/**
 * eod-center.ts — End-of-Day Follow-Ups Complete Build Guide (Oct 30 2026). Raw-SQL pieces shared by the existing
 * Daily Follow-Up service and the new read-only management center (pos/eod-follow-ups/*). No second queue, no second
 * scheduler, no second send path:
 *
 *   loadEodCandidates   ONE eligibility rule (guide §6, §8): completed service lines of the branch-local business
 *                       date + the reasons a line would NOT become a task. Preview and the 8 PM generation both call
 *                       it, so "Preview Tonight" can never disagree with what the job creates from the same data.
 *   claimAndSendTask    the send (guide §8 "revalidate at send-time in a single authoritative transaction"): row lock
 *                       on the task, a per-customer advisory lock, the protections re-checked, the status moved with
 *                       the lifecycle guard, the Customer App message written — all in one transaction. A double-tap,
 *                       a retry, an expiry sweep and a second technician's task for the same customer cannot race it.
 *   EodCenter           summary · health · preview · runs · task history (search / basis / From–To / pages) · detail.
 *                       Reads only — Preview writes nothing, sends nothing, notifies nobody.
 *
 * Delivery channel: this workflow delivers through the Customer App inbox (customer_notifications) — it sends no SMS
 * and no email (the existing behaviour; SMS / email delivery for follow-ups is NOT built — see docs). Customer contact
 * protection (§8): an archived customer is never contacted; an already-booked customer (Retention's upcoming-booking
 * rule: booked … waiting from the salon's today) and a customer who already received a follow-up inside the branch's
 * cooldown are suppressed — a manager may override those two with a written reason (audited); nothing overrides an
 * archived customer or a missing Customer App account.
 */
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import { canMoveToSql, transitionStatus } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { FOLLOW_UP_TASK } from '../communications-lifecycles';
import { localDateInTz, localMinutesInTz, parseHHMM, FOLLOW_UP_TEMPLATES } from './end-of-day-followups.dto';
import type { FollowUpSettings } from './end-of-day-followups.dto';

/** Bumped whenever the eligibility rule changes; stored on every generation run. */
export const EOD_RULE_VERSION = 'eod-followups-v2';
/** Retention's "upcoming booking" statuses (modules/customers retention.repository UPCOMING) — one definition. */
export const UPCOMING_BOOKING_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting'];
export const UNSENT_STATES = ['pending', 'pending_manager_approval', 'rejected'] as const;
const SENT_STATES = ['sent', 'customer_replied', 'rebooked'];

export type ExclusionReason = 'already_generated' | 'customer_archived' | 'already_booked' | 'recently_contacted';
export interface EodCandidate {
  ticketId: string; ticketNumber: string | null; ticketServiceLineId: string; serviceId: string | null; serviceName: string;
  technicianId: string; technicianName: string; customerId: string; customerName: string; customerPhone: string | null;
  customerAppUserId: string | null; completedAt: string | null;
  existingTaskId: string | null; nextBookingDate: string | null; lastSentAt: string | null;
  /** null = becomes a task; otherwise why not */
  excluded: ExclusionReason | null;
  /** a task is created but the Customer App cannot deliver it (no app account) — shown as a warning */
  noApp: boolean;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
function addDays(ymd: string, n: number): string { const [y, m, d] = ymd.split('-').map(Number); return utcDate(new Date(Date.UTC(y, m - 1, d) + n * 86400000)); }

/** The single eligibility rule — see header. `now` drives the cooldown; `businessDate` is branch-local. */
export async function loadEodCandidates(db: Kysely<any>, a: { tenantId: string; branchId: string; tz: string; businessDate: string; cooldownHours: number; now: Date }): Promise<EodCandidate[]> {
  const T = a.tenantId, B = a.branchId;
  const start = `${addDays(a.businessDate, -1)}T00:00:00.000Z`, end = `${addDays(a.businessDate, 2)}T00:00:00.000Z`;
  const rows = (await sql<any>`
    select tsl.id as line_id, tsl.ticket_id, tsl.service_id, tsl.service_name_snapshot as service_name, tsl.technician_id,
           t.ticket_number, t.customer_id, c.full_name, c.first_name, c.last_name, c.normalized_phone, c.phone_display,
           c.user_id as customer_user_id, c.status as customer_status, tech.full_name as tech_name,
           coalesce(tsl.completed_at, t.paid_at, t.service_done_at) as completed_resolved,
           (select f.id from service_follow_up_tasks f where f.tenant_id = tsl.tenant_id and f.branch_id = tsl.branch_id
               and f.ticket_service_line_id = tsl.id and f.technician_id = tsl.technician_id and f.deleted_at is null limit 1) as existing_task_id,
           (select min(ap.appt_date)::text from pos_tech_appointments ap where ap.tenant_id = tsl.tenant_id and ap.customer_id = t.customer_id
               and ap.appt_date >= ${a.businessDate}::date and ap.status = any(${UPCOMING_BOOKING_STATUSES}::text[])) as next_booking,
           (select max(f2.sent_at) from service_follow_up_tasks f2 where f2.tenant_id = tsl.tenant_id and f2.customer_id = t.customer_id
               and f2.sent_at is not null) as last_sent_at
      from ticket_service_lines tsl
      join tickets t on t.id = tsl.ticket_id and t.tenant_id = tsl.tenant_id
      left join customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
      left join technicians tech on tech.id = tsl.technician_id and tech.tenant_id = tsl.tenant_id
     where tsl.tenant_id = ${T}::uuid and tsl.branch_id = ${B}::uuid
       and t.status in ('paid', 'completed', 'closed') and tsl.status in ('completed', 'done')
       and tsl.technician_id is not null and t.customer_id is not null and tsl.removed_at is null
       and coalesce(tsl.completed_at, t.paid_at, t.service_done_at) >= ${start}::timestamptz
       and coalesce(tsl.completed_at, t.paid_at, t.service_done_at) < ${end}::timestamptz
     order by coalesce(tsl.completed_at, t.paid_at, t.service_done_at), tsl.id`.execute(db)).rows;
  const coolMs = Math.max(0, a.cooldownHours) * 3600_000;
  const out: EodCandidate[] = [];
  for (const r of rows) {
    const completedAt = iso(r.completed_resolved);
    if (!completedAt || localDateInTz(new Date(completedAt), a.tz) !== a.businessDate) continue;   // exact branch-local date (DST-correct)
    const lastSentAt = iso(r.last_sent_at);
    const excluded: ExclusionReason | null = r.existing_task_id ? 'already_generated'
      : r.customer_status === 'archived' ? 'customer_archived'
      : r.next_booking ? 'already_booked'
      : (coolMs > 0 && lastSentAt && a.now.getTime() - new Date(lastSentAt).getTime() < coolMs) ? 'recently_contacted'
      : null;
    out.push({
      ticketId: r.ticket_id, ticketNumber: r.ticket_number ?? null, ticketServiceLineId: r.line_id, serviceId: r.service_id ?? null,
      serviceName: r.service_name || 'Service', technicianId: r.technician_id, technicianName: r.tech_name || 'Your technician',
      customerId: r.customer_id, customerName: (r.full_name || `${r.first_name ?? ''} ${r.last_name ?? ''}`).trim() || 'Customer',
      customerPhone: r.phone_display || r.normalized_phone || null, customerAppUserId: r.customer_user_id ?? null, completedAt,
      existingTaskId: r.existing_task_id ?? null, nextBookingDate: r.next_booking ?? null, lastSentAt, excluded, noApp: !r.customer_user_id,
    });
  }
  return out;
}

export function summarizeCandidates(c: EodCandidate[]) {
  const reasons: Record<ExclusionReason, number> = { already_generated: 0, customer_archived: 0, already_booked: 0, recently_contacted: 0 };
  for (const x of c) if (x.excluded) reasons[x.excluded] += 1;
  const included = c.filter((x) => !x.excluded);
  return { candidates: c.length, wouldCreate: included.length, excluded: c.length - included.length, reasons, noApp: included.filter((x) => x.noApp).length };
}

// ── send ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type SendRefusal = 'not_found' | 'invalid_state' | 'expired' | 'customer_archived' | 'already_booked' | 'recently_contacted' | 'source_cancelled' | 'sms_opted_out';
/** extras FOLLOW-UP QUEUE 05: the visit a task was made for must still be what generation accepted — a paid / completed /
 *  closed ticket and a service line that was not removed. A voided / reopened / removed ticket or a removed line is a cancelled
 *  source: the task can never be sent (no manager override), and the contact check says why. */
export const EOD_SOURCE_TICKET_STATUSES = ['paid', 'completed', 'closed'] as const;
// the two task aliases callers use — constant column references only (check:raw-sql-inputs: never a built identifier)
const TASK_REFS = {
  f: { tenant: sql.ref('f.tenant_id'), ticket: sql.ref('f.ticket_id'), line: sql.ref('f.ticket_service_line_id') },
  sfu: { tenant: sql.ref('sfu.tenant_id'), ticket: sql.ref('sfu.ticket_id'), line: sql.ref('sfu.ticket_service_line_id') },
} as const;
export const sourceCancelledSql = (taskAlias: keyof typeof TASK_REFS) => { const r = TASK_REFS[taskAlias]; return sql`(exists (select 1 from tickets st where st.tenant_id = ${r.tenant} and st.id = ${r.ticket}
      and (st.removed_at is not null or st.status <> all(${[...EOD_SOURCE_TICKET_STATUSES]}::text[])))
    or exists (select 1 from ticket_service_lines sl where sl.tenant_id = ${r.tenant} and sl.id = ${r.line} and sl.removed_at is not null))`; };
export type ClaimResult =
  | { outcome: 'sent'; notificationId: string; overridden: string[] }
  | { outcome: 'already_sent' }
  | { outcome: 'no_app' }
  | { outcome: 'refused'; reason: SendRefusal; detail?: string };

/** See header. `allowedFrom` — the states this actor may send from (a technician only 'pending'; a manager also an
 *  approval-pending draft and a "no app" retry). `override` covers only the soft protections. */
export async function claimAndSendTask(db: Kysely<any>, outbox: OutboxWriter | null, a: {
  tenantId: string; taskId: string; actorUserId: string; message: string | null; allowedFrom: string[]; approve: boolean;
  override: { reason: string } | null; cooldownHours: number; today: string; title: (techName: string) => string;
}): Promise<ClaimResult> {
  return db.transaction().execute(async (trx: Kysely<any>) => {
    const t = (await sql<any>`select id, tenant_id, branch_id, status, customer_id, technician_id, technician_name_snapshot, customer_app_user_id, suggested_message,
          ${sourceCancelledSql('sfu')} as source_cancelled
        from service_follow_up_tasks sfu where id = ${a.taskId}::uuid and tenant_id = ${a.tenantId}::uuid and deleted_at is null for update`.execute(trx)).rows[0];
    if (!t) return { outcome: 'refused', reason: 'not_found' } as const;
    if (SENT_STATES.includes(t.status)) return { outcome: 'already_sent' } as const;
    if (t.status === 'expired') return { outcome: 'refused', reason: 'expired' } as const;
    if (!a.allowedFrom.includes(t.status)) return { outcome: 'refused', reason: 'invalid_state', detail: t.status } as const;
    if (t.source_cancelled) return { outcome: 'refused', reason: 'source_cancelled' } as const;   // never overridable
    // one decision at a time per customer: two technicians' tasks for the same client cannot both pass the cooldown
    await sql`select pg_advisory_xact_lock(hashtextextended(${`eod:${a.tenantId}:${t.customer_id}`}, 0))`.execute(trx);
    const cust = (await sql<any>`select status, normalized_phone from customers where id = ${t.customer_id}::uuid and tenant_id = ${a.tenantId}::uuid`.execute(trx)).rows[0];
    if (!cust || cust.status === 'archived') return { outcome: 'refused', reason: 'customer_archived' } as const;
    // Kevin's decision (Nov 12 2026): a customer on the SMS opt-out list (texted STOP) gets no End-of-Day / follow-up message on
    // ANY channel — checked at dispatch, inside the claim, and never overridable by staff (END-OF-DAY FOLLOW-UPS 07 / 11).
    // Email opt-out is not part of that decision.
    if (cust.normalized_phone && (await sql<{ x: number }>`select 1 as x from notification_opt_outs oo where oo.tenant_id = ${a.tenantId}::uuid and oo.channel = 'sms'
        and oo.address = ${String(cust.normalized_phone)} limit 1`.execute(trx)).rows.length) return { outcome: 'refused', reason: 'sms_opted_out' } as const;
    if (!t.customer_app_user_id) {
      await transitionStatus(trx, FOLLOW_UP_TASK, { where: { tenant_id: a.tenantId, id: a.taskId }, to: 'customer_not_available', set: { updated_at: sql`now()` } });
      return { outcome: 'no_app' } as const;
    }
    const overridden: string[] = [];
    const booked = (await sql<any>`select min(appt_date)::text as d from pos_tech_appointments where tenant_id = ${a.tenantId}::uuid and customer_id = ${t.customer_id}::uuid
        and appt_date >= ${a.today}::date and status = any(${UPCOMING_BOOKING_STATUSES}::text[])`.execute(trx)).rows[0]?.d ?? null;
    if (booked) { if (!a.override) return { outcome: 'refused', reason: 'already_booked', detail: booked } as const; overridden.push('already_booked'); }
    if (a.cooldownHours > 0) {
      const recent = (await sql<any>`select max(sent_at) as at from service_follow_up_tasks where tenant_id = ${a.tenantId}::uuid and customer_id = ${t.customer_id}::uuid
          and id <> ${a.taskId}::uuid and sent_at is not null and sent_at > now() - make_interval(hours => ${a.cooldownHours}::int)`.execute(trx)).rows[0]?.at ?? null;
      if (recent) { if (!a.override) return { outcome: 'refused', reason: 'recently_contacted', detail: iso(recent) ?? undefined } as const; overridden.push('recently_contacted'); }
    }
    const msg = (a.message ?? '').trim() || t.suggested_message;
    const moved = await transitionStatus(trx, FOLLOW_UP_TASK, { where: { tenant_id: a.tenantId, id: a.taskId }, to: 'sent', set: {
      sent_message: msg, sent_by_user_id: a.actorUserId, sent_at: sql`now()`, updated_at: sql`now()`,
      override_reason: a.override ? `${overridden.join(',')}: ${a.override.reason}` : null,
      ...(a.approve ? { approved_by_user_id: a.actorUserId } : {}),
    } });
    if (!moved) return { outcome: 'refused', reason: 'invalid_state' } as const;
    const notifId = (await sql<{ id: string }>`insert into customer_notifications (tenant_id, customer_id, type, title, body, reference)
        values (${a.tenantId}::uuid, ${t.customer_id}::uuid, 'service_follow_up', ${a.title(t.technician_name_snapshot)}, ${msg}, ${a.taskId}) returning id`.execute(trx)).rows[0].id;
    await sql`update service_follow_up_tasks set customer_app_notification_id = ${notifId}::uuid where id = ${a.taskId}::uuid and tenant_id = ${a.tenantId}::uuid`.execute(trx);
    if (outbox) await outbox.write(trx, createDomainEvent({
      eventType: DOMAIN_EVENTS.FOLLOWUP_TASK_SENT, tenantId: a.tenantId, branchId: t.branch_id ?? undefined,
      aggregateType: 'followup_task', aggregateId: a.taskId, actorId: a.actorUserId, actorType: 'user',
      payload: { taskId: a.taskId, technicianId: t.technician_id, customerId: t.customer_id, status: 'sent', hasNotification: true },
    }));
    return { outcome: 'sent', notificationId: notifId, overridden } as const;
  });
}

/** Expire unsent tasks created before the cutoff — a STATUS change (history kept, the line can never be regenerated).
 *  A task already claimed for sending holds its row lock and is no longer unsent, so the two cannot both win. */
export async function expireUnsent(db: Kysely<any>, tenantId: string, branchId: string, cutoffIso: string, hours: number): Promise<string[]> {
  const rows = (await sql<{ id: string }>`update service_follow_up_tasks
       set status = 'expired', expired_at = now(), skip_reason = ${`expired_after_${hours}h`}, updated_at = now()
     where tenant_id = ${tenantId}::uuid and branch_id = ${branchId}::uuid and deleted_at is null
       and status in ('pending', 'pending_manager_approval', 'rejected') and ${canMoveToSql(FOLLOW_UP_TASK, 'expired')}
       and created_at < ${cutoffIso}::timestamptz
     returning id`.execute(db)).rows;
  return rows.map((r) => r.id);
}

// ── read models ───────────────────────────────────────────────────────────────────────────────────────────────────
export type HealthState = 'ready' | 'pending' | 'attention_required' | 'failed' | 'unknown' | 'not_used' | 'off';
export interface HealthRow { key: string; state: HealthState; detail: string; evidence: string; nextStep: string | null;
  /** extras FOLLOW-UP QUEUE 09 — only on the 'reconcile' row: the unsent tasks each owning module now disagrees with */
  reconcile?: FollowUpReconciliation }
/** extras FOLLOW-UP QUEUE 09 — the unsent tasks (pending / awaiting approval / rejected) re-read against the modules that own
 *  their facts, with the SAME rules the send path applies: Checkout (sourceCancelledSql — the send refuses, no override),
 *  Customer Profile (archived or no longer on file — refused), Booking (an upcoming booking from the salon's today,
 *  UPCOMING_BOOKING_STATUSES — suppressed unless a manager overrides), Technician app (the task's technician is archived or
 *  inactive — the task is in no technician's list). Counts only; reading changes nothing. SMS Inbox replies are not read here. */
export interface FollowUpReconciliation { open: number; sourceCancelled: number; customerArchived: number; alreadyBooked: number; technicianInactive: number }
export const TASK_SORTS = ['newest', 'due'] as const;
export const DATE_BASES = ['generated', 'due', 'sent', 'expired'] as const;
const PAGE_SIZES = [10, 20, 50];

export interface TaskQuery { q?: string; status?: string; technicianId?: string; approval?: string; basis?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class EodCenter {
  constructor(private readonly db: Kysely<any>) {}

  /** next run (branch-local): today at the generation time if not yet run, else tomorrow */
  async nextRun(T: string, B: string, s: FollowUpSettings, now: Date) {
    if (!s.enabled) return null;
    const today = localDateInTz(now, s.timezone);
    const ranToday = (await sql<any>`select 1 from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid and business_date = ${today}::date and run_status = 'completed'`.execute(this.db)).rows.length > 0;
    const date = !ranToday && localMinutesInTz(now, s.timezone) < parseHHMM(s.generationTime) ? today : ranToday ? addDays(today, 1) : today;
    const at = (await sql<{ at: string }>`select ((${date}::date + ${s.generationTime}::time)::timestamp at time zone ${s.timezone}) as at`.execute(this.db)).rows[0].at;
    return { businessDate: date, localTime: s.generationTime, timezone: s.timezone, at: iso(at), dueNow: date === today && !ranToday && localMinutesInTz(now, s.timezone) >= parseHHMM(s.generationTime) };
  }

  async summary(T: string, B: string, s: FollowUpSettings, now: Date) {
    const today = localDateInTz(now, s.timezone);
    const k = (await sql<any>`
      with d as (select (${today}::date::timestamp at time zone ${s.timezone}) as s0, ((${today}::date + 1)::timestamp at time zone ${s.timezone}) as s1)
      select count(*) filter (where f.status = 'pending')::int as pending,
             count(*) filter (where f.status = 'pending_manager_approval')::int as awaiting,
             count(*) filter (where f.status = 'rejected')::int as rejected,
             count(*) filter (where f.sent_at >= d.s0 and f.sent_at < d.s1)::int as sent_today,
             count(*) filter (where f.status in ('failed', 'customer_not_available') and f.updated_at >= d.s0 and f.updated_at < d.s1)::int as failed_today,
             count(*) filter (where f.status = 'expired' and f.expired_at >= d.s0 and f.expired_at < d.s1)::int as expired_today,
             count(*) filter (where f.sent_at >= now() - interval '30 days' and exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id
                 and ap.customer_id = f.customer_id and ap.created_at > f.sent_at and ap.created_at <= f.sent_at + interval '30 days' and ap.status not in ('cancelled', 'no_show')))::int as booked_after_30d
        from service_follow_up_tasks f, d
       where f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null`.execute(this.db)).rows[0];
    const last = (await sql<any>`select business_date::text as d, run_status, trigger_source, finished_at, created_count, skipped_count, candidates_count, excluded_count
        from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid order by business_date desc, updated_at desc limit 1`.execute(this.db)).rows[0] ?? null;
    return {
      today, timezone: s.timezone, nextRun: await this.nextRun(T, B, s, now),
      lastRun: last ? { businessDate: last.d, status: last.run_status, trigger: last.trigger_source, finishedAt: iso(last.finished_at), created: Number(last.created_count), skipped: Number(last.skipped_count), candidates: Number(last.candidates_count), excluded: Number(last.excluded_count) } : null,
      kpis: { pending: k.pending, awaitingApproval: k.awaiting, rejected: k.rejected, sentToday: k.sent_today, failedToday: k.failed_today, expiredToday: k.expired_today, bookedAfter30d: k.booked_after_30d },
      generatedAt: now.toISOString(),
    };
  }

  async health(T: string, B: string, s: FollowUpSettings, now: Date): Promise<{ overall: HealthState; rows: HealthRow[] }> {
    const jobs = (await sql<any>`select name, last_started_at, last_finished_at, last_outcome, last_error, failures, runs, updated_at from scheduler_runs
        where name in ('followups.run_due', 'followups.expire_stale')`.execute(this.db)).rows;
    const job = (n: string) => jobs.find((j: any) => j.name === n) ?? null;
    const stale = (j: any) => !j?.updated_at || now.getTime() - new Date(j.updated_at).getTime() > 15 * 60_000;
    const jobRow = (key: string, n: string, offDetail: string | null): HealthRow => {
      if (offDetail) return { key, state: 'off', detail: offDetail, evidence: 'branch setting', nextStep: null };
      const j = job(n);
      if (!j) return { key, state: 'unknown', detail: 'No worker has recorded this job here yet.', evidence: `scheduler_runs: no '${n}' row`, nextStep: 'Check that the worker process is running with the critical job class.' };
      if (j.last_outcome && /fail|error/i.test(j.last_outcome)) return { key, state: 'failed', detail: 'The last run failed.', evidence: `last outcome ${j.last_outcome}${j.last_error ? ` — ${String(j.last_error).slice(0, 120)}` : ''}`, nextStep: 'Open the worker logs for this job.' };
      if (stale(j)) return { key, state: 'attention_required', detail: 'The worker has not checked in for over 15 minutes.', evidence: `last heartbeat ${iso(j.updated_at)}`, nextStep: 'Restart or scale the worker.' };
      return { key, state: 'ready', detail: 'The worker is running this job.', evidence: `last finished ${iso(j.last_finished_at) ?? '—'} · runs ${j.runs} · failures ${j.failures}`, nextStep: null };
    };
    const rows: HealthRow[] = [];
    rows.push(jobRow('scheduler', 'followups.run_due', s.enabled ? null : 'End-of-day follow-ups are turned off for this branch.'));
    rows.push(jobRow('expiry', 'followups.expire_stale', s.autoExpirePendingHours > 0 ? null : 'Auto-remove is set to Never.'));
    const failedRuns = Number((await sql<any>`select count(*)::int as n from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid
        and run_status = 'failed' and business_date >= (${localDateInTz(now, s.timezone)}::date - 7)`.execute(this.db)).rows[0].n);
    const lastRun = (await sql<any>`select business_date::text as d, run_status, finished_at, error_message from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid order by business_date desc limit 1`.execute(this.db)).rows[0];
    rows.push(failedRuns > 0
      ? { key: 'generation', state: 'failed', detail: `${failedRuns} generation run(s) failed in the last 7 days.`, evidence: `last: ${lastRun?.d} ${lastRun?.run_status}${lastRun?.error_message ? ` — ${String(lastRun.error_message).slice(0, 120)}` : ''}`, nextStep: 'Open Generation runs below; Generate Now retries safely (no duplicates).' }
      : lastRun ? { key: 'generation', state: 'ready', detail: `Last generated for ${lastRun.d}.`, evidence: `run ${lastRun.run_status} at ${iso(lastRun.finished_at) ?? '—'}`, nextStep: null }
      : { key: 'generation', state: 'pending', detail: 'No generation run has happened for this branch yet.', evidence: 'daily_follow_up_generation_runs: none', nextStep: null });
    const tplOk = !s.defaultMessageTemplate || FOLLOW_UP_TEMPLATES.some((t) => t.key === s.defaultMessageTemplate);
    rows.push(tplOk
      ? { key: 'template', state: 'ready', detail: 'The follow-up message template is valid.', evidence: `template ${s.defaultMessageTemplate ?? 'default'}`, nextStep: null }
      : { key: 'template', state: 'attention_required', detail: 'The saved template key is unknown; the default text is used.', evidence: `template ${s.defaultMessageTemplate}`, nextStep: 'Pick a template again and save.' });
    rows.push({ key: 'channel', state: 'ready', detail: 'Follow-ups are delivered to the Customer App inbox.', evidence: 'customer_notifications', nextStep: null });
    rows.push({ key: 'sms', state: 'not_used', detail: 'This workflow sends no text messages.', evidence: 'delivery is in-app only', nextStep: null });
    rows.push({ key: 'email', state: 'not_used', detail: 'This workflow sends no email.', evidence: 'delivery is in-app only', nextStep: null });
    if (!s.reminderToTech) rows.push({ key: 'tech_alerts', state: 'off', detail: 'Technician reminders are turned off.', evidence: 'branch setting', nextStep: null });
    else {
      const ta = (await sql<any>`select max(n.created_at) as at, count(*)::int as n from technician_notifications n join technicians te on te.id = n.technician_id and te.tenant_id = n.tenant_id
          where n.tenant_id = ${T}::uuid and n.type = 'daily_followup_ready' and (te.branch_id = ${B}::uuid or te.branch_id is null) and n.created_at > now() - interval '7 days'`.execute(this.db).catch(() => ({ rows: [{ at: null, n: 0 }] }))).rows[0];
      rows.push(ta?.at ? { key: 'tech_alerts', state: 'ready', detail: 'Technicians were told when their list was ready.', evidence: `${ta.n} alert(s) in 7 days · last ${iso(ta.at)}`, nextStep: null }
        : { key: 'tech_alerts', state: 'pending', detail: 'No ready-list alert in the last 7 days.', evidence: 'technician_notifications: none', nextStep: 'An alert is sent only when a run creates tasks.' });
    }
    const q = (await sql<any>`select count(*) filter (where status = 'pending_manager_approval')::int as awaiting, min(submitted_at) filter (where status = 'pending_manager_approval') as oldest
        from service_follow_up_tasks where tenant_id = ${T}::uuid and branch_id = ${B}::uuid and deleted_at is null`.execute(this.db)).rows[0];
    rows.push(q.awaiting > 0
      ? { key: 'queue', state: 'attention_required', detail: `${q.awaiting} follow-up(s) wait for a manager.`, evidence: q.oldest ? `oldest submitted ${iso(q.oldest)}` : 'awaiting approval', nextStep: 'Open the Awaiting approval filter.' }
      : { key: 'queue', state: 'ready', detail: 'Nothing waits for approval.', evidence: 'awaiting approval 0', nextStep: null });
    const rec = await this.reconciliation(T, B, localDateInTz(now, s.timezone));
    const recIssues = rec.sourceCancelled + rec.customerArchived + rec.alreadyBooked + rec.technicianInactive;
    rows.push({ key: 'reconcile', state: recIssues > 0 ? 'attention_required' : 'ready', reconcile: rec,
      detail: recIssues > 0 ? `${recIssues} unsent follow-up(s) no longer match Checkout, Customer Profile, Booking or the technician list.` : 'Every unsent follow-up still matches its visit, customer, bookings and technician.',
      evidence: `open ${rec.open} · source changed ${rec.sourceCancelled} · customer archived ${rec.customerArchived} · already booked ${rec.alreadyBooked} · technician inactive ${rec.technicianInactive}`,
      nextStep: recIssues > 0 ? 'Open each task: the contact check says why it cannot be sent.' : null });
    const order: HealthState[] = ['failed', 'attention_required', 'unknown', 'pending'];
    const core = rows.filter((r) => ['scheduler', 'generation', 'template', 'channel', 'queue', 'expiry'].includes(r.key));
    const overall: HealthState = !s.enabled ? 'off' : order.find((st) => core.some((r) => r.state === st)) ?? 'ready';
    return { overall, rows };
  }

  /** extras FOLLOW-UP QUEUE 09 — see FollowUpReconciliation. `today` is the branch-local salon day. */
  async reconciliation(T: string, B: string, today: string): Promise<FollowUpReconciliation> {
    const r = (await sql<{ open: number; source_cancelled: number; customer_archived: number; already_booked: number; technician_inactive: number }>`select count(*)::int as open,
        count(*) filter (where ${sourceCancelledSql('f')})::int as source_cancelled,
        count(*) filter (where c.id is null or c.status = 'archived')::int as customer_archived,
        count(*) filter (where exists (select 1 from pos_tech_appointments ap where ap.tenant_id = f.tenant_id and ap.customer_id = f.customer_id
            and ap.appt_date >= ${today}::date and ap.status = any(${UPCOMING_BOOKING_STATUSES}::text[])))::int as already_booked,
        count(*) filter (where te.id is null or te.archived_at is not null or te.is_active = false)::int as technician_inactive
      from service_follow_up_tasks f
      left join customers c on c.id = f.customer_id and c.tenant_id = f.tenant_id
      left join technicians te on te.id = f.technician_id and te.tenant_id = f.tenant_id
     where f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null and f.status = any(${[...UNSENT_STATES]}::text[])`.execute(this.db)).rows[0];
    return { open: Number(r?.open ?? 0), sourceCancelled: Number(r?.source_cancelled ?? 0), customerArchived: Number(r?.customer_archived ?? 0), alreadyBooked: Number(r?.already_booked ?? 0), technicianInactive: Number(r?.technician_inactive ?? 0) };
  }

  async runs(T: string, B: string, page = 1, pageSize = 10) {
    const ps = PAGE_SIZES.includes(pageSize) ? pageSize : 10, pg = Math.max(1, Math.floor(page) || 1);
    const total = Number((await sql<any>`select count(*)::int as n from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid`.execute(this.db)).rows[0].n);
    const items = (await sql<any>`select id, business_date::text as business_date, run_status, trigger_source, started_at, finished_at, created_count, skipped_count,
          candidates_count, excluded_count, exclusions_json, rule_version, run_timezone, generation_time, error_message
        from daily_follow_up_generation_runs where tenant_id = ${T}::uuid and branch_id = ${B}::uuid
       order by business_date desc, id desc limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows.map((r: any) => ({
      id: r.id, businessDate: r.business_date, status: r.run_status, trigger: r.trigger_source, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
      created: Number(r.created_count), skipped: Number(r.skipped_count), candidates: Number(r.candidates_count), excluded: Number(r.excluded_count),
      exclusions: typeof r.exclusions_json === 'string' ? JSON.parse(r.exclusions_json) : (r.exclusions_json ?? {}), ruleVersion: r.rule_version, timezone: r.run_timezone, generationTime: r.generation_time,
      error: r.error_message ? String(r.error_message).slice(0, 200) : null,
    }));
    return { items, total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)) };
  }

  async tasks(T: string, B: string, tz: string, f: TaskQuery) {
    const ps = PAGE_SIZES.includes(Number(f.pageSize)) ? Number(f.pageSize) : 20, pg = Math.max(1, Math.floor(Number(f.page)) || 1);
    const conds = [sql`f.tenant_id = ${T}::uuid`, sql`f.branch_id = ${B}::uuid`, sql`f.deleted_at is null`];
    const q = (f.q ?? '').trim().slice(0, 120);
    if (q) {
      const digits = q.replace(/\D/g, '');
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const parts = [sql`f.customer_name_snapshot ilike ${like}`, sql`f.technician_name_snapshot ilike ${like}`, sql`f.service_name_snapshot ilike ${like}`, sql`coalesce(t.ticket_number::text, '') ilike ${like}`];
      if (digits.length >= 3) parts.push(sql`regexp_replace(coalesce(f.customer_phone_snapshot, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      if (UUID.test(q)) parts.push(sql`(f.id = ${q}::uuid or f.ticket_id = ${q}::uuid or f.appointment_id = ${q}::uuid or f.customer_id = ${q}::uuid)`);
      conds.push(sql`(${sql.join(parts, sql` or `)})`);
    }
    const STATUS_GROUPS: Record<string, string[]> = { unsent: [...UNSENT_STATES], sent: SENT_STATES, closed: ['skipped', 'dismissed', 'expired', 'customer_not_available', 'failed'] };
    if (f.status && f.status !== 'all') conds.push(sql`f.status = any(${STATUS_GROUPS[f.status] ?? [f.status]}::text[])`);
    if (f.technicianId && UUID.test(f.technicianId)) conds.push(sql`f.technician_id = ${f.technicianId}::uuid`);
    if (f.approval === 'awaiting') conds.push(sql`f.status = 'pending_manager_approval'`);
    else if (f.approval === 'rejected') conds.push(sql`f.status = 'rejected'`);
    else if (f.approval === 'approved') conds.push(sql`f.approved_by_user_id is not null`);
    const basis = (DATE_BASES as readonly string[]).includes(f.basis ?? '') ? f.basis! : 'generated';
    if (f.from && f.to && YMD.test(f.from) && YMD.test(f.to)) {
      if (basis === 'due') conds.push(sql`f.business_date between ${f.from}::date and ${f.to}::date`);
      else {
        const col = basis === 'sent' ? sql`f.sent_at` : basis === 'expired' ? sql`f.expired_at` : sql`f.created_at`;
        conds.push(sql`${col} >= (${f.from}::date::timestamp at time zone ${tz}) and ${col} < ((${f.to}::date + 1)::timestamp at time zone ${tz})`);
      }
    }
    const where = sql.join(conds, sql` and `);
    const total = Number((await sql<any>`select count(*)::int as n from service_follow_up_tasks f left join tickets t on t.id = f.ticket_id and t.tenant_id = f.tenant_id where ${where}`.execute(this.db)).rows[0].n);
    const order = f.sort === 'due' ? sql`f.business_date asc, f.completed_at asc nulls last, f.id asc` : sql`f.created_at desc, f.id desc`;
    const rows = (await sql<any>`select f.id, f.business_date::text as business_date, f.status, f.customer_id, f.customer_name_snapshot, f.customer_phone_snapshot, f.customer_app_user_id,
          f.service_name_snapshot, f.technician_id, f.technician_name_snapshot, f.completed_at, f.created_at, f.sent_at, f.expired_at, f.skip_reason, f.manager_note,
          f.ticket_id, f.appointment_id, t.ticket_number, f.approved_by_user_id is not null as approved, f.override_reason is not null as overridden
        from service_follow_up_tasks f left join tickets t on t.id = f.ticket_id and t.tenant_id = f.tenant_id
       where ${where} order by ${order} limit ${ps} offset ${(pg - 1) * ps}`.execute(this.db)).rows;
    return {
      items: rows.map((r: any) => ({
        id: r.id, businessDate: r.business_date, status: r.status, customerId: r.customer_id, customerName: r.customer_name_snapshot,
        customerPhoneLast4: r.customer_phone_snapshot ? String(r.customer_phone_snapshot).replace(/\D/g, '').slice(-4) : null, customerHasApp: !!r.customer_app_user_id,
        serviceName: r.service_name_snapshot, technicianId: r.technician_id, technicianName: r.technician_name_snapshot, completedAt: iso(r.completed_at),
        createdAt: iso(r.created_at), sentAt: iso(r.sent_at), expiredAt: iso(r.expired_at), reason: r.skip_reason ?? null, managerNote: r.manager_note ?? null,
        ticketId: r.ticket_id, ticketNumber: r.ticket_number ?? null, appointmentId: r.appointment_id ?? null, approved: !!r.approved, overridden: !!r.overridden,
      })),
      total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)), basis, sort: f.sort === 'due' ? 'due' : 'newest',
    };
  }

  async detail(T: string, B: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = (await sql<any>`select f.id, f.status, f.customer_id, f.customer_name_snapshot, f.customer_phone_snapshot, f.customer_app_user_id, f.technician_id,
          f.technician_name_snapshot, f.service_name_snapshot, f.ticket_id, f.appointment_id, f.completed_at, f.created_at, f.submitted_at, f.sent_at, f.expired_at,
          f.rejected_at, f.message_template_key, f.suggested_message, f.sent_message, f.skip_reason, f.manager_note, f.override_reason, f.approved_by_user_id,
          f.customer_app_notification_id, f.customer_viewed_at, f.business_date::text as bdate, t.ticket_number from service_follow_up_tasks f left join tickets t on t.id = f.ticket_id and t.tenant_id = f.tenant_id
        where f.id = ${id}::uuid and f.tenant_id = ${T}::uuid and f.branch_id = ${B}::uuid and f.deleted_at is null`.execute(this.db)).rows[0];
    if (!r) return null;
    const events = (await sql<any>`select action_type, role, created_at, metadata_json from audit_logs where tenant_id = ${T}::uuid and entity_id = ${id}
        and (entity_type = 'service_follow_up_task' or entity_type is null) order by created_at asc, id asc limit 100`.execute(this.db)).rows.map((e: any) => ({ action: e.action_type, role: e.role ?? null, at: iso(e.created_at) }));
    const notif = r.customer_app_notification_id ? (await sql<any>`select created_at, read_at from customer_notifications where id = ${r.customer_app_notification_id}::uuid and tenant_id = ${T}::uuid`.execute(this.db)).rows[0] ?? null : null;
    const booked = r.sent_at ? (await sql<any>`select id, appt_date::text as d, created_at from pos_tech_appointments where tenant_id = ${T}::uuid and customer_id = ${r.customer_id}::uuid
        and created_at > ${r.sent_at} and created_at <= ${r.sent_at}::timestamptz + interval '30 days' and status not in ('cancelled', 'no_show') order by created_at asc limit 1`.execute(this.db)).rows[0] ?? null : null;
    return {
      id: r.id, status: r.status, businessDate: r.bdate, customerId: r.customer_id, customerName: r.customer_name_snapshot, customerPhone: r.customer_phone_snapshot ?? null,
      customerHasApp: !!r.customer_app_user_id, technicianId: r.technician_id, technicianName: r.technician_name_snapshot, serviceName: r.service_name_snapshot,
      ticketId: r.ticket_id, ticketNumber: r.ticket_number ?? null, appointmentId: r.appointment_id ?? null, completedAt: iso(r.completed_at),
      createdAt: iso(r.created_at), submittedAt: iso(r.submitted_at), sentAt: iso(r.sent_at), expiredAt: iso(r.expired_at), rejectedAt: iso(r.rejected_at),
      templateKey: r.message_template_key ?? null, draft: r.suggested_message, sentMessage: r.sent_message ?? null, reason: r.skip_reason ?? null,
      managerNote: r.manager_note ?? null, overrideReason: r.override_reason ?? null, approved: !!r.approved_by_user_id,
      delivery: notif ? { channel: 'customer_app', deliveredToInboxAt: iso(notif.created_at), readAt: iso(notif.read_at) } : null,
      customerViewedAt: iso(r.customer_viewed_at),
      bookedAfter: booked ? { appointmentId: booked.id, date: booked.d, bookedAt: iso(booked.created_at), label: 'Booked after follow-up (not proof the follow-up caused it)' } : null,
      timeline: events,
    };
  }
}
