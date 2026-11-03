/**
 * tech.kysely.repository.ts — Postgres (Kysely) TechDataPort.
 *
 * ⚠️ STATUS: type-checked against the schema, but NOT run against a live database in this environment. It is staged for
 * validation per INTEGRATION_RUNBOOK §8. It queries the REAL tables (technicians, pos_tech_queue_tickets,
 * pos_tech_appointments, ticket_service_lines, technician_statuses) and does NOT fabricate data — where the schema
 * genuinely lacks a field (per-technician tips, a sales-trend baseline, a clean service name), it returns 0/'' and the
 * gap is commented rather than invented. Several mappings (the status vocabularies; whether the tech "ticket" is the
 * pos_tech_queue_tickets row; whether accept/start/complete should also advance the POS ticket + serving timers) MUST be
 * reconciled against the live data before trusting this adapter.
 */
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import type { Kysely } from 'kysely';
import { readAppFlag } from '@aipowersalon/customers';
import { sql } from 'kysely';
import { TechError } from './tech-errors';
import { nextTicketNumber } from '../queue/ticket-number';
import { ensureVisitTicket } from '../queue/visit-ticket';
import { completeServiceDone, ServiceDoneTransitionError } from '../service-done/service-done-transition';
import { branchTimeZone, assertTransition, canMoveToSql, type DB } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { SKILL_CHANGE_REQUEST, MANAGER_MESSAGE, QUEUE_SERVICE_ASSIGNMENT } from '../queue-lifecycles';
import { businessDate, dayStartMs } from '@aipowersalon/date-time';
import type { TechnicianStatus, TechMe, TechNextAppointment, TechScheduleItem, LineSnapshot } from './tech-dashboard.dto';
import type { CurrentServiceInput } from './tech-dashboard.core';
import { TECH_BRANCH_QUEUE_WINDOW, type TechSharedVisit } from '@aipowersalon/api-contracts/tenant';
import type {
  TechContext, TechDataPort, TechTicketView, TechAssignSource, TechAssignmentSignals, TechTicketStatus, TechDashboardRaw, ServiceDoneBody,
  TechTicketServiceLine, TechTicketListItem, TechQueueState, TechQueueCustomer, TechQueueEntry, TechMoreState, NoteBody, CancelRequestBody, DeclineBody,
  TechAuditAction, AuditMeta, TechSkills, TechWorkingHoursDay, RequestableService, SkillChangeRequest, SkillChangeBody,
  PendingSkillChangeRequest, SkillChangeType, SkillChangeStatus, TechPayrollView, TechPayrollPeriod, TechManagerMessage
} from './tech.repository';
import { deriveAssignmentReason, toStringArray, canReviewSkillRequest } from './tech.repository';
import { buildMediaUrl } from '@aipowersalon/media';
import { grantEligibility, revokeEligibility, normalizeProficiency, turnDecline, turnServiceStart } from '@aipowersalon/workforce';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const SERVING = ['serving', 'in_service'];

// RECONCILE: map stored status strings → the TechTicketStatus union. Fallback is conservative.
function asTechTicketStatus(s: string | null): TechTicketStatus {
  const v = (s || '').toLowerCase();
  if (v === 'in_service') return 'serving';
  if (v === 'declined') return 'cancelled';
  if (v === 'completed' || v === 'service_done') return 'done';
  if (['assigned', 'accepted', 'serving', 'nearly_finished', 'paused', 'done', 'cancelled'].includes(v)) return v as TechTicketStatus;
  return 'assigned';
}
function asTechnicianStatus(s: string | null): TechnicianStatus {
  const v = (s || '').toLowerCase();
  if (['available', 'assigned', 'in_service', 'on_break', 'lunch', 'off_shift'].includes(v)) return v as TechnicianStatus;
  if (v === 'serving') return 'in_service';
  if (v === 'break') return 'on_break';
  return 'off_shift';
}
function maskPhone(p: string | null): string | null {
  const digits = (p || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return '•••-•••-' + digits.slice(-4); // privacy: technician sees only the last 4
}
function shortTicketNo(ticketId: string | null, fallbackId: string): string { const base = ticketId || fallbackId; return '#' + base.replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase(); }
function initialsOf(name: string | null): string { return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?'; }
function fmtClockTime(t: string | null): string { if (!t) return ''; const [hh, mm] = String(t).split(':'); let h = Number(hh); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${mm} ${ap}`; }
function firstServiceName(json: unknown): string {
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (Array.isArray(arr) && arr.length) {
      return arr.map((f: any) => typeof f === 'string' ? f : (f?.name || f?.serviceName || '')).filter(Boolean).join(', ');
    }
  } catch { /* ignore */ }
  return '';
}
/**
 * One requested service's price and minutes as the queue keeps them (Oct 6 2026). The queue writes a line's minutes as
 * `estimatedDurationMinutes` and a front-desk price change as `priceOverrideCents`; this read `durationMinutes` and the
 * list price only, so an offer built from the queue showed 0 minutes and the list price until it had a ticket. Older
 * rows (`durationMinutes` / `duration`, `price` / `price_cents`) still read.
 */
export function requestedLine(s: any): { priceCents: number; durationMinutes: number } {
  const price = s?.priceOverrideCents ?? s?.priceCents ?? s?.price ?? s?.price_cents;
  const minutes = s?.estimatedDurationMinutes ?? s?.durationMinutes ?? s?.duration;
  return { priceCents: Number(price) || 0, durationMinutes: Number(minutes) || 0 };
}
function servicesTotalCents(json: unknown): number {
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (Array.isArray(arr) && arr.length) {
      return arr.reduce((acc: number, item: any) => {
        if (!item) return acc;
        return acc + requestedLine(item).priceCents;
      }, 0);
    }
  } catch { /* ignore */ }
  return 0;
}
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));

export class KyselyTechRepository implements TechDataPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /**
   * The technician's "today" — the BRANCH's day (Oct 6 2026). It was the server's UTC day, so after 8 pm in New York
   * the Tech App showed tomorrow's (empty) schedule and zeroed today's earnings and counts.
   */
  private async today(ctx: TechContext, nowMs: number): Promise<{ date: string; startIso: string }> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId); const now = new Date(nowMs);
    return { date: businessDate(tz, now), startIso: new Date(dayStartMs(tz, now)).toISOString() };
  }
  /** Will a pause/resume reach the boards through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  private async offerFact(trx: any, ctx: TechContext, type: string, row: any, extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.outbox || !row?.id) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: (row.branch_id as string) ?? (ctx as any).branchId ?? undefined,
      aggregateType: 'tech_queue_ticket', aggregateId: String(row.id), actorId: ctx.userId || undefined, actorType: 'user', correlationId: row.ticket_id ? `ticket:${row.ticket_id}` : undefined,
      payload: { techQueueTicketId: String(row.id), ticketId: row.ticket_id ?? null, technicianId: row.assigned_technician_id ?? null, ...extra } }));
  }
  private async pauseFact(trx: any, ctx: TechContext, type: string, ticketId: string, technicianId: string | null): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: (ctx as any).branchId || undefined, aggregateType: 'ticket', aggregateId: ticketId,
      actorId: ctx.userId || undefined, actorType: 'user', correlationId: `ticket:${ticketId}`, payload: { ticketId, technicianId, source: 'tech_app' } }));
  }

  async technicianAppEnabled(ctx: TechContext): Promise<boolean> {
    return readAppFlag(this.db, ctx.tenantId, 'technician_app');
  }

  /** technician_app_settings.app_enabled for ONE technician (Oct 12 2026 merge, P0 #3). No row = enabled (column default).
   *  A read error is NOT treated as enabled — the switch is a manager's access decision, so a failure to read it denies. */
  async technicianAppAccessEnabled(ctx: TechContext, technicianId: string): Promise<boolean> {
    const row: any = await this.db.selectFrom('technician_app_settings').select(['app_enabled'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).executeTakeFirst();
    return row ? row.app_enabled !== false : true;
  }

  async listNotifications(ctx: TechContext, technicianId: string, limit = 50) {
    const rows: any[] = await this.db.selectFrom('technician_notifications')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .select(['id', 'type', 'title', 'body', 'reference', 'read_at', 'created_at'])
      .orderBy('created_at', 'desc').limit(limit).execute().catch(() => []);
    return rows.map((r) => ({ id: String(r.id), type: String(r.type), title: String(r.title), body: r.body, reference: r.reference, readAt: r.read_at ? new Date(r.read_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() }));
  }

  async markNotificationsRead(ctx: TechContext, technicianId: string, ids: string[] | 'all') {
    let q: any = this.db.updateTable('technician_notifications').set({ read_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('read_at', 'is', null);
    if (ids !== 'all') { if (!ids.length) return 0; q = q.where('id', 'in', ids); }
    const res: any = await q.executeTakeFirst().catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0);
  }

  async resolveTechnicianId(ctx: TechContext): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const row = await this.db.selectFrom('technicians').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  // The technician's own payroll: their lines joined to the periods, newest first, with a paid/unpaid/total roll-up.
  // Reads payroll_lines + payroll_periods directly (the tables the owner/manager Payroll screen produces) — no recompute.
  // ONLY finalized + paid periods are shown: a `draft` period's lines are still editable by the owner (provisional), so
  // the technician must never see draft numbers as money owed. Unpaid = finalized (owed, not yet paid); Paid = paid.
  async myPayroll(ctx: TechContext, technicianId: string): Promise<TechPayrollView> {
    // Postgres returns DATE columns as JS Date objects; normalize period_start/end to a plain YYYY-MM-DD string.
    const isoDate = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
    const isoTs = (v: unknown): string | null => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
    const rows: any[] = await this.db.selectFrom('payroll_lines as l')
      .innerJoin('payroll_periods as p', 'p.id', 'l.period_id')
      .where('l.tenant_id', '=', ctx.tenantId).where('l.technician_id', '=', technicianId)
      .where('p.status', 'in', ['finalized', 'paid'])
      .select([
        'p.id as period_id', 'p.label as label', 'p.period_start as period_start', 'p.period_end as period_end',
        'p.status as status', 'p.paid_at as paid_at',
        'l.services_count as services_count', 'l.gross_sales_cents as gross_sales_cents', 'l.commission_cents as commission_cents',
        'l.tips_cents as tips_cents', 'l.adjustment_cents as adjustment_cents', 'l.payable_cents as payable_cents',
      ])
      .orderBy('p.period_start', 'desc').execute().catch(() => []);
    const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    const periods: TechPayrollPeriod[] = rows.map((r) => ({
      periodId: String(r.period_id), label: r.label ?? null, periodStart: isoDate(r.period_start), periodEnd: isoDate(r.period_end),
      status: (r.status === 'paid' || r.status === 'finalized') ? r.status : 'draft',
      paidAt: isoTs(r.paid_at),
      servicesCount: n(r.services_count), grossCents: n(r.gross_sales_cents), commissionCents: n(r.commission_cents),
      tipsCents: n(r.tips_cents), adjustmentCents: n(r.adjustment_cents), payableCents: n(r.payable_cents),
    }));
    let paidCents = 0, unpaidCents = 0;
    for (const p of periods) { if (p.status === 'paid') paidCents += p.payableCents; else unpaidCents += p.payableCents; }
    return { paidCents, unpaidCents, totalCents: paidCents + unpaidCents, periods };
  }

  async todaySchedule(ctx: TechContext, technicianId: string, nowMs: number = Date.now(), dateStr?: string): Promise<TechScheduleItem[]> {
    if (!ctx.tenantId) return [];
    const rows = await this.db.selectFrom('pos_tech_appointments')
      .select(['id', 'customer_name', 'services', 'start_time', 'status', 'duration_minutes', 'is_vip', 'inspiration_photo_id'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .where('appt_date', '=', dateStr || (await this.today(ctx, nowMs)).date)
      .orderBy('start_time', 'asc').execute();
    // Resolve "Book This Look" inspiration thumbnails (P3) for the appointments that carry one.
    const photoIds = [...new Set(rows.map((a) => a.inspiration_photo_id).filter(Boolean))] as string[];
    const photoMap: Record<string, string> = {};
    if (photoIds.length) {
      const photos = await this.db.selectFrom('tech_portfolio_photos').select(['id', 'thumbnail_url', 'image_url']).where('id', 'in', photoIds).execute().catch(() => []);
      for (const p of photos) photoMap[p.id] = p.thumbnail_url || p.image_url || '';
    }
    return rows.map((a) => ({
      appointmentId: a.id,
      customerName: a.customer_name ?? '',
      customerInitials: (a.customer_name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]!.toUpperCase()).join('') || '?',
      serviceName: firstServiceName(a.services),
      startTime: iso(a.start_time),
      status: a.status ?? 'booked',
      durationMinutes: Number(a.duration_minutes) || 0,
      vip: !!a.is_vip,
      inspirationPhotoUrl: a.inspiration_photo_id ? (photoMap[a.inspiration_photo_id] || null) : null,
    }));
  }

  /** Service History (mobile ecosystem Tech pass, Jul 29 2026): this technician's PAID service lines, newest first,
   *  with the guest and the ticket's satisfaction rating (109 — nullable until someone rates; shown honestly as
   *  unrated, never fabricated). `service` filters by the line's name snapshot; the distinct-name list feeds the
   *  screen's All-Services filter. */
  async serviceHistory(ctx: TechContext, technicianId: string, service?: string, limit = 60): Promise<{ items: { ticketId: string; serviceName: string; customerName: string; completedAt: string | null; rating: number | null; lineTotalCents: number }[]; services: string[] }> {
    if (!ctx.tenantId) return { items: [], services: [] };
    let q = this.db.selectFrom('ticket_service_lines as l')
      .innerJoin('tickets as tk', 'tk.id', 'l.ticket_id')
      .leftJoin('customers as c', 'c.id', 'tk.customer_id')
      .select(['tk.id as ticket_id', 'l.service_name_snapshot as service_name', 'c.first_name as first_name', 'c.last_name as last_name', 'tk.paid_at as completed_at', 'tk.satisfaction_rating as rating', 'l.line_total_cents as line_total_cents'])
      .where('l.tenant_id', '=', ctx.tenantId).where('tk.tenant_id', '=', ctx.tenantId)
      // a removed line or ticket is not a service she performed; a closed ticket is paid (both were wrong here)
      .where('l.technician_id', '=', technicianId).where('tk.status', 'in', ['paid', 'closed']).where('l.removed_at', 'is', null).where('tk.removed_at', 'is', null);
    if (service) q = q.where('l.service_name_snapshot', '=', service);
    // a failed read is an error, not "no history" (it used to answer an empty list)
    const rows = await q.orderBy('tk.paid_at', 'desc').limit(Math.min(200, Math.max(1, limit))).execute();
    const names = await this.db.selectFrom('ticket_service_lines').select('service_name_snapshot').distinct()
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('removed_at', 'is', null).execute();
    return {
      items: rows.map((r) => ({
        ticketId: r.ticket_id,
        serviceName: r.service_name ?? '',
        customerName: [r.first_name, r.last_name ? String(r.last_name).slice(0, 1) + '.' : ''].filter(Boolean).join(' ') || 'Walk-in guest',
        completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
        rating: r.rating == null ? null : Number(r.rating),
        lineTotalCents: Number(r.line_total_cents) || 0,
      })),
      services: names.map((n) => n.service_name_snapshot).filter(Boolean).sort(),
    };
  }

  // Per-technician tips over [fromIso,toIso): the ONE tip reader (Oct 12 2026 merge) — ticket_tip_allocations, written by
  // the compensation engine on payment (compensation.kysely.ports.ts) or by the manual allocation endpoint. The old
  // "proportional by revenue" fallback produced a SECOND answer that disagreed with the owner / payroll figures; a paid
  // ticket with no allocation row is a snapshot gap to repair, not something to re-estimate here.
  async getTicket(ctx: TechContext, ticketId: string): Promise<TechTicketView | null> {
    const row = await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['id', 'ticket_id', 'assigned_technician_id', 'status', 'customer_name', 'customer_phone', 'requested_services', 'notes', 'accepted_at', 'started_at', 'assigned_at', 'acceptance_deadline', 'version', 'is_vip', 'customer_id', 'appointment_id', 'source', 'queue_item_id', 'visit_part'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    if (!row) return null;
    // multi-technician routing: a PART of a split visit shows only its own lines ("my lines") and who has the rest
    const part = row.visit_part != null && !!row.queue_item_id;
    const partTech = part ? (row.assigned_technician_id ?? null) : null;
    const qid = row.queue_item_id ?? null;
    const asg = qid ? (await this.assignmentSignals(ctx, [qid])).get(String(qid)) : undefined;   // round 2: how the guest came to this technician
    const status = asTechTicketStatus(row.status);
    let services: TechTicketServiceLine[] = []; let totalCents = 0; let durationMinutes = 0; let lastCompletedAt: Date | null = null;
    if (row.ticket_id) {
      let lq = this.db.selectFrom('ticket_service_lines')
        .select(['id', 'service_id', 'service_name_snapshot', 'price_cents_snapshot', 'duration_minutes_snapshot', 'line_total_cents', 'status', 'completed_at'])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', row.ticket_id).where('removed_at', 'is', null);
      if (partTech) lq = lq.where('technician_id', '=', partTech);
      const lines = await lq.orderBy('created_at', 'asc').execute();
      services = lines.map((l: any) => ({ id: l.id, serviceId: l.service_id ?? null, name: l.service_name_snapshot, priceCents: Number(l.line_total_cents || l.price_cents_snapshot || 0), durationMinutes: Number(l.duration_minutes_snapshot || 0), status: (l.status || 'pending') }));
      totalCents = services.reduce((a, s) => a + s.priceCents, 0);
      durationMinutes = services.reduce((a, s) => a + s.durationMinutes, 0);
      for (const l of lines) if (l.completed_at && (!lastCompletedAt || new Date(l.completed_at) > lastCompletedAt)) lastCompletedAt = new Date(l.completed_at);
    } else if (row.requested_services) {
      try {
        const raw = typeof row.requested_services === 'string' ? JSON.parse(row.requested_services) : row.requested_services;
        if (Array.isArray(raw)) {
          services = raw.map((s: any, idx) => ({ id: `line_${row.id}_${idx}`, serviceId: s.serviceId ?? null, name: s.serviceName || s.name || 'Service', ...requestedLine(s), status: 'pending' as const }));
          totalCents = services.reduce((a, s) => a + s.priceCents, 0);
          durationMinutes = services.reduce((a, s) => a + s.durationMinutes, 0);
        }
      } catch { /* parse fallback */ }
    }
    const allComplete = !!row.ticket_id && (await this.allLinesComplete(ctx, row.ticket_id, partTech));
    const sharedVisit = part ? await this.sharedVisit(ctx, String(row.queue_item_id), String(row.id), Number(row.visit_part)) : null;
    const effectiveStatus: TechTicketStatus = allComplete ? 'done' : status;
    const startBase = row.assigned_at ? new Date(row.assigned_at) : null;
    const scheduledEnd = (startBase && durationMinutes > 0) ? new Date(startBase.getTime() + durationMinutes * 60000) : null;
    let preferredTechId: string | null = null;
    let allergies: string[] | null = null;
    let safetyNotes: string | null = null;
    if (row.customer_id) {
      const c = await this.db.selectFrom('customers').select(['preferred_technician_id', 'allergies', 'safety_notes'])
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.customer_id).executeTakeFirst();
      preferredTechId = c?.preferred_technician_id ?? null;
      allergies = toStringArray(c?.allergies);
      safetyNotes = (c?.safety_notes ?? null) || null;
    }
    let requestedTechnician: string | null = null;
    if (preferredTechId) {
      const pt = await this.db.selectFrom('technicians').select(['full_name'])
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', preferredTechId).executeTakeFirst();
      requestedTechnician = pt?.full_name ?? null;
    }
    const assignmentReason = deriveAssignmentReason({ preferredTechId, assignedTechId: row.assigned_technician_id, appointmentId: row.appointment_id, source: row.source });
    return {
      ticketId: row.id, realTicketId: row.ticket_id ?? null, technicianId: row.assigned_technician_id ?? null, status: effectiveStatus,
      queueItemId: qid, ...(asg?.assignSource ? { assignSource: asg.assignSource } : {}), lock: asg?.lock ?? null,
      lockedToYou: !!asg?.lock && !!row.assigned_technician_id && asg.lock.technicianId === row.assigned_technician_id,   // the caller is the assignee (ownedTicket)
      ticketNumber: shortTicketNo(row.ticket_id, row.id), customerName: row.customer_name ?? null, customerPhoneMasked: maskPhone(row.customer_phone),
      services, notes: row.notes ?? null, totalCents, durationMinutes,
      scheduledStart: startBase ? startBase.toISOString() : null, scheduledEnd: scheduledEnd ? scheduledEnd.toISOString() : null,
      acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
      acceptanceDeadline: row.acceptance_deadline && effectiveStatus === 'assigned' ? new Date(row.acceptance_deadline).toISOString() : null,
      version: Number(row.version ?? 0),
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
      startSource: (row as any).start_source || undefined,
      completedAt: effectiveStatus === 'done' ? (lastCompletedAt ? lastCompletedAt.toISOString() : null) : null,
      vip: !!row.is_vip, requestedTechnician, assignmentReason,
      loyaltyTier: null, allergies, safetyNotes, inspoUrl: null,
      ...(part ? { sharedVisit } : {}),
    };
  }

  /** "my lines" for a part of a split visit (technician), else every line of the ticket. */
  private async allLinesComplete(ctx: TechContext, ticketId: string, technicianId: string | null = null): Promise<boolean> {
    let q = this.db.selectFrom('ticket_service_lines').select(['completed_at']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId);
    if (technicianId) q = q.where('technician_id', '=', technicianId);
    const rows = await q.execute();
    return rows.length > 0 && rows.every((r) => !!r.completed_at);
  }
  /** The other parts of a split visit, as this technician sees them (names, services, status — never the price). */
  private async sharedVisit(ctx: TechContext, queueItemId: string, selfId: string, visitPart: number): Promise<TechSharedVisit> {
    const parts: any[] = await this.db.selectFrom('pos_tech_queue_tickets as p').leftJoin('technicians as t', (j: any) => j.onRef('t.id', '=', 'p.assigned_technician_id').on('t.tenant_id', '=', ctx.tenantId))
      .select(['p.id', 'p.visit_part', 'p.status', 'p.requested_services', 't.full_name']).where('p.tenant_id', '=', ctx.tenantId).where('p.queue_item_id', '=', queueItemId)
      .where('p.visit_part', 'is not', null).orderBy('p.visit_part', 'asc').execute();
    const names = (v: any) => { try { const raw = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(raw) ? raw.map((x: any) => String(x.serviceName || x.name || 'Service')) : []; } catch { return []; } };
    return { visitPart, partCount: parts.length, others: parts.filter((p) => String(p.id) !== selfId).map((p) => ({ technicianName: p.full_name ?? null, serviceNames: names(p.requested_services), status: String(p.status) })) };
  }

  async listTickets(ctx: TechContext, technicianId: string): Promise<TechTicketListItem[]> {
    const rows = await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['id', 'ticket_id', 'customer_name', 'requested_services', 'status', 'started_at', 'assigned_at', 'acceptance_deadline', 'version', 'is_vip'])
      .where('tenant_id', '=', ctx.tenantId).where('assigned_technician_id', '=', technicianId)
      .where('status', 'in', ['assigned', 'accepted', 'serving', 'in_service', 'nearly_finished', 'paused', 'done'])
      .orderBy('assigned_at', 'desc').execute();
    // one grouped sum keyed by ticket_id (avoids N+1)
    const ticketIds = rows.map((r) => r.ticket_id).filter((x): x is string => !!x);
    const totals = new Map<string, number>();
    if (ticketIds.length) {
      const sums = await this.db.selectFrom('ticket_service_lines')
        .select(['ticket_id', sql<string>`coalesce(sum(coalesce(nullif(line_total_cents, 0), price_cents_snapshot, 0)), 0)`.as('s')])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', 'in', ticketIds).groupBy('ticket_id').execute();
      for (const r of sums) totals.set(r.ticket_id, Number(r.s) || 0);
    }
    return rows.map((r) => {
      const dbTotal = r.ticket_id ? totals.get(r.ticket_id) : undefined;
      const totalCents = (dbTotal && dbTotal > 0) ? dbTotal : servicesTotalCents(r.requested_services);
      return {
        ticketId: r.id, ticketNumber: shortTicketNo(r.ticket_id, r.id), customerName: r.customer_name ?? null,
        serviceSummary: firstServiceName(r.requested_services) || 'Service', status: asTechTicketStatus(r.status),
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
        totalCents,
        acceptanceDeadline: r.acceptance_deadline && asTechTicketStatus(r.status) === 'assigned' ? new Date(r.acceptance_deadline).toISOString() : null,
        version: Number(r.version ?? 0),
        scheduledStart: r.started_at ? new Date(r.started_at).toISOString() : (r.assigned_at ? new Date(r.assigned_at).toISOString() : null),
        vip: !!r.is_vip,
      };
    });
  }

  /** Round 2: per queue item, how it was assigned (latest assign row) and its active lock — one query each. */
  private async assignmentSignals(ctx: TechContext, queueItemIds: (string | null | undefined)[]): Promise<Map<string, { assignSource?: TechAssignSource; lock: { technicianId: string | null; reason: string | null } | null }>> {
    const ids = [...new Set(queueItemIds.filter((x): x is string => typeof x === 'string' && x.length === 36))];
    const out = new Map<string, { assignSource?: TechAssignSource; lock: { technicianId: string | null; reason: string | null } | null }>();
    if (!ids.length) return out;
    const [hist, locks] = await Promise.all([
      sql<{ queue_item_id: string; source: string }>`select distinct on (queue_item_id) queue_item_id, source from pos_queue_status_history
        where tenant_id = ${ctx.tenantId} and queue_item_id in (${sql.join(ids)}) and to_technician is not null and (from_technician is null or to_technician <> from_technician)
        order by queue_item_id, created_at desc, version desc`.execute(this.db).then((r) => r.rows).catch(() => []),
      this.db.selectFrom('queue_assignment_locks').select(['queue_item_id', 'technician_id', 'reason']).where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids)
        .where('released_at', 'is', null).where((eb: any) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql`now()`)])).execute().catch(() => []),
    ]);
    const SRC: Record<string, TechAssignSource> = { staff: 'staff', ai_suggestion: 'ai_suggestion', auto_assign: 'auto_assign', repair: 'repair', customer: 'customer', kiosk: 'customer' };
    for (const id of ids) out.set(id, { lock: null });
    for (const h of hist) out.get(String(h.queue_item_id))!.assignSource = SRC[h.source] ?? 'staff';   // system / technician writes read as the desk's
    for (const l of locks) out.get(String(l.queue_item_id))!.lock = { technicianId: l.technician_id ?? null, reason: l.reason ?? null };
    return out;
  }

  async queueState(ctx: TechContext, technicianId: string): Promise<TechQueueState> {
    const { status } = await this.breakContext(ctx, technicianId);
    const onBreak = status === 'on_break' || status === 'lunch';
    // the technician's personal queue: tickets assigned to them that haven't started yet, soonest first
    const rows = await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['id', 'ticket_id', 'customer_name', 'requested_services', 'status', 'assigned_at', 'is_vip', 'assigned_technician_id', 'queue_item_id'])
      .where('tenant_id', '=', ctx.tenantId).where('assigned_technician_id', '=', technicianId)
      .where('status', 'in', ['assigned', 'accepted']).orderBy('assigned_at', 'asc').execute();
    const toCust = (r: any): TechQueueCustomer => ({ name: r.customer_name ?? null, serviceSummary: firstServiceName(r.requested_services) || 'Service', scheduledTime: r.assigned_at ? new Date(r.assigned_at).toISOString() : null, status: asTechTicketStatus(r.status) });
    let sig = new Map<string, { assignSource?: TechAssignSource; lock: { technicianId: string | null; reason: string | null } | null }>();
    const toEntry = (r: any): TechQueueEntry & TechAssignmentSignals => {
      const s = r.queue_item_id ? sig.get(String(r.queue_item_id)) : undefined;
      return { ticketId: r.id, ticketNumber: shortTicketNo(r.ticket_id, r.id), name: r.customer_name ?? null, serviceSummary: firstServiceName(r.requested_services) || 'Service', scheduledTime: r.assigned_at ? new Date(r.assigned_at).toISOString() : null, status: asTechTicketStatus(r.status), vip: !!r.is_vip, mine: r.assigned_technician_id === technicianId,
        queueItemId: r.queue_item_id ?? null, ...(s?.assignSource ? { assignSource: s.assignSource } : {}), lock: s?.lock ?? null, lockedToYou: !!s?.lock && s.lock.technicianId === technicianId };
    };
    // the branch's active queue (this technician's branch only — never cross-branch, §39), read-only context
    const tech = await this.db.selectFrom('technicians').select('branch_id').where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).executeTakeFirst();
    // 200-technician mandate §43 (Oct 23 2026): a bounded WINDOW of the branch queue (the Technician App queries its own
    // data plus relative context, never the whole floor of a 200-technician salon) — and the true size alongside it, so the
    // window is never a silent cut (it was .limit(50) with no total).
    const ACTIVE = ['assigned', 'accepted', 'serving', 'in_service', 'nearly_finished', 'paused'];
    const branchRows = tech?.branch_id ? await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['id', 'ticket_id', 'customer_name', 'requested_services', 'status', 'assigned_at', 'is_vip', 'assigned_technician_id', 'queue_item_id'])
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', tech.branch_id)
      .where('status', 'in', ACTIVE)
      .orderBy('assigned_at', 'asc').orderBy('id', 'asc').limit(TECH_BRANCH_QUEUE_WINDOW).execute() : [];
    const branchQueueTotal = !tech?.branch_id ? 0 : branchRows.length < TECH_BRANCH_QUEUE_WINDOW ? branchRows.length
      : Number((await this.db.selectFrom('pos_tech_queue_tickets').select(sql<string>`count(*)`.as('n')).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', tech.branch_id).where('status', 'in', ACTIVE).executeTakeFirst())?.n ?? branchRows.length);
    sig = await this.assignmentSignals(ctx, [...rows, ...branchRows].map((r: any) => r.queue_item_id));
    return {
      turnPosition: rows.length ? rows.length : null, // honest: how many customers are waiting for THIS technician
      status, onBreak,
      upNext: rows[0] ? toCust(rows[0]) : undefined,
      following: rows[1] ? toCust(rows[1]) : undefined,
      myQueue: rows.map(toEntry),
      branchQueue: branchRows.map(toEntry),
      branchQueueTotal,
    };
  }

  async moreState(ctx: TechContext, technicianId: string): Promise<TechMoreState> {
    const t = await this.db.selectFrom('technicians as t')
      .leftJoin('global_tech_profiles as g', 'g.id', 't.global_tech_profile_id')
      .select(['t.full_name', 't.role_label', 't.avatar_url', 'g.avatar_url as global_avatar'])
      .where('t.tenant_id', '=', ctx.tenantId).where('t.id', '=', technicianId).executeTakeFirst();
    const st = await this.db.selectFrom('technician_statuses').select('status')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).orderBy('changed_at', 'desc').executeTakeFirst();
    const sk = await this.skills(ctx, technicianId);
    const skillsLabel = sk.specialties.length ? sk.specialties.slice(0, 6).join(', ')
      : (sk.services.length ? sk.services.slice(0, 6).map((x) => x.serviceName).join(', ') : null);
    const wh = await this.workingHours(ctx, technicianId);
    const working = wh.filter((d) => d.isWorking && d.startTime && d.endTime);
    let workingHoursLabel: string | null = null;
    if (working.length) {
      const minStart = working.map((d) => d.startTime!).sort()[0];
      const maxEnd = working.map((d) => d.endTime!).sort().slice(-1)[0];
      workingHoursLabel = `${fmtClockTime(minStart)} – ${fmtClockTime(maxEnd)}`;
    }
    const avatarRaw = t?.global_avatar || t?.avatar_url || null;
    return {
      technician: { technicianId, fullName: t?.full_name ?? '', initials: initialsOf(t?.full_name ?? null), roleLabel: t?.role_label ?? 'Technician', avatarUrl: buildMediaUrl(avatarRaw) ?? undefined, status: asTechnicianStatus(st?.status ?? null) },
      workingHoursLabel, skillsLabel,
    };
  }

  // Skills/specialties + service eligibility from the real mapping: technician_services → services_catalog → categories.
  async skills(ctx: TechContext, technicianId: string): Promise<TechSkills> {
    const rows = await this.db.selectFrom('technician_services as ts')
      .innerJoin('services as s', 's.id', 'ts.service_id')
      .leftJoin('service_categories as sc', 'sc.id', 's.category_id')
      .select(['ts.service_id as service_id', 's.name as service_name', 'ts.is_primary as is_primary', 'sc.name as category'])
      .where('ts.tenant_id', '=', ctx.tenantId).where('ts.technician_id', '=', technicianId).where('s.tenant_id', '=', ctx.tenantId)
      .orderBy('s.name').execute();
    const services = rows.map((r) => ({ serviceId: r.service_id, serviceName: r.service_name, isPrimary: !!r.is_primary }));
    const specialties = [...new Set(rows.map((r) => r.category).filter((x): x is string => !!x))];
    return { specialties, services };
  }

  // Weekly working hours from technician_schedules (day_of_week 0–6, TIME columns).
  async workingHours(ctx: TechContext, technicianId: string): Promise<TechWorkingHoursDay[]> {
    const rows = await this.db.selectFrom('technician_schedules')
      .select(['day_of_week', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).orderBy('day_of_week').execute();
    return rows.map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time ?? null, endTime: r.end_time ?? null, lunchStartTime: r.lunch_start_time ?? null, lunchEndTime: r.lunch_end_time ?? null, isWorking: !!r.is_working }));
  }

  private shapeSkillReq(r: any): SkillChangeRequest {
    return { id: r.id, serviceId: r.service_id, serviceName: r.service_name ?? '', requestType: (r.request_type === 'remove' ? 'remove' : 'add') as SkillChangeType, note: r.note ?? null, status: r.status as SkillChangeStatus, createdAt: iso(r.created_at), decidedAt: r.decided_at ? iso(r.decided_at) : null, proficiencyLevel: r.proficiency_level ?? null, experienceYears: r.experience_years ?? null, supportingPhotos: typeof r.supporting_photos === 'string' ? JSON.parse(r.supporting_photos) : (r.supporting_photos ?? []), certificateEvidence: r.certificate_evidence ?? null, reviewNotes: r.review_notes ?? null, submittedAt: r.submitted_at ? iso(r.submitted_at) : null };
  }

  // Active tenant services the technician is NOT yet eligible for — the menu a technician can request to add.
  async requestableServices(ctx: TechContext, technicianId: string): Promise<RequestableService[]> {
    const rows = await this.db.selectFrom('services as s')
      .leftJoin('service_categories as sc', 'sc.id', 's.category_id')
      .select(['s.id as service_id', 's.name as service_name', 'sc.name as category'])
      .where('s.tenant_id', '=', ctx.tenantId).where('s.status', '=', 'active')
      .where('s.id', 'not in', (eb) => eb.selectFrom('technician_services as ts').select('ts.service_id').where('ts.tenant_id', '=', ctx.tenantId).where('ts.technician_id', '=', technicianId))
      .orderBy('s.name').execute();
    return rows.map((r) => ({ serviceId: r.service_id, serviceName: r.service_name, category: r.category ?? null }));
  }

  async createSkillChangeRequest(ctx: TechContext, technicianId: string, body: SkillChangeBody): Promise<SkillChangeRequest> {
    const type: SkillChangeType = body.requestType === 'remove' ? 'remove' : 'add';
    const status: SkillChangeStatus = body.status === 'draft' ? 'draft' : 'submitted';
    const svc = await this.db.selectFrom('services').select(['id', 'name']).where('tenant_id', '=', ctx.tenantId).where('id', '=', body.serviceId).executeTakeFirst();
    if (!svc) throw withCode(new TechError('not_found', 'That service was not found.'), 'SERVICE_NOT_FOUND');
    const dup = await this.db.selectFrom('technician_skill_change_requests').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('service_id', '=', body.serviceId).where('request_type', '=', type).where('status', 'in', ['pending', 'draft', 'submitted', 'under_review', 'more_information_required']).executeTakeFirst();
    if (dup) throw withCode(new TechError('invalid_state', 'You already have an active request for this service.'), 'SKILL_REQUEST_ALREADY_EXISTS');
    const tech = await this.db.selectFrom('technicians').select('branch_id').where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).executeTakeFirst();
    const note = body.note ? String(body.note).slice(0, 500) : null;
    const submittedAt = status === 'submitted' ? sql`now()` : null;
    const ins = await this.db.insertInto('technician_skill_change_requests').values({
      tenant_id: ctx.tenantId, branch_id: (tech?.branch_id ?? ctx.branchId ?? null), technician_id: technicianId, service_id: body.serviceId, request_type: type, note, status,
      proficiency_level: body.proficiencyLevel ?? null, experience_years: body.experienceYears ?? null, supporting_photos: JSON.stringify(body.supportingPhotos ?? []) as any, certificate_evidence: body.certificateEvidence ?? null, submitted_at: submittedAt as any
    }).returning(['id', 'created_at', 'submitted_at']).executeTakeFirstOrThrow();
    return { id: ins.id, serviceId: body.serviceId, serviceName: svc.name, requestType: type, note, status, createdAt: iso(ins.created_at), decidedAt: null, proficiencyLevel: body.proficiencyLevel ?? null, experienceYears: body.experienceYears ?? null, supportingPhotos: body.supportingPhotos ?? [], certificateEvidence: body.certificateEvidence ?? null, reviewNotes: null, submittedAt: ins.submitted_at ? iso(ins.submitted_at) : null };
  }

  async updateSkillChangeRequest(ctx: TechContext, requestId: string, technicianId: string, body: SkillChangeBody): Promise<SkillChangeRequest> {
    const req = await this.db.selectFrom('technician_skill_change_requests').selectAll().where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('id', '=', requestId).executeTakeFirst();
    if (!req) throw withCode(new TechError('not_found', 'That request was not found.'), 'REQUEST_NOT_FOUND');
    if (!['draft', 'more_information_required'].includes(req.status as string)) throw withCode(new TechError('invalid_state', 'You can only update draft or more-info-required requests.'), 'SKILL_REQUEST_NOT_EDITABLE');

    const status: SkillChangeStatus = body.status === 'draft' ? 'draft' : 'submitted';
    assertTransition(SKILL_CHANGE_REQUEST, String(req.status), status);   // Phase 12 (#27)
    const submittedAt = (status === 'submitted' && req.status !== 'submitted') ? sql`now()` : req.submitted_at;
    const note = body.note ? String(body.note).slice(0, 500) : null;

    await this.db.updateTable('technician_skill_change_requests').set({
      status, note, proficiency_level: body.proficiencyLevel ?? null, experience_years: body.experienceYears ?? null, supporting_photos: JSON.stringify(body.supportingPhotos ?? []) as any, certificate_evidence: body.certificateEvidence ?? null, submitted_at: submittedAt as any
    }).where('id', '=', requestId).where('tenant_id', '=', ctx.tenantId).where('status', '=', req.status as any).where(canMoveToSql(SKILL_CHANGE_REQUEST, status) as any).execute();

    const svc = await this.db.selectFrom('services').select(['name']).where('tenant_id', '=', ctx.tenantId).where('id', '=', req.service_id).executeTakeFirst();
    return { id: req.id, serviceId: req.service_id, serviceName: svc?.name ?? '', requestType: req.request_type as SkillChangeType, note, status, createdAt: iso(req.created_at), decidedAt: req.decided_at ? iso(req.decided_at) : null, proficiencyLevel: body.proficiencyLevel ?? null, experienceYears: body.experienceYears ?? null, supportingPhotos: body.supportingPhotos ?? [], certificateEvidence: body.certificateEvidence ?? null, reviewNotes: req.review_notes as string | null, submittedAt: submittedAt ? iso(submittedAt) : (req.submitted_at ? iso(req.submitted_at) : null) };
  }

  async listSkillChangeRequests(ctx: TechContext, technicianId: string): Promise<SkillChangeRequest[]> {
    const rows = await this.db.selectFrom('technician_skill_change_requests as q')
      .leftJoin('services as s', 's.id', 'q.service_id')
      .select(['q.id as id', 'q.service_id as service_id', 's.name as service_name', 'q.request_type as request_type', 'q.note as note', 'q.status as status', 'q.created_at as created_at', 'q.decided_at as decided_at', 'q.proficiency_level', 'q.experience_years', 'q.supporting_photos', 'q.certificate_evidence', 'q.review_notes', 'q.submitted_at'])
      .where('q.tenant_id', '=', ctx.tenantId).where('q.technician_id', '=', technicianId).orderBy('q.created_at', 'desc').execute();
    return rows.map((r) => this.shapeSkillReq(r));
  }

  /** Branches a MANAGER session may review for (Oct 12 2026 merge, workforce audit P1 #16). OWNER sees the whole tenant
   *  (null). A manager sees the branches her user_branch_access rows grant; with none, only her session branch.
   *  Technicians never reach here (the service gate is role-based). */
  private async reviewerBranchScope(ctx: TechContext): Promise<string[] | null> {
    if (String(ctx.role || '').toUpperCase() === 'OWNER') return null;
    const rows = await this.db.selectFrom('user_branch_access').select('branch_id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).execute().catch(() => [] as any[]);
    const ids = rows.map((r) => String(r.branch_id)).filter(Boolean);
    if (!ids.length && ctx.branchId) ids.push(ctx.branchId);
    return ids;
  }
  private requestInScope(scope: string[] | null, reqBranchId: string | null, techBranchId: string | null): boolean {
    if (scope === null) return true;
    const b = reqBranchId || techBranchId;
    return !!b && scope.includes(String(b));
  }

  // Pending = awaiting a manager (submitted / under_review / more_information_required). Decided rows and drafts are
  // excluded; the list is branch-scoped to the reviewing manager (Oct 12 2026 merge, workforce audit P1 #16).
  async listPendingSkillChangeRequests(ctx: TechContext): Promise<PendingSkillChangeRequest[]> {
    const scope = await this.reviewerBranchScope(ctx);
    const rows = await this.db.selectFrom('technician_skill_change_requests as q')
      .leftJoin('services as s', 's.id', 'q.service_id')
      .leftJoin('technicians as t', 't.id', 'q.technician_id')
      .select(['q.id as id', 'q.service_id as service_id', 's.name as service_name', 'q.request_type as request_type', 'q.note as note', 'q.status as status', 'q.created_at as created_at', 'q.decided_at as decided_at', 'q.proficiency_level', 'q.experience_years', 'q.supporting_photos', 'q.certificate_evidence', 'q.review_notes', 'q.submitted_at', 'q.technician_id as technician_id', 't.full_name as technician_name', 'q.branch_id as req_branch_id', 't.branch_id as tech_branch_id'])
      .where('q.tenant_id', '=', ctx.tenantId).where('q.status', 'in', ['submitted', 'under_review', 'more_information_required']).orderBy('q.created_at', 'asc').execute();
    return rows.filter((r) => this.requestInScope(scope, r.req_branch_id, r.tech_branch_id)).map((r) => ({ ...this.shapeSkillReq(r), technicianId: r.technician_id, technicianName: r.technician_name ?? '' }));
  }

  // Review / decide in ONE transaction with the request row locked (FOR UPDATE), so two managers deciding at once
  // serialise: the second sees a decided row and gets invalid_state. Approval writes eligibility through the ONE writer
  // (grantEligibility — INSERT … ON CONFLICT DO NOTHING, migration 583) carrying proficiency + certificate evidence.
  // Review steps stamp the 583 bookkeeping columns (review_started_at / more_info_requested_at).
  async decideSkillChangeRequest(ctx: TechContext, requestId: string, decision: SkillChangeStatus, decidedByUserId: string, reviewNotes?: string | null): Promise<PendingSkillChangeRequest> {
    const now = new Date();
    const terminal = decision === 'approved' || decision === 'rejected';
    const scope = await this.reviewerBranchScope(ctx);
    return await this.db.transaction().execute(async (trx) => {
      const req: any = await trx.selectFrom('technician_skill_change_requests').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', requestId).forUpdate().executeTakeFirst();
      if (!req) throw withCode(new TechError('not_found', 'That request was not found.'), 'REQUEST_NOT_FOUND');
      const tech: any = await trx.selectFrom('technicians').select(['full_name', 'branch_id', 'user_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', req.technician_id).executeTakeFirst();
      if (!this.requestInScope(scope, req.branch_id ?? null, (tech as any)?.branch_id ?? null)) throw withCode(new TechError('forbidden', 'This request belongs to a branch you do not manage.'), 'SKILL_REQUEST_OTHER_BRANCH');
      if (decision === 'approved' && tech?.user_id && tech.user_id === decidedByUserId) {
        throw withCode(new TechError('forbidden', 'A manager or owner cannot approve their own skill request.'), 'SKILL_REQUEST_SELF_APPROVAL');
      }
      if (['approved', 'rejected'].includes(req.status as string)) throw withCode(new TechError('invalid_state', 'That request has already been decided.'), 'REQUEST_ALREADY_DECIDED');
      if (!canReviewSkillRequest(String(req.status), String(decision))) throw new TechError('invalid_state', req.status === 'draft' ? 'That request is still a draft.' : `A request that is ${String(req.status).replace(/_/g, ' ')} cannot be marked ${String(decision).replace(/_/g, ' ')}.`);

      assertTransition(SKILL_CHANGE_REQUEST, String(req.status), String(decision));   // Phase 12 (#27): the same table as canReviewSkillRequest
      const decidedAt = terminal ? now : req.decided_at;
      const set: any = { status: decision, review_notes: reviewNotes ?? req.review_notes ?? null, updated_at: now };
      if (terminal) { set.decided_by_user_id = decidedByUserId; set.decided_at = now; }
      if (decision === 'under_review') { set.review_started_at = now; set.review_started_by_user_id = decidedByUserId; }
      if (decision === 'more_information_required') { set.more_info_requested_at = now; }
      await trx.updateTable('technician_skill_change_requests').set(set).where('id', '=', requestId).where('tenant_id', '=', ctx.tenantId).execute();

      if (decision === 'approved') {
        if (req.request_type === 'add') {
          await grantEligibility(trx, { tenantId: ctx.tenantId, branchId: (req.branch_id ?? tech?.branch_id ?? ctx.branchId) || null, technicianId: req.technician_id, serviceId: req.service_id, proficiency: normalizeProficiency(req.proficiency_level), certificateDocumentKey: req.certificate_evidence ?? null, grantedByUserId: decidedByUserId, via: 'skill_request' });
        } else {
          await revokeEligibility(trx, { tenantId: ctx.tenantId, technicianId: req.technician_id, serviceId: req.service_id });
        }
      }
      const svc = await trx.selectFrom('services').select('name').where('tenant_id', '=', ctx.tenantId).where('id', '=', req.service_id).executeTakeFirst();
      return { id: req.id, serviceId: req.service_id, serviceName: svc?.name ?? '', requestType: (req.request_type === 'remove' ? 'remove' : 'add') as SkillChangeType, note: req.note ?? null, status: decision as SkillChangeStatus, createdAt: iso(req.created_at), decidedAt: decidedAt ? iso(decidedAt) : null, proficiencyLevel: req.proficiency_level as string | null, experienceYears: req.experience_years as number | null, supportingPhotos: typeof req.supporting_photos === 'string' ? JSON.parse(req.supporting_photos) : (req.supporting_photos ?? []), certificateEvidence: req.certificate_evidence as string | null, reviewNotes: set.review_notes ?? null, submittedAt: req.submitted_at ? iso(req.submitted_at) : null, technicianId: req.technician_id, technicianName: tech?.full_name ?? '' };
    });
  }

  async addNote(ctx: TechContext, ticketId: string, body: NoteBody): Promise<void> {
    const note = (body.note || '').trim(); if (!note) return;
    const row = await this.db.selectFrom('pos_tech_queue_tickets').select('notes').where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    const stamp = new Date().toISOString();
    const tag = body.visibility === 'customer' ? 'customer' : 'internal';
    const next = `${row?.notes ? row.notes + '\n' : ''}[${stamp}] (${tag}) ${note}`;
    await this.db.updateTable('pos_tech_queue_tickets').set({ notes: next, updated_at: new Date() }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
  }

  async requestCancel(ctx: TechContext, ticketId: string, body: CancelRequestBody): Promise<void> {
    // technicians cannot hard-cancel; record the request for the front desk (status change is the desk's decision)
    const reason = (body.reason || 'No reason given').trim();
    const row = await this.db.selectFrom('pos_tech_queue_tickets').select('notes').where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    const next = `${row?.notes ? row.notes + '\n' : ''}[${new Date().toISOString()}] (cancel-requested) ${reason}`;
    // NOTE: delay_status CHECK only allows none/warning/late/critical, so the request is recorded as a note (the
    // authoritative cancel/refund decision belongs to the front desk POS, not the technician app).
    await this.db.updateTable('pos_tech_queue_tickets').set({ notes: next, updated_at: new Date() }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
  }

  async recordAudit(ctx: TechContext, technicianId: string, action: TechAuditAction, meta: AuditMeta = {}): Promise<void> {
    await this.db.insertInto('technician_audit_logs').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, technician_id: technicianId, user_id: ctx.userId || null,
      action, ticket_id: meta.ticketId ?? null, metadata: JSON.stringify(meta.data ?? {}),
    }).execute();
  }

  // Minimal lifecycle update on the tech-queue ticket. RECONCILE: the full POS flow may also advance tickets/serving.
  async accept(ctx: TechContext, ticketId: string, expectedVersion?: number): Promise<boolean> {
    // §13/§20 optimistic concurrency: bump version on write, and when the client passed the version it last saw, the
    // guarded WHERE matches only if no one has touched the row since — so a stale (lost-the-race) accept matches 0 rows.
    // The status guard is the primary double-accept protection; version is defense-in-depth.
    return this.db.transaction().execute(async (trx) => {
      let q = trx.updateTable('pos_tech_queue_tickets')
        .set({ status: 'accepted', accepted_at: new Date(), updated_at: new Date(), version: sql`version + 1` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId)
        .where('status', 'in', ['assigned', 'waiting_for_acceptance']).where(canMoveToSql(TECH_QUEUE_TICKET, 'accepted') as any);
      if (typeof expectedVersion === 'number') q = q.where('version', '=', expectedVersion);
      const row: any = await q.returning(['id', 'ticket_id', 'branch_id', 'assigned_technician_id']).executeTakeFirst();
      // tech_queue.offer_accepted — only when the guarded update landed (a lost race / double tap records nothing)
      if (row?.id) await this.offerFact(trx, ctx, DOMAIN_EVENTS.TECH_OFFER_ACCEPTED, row);
      return !!row?.id;
    });
  }
  async decline(ctx: TechContext, ticketId: string, body: DeclineBody): Promise<void> {
    // §11 decline: the offer goes back to assignment-ready (status 'declined'); the front-desk POS re-assigns. The
    // reason is recorded on the ticket notes (never lost). The status flip is the ONLY accept-path mutation, so a
    // double-tap or a late tap after another transition is a no-op: the WHERE status-guard matches only a pending offer.
    const reason = (body.reason || '').trim() || 'No reason given';
    const row = await this.db.selectFrom('pos_tech_queue_tickets').select('notes')
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    const next = `${row?.notes ? row.notes + '\n' : ''}[${new Date().toISOString()}] (declined) ${reason}`;
    await this.db.transaction().execute(async (trx) => {
      const row: any = await trx.updateTable('pos_tech_queue_tickets')
        .set({ status: 'declined', notes: next, updated_at: new Date(), version: sql`version + 1` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId)
        .where('status', 'in', ['assigned', 'waiting_for_acceptance']).where(canMoveToSql(TECH_QUEUE_TICKET, 'declined') as any) // status-guard: only a pending offer can be declined
        .returning(['id', 'ticket_id', 'branch_id', 'assigned_technician_id']).executeTakeFirst();
      // tech_queue.offer_declined — the reason stays in the ticket notes
      if (row?.id) await this.offerFact(trx, ctx, DOMAIN_EVENTS.TECH_OFFER_DECLINED, row);
      // Fair Turn Engine §64–66: the declined turn comes back, then the salon's decline consequence (safety reasons never penalised)
      if (row?.id && row.branch_id && row.assigned_technician_id) {
        const link: any = await trx.selectFrom('pos_tech_queue_tickets').select(['queue_item_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
        await turnDecline(trx, { tenantId: ctx.tenantId, branchId: String(row.branch_id), technicianId: String(row.assigned_technician_id), queueItemId: link?.queue_item_id ?? null, ticketId: row.ticket_id ?? null,
          reasonCode: body.reasonCode ?? null, reasonText: reason, actor: { userId: ctx.userId ?? null, type: 'technician' } }, { outbox: this.outbox ?? null });
      }
    });
  }
  async start(ctx: TechContext, ticketId: string): Promise<boolean> {
    // §34 start: accepted|paused → in_service. Status-guarded WHERE (like accept/pause) so a start that lost the race —
    // the ticket was cancelled/declined/already-started in the check→write window, or a stale client tapped — matches 0
    // rows instead of resurrecting a dead ticket into service. Service lines only move once the transition actually took.
    const started: any = await this.db.transaction().execute(async (trx) => {
      const row: any = await trx.updateTable('pos_tech_queue_tickets').set({ status: 'in_service', start_source: 'tech', started_at: new Date(), updated_at: new Date(), version: sql`version + 1` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).where('status', 'in', ['accepted', 'paused']).where(canMoveToSql(TECH_QUEUE_TICKET, 'in_service') as any)
        .returning(['id', 'ticket_id', 'branch_id', 'assigned_technician_id', 'appointment_id', 'queue_item_id', 'visit_part']).executeTakeFirst();
      if (!row?.id) return null;
      // Fair Turn Engine §86: the technician is SERVING in the turn queue (same transaction)
      if (row.branch_id && row.assigned_technician_id) await turnServiceStart(trx, { tenantId: ctx.tenantId, branchId: String(row.branch_id), technicianIds: [String(row.assigned_technician_id)], queueItemId: row.queue_item_id ?? null, ticketId: row.ticket_id ?? null, actor: { userId: ctx.userId ?? null, type: 'technician' } }, { outbox: this.outbox ?? null });
      // multi-technician routing: a PART of a split visit starts only its own lines; the legacy path below is unchanged
      if (row.visit_part != null && row.queue_item_id) return this.startPart(trx, ctx, row);
      // A whole visit (one technician) gets its canonical ticket NOW, as a split part does: without it every in-service
      // edit in the Tech App (add-on, add / change a line) was refused "no active service to edit yet" until Service Done
      // (wave 4 PILOT, Oct 13 2026). ensureVisitTicket is idempotent under the queue item's lock; complete() reuses it.
      if (!row.ticket_id && row.queue_item_id) {
        const made = await ensureVisitTicket(trx, { tenantId: ctx.tenantId, branchId: row.branch_id ?? ctx.branchId }, String(row.queue_item_id), { lineStatus: () => 'in_progress' });
        await trx.updateTable('pos_tech_queue_tickets').set({ ticket_id: made.ticketId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.id).execute();
        row.ticket_id = made.ticketId;
      }
      // Developer (Sep 2026): the linked canonical ticket, appointment and queue item advance with the start — in the
      // SAME transaction as the start and its fact (their version did this in separate statements).
      if (row.ticket_id) {
        await trx.updateTable('ticket_service_lines').set({ status: 'in_progress', started_at: new Date(), updated_at: new Date() })
          .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', row.ticket_id).where('completed_at', 'is', null).execute();
        await trx.updateTable('tickets').set({ status: 'serving', updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.ticket_id).execute();
      }
      if (row.appointment_id) await trx.updateTable('pos_tech_appointments').set({ status: 'in_service', start_source: 'tech', updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.appointment_id).where(canMoveToSql(APPOINTMENT, 'in_service') as any).execute();
      await trx.updateTable('pos_tech_appointments').set({ status: 'in_service', updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('tech_queue_idempotency_key', '=', ticketId).where(canMoveToSql(APPOINTMENT, 'in_service') as any).execute();
      if (row.queue_item_id) await trx.updateTable('pos_queue_items').set({ status: 'in_service', updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.queue_item_id).where(canMoveToSql(QUEUE_ITEM, 'in_service') as any).execute();
      // service.started (tech-app path; the POS Serving path records the same fact) — aggregate = the canonical ticket
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.SERVICE_STARTED, tenantId: ctx.tenantId, branchId: (row.branch_id as string) ?? ctx.branchId ?? undefined,
        aggregateType: 'ticket', aggregateId: String(row.ticket_id ?? row.id), actorId: ctx.userId || undefined, actorType: 'user', correlationId: row.ticket_id ? `ticket:${row.ticket_id}` : undefined,
        payload: { ticketId: row.ticket_id ?? null, techQueueTicketId: String(row.id), technicianId: row.assigned_technician_id ?? null, source: 'tech_app' } }));
      return row;
    });
    if (!started?.id) return false;
    return true;
  }
  /** Start ONE part of a split visit (in the start's transaction): the visit's canonical ticket exists (per-line
   *  technicians — ensureVisitTicket), only THIS technician's ticket lines go in_progress and their plan lines in_service;
   *  the ticket is serving and the queue item / appointment move to in_service on the FIRST part only. */
  private async startPart(trx: any, ctx: TechContext, row: any): Promise<any> {
    const tech = String(row.assigned_technician_id);
    const { ticketId } = await ensureVisitTicket(trx, { tenantId: ctx.tenantId, branchId: row.branch_id ?? ctx.branchId }, String(row.queue_item_id),
      { lineStatus: (t) => (t === tech ? 'in_progress' : 'pending') });
    await trx.updateTable('pos_tech_queue_tickets').set({ ticket_id: ticketId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.id).execute();
    await trx.updateTable('ticket_service_lines').set({ status: 'in_progress', started_at: new Date(), updated_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', tech).where('completed_at', 'is', null).execute();
    await trx.updateTable('queue_service_assignments').set({ status: 'in_service', started_at: sql`now()`, updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', row.queue_item_id).where('tech_queue_ticket_id', '=', row.id)
      .where('status', 'in', ['pending', 'assigned']).where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'in_service', 'queue_service_assignments')).execute();
    await trx.updateTable('tickets').set({ status: 'serving', updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).where('status', '!=', 'serving').execute();
    if (row.appointment_id) await trx.updateTable('pos_tech_appointments').set({ status: 'in_service', start_source: 'tech', updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.appointment_id).where('status', '!=', 'in_service').where(canMoveToSql(APPOINTMENT, 'in_service')).execute();
    await trx.updateTable('pos_queue_items').set({ status: 'in_service', started_at: sql`coalesce(started_at, now())`, updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.queue_item_id).where('status', '!=', 'in_service').where(canMoveToSql(QUEUE_ITEM, 'in_service')).execute();
    if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.SERVICE_STARTED, tenantId: ctx.tenantId, branchId: (row.branch_id as string) ?? ctx.branchId ?? undefined,
      aggregateType: 'ticket', aggregateId: ticketId, actorId: ctx.userId || undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
      payload: { ticketId, techQueueTicketId: String(row.id), technicianId: tech, source: 'tech_app', visitPart: Number(row.visit_part) } }));
    return { ...row, ticket_id: ticketId };
  }

  /** Complete ONE part: only its lines; the part is service_done; the VISIT completes exactly once — the guarded ticket
   *  update (no open line left) decides, under the ticket's row lock, so two parts finishing at once complete it once. */
  private async completePart(ctx: TechContext, ticketId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row: any = await trx.selectFrom('pos_tech_queue_tickets').select(['id', 'ticket_id', 'queue_item_id', 'appointment_id', 'assigned_technician_id', 'branch_id', 'status', 'visit_part'])
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).forUpdate().executeTakeFirst();
      if (!row) return;
      assertTransition(TECH_QUEUE_TICKET, row.status, 'service_done');
      const tech = String(row.assigned_technician_id);
      // lock order: the queue item (ensureVisitTicket), then the ticket
      const { ticketId: realTicketId } = await ensureVisitTicket(trx, { tenantId: ctx.tenantId, branchId: row.branch_id ?? ctx.branchId }, String(row.queue_item_id),
        { lineStatus: (t) => (t === tech ? 'in_progress' : 'pending') });
      await trx.selectFrom('tickets').select(['id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', realTicketId).forUpdate().executeTakeFirst();
      if (!row.ticket_id) await trx.updateTable('pos_tech_queue_tickets').set({ ticket_id: realTicketId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.id).execute();
      await trx.updateTable('ticket_service_lines').set({ status: 'completed', completed_at: new Date(), progress_percent: 100, updated_at: new Date() })
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', realTicketId).where('technician_id', '=', tech).where('completed_at', 'is', null).execute();
      await trx.updateTable('queue_service_assignments').set({ status: 'done', completed_at: sql`now()`, updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', row.queue_item_id).where('tech_queue_ticket_id', '=', row.id)
        .where('status', 'in', ['in_service']).where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'done', 'queue_service_assignments') as any).execute();
      await trx.updateTable('pos_tech_queue_tickets').set({ status: 'service_done', updated_at: new Date() } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.id).where(canMoveToSql(TECH_QUEUE_TICKET, 'service_done') as any).execute();
      const fin: any = await trx.updateTable('tickets').set({ status: 'service_done', service_done_at: sql`now()`, updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', realTicketId).where('status', '!=', 'service_done')
        .where(sql<boolean>`not exists (select 1 from ticket_service_lines l where l.tenant_id = ${ctx.tenantId} and l.ticket_id = ${realTicketId} and l.completed_at is null and coalesce(l.status, '') not in ('cancelled', 'removed', 'voided'))`)
        .returning(['id']).executeTakeFirst();
      const branchId = (row.branch_id as string) ?? ctx.branchId ?? undefined;
      if (fin?.id) {
        if (row.appointment_id) await trx.updateTable('pos_tech_appointments').set({ status: 'completed', updated_at: sql`now()` })
          .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.appointment_id).where(canMoveToSql(APPOINTMENT, 'completed') as any).execute();
        await trx.updateTable('pos_queue_items').set({ status: 'completed', updated_at: sql`now()` })
          .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.queue_item_id).where('status', '!=', 'completed').where(canMoveToSql(QUEUE_ITEM, 'completed') as any).execute();
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.SERVICE_COMPLETED, tenantId: ctx.tenantId, branchId,
          aggregateType: 'ticket', aggregateId: realTicketId, actorId: ctx.userId || undefined, actorType: 'user', correlationId: `ticket:${realTicketId}`,
          payload: { ticketId: realTicketId, status: 'completed', source: 'tech_app', queueItemId: String(row.queue_item_id) } }));
      } else if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_UPDATED, tenantId: ctx.tenantId, branchId,
          aggregateType: 'ticket', aggregateId: realTicketId, actorId: ctx.userId || undefined, actorType: 'user', correlationId: `ticket:${realTicketId}`,
          payload: { ticketId: realTicketId, change: 'part_completed', technicianId: tech, visitPart: Number(row.visit_part) } }));
      }
    });
  }
  async pause(ctx: TechContext, ticketId: string): Promise<void> {
    // §34 pause: in_service → paused. status-guarded WHERE so a double-tap (or a tap after another transition) is a
    // harmless no-op. Active (not-yet-complete) lines go in_progress → paused so the per-service state stays truthful.
    await this.db.updateTable('pos_tech_queue_tickets').set({ status: 'paused', updated_at: new Date(), version: sql`version + 1` })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).where('status', '=', 'in_service').where(canMoveToSql(TECH_QUEUE_TICKET, 'paused') as any).execute();
    const row = await this.db.selectFrom('pos_tech_queue_tickets').select(['ticket_id', 'assigned_technician_id as technician_id', 'visit_part']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    const part = row?.visit_part != null;   // multi-technician routing: a part pauses / resumes only its own lines
    if (row?.ticket_id) await this.db.updateTable('ticket_service_lines').set({ status: 'paused', updated_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', row.ticket_id).where('status', '=', 'in_progress').where('completed_at', 'is', null)
      .where((eb: any) => (part ? eb('technician_id', '=', row.technician_id) : sql<boolean>`true`)).execute();
    // §33 durability (PHASE A, additive): a tech-initiated pause is durably recorded on the canonical ticket too, so a
    // future Serving read-path derivation (deferred) can reflect it. Guarded so a re-pause does not reset the clock.
    if (row?.ticket_id && !part) await this.db.transaction().execute(async (trx) => {
      const r: any = await trx.updateTable('tickets').set({ serving_paused_at: sql`now()`, updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.ticket_id).where('serving_paused_at', 'is', null).executeTakeFirst();
      // service.paused — only a REAL pause (the canonical marker was clear), in the marker's own transaction
      if (Number(r?.numUpdatedRows ?? 0) > 0) await this.pauseFact(trx, ctx, DOMAIN_EVENTS.SERVICE_PAUSED, String(row.ticket_id), row.technician_id ?? null);
    });
  }
  async resume(ctx: TechContext, ticketId: string): Promise<void> {
    // §34 resume: paused → in_service. Mirror of pause; status-guarded so only a paused ticket resumes.
    await this.db.updateTable('pos_tech_queue_tickets').set({ status: 'in_service', updated_at: new Date(), version: sql`version + 1` })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).where('status', '=', 'paused').where(canMoveToSql(TECH_QUEUE_TICKET, 'in_service') as any).execute();
    const row = await this.db.selectFrom('pos_tech_queue_tickets').select(['ticket_id', 'assigned_technician_id as technician_id', 'visit_part']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    const part = row?.visit_part != null;   // multi-technician routing: a part pauses / resumes only its own lines
    if (row?.ticket_id) await this.db.updateTable('ticket_service_lines').set({ status: 'in_progress', updated_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', row.ticket_id).where('status', '=', 'paused').where('completed_at', 'is', null)
      .where((eb: any) => (part ? eb('technician_id', '=', row.technician_id) : sql<boolean>`true`)).execute();
    // §33 durability (PHASE A, additive): accumulate the paused span and clear the marker on the canonical ticket.
    if (row?.ticket_id && !part) await this.db.transaction().execute(async (trx) => {
      const r: any = await trx.updateTable('tickets').set({ accumulated_paused_ms: sql`accumulated_paused_ms + (extract(epoch from (now() - serving_paused_at)) * 1000)::bigint`, serving_paused_at: null, updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', row.ticket_id).where('serving_paused_at', 'is not', null).executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) > 0) await this.pauseFact(trx, ctx, DOMAIN_EVENTS.SERVICE_RESUMED, String(row.ticket_id), row.technician_id ?? null);
    });
  }
  /** Service Done from the tech app — THE shared transition (service-done/service-done-transition.ts; merge Oct 12 2026).
   *  A visit with a queue item gets its canonical priced ticket through ensureVisitTicket (per-line technicians, baked
   *  commission) — never a fabricated `tickets` row with unpriced lines; the rare appointment-sourced row with no queue
   *  item still gets its ticket from its requested services, and the transition stamps the ONE commission precedence on
   *  every line before completing. Idempotent by the completion key; a retry is a no-op. */
  async complete(ctx: TechContext, ticketId: string, body: ServiceDoneBody): Promise<void> {
    const row = await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['ticket_id', 'appointment_id', 'queue_item_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'requested_services', 'assigned_technician_id', 'branch_id', 'status', 'visit_part'])
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    if (!row) throw withCode(new TechError('not_found', 'Ticket not found.'), 'TICKET_NOT_FOUND');
    // multi-technician routing: a PART of a split visit finishes only its own lines
    if (row?.visit_part != null && row?.queue_item_id) return this.completePart(ctx, ticketId);
    // Phase 12 (#27): service done is a TECH_QUEUE_TICKET move — a cancelled / declined / expired / no-show ticket is
    // never completed (409, before anything is written)
    if (row?.status) assertTransition(TECH_QUEUE_TICKET, row.status, 'service_done');

    let realTicketId = row.ticket_id;
    if (!realTicketId && row.queue_item_id) {
      // the visit's canonical ticket (per-line technicians + baked commission), created once under the queue item's lock
      const made = await this.db.transaction().execute((trx) => ensureVisitTicket(trx, { tenantId: ctx.tenantId, branchId: row.branch_id ?? ctx.branchId }, String(row.queue_item_id), { lineStatus: () => 'in_progress' }));
      realTicketId = made.ticketId;
      await this.db.updateTable('pos_tech_queue_tickets').set({ ticket_id: realTicketId }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
    } else if (!realTicketId) {
      const ticketBranchId = row.branch_id || ctx.branchId;
      const ticketNumber = await nextTicketNumber(this.db, ctx.tenantId, ticketBranchId);
      const ins = await this.db.insertInto('tickets').values({
        tenant_id: ctx.tenantId, branch_id: ticketBranchId, customer_id: row.customer_id || null, queue_item_id: null,
        primary_technician_id: row.assigned_technician_id || null, status: 'serving', accepted_at: new Date().toISOString(), serving_started_at: new Date().toISOString(), ticket_number: ticketNumber,
      } as any).returning(['id']).executeTakeFirstOrThrow();
      realTicketId = ins.id;
      await this.db.updateTable('pos_tech_queue_tickets').set({ ticket_id: realTicketId } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
      try {
        const raw = typeof row.requested_services === 'string' ? JSON.parse(row.requested_services) : row.requested_services;
        if (Array.isArray(raw) && raw.length) {
          await this.db.insertInto('ticket_service_lines').values(raw.map((s: any) => ({
            tenant_id: ctx.tenantId, branch_id: ticketBranchId, ticket_id: realTicketId, service_id: (s.serviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.serviceId)) ? s.serviceId : '00000000-0000-0000-0000-000000000000', technician_id: row.assigned_technician_id || null,
            service_name_snapshot: s.serviceName || s.name || 'Service', price_cents_snapshot: Number(s.priceCents || s.price || 0), duration_minutes_snapshot: requestedLine(s).durationMinutes || 30,
            line_total_cents: requestedLine(s).priceCents, status: 'in_progress',
          })) as any).execute();
        }
      } catch { /* parse fallback */ }
    }
    try {
      // the ticket's own row / the line technician decide ownership; the transition flips the tech-queue row, the queue
      // item and the appointment (each through its machine) and records service.completed
      await completeServiceDone(this.db, { outbox: this.outbox ?? null, workforce: null }, {
        tenantId: ctx.tenantId, branchId: row.branch_id || ctx.branchId || null, ticketId: String(realTicketId), actor: { userId: ctx.userId, role: String(ctx.role || 'TECHNICIAN') },
        source: 'tech_app', technicianId: row.assigned_technician_id || null, lock: false, notes: body?.notes ?? null,
      });
    } catch (e: any) {
      if (e instanceof ServiceDoneTransitionError) throw new TechError(e.code === 'TICKET_NOT_FOUND' ? 'not_found' : e.code === 'NOT_ASSIGNED' ? 'forbidden' : 'invalid_state', e.message);
      throw e;
    }
    // the tech-queue row itself (the transition only flips rows that already carry ticket_id — this one may have just got it)
    await this.db.updateTable('pos_tech_queue_tickets').set({ status: 'service_done', updated_at: new Date(), version: sql`version + 1` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).where('status', '!=', 'service_done').where(canMoveToSql(TECH_QUEUE_TICKET, 'service_done') as any).execute();
    await this.db.updateTable('pos_tech_appointments').set({ status: 'completed', updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('tech_queue_idempotency_key', '=', ticketId).where(canMoveToSql(APPOINTMENT, 'completed') as any).execute();
  }

  async breakContext(ctx: TechContext, technicianId: string): Promise<{ status: TechnicianStatus; hasActiveService: boolean }> {
    const st = await this.db.selectFrom('technician_statuses').select('status')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .orderBy('changed_at', 'desc').executeTakeFirst();
    const active = await this.db.selectFrom('pos_tech_queue_tickets').select('id')
      .where('tenant_id', '=', ctx.tenantId).where('assigned_technician_id', '=', technicianId).where('status', 'in', SERVING)
      .executeTakeFirst();
    return { status: asTechnicianStatus(st?.status ?? null), hasActiveService: !!active };
  }
  async setBreak(ctx: TechContext, technicianId: string, on: boolean, _override: boolean): Promise<TechnicianStatus> {
    const status: TechnicianStatus = on ? 'on_break' : 'available';
    await this.db.insertInto('technician_statuses')
      .values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: technicianId, status, changed_at: new Date() })
      .execute();
    return status;
  }

  async dashboardRaw(ctx: TechContext, technicianId: string, nowMs: number = Date.now()): Promise<TechDashboardRaw> {
    const tenant = ctx.tenantId;
    const day = await this.today(ctx, nowMs); const sod = day.startIso;

    const tech = await this.db.selectFrom('technicians as t')
      .leftJoin('global_tech_profiles as g', 'g.id', 't.global_tech_profile_id')
      .select(['t.full_name', 't.role_label', 't.avatar_url', 'g.avatar_url as global_avatar'])
      .where('t.tenant_id', '=', tenant).where('t.id', '=', technicianId).executeTakeFirst();
    const st = await this.db.selectFrom('technician_statuses').select('status')
      .where('tenant_id', '=', tenant).where('technician_id', '=', technicianId).orderBy('changed_at', 'desc').executeTakeFirst();
    const status = asTechnicianStatus(st?.status ?? null);
    const fullName = tech?.full_name ?? '';
    const avatarRaw = tech?.global_avatar || tech?.avatar_url || null;
    const technician: TechMe = {
      technicianId, fullName,
      initials: fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?',
      roleLabel: tech?.role_label ?? '', avatarUrl: buildMediaUrl(avatarRaw) ?? undefined, status,
    };

    // Today's PAID lines → SALES only (ONE-PAY: commission + tips on the Tech App come from the compensation snapshot in
    // TechService — no rate is read or multiplied here).
    const lineRows = await this.db.selectFrom('ticket_service_lines as l')
      .innerJoin('tickets as tk', 'tk.id', 'l.ticket_id')
      .select(['l.line_total_cents as line_total_cents'])
      .where('l.tenant_id', '=', tenant).where('tk.tenant_id', '=', tenant).where('l.technician_id', '=', technicianId)
      .where('tk.status', '=', 'paid').where('tk.paid_at', '>=', sod as any)
      .execute();
    const todayLines: LineSnapshot[] = lineRows.map((r: any) => ({ lineTotalCents: Number(r.line_total_cents) || 0 }));

    // Tech-queue counts for today.
    const cnt = async (build: (q: any) => any): Promise<number> => {
      const base = this.db.selectFrom('pos_tech_queue_tickets').select((eb: any) => eb.fn.countAll().as('c'))
        .where('tenant_id', '=', tenant).where('assigned_technician_id', '=', technicianId);
      const row = await build(base).executeTakeFirst();
      return Number(row?.c ?? 0);
    };
    const bookings = await cnt((q) => q.where('assigned_at', '>=', sod));
    const completed = await cnt((q) => q.where('status', 'in', ['done', 'completed', 'service_done']).where('updated_at', '>=', sod));
    const inService = await cnt((q) => q.where('status', 'in', SERVING));
    const acceptedNotStarted = await cnt((q) => q.where('status', '=', 'accepted'));
    // The earliest assigned-unaccepted ticket — its id lets the client Accept it.
    const assigned = await this.db.selectFrom('pos_tech_queue_tickets').select('id')
      .where('tenant_id', '=', tenant).where('assigned_technician_id', '=', technicianId).where('status', '=', 'assigned')
      .orderBy('assigned_at', 'asc').executeTakeFirst();
    const assignedTicketId = assigned?.id ?? null;

    // Current service (most recent serving ticket).
    const cur = await this.db.selectFrom('pos_tech_queue_tickets')
      .select(['id', 'ticket_id', 'queue_item_id', 'customer_id', 'customer_name', 'requested_services', 'started_at'])
      .where('tenant_id', '=', tenant).where('assigned_technician_id', '=', technicianId).where('status', 'in', SERVING)
      .orderBy('started_at', 'desc').executeTakeFirst();
    const currentService: CurrentServiceInput | undefined = cur ? {
      ticketId: cur.ticket_id ?? cur.id, queueItemId: cur.queue_item_id ?? '', serviceLineId: '',
      customerId: cur.customer_id ?? '', customerName: cur.customer_name ?? '',
      serviceName: firstServiceName(cur.requested_services), startedAt: iso(cur.started_at), status: 'serving',
    } : undefined;

    // Next appointment today (earliest upcoming).
    const appt = await this.db.selectFrom('pos_tech_appointments')
      .select(['id', 'customer_name', 'services', 'start_time', 'status'])
      .where('tenant_id', '=', tenant).where('technician_id', '=', technicianId)
      .where('appt_date', '=', day.date)
      .where('status', 'in', ['confirmed', 'arrived', 'checked_in', 'waiting', 'assigned'])
      .orderBy('start_time', 'asc').executeTakeFirst();
    const nextAppointment: TechNextAppointment | undefined = appt ? {
      appointmentId: appt.id,
      customerName: appt.customer_name ?? '',
      customerInitials: (appt.customer_name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?',
      serviceName: firstServiceName(appt.services), startTime: iso(appt.start_time),
      status: (['confirmed', 'arrived', 'checked_in', 'waiting', 'assigned'].includes((appt.status || '').toLowerCase()) ? (appt.status as any) : 'confirmed'),
    } : undefined;

    // developer merge (Oct 6 2026): the Home bell counts the technician's UNREAD in-app notifications (it was a hard 0)
    const unread: any = await this.db.selectFrom('technician_notifications').select((eb: any) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', tenant).where('technician_id', '=', technicianId).where('read_at', 'is', null).executeTakeFirst().catch(() => undefined);
    const notificationsCount = Number(unread?.c ?? 0) || 0;

    return {
      technician, todayLines,
      bookings, completed, inService,
      salesTrendPercent: 0, // NOTE: no trend baseline in schema — needs a prior-period source.
      currentService, nextAppointment,
      notificationsCount,
      hasAssignedUnacceptedTicket: !!assignedTicketId,
      hasAcceptedNotStarted: acceptedNotStarted > 0,
      assignedTicketId,
    };
  }

  async saveManagerMessage(ctx: TechContext, data: { technicianId: string; technicianName: string; topic: string; message: string }): Promise<string> {
    const res = await sql<{ id: string }>`
      INSERT INTO technician_manager_messages (tenant_id, technician_id, technician_name, topic, message, status, created_at)
      VALUES (${ctx.tenantId}, ${data.technicianId}, ${data.technicianName}, ${data.topic}, ${data.message}, 'unread', now())
      RETURNING id
    `.execute(this.db);
    return res.rows[0]?.id || '';
  }

  async getManagerMessages(ctx: TechContext, technicianId?: string): Promise<TechManagerMessage[]> {
    // With a technicianId: that technician's OWN messages only (Oct 12 2026 merge, P0 #13). Without: the salon inbox.
    const res = await sql<any>`
      SELECT id, technician_id, technician_name, topic, message, status, created_at, resolved_at
      FROM technician_manager_messages
      WHERE tenant_id = ${ctx.tenantId}${technicianId ? sql` AND technician_id = ${technicianId}` : sql``}
      ORDER BY created_at DESC
      LIMIT 100
    `.execute(this.db);
    return res.rows.map((r: any) => ({
      id: r.id,
      technicianId: r.technician_id,
      technicianName: r.technician_name,
      topic: r.topic,
      message: r.message,
      status: r.status,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
    }));
  }

  async resolveManagerMessage(ctx: TechContext, messageId: string): Promise<void> {
    await sql`
      UPDATE technician_manager_messages
      SET status = 'resolved', resolved_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${messageId} AND ${canMoveToSql(MANAGER_MESSAGE, 'resolved')}
    `.execute(this.db);
  }
}
