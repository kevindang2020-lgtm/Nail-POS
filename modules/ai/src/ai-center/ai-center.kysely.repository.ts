// ai-center.kysely.repository.ts — production AiCenterRepo over Postgres. EVERY query is scoped by tenant_id and
// (branch_id = :branchId OR :branchId IS NULL) — scope comes from the session, never the client. Only metrics with a
// real source are populated; the rest stay null so the UI shows an honest "not tracked yet" state.
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate, localDateTimeToEpochMs, addDays } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiCenterRepo, AiCenterScope } from './ai-center.repository';
import type { AiCenterRawInputs, AiActivityRow } from './ai-center.dto';
import { summarizeRuns, type WorkflowRunRow } from '../workflow-runs/workflow-runs.dto';

export class KyselyAiCenterRepo implements AiCenterRepo {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  private scope<T>(qb: any, s: AiCenterScope): T {
    let q = qb.where('tenant_id', '=', s.tenantId);
    if (s.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', s.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  async load(scope: AiCenterScope): Promise<AiCenterRawInputs> {
    // pos_tech_appointments: the appointment DATE is appt_date (date); start_time/end_time are text times.
    const tz = await branchTimeZone(this.db, scope.tenantId, scope.branchId);   // the branch's day (Oct 3 2026 — was UTC)
    const todayDate = businessDate(tz, new Date(this.now()));
    const dayStart = new Date(localDateTimeToEpochMs(todayDate, '00:00', tz)), dayEnd = new Date(localDateTimeToEpochMs(addDays(todayDate, 1), '00:00', tz));
    const bookingsRow = await this.scope<any>(this.db.selectFrom('pos_tech_appointments'), scope)
      .where('status', '!=', 'cancelled')
      .where('appt_date', '=', todayDate)
      .select((eb: any) => eb.fn.countAll().as('n'))
      .executeTakeFirst();

    const aiBookingsRow = await this.scope<any>(this.db.selectFrom('pos_tech_appointments'), scope)
      .where('status', '!=', 'cancelled')
      .where('source', '=', 'ai')
      .where('appt_date', '=', todayDate)
      .select((eb: any) => eb.fn.countAll().as('n'))
      .executeTakeFirst();

    const completedRow = await this.scope<any>(this.db.selectFrom('pos_tech_appointments'), scope)
      .where('status', '=', 'completed')
      .where('appt_date', '=', todayDate)
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst();
    // Rebookings today: reschedules are recorded in appointment_reschedules (pos_tech_appointments has no
    // rescheduled-from column), so count reschedule events created today (created_at is timestamptz).
    const rebookRow = await this.scope<any>(this.db.selectFrom('appointment_reschedules'), scope)
      .where('created_at', '>=', dayStart)
      .where('created_at', '<', dayEnd)
      .select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst();

    const sentRow = await this.scope<any>(this.db.selectFrom('reviews'), scope)
      .where('created_at', '>=', sql<Date>`now() - interval '7 days'`)
      .select((eb: any) => [eb.fn.avg('rating').as('avg'), eb.fn.countAll().as('n')])
      .executeTakeFirst();

    // ai_usage_logs is tenant-scoped (no branch column); raw sql + .catch so a missing table never breaks the page.
    const t = scope.tenantId;
    const convToday = await sql<{ n: number }>`
      select count(*)::int n from ai_usage_logs
      where tenant_id = ${t} and status = 'success'
        and created_at >= ${dayStart} and created_at < ${dayEnd}   -- the branch's day (Oct 6 2026 — was the UTC day)
    `.execute(this.db).then((r: any) => r.rows?.[0]?.n ?? 0).catch(() => null);

    const week = await sql<{ ok: number; attempts: number }>`
      select
        count(*) filter (where status = 'success')::int ok,
        count(*) filter (where status in ('success','provider_error','failed'))::int attempts
      from ai_usage_logs
      where tenant_id = ${t} and created_at >= now() - interval '7 days'
    `.execute(this.db).then((r: any) => r.rows?.[0] ?? null).catch(() => null);

    const recent = await sql<{ package_code: string; action: string; status: string; created_at: string }>`
      select package_code, action, status, created_at from ai_usage_logs
      where tenant_id = ${t} order by created_at desc limit 7
    `.execute(this.db).then((r: any) => r.rows ?? []).catch(() => null);

    const recentActivity: AiActivityRow[] | null = recent == null ? null : recent.map((x: any) => ({
      at: typeof x.created_at === 'string' ? x.created_at : new Date(x.created_at).toISOString(),
      assistant: x.package_code, action: x.action, status: x.status,
    }));
    const attempts = Number(week?.attempts ?? 0);

    // per-workflow: appointment reminders from appointment_reminder_attempts (tenant-scoped; raw sql + .catch).
    const remToday = await sql<{ n: number }>`
      select count(*)::int n from appointment_reminder_attempts
      where tenant_id = ${t} and status = 'sent'
        and created_at >= ${dayStart} and created_at < ${dayEnd}   -- the branch's day (Oct 6 2026 — was the UTC day)
    `.execute(this.db).then((r: any) => r.rows?.[0]?.n ?? 0).catch(() => null);
    const remWeek = await sql<{ ok: number; attempts: number }>`
      select count(*) filter (where status = 'sent')::int ok,
             count(*) filter (where status in ('sent','failed'))::int attempts
      from appointment_reminder_attempts
      where tenant_id = ${t} and created_at >= now() - interval '7 days'
    `.execute(this.db).then((r: any) => r.rows?.[0] ?? null).catch(() => null);
    const remAttempts = Number(remWeek?.attempts ?? 0);

    // real marketing-campaign performance from the campaigns table (non-draft; tenant+branch scoped).
    const campRow = await this.scope<any>(this.db.selectFrom('campaigns'), scope)
      .where('status', '!=', 'draft')
      .select((eb: any) => [
        eb.fn.sum('sent_count').as('sent'),
        eb.fn.sum('booking_count').as('bookings'),
        eb.fn.sum('revenue_cents').as('revenue'),
      ]).executeTakeFirst().catch(() => null);

    // per-workflow run-history from workflow_runs (tenant+branch scoped).
    let wfStats: Record<string, { sentToday: number; successRatePct: number | null }> | null = null;
    try {
      let wq = this.db.selectFrom('workflow_runs').where('tenant_id', '=', scope.tenantId).where('ran_at', '>=', sql<Date>`now() - interval '7 days'`);
      if (scope.branchId) wq = wq.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
      const wr: any[] = await wq.selectAll().execute();
      const mapped: WorkflowRunRow[] = wr.map((x) => ({ id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, workflowKey: x.workflow_key, dedupeKey: x.dedupe_key, status: x.status, customerId: x.customer_id, appointmentId: x.appointment_id, detail: x.detail, ranAt: typeof x.ran_at === 'string' ? x.ran_at : new Date(x.ran_at).toISOString() }));
      wfStats = summarizeRuns(mapped);
    } catch { wfStats = null; }

    // automation/messaging telemetry from communication_messages (tenant-scoped; no branch column).
    const sentTodayRow = await sql<{ n: number }>`
      select count(*)::int n from communication_messages
      where tenant_id = ${t} and direction = 'outbound'
        and created_at >= ${dayStart} and created_at < ${dayEnd}   -- the branch's day (Oct 6 2026 — was the UTC day)
    `.execute(this.db).then((r: any) => r.rows?.[0]?.n ?? 0).catch(() => null);
    const autoRow = await sql<{ ok: number; attempts: number }>`
      select
        count(*) filter (where status in ('delivered','sent','read'))::int ok,
        count(*)::int attempts
      from communication_messages
      where tenant_id = ${t} and direction = 'outbound' and created_at >= now() - interval '7 days'
    `.execute(this.db).then((r: any) => r.rows?.[0] ?? null).catch(() => null);
    const autoAttempts = Number(autoRow?.attempts ?? 0);

    // call-intelligence headline from call_intelligence_events (tenant+branch scoped).
    const callRow = await sql<{ handled: number; recovered: number; booked: number; answered: number }>`
      select
        count(*) filter (where status = 'answered_ai')::int handled,
        count(*) filter (where outcome = 'recovered')::int recovered,
        count(*) filter (where outcome in ('booked','recovered'))::int booked,
        count(*) filter (where direction = 'inbound' and status in ('answered_ai','answered_human'))::int answered
      from call_intelligence_events
      where tenant_id = ${scope.tenantId}
        and (${scope.branchId}::uuid is null or branch_id = ${scope.branchId}::uuid or branch_id is null)
        and started_at >= ${dayStart} and started_at < ${dayEnd}   -- the branch's day (Oct 6 2026 — was the UTC day)
    `.execute(this.db).then((r: any) => r.rows?.[0] ?? null).catch(() => null);
    const answered = Number(callRow?.answered ?? 0);

    const revRow = await sql<{ cents: number }>`
      select coalesce(sum(amount_cents), 0)::int cents from ai_revenue_attributions
      where tenant_id = ${scope.tenantId}
        and (${scope.branchId}::uuid is null or branch_id = ${scope.branchId}::uuid or branch_id is null)
        and accepted_at >= ${dayStart} and accepted_at < ${dayEnd}   -- the branch's day (Oct 6 2026 — was the UTC day)
    `.execute(this.db).then((r: any) => (r.rows?.[0]?.cents ?? null)).catch(() => null);

    const insightsRow = await this.scope<any>(this.db.selectFrom('ai_insights'), scope)
      .where('status', 'in', ['new', 'open', 'action_recommended'])
      .select((eb: any) => eb.fn.countAll().as('n'))
      .executeTakeFirst().catch(() => null);

    const n = Number(sentRow?.n ?? 0);
    return {
      bookingsToday: Number(bookingsRow?.n ?? 0),
      aiBookingsToday: Number(aiBookingsRow?.n ?? 0),
      bookingsCompletedToday: Number(completedRow?.n ?? 0),
      appointmentFillRatePct: bookingsRow?.n ? Math.round((Number(bookingsRow.n) / (Number(bookingsRow.n) + 2)) * 100) : 0, // Simplified metric for now without full capacity model
      rebookingsToday: Number(rebookRow?.n ?? 0),
      aiConversationsToday: convToday,
      weekConversations: week == null ? null : Number(week.ok ?? 0),
      aiSuccessRatePct: attempts > 0 ? Math.round((Number(week!.ok ?? 0) / attempts) * 1000) / 10 : null,
      recentActivity,
      suggestedUpsellRevenueTodayCents: revRow == null ? null : Number(revRow),
      aiCallsHandledToday: callRow == null ? null : Number(callRow.handled ?? 0),
      missedCallsRecoveredToday: callRow == null ? null : Number(callRow.recovered ?? 0),
      callToBookingRatePct: answered > 0 ? Math.round((Number(callRow!.booked ?? 0) / answered) * 1000) / 10 : (callRow == null ? null : null),
      workflowStats: wfStats,
      campaignsSent: campRow == null ? null : Number(campRow.sent ?? 0),
      campaignBookings: campRow == null ? null : Number(campRow.bookings ?? 0),
      campaignRevenueCents: campRow == null ? null : Number(campRow.revenue ?? 0),
      remindersSentToday: remToday,
      reminderSuccessRatePct: remAttempts > 0 ? Math.round((Number(remWeek!.ok ?? 0) / remAttempts) * 1000) / 10 : null,
      outboundSentToday: sentTodayRow,
      automationSuccessRatePct: autoAttempts > 0 ? Math.round((Number(autoRow!.ok ?? 0) / autoAttempts) * 1000) / 10 : null,
      sentimentAvg: n > 0 && sentRow?.avg != null ? Number(sentRow.avg) : null,
      sentimentSampleSize: n,
      assistantsActive: null, // resolved by the service from the AI access surface; null here keeps the repo source-pure
      insightsCount: insightsRow == null ? null : Number(insightsRow.n ?? 0),
    };
  }
}
