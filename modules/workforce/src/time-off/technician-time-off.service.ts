// technician-time-off.service.ts — time-off requests (technician_time_off, 528 + 582). Merge Oct 12 2026 (the other chat's
// live-technician-schedule/technician-time-off.service.ts; Technician Profile mandate §20–§21):
//   • a technician requests from the Tech app (`pending`) — the technician is resolved from the SESSION user, a client
//     can never name another technician;
//   • a manager decides on the POS (approved | rejected), exactly once (compare-and-set through TECHNICIAN_TIME_OFF);
//   • a manager may enter approved time off directly (the manager IS the approver);
//   • a technician withdraws only her own pending request (→ cancelled, kept for the record).
// Only `approved` rows remove availability (TechniciansRepository.getSchedule().unavailableDates, the live board, and the
// eligibility engine's KyselyAvailabilityPort). Tenant / branch / actor are server-derived; every write is audited through
// AuditService; every change writes a `technician.time_off_changed` domain event in the SAME transaction as the row (the
// realtime projection turns it into technician_schedule_updated for the branch room + the technician's own room — the
// module never emits realtime itself, Constitution 9 §343).
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { type TimeOffDb, listTimeOff, getTimeOff, insertTimeOff, decideTimeOff, withdrawTimeOff, technicianInScope, TIME_OFF_KINDS, TIME_OFF_STATUSES, type TimeOffKind, type TimeOffRow, type TimeOffStatus } from './time-off.store';

export class TimeOffError extends Error { constructor(msg: string, public readonly status = 400, public readonly code = 'invalid_input') { super(msg); this.name = 'TimeOffError'; } }

export interface TimeOffCtx { tenantId: string; branchId?: string | null; userId: string; role?: string }
export interface TimeOffInput { startsAt: string; endsAt: string; kind?: string | null; reason?: string | null; allBranches?: boolean }
export interface TimeOffFilters { status?: string; from?: string; to?: string }

export const TIME_OFF_MAX_DAYS = 120;

export function validateTimeOff(i: TimeOffInput): { startsAt: string; endsAt: string; kind: TimeOffKind; reason: string | null } {
  const s = new Date(i?.startsAt), e = new Date(i?.endsAt);
  if (!isFinite(s.getTime()) || !isFinite(e.getTime())) throw new TimeOffError('startsAt and endsAt must be valid timestamps');
  if (e.getTime() <= s.getTime()) throw new TimeOffError('endsAt must be after startsAt', 400, 'invalid_range');
  if (e.getTime() - s.getTime() > TIME_OFF_MAX_DAYS * 86_400_000) throw new TimeOffError(`Time off cannot exceed ${TIME_OFF_MAX_DAYS} days in one request`, 400, 'invalid_range');
  const kind = String(i.kind || 'PERSONAL').toUpperCase() as TimeOffKind;
  if (!TIME_OFF_KINDS.includes(kind)) throw new TimeOffError('kind must be VACATION, SICK, PERSONAL or UNAVAILABLE');
  const reason = (i.reason ?? '').toString().trim().slice(0, 500) || null;
  return { startsAt: s.toISOString(), endsAt: e.toISOString(), kind, reason };
}
function statusFilter(v: unknown): TimeOffStatus | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).toLowerCase();
  if (!(TIME_OFF_STATUSES as string[]).includes(s)) throw new TimeOffError('status must be pending, approved, rejected or cancelled');
  return s as TimeOffStatus;
}

export class TechnicianTimeOffService {
  constructor(private readonly db: Kysely<DB> | null | undefined, private readonly outbox?: OutboxWriter | null, private readonly auditSvc?: AuditService | null) {}
  private need(): Kysely<DB> { if (!this.db) throw new TimeOffError('Time off is not available without a database', 503, 'unavailable'); return this.db; }

  private async audit(ctx: TimeOffCtx, action: string, entityId: string, metadata: Record<string, unknown>) {
    await this.auditSvc?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId, role: ctx.role ?? null },
      { module: 'workforce', action, resourceType: 'technician_time_off', resourceId: entityId, severity: 'low', metadata });
  }
  /** The row write + its domain event, one transaction (no event for a write that rolled back, no write without its event). */
  private async tx<T>(fn: (trx: TimeOffDb) => Promise<T>): Promise<T> { return this.need().transaction().execute((trx) => fn(trx)); }
  private async event(trx: TimeOffDb, ctx: TimeOffCtx, technicianId: string, row: TimeOffRow, action: string): Promise<void> {
    await this.outbox?.write(trx as any, createDomainEvent({
      eventType: DOMAIN_EVENTS.TECHNICIAN_TIME_OFF_CHANGED, tenantId: ctx.tenantId, branchId: ctx.branchId || row.branchId || undefined,
      aggregateType: 'technician_time_off', aggregateId: row.id, actorId: ctx.userId || undefined, actorType: 'user',
      payload: { technicianId, timeOffId: row.id, status: row.status, action },
    }));
  }

  // ---- technician (own) ----
  /** The calling technician, resolved from the session (users.id → technicians.user_id, active, this tenant). */
  async myTechnicianId(ctx: TimeOffCtx): Promise<string> {
    const r: any = await this.need().selectFrom('technicians').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst();
    if (!r) throw new TimeOffError('This account is not an active technician at this salon', 403, 'not_technician');
    return String(r.id);
  }
  async listMine(ctx: TimeOffCtx, f: TimeOffFilters = {}): Promise<TimeOffRow[]> {
    const technicianId = await this.myTechnicianId(ctx);
    return listTimeOff(this.need(), ctx.tenantId, technicianId, { status: statusFilter(f.status), from: f.from, to: f.to });
  }
  async requestMine(ctx: TimeOffCtx, input: TimeOffInput): Promise<TimeOffRow> {
    const technicianId = await this.myTechnicianId(ctx);
    const v = validateTimeOff(input);
    const row = await this.tx(async (trx) => {
      const r = await insertTimeOff(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, ...v, requestedBy: ctx.userId, status: 'pending' });
      await this.event(trx, ctx, technicianId, r, 'requested'); return r;
    });
    await this.audit(ctx, 'technician_time_off_requested', row.id, { technicianId, kind: v.kind, startsAt: v.startsAt, endsAt: v.endsAt });
    return row;
  }
  async cancelMine(ctx: TimeOffCtx, id: string): Promise<{ ok: true }> {
    const technicianId = await this.myTechnicianId(ctx);
    const ok = await this.tx(async (trx) => {
      if (!(await withdrawTimeOff(trx, ctx.tenantId, technicianId, id, ctx.userId))) return false;
      const row = await getTimeOff(trx, ctx.tenantId, id);
      if (row) await this.event(trx, ctx, technicianId, row, 'withdrawn');
      return true;
    });
    if (!ok) throw new TimeOffError('Only a pending request of your own can be withdrawn', 404, 'not_found');
    await this.audit(ctx, 'technician_time_off_cancelled', id, { technicianId });
    return { ok: true };
  }

  // ---- manager (POS) ----
  async listFor(ctx: TimeOffCtx, technicianId: string, f: TimeOffFilters = {}): Promise<TimeOffRow[]> {
    if (!(await technicianInScope(this.need(), ctx, technicianId))) throw new TimeOffError('Technician not found', 404, 'not_found');
    return listTimeOff(this.need(), ctx.tenantId, technicianId, { status: statusFilter(f.status), from: f.from, to: f.to });
  }
  async listPending(ctx: TimeOffCtx): Promise<TimeOffRow[]> {
    return listTimeOff(this.need(), ctx.tenantId, null, { status: 'pending', branchId: ctx.branchId || null });
  }
  /** A manager enters time off on a technician's behalf — approved immediately (the manager IS the approver). */
  async createFor(ctx: TimeOffCtx, technicianId: string, input: TimeOffInput): Promise<TimeOffRow> {
    const t = await technicianInScope(this.need(), ctx, technicianId);
    if (!t) throw new TimeOffError('Technician not found', 404, 'not_found');
    const v = validateTimeOff(input);
    const row = await this.tx(async (trx) => {
      const r = await insertTimeOff(trx, { tenantId: ctx.tenantId, branchId: input.allBranches ? null : (ctx.branchId || t.branchId), technicianId, ...v, requestedBy: ctx.userId, status: 'approved', approvedBy: ctx.userId });
      await this.event(trx, ctx, technicianId, r, 'entered'); return r;
    });
    await this.audit(ctx, 'technician_time_off_approved', row.id, { technicianId, kind: v.kind, startsAt: v.startsAt, endsAt: v.endsAt, enteredByManager: true });
    return row;
  }
  async decide(ctx: TimeOffCtx, technicianId: string, id: string, decision: string, note?: string | null): Promise<TimeOffRow> {
    const d = String(decision || '').toLowerCase();
    if (d !== 'approved' && d !== 'rejected') throw new TimeOffError('decision must be approved or rejected');
    if (!(await technicianInScope(this.need(), ctx, technicianId))) throw new TimeOffError('Technician not found', 404, 'not_found');
    const existing = await getTimeOff(this.need(), ctx.tenantId, id);
    if (!existing || existing.technicianId !== technicianId) throw new TimeOffError('Request not found', 404, 'not_found');
    const row = await this.tx(async (trx) => {
      const r = await decideTimeOff(trx, ctx.tenantId, id, d, ctx.userId, note ? String(note).slice(0, 500) : null);
      if (r) await this.event(trx, ctx, technicianId, r, d);
      return r;
    });
    if (!row) throw new TimeOffError('This request was already decided', 409, 'already_decided');
    await this.audit(ctx, d === 'approved' ? 'technician_time_off_approved' : 'technician_time_off_rejected', id, { technicianId, note: note ?? null });
    return row;
  }
}
