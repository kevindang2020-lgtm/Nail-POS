/**
 * end-of-day-followups.kysely.repository.ts — Postgres implementation of the Daily Follow-Up Queue port.
 *
 * Generation reads COMPLETED service lines (ticket paid/completed/closed + line completed/done + has tech + has
 * customer + not removed) and produces ONE task per line, owned by the line's technician_id. The branch-local business
 * date is matched in JS via Intl (DST-correct) after bounding candidates to a UTC window, so we never depend on the
 * database's timezone functions. Dedup is enforced by the partial unique index (tenant, branch, line, tech).
 */
import { dateColumnYmd } from '@aipowersalon/date-time';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  DailyFollowUpPort, NewTaskRow, TaskRecord, ActiveBranch, RunDiagnostics,
} from './end-of-day-followups.repository';
import { loadEodCandidates, claimAndSendTask, expireUnsent, type EodCandidate, type ClaimResult } from './eod-center';
import type { FollowUpContext, FollowUpSettings, FollowUpStatus } from './end-of-day-followups.dto';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { canMoveToSql, transitionStatus } from '@aipowersalon/database';
import type { Kysely as AnyKysely } from 'kysely';
import { FOLLOW_UP_TASK, FOLLOW_UP_GENERATION_RUN } from '../communications-lifecycles';

const DEFAULT_TZ = 'America/New_York';

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export class KyselyDailyFollowUpRepository implements DailyFollowUpPort {
  // Constitution 8 §80: task changes commit with their domain event. Optional and null-safe; the service keeps
  // its in-process realtime path when no writer is wired.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  /** The task's tenant/branch/technician — the event needs them and the caller only has an id. */
  private async taskCtx(trx: any, id: string): Promise<{ tenant_id: string; branch_id: string | null; technician_id: string | null; customer_id: string | null } | undefined> {
    return (await sql<any>`select tenant_id, branch_id, technician_id, customer_id from service_follow_up_tasks where id = ${id}::uuid`.execute(trx)).rows[0];
  }

  /**
   * The branch's timezone, from `branches.timezone` (migration 106) — the column the location screens write and the
   * campaign limits read.
   *
   * This used to read `store_hours_settings.timezone`. NOTHING in the codebase writes that table, so this always
   * returned null and every salon fell through to DEFAULT_TZ (America/New_York) unless an owner had separately set
   * a follow-up-specific timezone. A Los Angeles salon's "7pm" end-of-day follow-ups therefore ran at 4pm local.
   */
  async branchTimezone(tenantId: string, branchId: string): Promise<string | null> {
    const r = (await sql<any>`select timezone from branches where tenant_id = ${tenantId}::uuid and id = ${branchId}::uuid`.execute(this.db)).rows[0];
    return r?.timezone ?? null;
  }

  async settingsFor(tenantId: string, branchId: string): Promise<FollowUpSettings> {
    // raw SQL (Oct 31 2026, EOD guide): the settings are read by the scheduler, the send and the management center
    const row: any = (await sql<any>`select * from daily_follow_up_settings where tenant_id = ${tenantId}::uuid and branch_id = ${branchId}::uuid`.execute(this.db)).rows[0];
    const tz = (row?.timezone || (await this.branchTimezone(tenantId, branchId)) || DEFAULT_TZ) as string;
    if (!row) {
      return {
        enabled: true, generationTime: '20:00', timezone: tz, allowTechEditMessage: true, allowCustomerReplies: true,
        requireManagerApproval: false, reminderToTech: true, createMode: 'end_of_day', autoExpirePendingHours: 24, defaultMessageTemplate: null,
        contactCooldownHours: 24,
      };
    }
    return {
      enabled: !!row.enabled, generationTime: row.generation_time || '20:00', timezone: tz,
      allowTechEditMessage: !!row.allow_tech_edit_message, allowCustomerReplies: !!row.allow_customer_replies,
      requireManagerApproval: !!row.require_manager_approval, reminderToTech: !!row.reminder_to_tech,
      createMode: (row.create_mode === 'after_checkout' ? 'after_checkout' : 'end_of_day'),
      autoExpirePendingHours: row.auto_expire_pending_hours ?? 24,
      defaultMessageTemplate: row.default_message_template ?? null,
      contactCooldownHours: row.contact_cooldown_hours ?? 24,
    };
  }

  async saveSettings(ctx: FollowUpContext, patch: Partial<FollowUpSettings>): Promise<FollowUpSettings> {
    const cur = await this.settingsFor(ctx.tenantId, ctx.branchId);
    const n = { ...cur, ...patch };
    // the timezone override is written only when the patch names it (the resolved branch timezone is never copied in)
    const tzSet = patch.timezone !== undefined;
    await sql`insert into daily_follow_up_settings (tenant_id, branch_id, enabled, generation_time, timezone, default_message_template, allow_tech_edit_message,
        allow_customer_replies, require_manager_approval, reminder_to_tech, create_mode, auto_expire_pending_hours, contact_cooldown_hours, updated_by_user_id)
      values (${ctx.tenantId}::uuid, ${ctx.branchId}::uuid, ${n.enabled}, ${n.generationTime}, ${tzSet ? patch.timezone ?? null : null}, ${n.defaultMessageTemplate},
        ${n.allowTechEditMessage}, ${n.allowCustomerReplies}, ${n.requireManagerApproval}, ${n.reminderToTech}, ${n.createMode}, ${n.autoExpirePendingHours},
        ${n.contactCooldownHours}, ${ctx.userId}::uuid)
      on conflict (tenant_id, branch_id) do update set enabled = excluded.enabled, generation_time = excluded.generation_time,
        timezone = ${tzSet ? sql`excluded.timezone` : sql`daily_follow_up_settings.timezone`}, default_message_template = excluded.default_message_template,
        allow_tech_edit_message = excluded.allow_tech_edit_message, allow_customer_replies = excluded.allow_customer_replies,
        require_manager_approval = excluded.require_manager_approval, reminder_to_tech = excluded.reminder_to_tech, create_mode = excluded.create_mode,
        auto_expire_pending_hours = excluded.auto_expire_pending_hours, contact_cooldown_hours = excluded.contact_cooldown_hours,
        updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`.execute(this.db);
    return this.settingsFor(ctx.tenantId, ctx.branchId);
  }

  async activeBranches(): Promise<ActiveBranch[]> {
    // Constitution 7 §19: a suspended / closed salon sends no scheduled follow-ups (its branches stay 'active' rows)
    const rows = (await sql<any>`select b.id, b.tenant_id from branches b join tenants t on t.id = b.tenant_id where b.status = 'active' and t.status = 'active'`.execute(this.db)).rows;
    return rows.map((r: any) => ({ tenantId: r.tenant_id, branchId: r.id }));
  }

  async resolveTechnicianId(ctx: FollowUpContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = (await sql<any>`select id from technicians where tenant_id = ${ctx.tenantId}::uuid and user_id = ${ctx.userId}::uuid and is_active = true limit 1`.execute(this.db)).rows[0];
    return r?.id ?? null;
  }

  async resolveCustomerRecordId(ctx: FollowUpContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r: any = await this.db.selectFrom('customers').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).executeTakeFirst();
    return r?.id ?? null;
  }

  async runExists(tenantId: string, branchId: string, businessDate: string): Promise<boolean> {
    return (await sql<any>`select 1 from daily_follow_up_generation_runs where tenant_id = ${tenantId}::uuid and branch_id = ${branchId}::uuid
        and business_date = ${businessDate}::date and run_status = 'completed'`.execute(this.db)).rows.length > 0;
  }

  async recordRun(run: { tenantId: string; branchId: string; businessDate: string; runStatus: 'completed' | 'failed'; triggerSource: 'scheduler' | 'manual'; createdCount: number; skippedCount: number; errorMessage?: string | null; diag?: RunDiagnostics }): Promise<void> {
    const d = run.diag;
    await sql`insert into daily_follow_up_generation_runs (tenant_id, branch_id, business_date, run_status, trigger_source, finished_at, created_count, skipped_count, error_message,
        candidates_count, excluded_count, exclusions_json, rule_version, run_timezone, generation_time, run_key)
      values (${run.tenantId}::uuid, ${run.branchId}::uuid, ${run.businessDate}::date, ${run.runStatus}, ${run.triggerSource}, now(), ${run.createdCount}, ${run.skippedCount},
        ${run.errorMessage ?? null}, ${d?.candidates ?? 0}, ${d?.excluded ?? 0}, ${JSON.stringify(d?.exclusions ?? {})}::jsonb, ${d?.ruleVersion ?? null}, ${d?.timezone ?? null},
        ${d?.generationTime ?? null}, ${d?.runKey ?? null})
      on conflict (tenant_id, branch_id, business_date) do update set run_status = excluded.run_status, trigger_source = excluded.trigger_source, finished_at = now(),
        created_count = daily_follow_up_generation_runs.created_count + excluded.created_count, skipped_count = excluded.skipped_count,
        error_message = excluded.error_message, candidates_count = excluded.candidates_count, excluded_count = excluded.excluded_count,
        exclusions_json = excluded.exclusions_json, rule_version = excluded.rule_version, run_timezone = excluded.run_timezone,
        generation_time = excluded.generation_time, run_key = excluded.run_key, updated_at = now()
      where ${canMoveToSql(FOLLOW_UP_GENERATION_RUN, run.runStatus, 'daily_follow_up_generation_runs')}`.execute(this.db);
  }

  async eodCandidates(tenantId: string, branchId: string, tz: string, businessDate: string, cooldownHours: number, now: Date): Promise<EodCandidate[]> {
    return loadEodCandidates(this.db as unknown as AnyKysely<any>, { tenantId, branchId, tz, businessDate, cooldownHours, now });
  }

  async insertTasksIgnoreConflict(rows: NewTaskRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    // §18/§80: the nightly queue and followup.tasks_generated commit together. ONE event per (tenant, branch,
    // business date) — "the queue was generated" is a single fact. ON CONFLICT DO NOTHING (the live (line, tech)
    // unique index) makes a re-run insert nothing and therefore emit nothing — the scheduler is safe to retry.
    return this.db.transaction().execute(async (trx) => {
      let n = 0;
      for (const r of rows) {
        const res = (await sql<any>`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id,
            service_id, service_name_snapshot, customer_name_snapshot, customer_phone_snapshot, technician_name_snapshot, customer_app_user_id, completed_at, status,
            message_template_key, suggested_message)
          values (${r.tenantId}::uuid, ${r.branchId}::uuid, ${r.businessDate}::date, ${r.customerId}::uuid, ${r.technicianId}::uuid, ${r.ticketId}::uuid,
            ${r.ticketServiceLineId}::uuid, ${r.serviceId}::uuid, ${r.serviceName}, ${r.customerName}, ${r.customerPhone}, ${r.technicianName},
            ${r.customerAppUserId}::uuid, ${r.completedAt}::timestamptz, 'pending', ${r.templateKey}, ${r.suggestedMessage})
          on conflict do nothing returning id`.execute(trx)).rows;
        n += res.length;
      }
      if (n > 0 && this.outbox) {
        const first = rows[0];
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.FOLLOWUP_TASKS_GENERATED, tenantId: first.tenantId, branchId: first.branchId ?? undefined,
          aggregateType: 'followup_queue', aggregateId: `${first.branchId}:${first.businessDate}`, actorType: 'worker',
          // §95: counts and technician ids — never the customer name/phone snapshots these rows carry
          payload: { businessDate: first.businessDate, count: n, technicianIds: [...new Set(rows.map((r) => r.technicianId).filter(Boolean))] },
        }));
      }
      return n;
    });
  }

  async notifyTechnicians(tenantId: string, technicianIds: string[], businessDate: string): Promise<void> {
    if (technicianIds.length === 0) return;
    // ONE ready-list alert per technician per business date (guide §9): a manual top-up or a re-run never alerts twice
    await sql`insert into technician_notifications (tenant_id, technician_id, type, title, body, reference)
      select ${tenantId}::uuid, x.tid, 'daily_followup_ready', 'Your daily follow-up list is ready', ${"Tap to review today's clients and send follow-ups."}, ${businessDate}
        from unnest(${technicianIds}::uuid[]) as x(tid)
       where not exists (select 1 from technician_notifications n where n.tenant_id = ${tenantId}::uuid and n.technician_id = x.tid
                           and n.type = 'daily_followup_ready' and n.reference = ${businessDate})`.execute(this.db);
  }

  async expireStalePending(tenantId: string, branchId: string, cutoffIso: string, hours: number): Promise<number> {
    // a status change only — the row stays visible in history and keeps the (line, technician) slot, so the same
    // service line can never be generated again (the earlier soft-delete freed it); nothing is purged any more
    return (await expireUnsent(this.db as unknown as AnyKysely<any>, tenantId, branchId, cutoffIso, hours)).length;
  }

  private baseSelect() {
    return this.db.selectFrom('service_follow_up_tasks as f')
      .leftJoin('tickets as t', (j) => j.onRef('t.id', '=', 'f.ticket_id').onRef('t.tenant_id', '=', 'f.tenant_id'))
      .where('f.deleted_at', 'is', null)
      .select([
        'f.id as id', 'f.tenant_id as tenant_id', 'f.branch_id as branch_id',
        sql<string>`f.business_date::text`.as('business_date'),
        'f.status as status', 'f.customer_id as customer_id', 'f.customer_name_snapshot as customer_name',
        'f.customer_phone_snapshot as customer_phone', 'f.customer_app_user_id as customer_app_user_id',
        'f.service_id as service_id', 'f.service_name_snapshot as service_name', 'f.ticket_id as ticket_id',
        'f.ticket_service_line_id as line_id', 'f.appointment_id as appointment_id', 'f.technician_id as technician_id',
        'f.technician_name_snapshot as technician_name', 'f.completed_at as completed_at',
        'f.message_template_key as template_key', 'f.suggested_message as suggested_message',
        'f.sent_message as sent_message', 'f.sent_at as sent_at', 'f.skip_reason as skip_reason',
        'f.expired_at as expired_at', 'f.manager_note as manager_note',
        't.ticket_number as ticket_number',
      ]);
  }

  private map = (r: any): TaskRecord => ({
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, businessDate: dateColumnYmd(r.business_date) ?? '',
    status: r.status as FollowUpStatus, customerId: r.customer_id, customerName: r.customer_name,
    customerPhone: r.customer_phone ?? null, customerAppUserId: r.customer_app_user_id ?? null,
    serviceId: r.service_id ?? null, serviceName: r.service_name, ticketId: r.ticket_id,
    ticketNumber: r.ticket_number ?? null, ticketServiceLineId: r.line_id, appointmentId: r.appointment_id ?? null,
    technicianId: r.technician_id, technicianName: r.technician_name, completedAt: iso(r.completed_at),
    templateKey: r.template_key ?? null, suggestedMessage: r.suggested_message, sentMessage: r.sent_message ?? null,
    sentAt: iso(r.sent_at), skipReason: r.skip_reason ?? null, expiredAt: iso(r.expired_at), managerNote: r.manager_note ?? null,
  });

  async tasksForTechnician(tenantId: string, branchId: string, technicianId: string, opts: { businessDate?: string; status?: FollowUpStatus }): Promise<TaskRecord[]> {
    let q = this.baseSelect().where('f.tenant_id', '=', tenantId).where('f.branch_id', '=', branchId)
      .where('f.technician_id', '=', technicianId);
    if (opts.businessDate) q = q.where('f.business_date', '=', opts.businessDate);
    if (opts.status) q = q.where('f.status', '=', opts.status);
    const rows: any[] = await q.orderBy('f.completed_at', 'asc').orderBy('f.created_at', 'asc').execute();
    return rows.map(this.map);
  }

  async tasksForBranch(tenantId: string, branchId: string, opts: { businessDate?: string; technicianId?: string; status?: FollowUpStatus }): Promise<TaskRecord[]> {
    let q = this.baseSelect().where('f.tenant_id', '=', tenantId).where('f.branch_id', '=', branchId);
    if (opts.businessDate) q = q.where('f.business_date', '=', opts.businessDate);
    if (opts.technicianId) q = q.where('f.technician_id', '=', opts.technicianId);
    if (opts.status) q = q.where('f.status', '=', opts.status);
    const rows: any[] = await q.orderBy('f.technician_id', 'asc').orderBy('f.completed_at', 'asc').execute();
    return rows.map(this.map);
  }

  async tasksForCustomer(tenantId: string, customerId: string): Promise<TaskRecord[]> {
    // customers only ever see follow-ups that were actually sent to them.
    const rows: any[] = await this.baseSelect().where('f.tenant_id', '=', tenantId).where('f.customer_id', '=', customerId)
      .where('f.status', 'in', ['sent', 'customer_replied', 'rebooked'])
      .orderBy('f.sent_at', 'desc').execute();
    return rows.map(this.map);
  }

  async taskById(id: string): Promise<TaskRecord | null> {
    const r = (await sql<any>`select f.id, f.tenant_id, f.branch_id, f.business_date::text as business_date, f.status, f.customer_id, f.customer_name_snapshot as customer_name,
          f.customer_phone_snapshot as customer_phone, f.customer_app_user_id, f.service_id, f.service_name_snapshot as service_name, f.ticket_id,
          f.ticket_service_line_id as line_id, f.appointment_id, f.technician_id, f.technician_name_snapshot as technician_name, f.completed_at,
          f.message_template_key as template_key, f.suggested_message, f.sent_message, f.sent_at, f.skip_reason, f.expired_at, f.manager_note, t.ticket_number
        from service_follow_up_tasks f left join tickets t on t.id = f.ticket_id and t.tenant_id = f.tenant_id
       where f.id = ${id}::uuid and f.deleted_at is null`.execute(this.db)).rows[0];
    return r ? this.map(r) : null;
  }

  async claimSend(args: Parameters<typeof claimAndSendTask>[2]): Promise<ClaimResult> {
    return claimAndSendTask(this.db as unknown as AnyKysely<any>, this.outbox, args);
  }

  async submitForApproval(tenantId: string, id: string): Promise<boolean> {
    return !!(await transitionStatus(this.db as any, FOLLOW_UP_TASK, { where: { tenant_id: tenantId, id }, to: 'pending_manager_approval', set: { submitted_at: sql`now()`, manager_note: null, updated_at: sql`now()` } }));
  }

  async rejectTask(tenantId: string, id: string, userId: string, note: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const moved = await transitionStatus(trx as any, FOLLOW_UP_TASK, { where: { tenant_id: tenantId, id }, to: 'rejected', set: { rejected_at: sql`now()`, rejected_by_user_id: userId, manager_note: note, updated_at: sql`now()` } });
      const t = moved ? await this.taskCtx(trx, id) : undefined;
      if (t && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.FOLLOWUP_TASK_STATUS_CHANGED, tenantId: t.tenant_id, branchId: t.branch_id ?? undefined,
        aggregateType: 'followup_task', aggregateId: id, actorId: userId, actorType: 'user',
        payload: { taskId: id, technicianId: t.technician_id, customerId: t.customer_id, status: 'rejected', hasSkipReason: false },
      }));
      return !!moved;
    });
  }

  async markStatus(tenantId: string, id: string, status: FollowUpStatus, skipReason?: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await transitionStatus(trx as any, FOLLOW_UP_TASK, { where: { tenant_id: tenantId, id }, to: status as any, set: { skip_reason: skipReason ?? null, updated_at: sql`now()` } });
      const t = await this.taskCtx(trx, id);
      if (t && this.outbox) await this.outbox.write(trx, createDomainEvent({
        // a customer's reply is its own fact (declared, projected — and never produced until now): same fan-out plus the
        // customer's own room; every other transition stays task_status_changed
        eventType: status === 'customer_replied' ? DOMAIN_EVENTS.FOLLOWUP_CUSTOMER_REPLIED : DOMAIN_EVENTS.FOLLOWUP_TASK_STATUS_CHANGED, tenantId: t.tenant_id, branchId: t.branch_id ?? undefined,
        aggregateType: 'followup_task', aggregateId: id, actorType: 'user',
        payload: { taskId: id, technicianId: t.technician_id, customerId: t.customer_id, status, hasSkipReason: !!skipReason },
      }));
    });
  }

  async updateMessage(tenantId: string, id: string, message: string): Promise<void> {
    await sql`update service_follow_up_tasks set suggested_message = ${message}, updated_at = now() where tenant_id = ${tenantId}::uuid and id = ${id}::uuid`.execute(this.db);
  }

  async markCustomerViewed(tenantId: string, id: string): Promise<void> {
    await this.db.updateTable('service_follow_up_tasks').set({ customer_viewed_at: sql`now()`, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('id', '=', id).where('customer_viewed_at', 'is', null).execute();
  }


  async audit(entry: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; actionType: string; entityType?: string; entityId?: string; metadata?: any }): Promise<void> {
    await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${entry.tenantId}::uuid, ${entry.branchId || null}::uuid, ${entry.userId || null}::uuid, ${entry.role ?? null}, ${entry.actionType},
        ${entry.entityType ?? 'service_follow_up_task'}, ${entry.entityId ?? null}, ${JSON.stringify(entry.metadata ?? {})}::jsonb)`.execute(this.db);
  }
}
