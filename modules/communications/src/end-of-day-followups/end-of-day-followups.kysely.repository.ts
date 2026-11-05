/**
 * end-of-day-followups.kysely.repository.ts — Postgres implementation of the Daily Follow-Up Queue port.
 *
 * Generation reads COMPLETED service lines (ticket paid/completed/closed + line completed/done + has tech + has
 * customer + not removed) and produces ONE task per line, owned by the line's technician_id. The branch-local business
 * date is matched in JS via Intl (DST-correct) after bounding candidates to a UTC window, so we never depend on the
 * database's timezone functions. Dedup is enforced by the partial unique index (tenant, branch, line, tech).
 */
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  DailyFollowUpPort, CompletedLineRow, NewTaskRow, TaskRecord, ActiveBranch,
} from './end-of-day-followups.repository';
import type { FollowUpContext, FollowUpSettings, FollowUpStatus } from './end-of-day-followups.dto';
import { localDateInTz } from './end-of-day-followups.dto';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { canMoveToSql, transitionStatus } from '@aipowersalon/database';
import { FOLLOW_UP_TASK, FOLLOW_UP_GENERATION_RUN } from '../communications-lifecycles';

const DEFAULT_TZ = 'America/New_York';

function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export class KyselyDailyFollowUpRepository implements DailyFollowUpPort {
  // Constitution 8 §80: task changes commit with their domain event. Optional and null-safe; the service keeps
  // its in-process realtime path when no writer is wired.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  /** The task's tenant/branch/technician — the event needs them and the caller only has an id. */
  private async taskCtx(trx: any, id: string): Promise<{ tenant_id: string; branch_id: string | null; technician_id: string | null; customer_id: string | null } | undefined> {
    return trx.selectFrom('service_follow_up_tasks').select(['tenant_id', 'branch_id', 'technician_id', 'customer_id']).where('id', '=', id).executeTakeFirst();
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
    const r: any = await (this.db as any).selectFrom('branches').select('timezone')
      .where('tenant_id', '=', tenantId).where('id', '=', branchId).executeTakeFirst();
    return r?.timezone ?? null;
  }

  async settingsFor(tenantId: string, branchId: string): Promise<FollowUpSettings> {
    const row: any = await this.db.selectFrom('daily_follow_up_settings').selectAll()
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst();
    const tz = (row?.timezone || (await this.branchTimezone(tenantId, branchId)) || DEFAULT_TZ) as string;
    if (!row) {
      return {
        enabled: true, generationTime: '20:00', timezone: tz, allowTechEditMessage: true, allowCustomerReplies: true,
        requireManagerApproval: false, reminderToTech: true, createMode: 'end_of_day', autoExpirePendingHours: 24, defaultMessageTemplate: null,
      };
    }
    return {
      enabled: !!row.enabled, generationTime: row.generation_time || '20:00', timezone: tz,
      allowTechEditMessage: !!row.allow_tech_edit_message, allowCustomerReplies: !!row.allow_customer_replies,
      requireManagerApproval: !!row.require_manager_approval, reminderToTech: !!row.reminder_to_tech,
      createMode: (row.create_mode === 'after_checkout' ? 'after_checkout' : 'end_of_day'),
      autoExpirePendingHours: row.auto_expire_pending_hours ?? 24,
      defaultMessageTemplate: row.default_message_template ?? null,
    };
  }

  async saveSettings(ctx: FollowUpContext, patch: Partial<FollowUpSettings>): Promise<FollowUpSettings> {
    const cur = await this.settingsFor(ctx.tenantId, ctx.branchId);
    const next = { ...cur, ...patch };
    await this.db.insertInto('daily_follow_up_settings').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, enabled: next.enabled, generation_time: next.generationTime,
      timezone: patch.timezone !== undefined ? patch.timezone : (await this.rawTimezoneOverride(ctx.tenantId, ctx.branchId)),
      default_message_template: next.defaultMessageTemplate, allow_tech_edit_message: next.allowTechEditMessage,
      allow_customer_replies: next.allowCustomerReplies, require_manager_approval: next.requireManagerApproval,
      reminder_to_tech: next.reminderToTech, create_mode: next.createMode, auto_expire_pending_hours: next.autoExpirePendingHours, updated_by_user_id: ctx.userId,
    } as any).onConflict((oc) => oc.columns(['tenant_id', 'branch_id']).doUpdateSet({
      enabled: next.enabled, generation_time: next.generationTime,
      timezone: patch.timezone !== undefined ? (patch.timezone as any) : sql`daily_follow_up_settings.timezone`,
      default_message_template: next.defaultMessageTemplate, allow_tech_edit_message: next.allowTechEditMessage,
      allow_customer_replies: next.allowCustomerReplies, require_manager_approval: next.requireManagerApproval,
      reminder_to_tech: next.reminderToTech, create_mode: next.createMode, auto_expire_pending_hours: next.autoExpirePendingHours, updated_by_user_id: ctx.userId,
      updated_at: sql`now()`,
    } as any)).execute();
    return this.settingsFor(ctx.tenantId, ctx.branchId);
  }

  private async rawTimezoneOverride(tenantId: string, branchId: string): Promise<string | null> {
    const r: any = await this.db.selectFrom('daily_follow_up_settings').select('timezone')
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst();
    return r?.timezone ?? null;
  }

  async activeBranches(): Promise<ActiveBranch[]> {
    // Constitution 7 §19: a suspended / closed salon sends no scheduled follow-ups (its branches stay 'active' rows)
    const rows: any[] = await this.db.selectFrom('branches as b').innerJoin('tenants as t', 't.id', 'b.tenant_id')
      .select(['b.id as id', 'b.tenant_id as tenant_id']).where('b.status', '=', 'active').where('t.status', '=', 'active').execute();
    return rows.map((r) => ({ tenantId: r.tenant_id, branchId: r.id }));
  }

  async resolveTechnicianId(ctx: FollowUpContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r: any = await this.db.selectFrom('technicians').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true)
      .executeTakeFirst();
    return r?.id ?? null;
  }

  async resolveCustomerRecordId(ctx: FollowUpContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r: any = await this.db.selectFrom('customers').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).executeTakeFirst();
    return r?.id ?? null;
  }

  async runExists(tenantId: string, branchId: string, businessDate: string): Promise<boolean> {
    const r: any = await this.db.selectFrom('daily_follow_up_generation_runs').select('id')
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).where('business_date', '=', businessDate)
      .where('run_status', '=', 'completed').executeTakeFirst();
    return !!r;
  }

  async recordRun(run: { tenantId: string; branchId: string; businessDate: string; runStatus: 'completed' | 'failed'; triggerSource: 'scheduler' | 'manual'; createdCount: number; skippedCount: number; errorMessage?: string | null }): Promise<void> {
    await this.db.insertInto('daily_follow_up_generation_runs').values({
      tenant_id: run.tenantId, branch_id: run.branchId, business_date: run.businessDate, run_status: run.runStatus,
      trigger_source: run.triggerSource, finished_at: sql`now()`, created_count: run.createdCount,
      skipped_count: run.skippedCount, error_message: run.errorMessage ?? null,
    } as any).onConflict((oc) => oc.columns(['tenant_id', 'branch_id', 'business_date']).doUpdateSet({
      run_status: run.runStatus, trigger_source: run.triggerSource, finished_at: sql`now()`,
      created_count: sql`daily_follow_up_generation_runs.created_count + ${run.createdCount}`,
      skipped_count: run.skippedCount, error_message: run.errorMessage ?? null, updated_at: sql`now()`,
    } as any).where(canMoveToSql(FOLLOW_UP_GENERATION_RUN, run.runStatus, 'daily_follow_up_generation_runs') as any)).execute();
  }

  async completedServiceLines(tenantId: string, branchId: string, tz: string, businessDate: string): Promise<CompletedLineRow[]> {
    const startIso = `${addDaysIso(businessDate, -1)}T00:00:00.000Z`;
    const endIso = `${addDaysIso(businessDate, 2)}T00:00:00.000Z`;
    const rows: any[] = await this.db.selectFrom('ticket_service_lines as tsl')
      .innerJoin('tickets as t', (j) => j.onRef('t.id', '=', 'tsl.ticket_id').onRef('t.tenant_id', '=', 'tsl.tenant_id'))
      .leftJoin('customers as c', 'c.id', 't.customer_id')
      .leftJoin('technicians as tech', 'tech.id', 'tsl.technician_id')
      .select([
        'tsl.id as lineId', 'tsl.ticket_id as ticketId', 'tsl.service_id as serviceId',
        'tsl.service_name_snapshot as serviceName', 'tsl.technician_id as technicianId',
        't.ticket_number as ticketNumber', 't.customer_id as customerId',
        'c.full_name as customerFullName', 'c.first_name as customerFirst', 'c.last_name as customerLast',
        'c.normalized_phone as phoneNorm', 'c.phone_display as phoneDisplay', 'c.user_id as customerUserId',
        'tech.full_name as techName',
        sql<any>`COALESCE(tsl.completed_at, t.paid_at, t.service_done_at)`.as('completedResolved'),
      ])
      .where('tsl.tenant_id', '=', tenantId)
      .where('tsl.branch_id', '=', branchId)
      .where('t.status', 'in', ['paid', 'completed', 'closed'])
      .where('tsl.status', 'in', ['completed', 'done'])
      .where('tsl.technician_id', 'is not', null)
      .where('t.customer_id', 'is not', null)
      .where('tsl.removed_at', 'is', null)
      .where(sql<boolean>`COALESCE(tsl.completed_at, t.paid_at, t.service_done_at) >= ${startIso}::timestamptz`)
      .where(sql<boolean>`COALESCE(tsl.completed_at, t.paid_at, t.service_done_at) < ${endIso}::timestamptz`)
      .execute();
    const out: CompletedLineRow[] = [];
    for (const r of rows) {
      const completedAt = iso(r.completedResolved);
      // exact branch-local business-date match (DST-correct, no DB tz dependency)
      if (!completedAt || localDateInTz(new Date(completedAt), tz) !== businessDate) continue;
      out.push({
        ticketId: r.ticketId, ticketNumber: r.ticketNumber ?? null, ticketServiceLineId: r.lineId,
        serviceId: r.serviceId ?? null, serviceName: r.serviceName || 'Service', technicianId: r.technicianId,
        technicianName: r.techName || 'Your technician', customerId: r.customerId,
        customerName: (r.customerFullName || `${r.customerFirst ?? ''} ${r.customerLast ?? ''}`).trim() || 'Customer',
        customerPhone: r.phoneDisplay || r.phoneNorm || null, customerAppUserId: r.customerUserId ?? null,
        completedAt,
      });
    }
    return out;
  }

  async insertTasksIgnoreConflict(rows: NewTaskRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    // §18/§80: the nightly queue and followup.tasks_generated commit together. ONE event per (tenant, branch,
    // business date) — "the queue was generated" is a single fact, not N task facts; the per-task events are
    // task_sent / task_status_changed, which happen when a human acts. onConflict doNothing means a re-run
    // inserts nothing and therefore emits nothing (§3: no rows, no fact) — which is what makes the nightly
    // scheduler safe to retry.
    return this.db.transaction().execute(async (trx) => {
      const res = await trx.insertInto('service_follow_up_tasks').values(rows.map((r) => ({
        tenant_id: r.tenantId, branch_id: r.branchId, business_date: r.businessDate, customer_id: r.customerId,
        technician_id: r.technicianId, ticket_id: r.ticketId, ticket_service_line_id: r.ticketServiceLineId,
        service_id: r.serviceId, service_name_snapshot: r.serviceName, customer_name_snapshot: r.customerName,
        customer_phone_snapshot: r.customerPhone, technician_name_snapshot: r.technicianName,
        customer_app_user_id: r.customerAppUserId, completed_at: r.completedAt, status: 'pending',
        message_template_key: r.templateKey, suggested_message: r.suggestedMessage,
      })) as any).onConflict((oc) => oc.doNothing()).returning('id').execute();
      if (res.length > 0 && this.outbox) {
        const first = rows[0];
        await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.FOLLOWUP_TASKS_GENERATED, tenantId: first.tenantId, branchId: first.branchId ?? undefined,
          aggregateType: 'followup_queue', aggregateId: `${first.branchId}:${first.businessDate}`, actorType: 'worker',
          // §95: counts and technician ids — never the customer name/phone snapshots these rows carry
          payload: { businessDate: first.businessDate, count: res.length, technicianIds: [...new Set(rows.map((r) => r.technicianId).filter(Boolean))] },
        }));
      }
      return res.length;
    });
  }

  async notifyTechnicians(tenantId: string, technicianIds: string[], businessDate: string): Promise<void> {
    if (technicianIds.length === 0) return;
    await this.db.insertInto('technician_notifications').values(technicianIds.map((tid) => ({
      tenant_id: tenantId, technician_id: tid, type: 'daily_followup_ready',
      title: 'Your daily follow-up list is ready', body: 'Tap to review today\'s clients and send follow-ups.',
      reference: businessDate,
    })) as any).execute();
  }

  async expireStalePending(tenantId: string, branchId: string, cutoffIso: string): Promise<number> {
    // Soft-delete: status -> 'expired' + deleted_at set, so the row drops out of every queue (all filter
    // deleted_at IS NULL) and frees the partial unique index, while staying on record for audit/reporting.
    const res = await this.db.updateTable('service_follow_up_tasks').set({ status: 'expired', deleted_at: sql`now()`, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId)
      .where('status', '=', 'pending').where(canMoveToSql(FOLLOW_UP_TASK, 'expired') as any).where('deleted_at', 'is', null)
      .where(sql<boolean>`created_at < ${cutoffIso}::timestamptz`)
      .returning('id').execute();
    return res.length;
  }

  async purgeExpired(cutoffIso: string): Promise<number> {
    // Stage-2: hard-delete rows that were soft-deleted (expired) before the retention cutoff. The audit_logs entries
    // written across the task lifecycle are independent and are NOT removed here.
    const res = await this.db.deleteFrom('service_follow_up_tasks')
      .where('deleted_at', 'is not', null)
      .where(sql<boolean>`deleted_at < ${cutoffIso}::timestamptz`)
      .returning('id').execute();
    return res.length;
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
        't.ticket_number as ticket_number',
      ]);
  }

  private map = (r: any): TaskRecord => ({
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, businessDate: String(r.business_date).slice(0, 10),
    status: r.status as FollowUpStatus, customerId: r.customer_id, customerName: r.customer_name,
    customerPhone: r.customer_phone ?? null, customerAppUserId: r.customer_app_user_id ?? null,
    serviceId: r.service_id ?? null, serviceName: r.service_name, ticketId: r.ticket_id,
    ticketNumber: r.ticket_number ?? null, ticketServiceLineId: r.line_id, appointmentId: r.appointment_id ?? null,
    technicianId: r.technician_id, technicianName: r.technician_name, completedAt: iso(r.completed_at),
    templateKey: r.template_key ?? null, suggestedMessage: r.suggested_message, sentMessage: r.sent_message ?? null,
    sentAt: iso(r.sent_at), skipReason: r.skip_reason ?? null,
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
    const r: any = await this.baseSelect().where('f.id', '=', id).executeTakeFirst();
    return r ? this.map(r) : null;
  }

  async markSent(tenantId: string, id: string, message: string, sentByUserId: string, notificationId: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await transitionStatus(trx as any, FOLLOW_UP_TASK, { where: { tenant_id: tenantId, id }, to: 'sent', set: {
        sent_message: message, sent_by_user_id: sentByUserId, sent_at: sql`now()`, customer_app_notification_id: notificationId, updated_at: sql`now()`,
      } });
      const t = await this.taskCtx(trx, id);
      if (t && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.FOLLOWUP_TASK_SENT, tenantId: t.tenant_id, branchId: t.branch_id ?? undefined,
        aggregateType: 'followup_task', aggregateId: id, actorId: sentByUserId, actorType: 'user',
        // §95: the message the technician sent stays in the row — the event says only that one was sent
        payload: { taskId: id, technicianId: t.technician_id, customerId: t.customer_id, status: 'sent', hasNotification: !!notificationId },
      }));
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
    await this.db.updateTable('service_follow_up_tasks').set({ suggested_message: message, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('id', '=', id).execute();
  }

  async markCustomerViewed(tenantId: string, id: string): Promise<void> {
    await this.db.updateTable('service_follow_up_tasks').set({ customer_viewed_at: sql`now()`, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('id', '=', id).where('customer_viewed_at', 'is', null).execute();
  }

  async createCustomerNotification(tenantId: string, customerId: string, title: string, body: string, reference: string): Promise<string> {
    const r: any = await this.db.insertInto('customer_notifications').values({
      tenant_id: tenantId, customer_id: customerId, type: 'service_follow_up', title, body, reference,
    } as any).returning('id').executeTakeFirst();
    return r?.id;
  }

  async audit(entry: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; actionType: string; entityType?: string; entityId?: string; metadata?: any }): Promise<void> {
    await this.db.insertInto('audit_logs' as any).values({
      tenant_id: entry.tenantId, branch_id: entry.branchId ?? null, user_id: entry.userId ?? null,
      role: entry.role ?? null, action_type: entry.actionType, entity_type: entry.entityType ?? 'service_follow_up_task',
      entity_id: entry.entityId ?? null, metadata_json: JSON.stringify(entry.metadata ?? {}),
    } as any).execute();
  }
}
