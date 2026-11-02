// service-done-transition.ts — THE ONE Service Done implementation (merge Oct 12 2026 — the other chat's workforce audit
// "three Service Done implementations → one"; Payroll mandate §14 "SERVICE DONE is a major financial boundary").
// Used by the tech app `complete` (whole-visit path), Serving `markDone` and Serving `sendToServiceDone`.
//
//   • transactional: the ticket row is locked (FOR UPDATE) for the whole transition
//   • status-guarded: only a ticket in service (tickets.status 'serving', or 'accepted' when the POS started it without a
//     timer) can be completed; a ticket already at service_done is a DUPLICATE (idempotent), anything later (checkout /
//     paid / cancelled / voided) is refused
//   • idempotent by key: the completion key (ticketId + subtotal) is stored on the primary ticket_service_sessions row
//     (migration 586); a retry with the same key — from ANY of the three entry points — is a no-op that reports
//     duplicate=true
//   • commission snapshot BEFORE completion: every line reaching Service Done is priced through the ONE precedence
//     (authored rule → service rate → tenant default; @aipowersalon/workforce stampCommissionOnLine). A line priced at
//     creation is frozen; a line that reached completion with a NULL snapshot is priced now, so it never pays $0.
//   • updates: ticket_service_lines → completed; tickets → service_done (+ paused clock closed); the visit's
//     pos_queue_items / pos_tech_queue_tickets / pos_tech_appointments / queue_service_assignments projections →
//     completed / service_done / done, every one through its lifecycle machine (canMoveToSql); checkout readiness is what
//     Service Done reads (tickets.status = 'service_done')
//   • optionally LOCKS the ticket at Service Done (the Serving "send" path) with the subtotal it was sent at
//   • records service.completed in the outbox INSIDE the transaction (Constitution 8), and transitions workforce state
//     (serviceCompleted) for the primary + helper technicians AFTER commit — never inside the transaction
import { sql, type Kysely, type Transaction } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { stampCommissionOnLine, turnServiceComplete } from '@aipowersalon/workforce';
import { QUEUE_SERVICE_ASSIGNMENT, TICKET_SERVICE_SESSION, SERVICE_DONE_CHECKOUT, SERVICE_DONE_QUALITY } from '../queue-lifecycles';

export type ServiceDoneSource = 'tech_app' | 'serving_mark_done' | 'serving_send' | 'pos';
export class ServiceDoneTransitionError extends Error {
  constructor(public readonly code: 'TICKET_NOT_FOUND' | 'INVALID_STATUS' | 'NOT_ASSIGNED', message: string) { super(message); this.name = 'ServiceDoneTransitionError'; }
}
export interface ServiceDoneInput {
  tenantId: string; branchId?: string | null; ticketId: string;
  actor: { userId?: string | null; role?: string | null };
  source: ServiceDoneSource;
  /** When set, the caller asserts the ticket must be assigned to THIS technician (tech app own-ticket rule). */
  technicianId?: string | null;
  /** Serving "send to Service Done": lock the ticket at the subtotal it was sent with. */
  lock?: boolean;
  notes?: string | null;
}
export interface ServiceDoneResult { ticketId: string; duplicate: boolean; idempotencyKey: string; subtotalCents: number; locked: boolean; technicianIds: string[]; branchId: string | null }
/** Structural (no Nest coupling): the workforce state projection the Technician Profile work provides. Optional. */
export interface ServiceDoneWorkforcePort { serviceCompleted?(tenantId: string, technicianId: string, meta: { ticketId: string }): Promise<unknown> }
export interface ServiceDoneDeps {
  outbox?: OutboxWriter | null;
  workforce?: ServiceDoneWorkforcePort | null;
}

export function buildServiceDoneCompletionKey(ticketId: string, subtotalCents: number): string { return ticketId + ':send_to_service_done:' + subtotalCents; }

const COMPLETABLE = ['serving', 'accepted', 'in_service'];
const EXCLUDED_LINE_STATUSES = ['cancelled', 'removed', 'voided'];

export async function completeServiceDone(db: Kysely<DB>, deps: ServiceDoneDeps, input: ServiceDoneInput): Promise<ServiceDoneResult> {
  const out = await db.transaction().execute(async (trx) => completeInTrx(trx, deps, input));
  // post-commit side effect — best-effort, never part of the transaction (a state projection must not undo a completion)
  if (!out.duplicate || out.justLocked) {
    for (const tid of out.technicianIds) { try { await deps.workforce?.serviceCompleted?.(input.tenantId, tid, { ticketId: input.ticketId }); } catch { /* never load-bearing */ } }
  }
  const { justLocked: _j, ...rest } = out;
  return rest;
}

async function completeInTrx(trx: Transaction<DB>, deps: ServiceDoneDeps, input: ServiceDoneInput): Promise<ServiceDoneResult & { justLocked: boolean }> {
  const t: any = await trx.selectFrom('tickets').select(['id', 'branch_id', 'status', 'primary_technician_id', 'helper_technician_id', 'queue_item_id', 'service_done_locked_at', 'serving_started_at']).where('tenant_id', '=', input.tenantId).where('id', '=', input.ticketId).forUpdate().executeTakeFirst();
  if (!t) throw new ServiceDoneTransitionError('TICKET_NOT_FOUND', 'Ticket not found');
  if (input.technicianId) {
    const owns = t.primary_technician_id === input.technicianId || t.helper_technician_id === input.technicianId;
    const line = owns ? null : await trx.selectFrom('ticket_service_lines').select('id').where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).where('technician_id', '=', input.technicianId).executeTakeFirst();
    if (!owns && !line) throw new ServiceDoneTransitionError('NOT_ASSIGNED', 'This ticket is not assigned to you.');
  }
  const lines: any[] = await trx.selectFrom('ticket_service_lines').select(['id', 'line_total_cents', 'price_cents_snapshot', 'technician_id', 'status', 'completed_at'])
    .where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).where('removed_at', 'is', null).execute();
  const subtotal = lines.reduce((a, l) => a + Number(l.line_total_cents ?? l.price_cents_snapshot ?? 0), 0);
  const key = buildServiceDoneCompletionKey(input.ticketId, subtotal);
  const technicianIds = [...new Set([t.primary_technician_id, t.helper_technician_id, ...lines.map((l) => l.technician_id)].filter(Boolean).map(String))];
  const alreadyDone = String(t.status) === 'service_done';
  const alreadyLocked = !!t.service_done_locked_at;
  const branchId: string | null = t.branch_id ?? input.branchId ?? null;

  if (!alreadyDone && !COMPLETABLE.includes(String(t.status))) {
    throw new ServiceDoneTransitionError('INVALID_STATUS', `Cannot mark Service Done from status '${t.status}'.`);
  }

  // Existing completion under THIS key (any entry point) → duplicate. Under a DIFFERENT key with the ticket already at
  // service_done → the subtotal changed after completion (lines edited at Service Done) — still a no-op completion,
  // but the new key is recorded on the session so the lock reflects the current subtotal.
  const existing: any = await trx.selectFrom('ticket_service_sessions').select(['id', 'idempotency_key', 'status'])
    .where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).where('is_helper', '=', false).orderBy('created_at', 'desc').executeTakeFirst();
  let duplicate = alreadyDone && (!!existing && existing.idempotency_key === key);
  let justLocked = false;

  if (!alreadyDone) {
    const now = sql`now()`;
    // sessions: every live row for this ticket completes; the primary row carries the key
    const live: any[] = await trx.selectFrom('ticket_service_sessions').select(['id', 'is_helper', 'paused_at'])
      .where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).where('status', 'in', ['STARTED', 'PAUSED']).execute();
    for (const s of live) {
      await trx.updateTable('ticket_service_sessions').set({
        status: 'COMPLETED', completed_at: now, completed_by_user_id: input.actor.userId ?? null, completion_source: input.source,
        accumulated_paused_ms: s.paused_at ? sql`accumulated_paused_ms + (extract(epoch from (now() - paused_at)) * 1000)::bigint` : sql`accumulated_paused_ms`, paused_at: null,
        idempotency_key: s.is_helper ? null : key, version: sql`version + 1`, updated_at: now,
      } as any).where('tenant_id', '=', input.tenantId).where('id', '=', s.id).where(canMoveToSql(TICKET_SERVICE_SESSION, 'COMPLETED') as any).execute();
    }
    const sessionTech = t.primary_technician_id || input.technicianId || technicianIds[0] || null;
    if (!live.some((s) => !s.is_helper) && sessionTech) {
      // no durable session (ticket started before 586, or by a POS path that never opened one): record the completion
      // so the key exists for idempotency. ON CONFLICT on the key = a concurrent completion already landed.
      const ins: any = await trx.insertInto('ticket_service_sessions').values({
        tenant_id: input.tenantId, branch_id: branchId, ticket_id: input.ticketId, technician_id: sessionTech,
        is_helper: false, status: 'COMPLETED', started_at: t.serving_started_at ?? now, completed_at: now, completed_by_user_id: input.actor.userId ?? null, completion_source: input.source, idempotency_key: key,
      } as any).onConflict((oc) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).executeTakeFirst();
      if (Number(ins?.numInsertedOrUpdatedRows ?? 0) === 0) duplicate = true;
    }
    // Commission snapshot BEFORE completion (Payroll mandate §14): the ONE precedence; lines already priced are frozen.
    for (const l of lines) await stampCommissionOnLine(trx as unknown as Kysely<DB>, input.tenantId, String(l.id));
    await trx.updateTable('ticket_service_lines').set({ status: 'completed', completed_at: now, progress_percent: 100, updated_at: now } as any)
      .where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).where('removed_at', 'is', null).where('completed_at', 'is', null)
      .where((eb) => eb.or([eb('status', 'is', null), eb('status', 'not in', EXCLUDED_LINE_STATUSES)])).execute();
    await trx.updateTable('tickets').set({
      status: 'service_done', service_done_at: sql`coalesce(service_done_at, now())`,
      accumulated_paused_ms: sql`case when serving_paused_at is null then accumulated_paused_ms else accumulated_paused_ms + (extract(epoch from (now() - serving_paused_at)) * 1000)::bigint end`,
      serving_paused_at: null, updated_at: now, ...(input.notes != null && String(input.notes).trim() ? { service_done_notes: String(input.notes).slice(0, 2000) } : {}),
      // Service Done mandate §30 / §97 (Oct 28 2026): a visit that was REOPENED and is now completed again starts the Service
      // Done workflow afresh — not stuck at 'reopened' (the handoff refuses a reopened ticket) and its quality must be
      // reconfirmed after the rework. (Every SET expression reads the row as it was before this UPDATE.)
      service_done_checkout_status: 'not_ready',
      service_done_quality_status: sql`case when service_done_checkout_status = 'reopened' then 'pending' else service_done_quality_status end`,
    } as any).where('tenant_id', '=', input.tenantId).where('id', '=', input.ticketId)
      .where(canMoveToSql(SERVICE_DONE_CHECKOUT, 'not_ready')).where(canMoveToSql(SERVICE_DONE_QUALITY, 'pending')).execute();   // every state may reach these: a guard, never a filter
    // visit projections → completed (queue board, tech queue, calendar, per-line plan) — each through its machine
    const queueItemIds = new Set<string>();
    if (t.queue_item_id) queueItemIds.add(String(t.queue_item_id));
    const tq: any[] = await trx.selectFrom('pos_tech_queue_tickets').select(['id', 'appointment_id', 'queue_item_id'])
      .where('tenant_id', '=', input.tenantId).where('ticket_id', '=', input.ticketId).execute();
    for (const r of tq) if (r.queue_item_id) queueItemIds.add(String(r.queue_item_id));
    await trx.updateTable('pos_queue_items').set({ status: 'completed', updated_at: now } as any).where('tenant_id', '=', input.tenantId)
      .where((eb) => eb.or([eb('ticket_id', '=', input.ticketId), eb('id', '=', input.ticketId), ...(queueItemIds.size ? [eb('id', 'in', [...queueItemIds])] : [])]))
      .where(canMoveToSql(QUEUE_ITEM, 'completed') as any).execute();
    if (queueItemIds.size) {
      await trx.updateTable('queue_service_assignments').set({ status: 'done', completed_at: sql`coalesce(completed_at, now())`, updated_at: now } as any)
        .where('tenant_id', '=', input.tenantId).where('queue_item_id', 'in', [...queueItemIds]).where('status', '=', 'in_service')
        .where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'done', 'queue_service_assignments') as any).execute();
    }
    if (tq.length) {
      await trx.updateTable('pos_tech_queue_tickets').set({ status: 'service_done', updated_at: now, version: sql`version + 1` } as any)
        .where('tenant_id', '=', input.tenantId).where('id', 'in', tq.map((r) => r.id)).where(canMoveToSql(TECH_QUEUE_TICKET, 'service_done') as any).execute();
      const apptIds = tq.map((r) => r.appointment_id).filter(Boolean);
      if (apptIds.length) await trx.updateTable('pos_tech_appointments').set({ status: 'completed', updated_at: now } as any).where('tenant_id', '=', input.tenantId).where('id', 'in', apptIds).where(canMoveToSql(APPOINTMENT, 'completed') as any).execute();
      await trx.updateTable('pos_tech_appointments').set({ status: 'completed', updated_at: now } as any).where('tenant_id', '=', input.tenantId).where('tech_queue_idempotency_key', 'in', tq.map((r) => r.id)).where(canMoveToSql(APPOINTMENT, 'completed') as any).execute();
    }
    await trx.updateTable('pos_tech_appointments').set({ status: 'completed', updated_at: now } as any).where('tenant_id', '=', input.tenantId).where('id', '=', input.ticketId).where(canMoveToSql(APPOINTMENT, 'completed') as any).execute();
    // Fair Turn Engine §87–88: COMPLETE + TURN_CREDIT for every technician of the visit, in THIS transaction — the
    // provisional turn becomes credited (rule snapshot from the assignment) and the technician returns to READY.
    if (!duplicate && typeof branchId === 'string' && /^[0-9a-f-]{36}$/i.test(branchId) && technicianIds.length) {
      await turnServiceComplete(trx, { tenantId: input.tenantId, branchId, technicianIds, queueItemIds: [...queueItemIds], ticketId: input.ticketId,
        startedAt: t.serving_started_at ? new Date(t.serving_started_at).toISOString() : null, actor: { userId: input.actor.userId ?? null, type: input.source === 'tech_app' ? 'technician' : (input.actor.userId ? 'user' : 'system') } }, { outbox: deps.outbox ?? null });
    }
    // service.completed — recorded with the completion, in its transaction (Constitution 8 transactional outbox)
    if (deps.outbox && !duplicate) await deps.outbox.write(trx, createDomainEvent({
      eventType: DOMAIN_EVENTS.SERVICE_COMPLETED, tenantId: input.tenantId, branchId: branchId ?? undefined, aggregateType: 'ticket', aggregateId: input.ticketId,
      actorId: input.actor.userId || undefined, actorType: 'user', correlationId: `ticket:${input.ticketId}`,
      payload: { ticketId: input.ticketId, status: input.lock ? 'sent_to_service_done' : 'completed', source: input.source, technicianIds, subtotalCents: subtotal, idempotencyKey: key },
    }));
  } else if (existing && existing.idempotency_key !== key && existing.status === 'COMPLETED') {
    await trx.updateTable('ticket_service_sessions').set({ idempotency_key: key, version: sql`version + 1`, updated_at: sql`now()` }).where('tenant_id', '=', input.tenantId).where('id', '=', existing.id).execute();
  }

  if (input.lock && !alreadyLocked) {
    await trx.updateTable('tickets').set({ service_done_locked_at: sql`now()`, service_done_locked_by_user_id: input.actor.userId ?? null, service_done_locked_total_cents: subtotal, updated_at: sql`now()` })
      .where('tenant_id', '=', input.tenantId).where('id', '=', input.ticketId).execute();
    justLocked = true;
  }
  const locked = alreadyLocked || justLocked;
  // a "send" that finds the ticket already sent under the same key is the documented duplicate
  if (input.lock && alreadyLocked && alreadyDone) duplicate = duplicate || (existing?.idempotency_key === key);
  return { ticketId: input.ticketId, duplicate, idempotencyKey: key, subtotalCents: subtotal, locked, technicianIds, justLocked, branchId };
}
