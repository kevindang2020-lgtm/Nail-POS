// KyselyClockManagementRepository — real technician_shifts (the punch), technician_timecard_adjustments (the append-only
// correction trail), and audit_logs. Every read/write is tenant-scoped AND branch-scoped (a manager at branch A cannot
// touch branch B's punches). A correction is ONE transaction: trail rows + punch update + audit row — the audit write
// is mandatory; if it fails nothing is corrected (workforce audit: "make the audit write non-optional").
import { Kysely, sql } from 'kysely';
import { KyselyAuditRepository } from '@aipowersalon/audit';
import type { DB } from '@aipowersalon/database';
import type { ClockManagementRepository, ClockManagementCtx, TimecardShift, AdjustmentChange, TimecardBreak } from './technician-clock-management.service';
import { classifyBreak, mergeBreakPolicy } from '../time-clock/break-policy';

const iso = (v: unknown): string | null => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));

export class KyselyClockManagementRepository implements ClockManagementRepository {
  constructor(private readonly db: Kysely<DB>) {}

  private scoped(qb: any, ctx: ClockManagementCtx): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    return q;
  }

  async getShift(ctx: ClockManagementCtx, shiftId: string): Promise<TimecardShift | null> {
    const r = await this.scoped(this.db.selectFrom('technician_shifts'), ctx)
      .select(['id', 'technician_id', 'branch_id', 'start_time', 'end_time'])
      .where('id', '=', shiftId)
      .executeTakeFirst();
    if (!r) return null;
    return { id: r.id, technicianId: r.technician_id, branchId: r.branch_id ?? null, startTime: iso(r.start_time), endTime: iso(r.end_time) };
  }

  async applyCorrection(ctx: ClockManagementCtx, shift: TimecardShift, changes: AdjustmentChange[], times: { startTime?: string | null; endTime?: string | null }, reason: string, actorId: string): Promise<void> {
    if (!changes.length) return;
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('technician_timecard_adjustments').values(changes.map((c) => ({
        tenant_id: ctx.tenantId, branch_id: shift.branchId ?? ctx.branchId ?? null, shift_id: shift.id, technician_id: shift.technicianId,
        field: c.field, original_value: c.originalValue ? new Date(c.originalValue) : null, new_value: c.newValue ? new Date(c.newValue) : null,
        reason, adjusted_by: actorId,
      })) as any).execute();
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (times.startTime !== undefined) patch.start_time = times.startTime ? new Date(times.startTime) : null;
      if (times.endTime !== undefined) { patch.end_time = times.endTime ? new Date(times.endTime) : null; patch.status = times.endTime ? 'completed' : 'active'; }
      const upd = await this.scoped(trx.updateTable('technician_shifts'), ctx).set(patch as any).where('id', '=', shift.id).executeTakeFirst();
      if (!Number((upd as any)?.numUpdatedRows ?? 0)) throw new Error('Timecard entry not found in this branch');
      // Audit is part of the transaction — NOT swallowed. A correction nobody can see in the audit log is the bug.
      // (through modules/audit's repository on THIS transaction — audit_events, with before/after and the reason)
      await new KyselyAuditRepository(trx as any).record(
        { tenantId: ctx.tenantId, branchId: shift.branchId ?? ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? 'MANAGER' },
        { module: 'workforce', action: 'technician_timecard_adjusted', resourceType: 'technician_clock', resourceId: shift.id, reason,
          before: { startTime: shift.startTime, endTime: shift.endTime }, after: times,
          metadata: { technicianId: shift.technicianId, fields: changes.map((c) => c.field) } });
    });
  }

  async getBreak(ctx: ClockManagementCtx, breakId: string): Promise<TimecardBreak | null> {
    if (!/^[0-9a-f-]{36}$/i.test(breakId)) return null;
    let q = this.db.selectFrom('technician_breaks').select(['id', 'technician_id', 'shift_id', 'branch_id', 'kind', 'started_at', 'ended_at', 'interrupted_at'] as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', breakId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    const r: any = await q.executeTakeFirst();
    return r ? { id: String(r.id), technicianId: String(r.technician_id), shiftId: r.shift_id ?? null, branchId: r.branch_id ?? null, kind: String(r.kind ?? 'break'), startedAt: iso(r.started_at)!, endedAt: iso(r.ended_at), interruptedAt: iso(r.interrupted_at) } : null;
  }
  /** ONE transaction: trail rows (break_id) + the break update + its re-classification + the audit row. */
  async applyBreakCorrection(ctx: ClockManagementCtx, brk: TimecardBreak, changes: AdjustmentChange[], times: { startedAt?: string | null; endedAt?: string | null }, reason: string, actorId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('technician_timecard_adjustments').values(changes.map((c) => ({
        tenant_id: ctx.tenantId, branch_id: brk.branchId ?? ctx.branchId ?? null, shift_id: brk.shiftId!, technician_id: brk.technicianId, break_id: brk.id,
        field: c.field, original_value: c.originalValue ? new Date(c.originalValue) : null, new_value: c.newValue ? new Date(c.newValue) : null, reason, adjusted_by: actorId,
      })) as any).execute();
      const start = times.startedAt ?? brk.startedAt; const end = times.endedAt !== undefined ? times.endedAt : brk.endedAt;
      const patch: Record<string, unknown> = {};
      if (times.startedAt) patch.started_at = new Date(times.startedAt);
      if (times.endedAt !== undefined) patch.ended_at = times.endedAt ? new Date(times.endedAt) : null;
      if (end) {
        const rows: any[] = await trx.selectFrom('time_clock_break_policies').select(['branch_id', 'policy', 'version'] as any).where('tenant_id', '=', ctx.tenantId).execute();
        const salon = rows.find((r) => !r.branch_id); const branch = rows.find((r) => brk.branchId && r.branch_id === brk.branchId);
        const c = classifyBreak(mergeBreakPolicy({ salon: salon?.policy ?? null, branch: branch?.policy ?? null }), { kind: brk.kind, minutes: Math.round((Date.parse(end) - Date.parse(start)) / 60000), interrupted: !!brk.interruptedAt });
        Object.assign(patch, { classification: c.classification, paid_minutes: c.paidMinutes, unpaid_minutes: c.unpaidMinutes, policy_version: Number(branch?.version ?? salon?.version ?? 0) });
      }
      await trx.updateTable('technician_breaks').set(patch as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', brk.id).execute();
      await new KyselyAuditRepository(trx as any).record(
        { tenantId: ctx.tenantId, branchId: brk.branchId ?? ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? 'MANAGER' },
        { module: 'workforce', action: 'technician_break_adjusted', resourceType: 'technician_break', resourceId: brk.id, reason,
          before: { startedAt: brk.startedAt, endedAt: brk.endedAt }, after: times, metadata: { technicianId: brk.technicianId, fields: changes.map((c) => c.field) } });
    });
  }

  async writeAudit(ctx: ClockManagementCtx, action: string, entityId: string, metadata: unknown): Promise<void> {
    await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      VALUES (${ctx.tenantId}, ${ctx.branchId ?? null}, ${ctx.userId}, ${ctx.role ?? 'MANAGER'}, ${action}, ${'technician_clock'}, ${entityId}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db);
  }
}
