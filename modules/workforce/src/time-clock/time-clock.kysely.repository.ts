// time-clock.kysely.repository.ts — Kysely adapter over technician_shifts (the punch) + technician_breaks (580).
// Tenant/branch scoping is server-derived from ctx. Concurrency is carried by the schema (Technician Profile merge):
//   • one OPEN punch per technician  — partial unique uq_technician_shifts_open_punch (580): a racing second clock-in
//     inserts nothing (ON CONFLICT on the partial index) and this adapter returns the EXISTING open punch (created=false);
//   • one OPEN break per technician  — partial unique uq_technician_breaks_open (580), same treatment;
//   • clock-out is a compare-and-set (`WHERE end_time IS NULL`), so two clock-outs close the punch exactly once.
// The legacy technician_statuses compat row is NOT written here any more — WorkforceStatusService owns it (579).
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate, utcDate } from '@aipowersalon/date-time';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { KyselyAuditRepository } from '@aipowersalon/audit';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TimeClockContext, ShiftPunch, BreakRow } from './time-clock.dto';
import { ACTIVE_STATUS, CLOCKED_OUT_STATUS } from './time-clock.dto';
import type { TimeClockRepositoryPort, TechnicianRef } from './time-clock.repository';
const isoOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
// a DATE column comes back as a Date at UTC midnight — its UTC day IS the stored calendar date (not a 'today')
const dateOf = (v: unknown): string => (v instanceof Date ? utcDate(v) : String(v ?? '').slice(0, 10));
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
import { buildMediaUrl } from '@aipowersalon/media';
import { loadScheduleFacts } from '../availability/availability-port.adapter';
import { isTechnicianAvailableAt, DAY_NAMES_LOCAL } from '../availability/availability-core';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';

export class KyselyTimeClockRepository implements TimeClockRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  async timeZone(ctx: TimeClockContext): Promise<string> { return branchTimeZone(this.db, ctx.tenantId, ctx.branchId); }
  /** 200-Technician 04: scheduled today = a working weekly day whose START the availability core accepts (not on approved time
   *  off / blocked then) — the same facts and rule the booking eligibility uses; one technician at a time, at most 200. */
  async scheduledStarts(ctx: TimeClockContext, dateStr: string, technicianIds: string[]): Promise<{ technicianId: string; startTime: string }[]> {
    const out: { technicianId: string; startTime: string }[] = [];
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    for (const technicianId of technicianIds.slice(0, 200)) {
      const facts = await loadScheduleFacts(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, dateIso: dateStr });
      const day = facts?.weekly[DAY_NAMES_LOCAL[dow]];
      if (!facts || !day?.isWorking || !day.startTime) continue;
      const at = localDateTimeToEpochMs(dateStr, day.startTime, facts.timezone);
      if (!Number.isFinite(at) || !isTechnicianAvailableAt({ ...facts, liveBreaks: [] }, at, 1).available) continue;
      out.push({ technicianId, startTime: day.startTime });
    }
    return out;
  }
  /** Will the clock change reach the boards through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  /** technician.clocked_in / clocked_out — declared since Constitution 8, recorded by nothing until now. */
  private async clockFact(trx: any, ctx: TimeClockContext, type: string, punchId: string, branchId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: isUuid(branchId) ? branchId : undefined,
      aggregateType: 'technician_shift', aggregateId: punchId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', payload }));
  }
  private scope(qb: any, ctx: TimeClockContext, tenantCol: string, branchCol: string): any {
    let q = qb.where(tenantCol, '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(branchCol, '=', ctx.branchId), eb(branchCol, 'is', null)]));
    return q;
  }

  async listTechnicians(ctx: TimeClockContext): Promise<TechnicianRef[]> {
    const rows = await this.scope(this.db.selectFrom('technicians as tech'), ctx, 'tech.tenant_id', 'tech.branch_id')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.is_active', '=', true)
      .select(['tech.id', 'tech.full_name', 'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'])
      .orderBy('tech.full_name', 'asc').execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => {
      const rawPhoto = r.tech_avatar_url || r.gtp_avatar_url || r.user_avatar_url || null;
      return { technicianId: String(r.id), technicianName: r.full_name ?? null, avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null };
    });
  }

  private punch(r: any): ShiftPunch {
    return { id: String(r.id), technicianId: String(r.technician_id), shiftDate: dateOf(r.shift_date), startTime: isoOf(r.start_time), endTime: isoOf(r.end_time), status: String(r.status || '') };
  }
  /** The columns a BreakRow is built from (explicit — the response-exposure ratchet). */
  private static readonly BREAK_COLS = ['id', 'technician_id', 'shift_id', 'kind', 'reason', 'started_at', 'ended_at', 'started_by', 'ended_by', 'classification', 'paid_minutes', 'unpaid_minutes', 'interrupted_at'] as const;
  private brk(r: any): BreakRow {
    return { id: String(r.id), technicianId: String(r.technician_id), shiftId: r.shift_id ? String(r.shift_id) : null, kind: String(r.kind || 'break'), reason: r.reason ?? null, startedAt: isoOf(r.started_at)!, endedAt: isoOf(r.ended_at), startedBy: r.started_by ?? null, endedBy: r.ended_by ?? null,
      classification: r.classification ?? null, paidMinutes: r.paid_minutes ?? null, unpaidMinutes: r.unpaid_minutes ?? null, interruptedAt: isoOf(r.interrupted_at) };
  }

  // The day's punches PLUS any still-open punch from an earlier salon-day (an overnight shift or a missed clock-out must
  // still read as "clocked in" — clock-out finds the open punch regardless of its date).
  async listTodayPunches(ctx: TimeClockContext, dateStr: string, technicianId?: string): Promise<ShiftPunch[]> {
    let q = this.scope(this.db.selectFrom('technician_shifts'), ctx, 'tenant_id', 'branch_id')
      .where((eb: any) => eb.or([eb('shift_date', '=', dateStr), eb.and([eb('end_time', 'is', null), eb('status', '=', ACTIVE_STATUS)])]));
    if (technicianId) q = q.where('technician_id', '=', technicianId);   // idx_technician_shifts_tenant_tech_date
    const rows = await q.select(['id', 'technician_id', 'shift_date', 'start_time', 'end_time', 'status']).execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => this.punch(r));
  }

  async findOpenPunch(ctx: TimeClockContext, technicianId: string): Promise<ShiftPunch | null> {
    const r = await this.db.selectFrom('technician_shifts').select(['id', 'technician_id', 'shift_date', 'start_time', 'end_time', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('end_time', 'is', null).where('status', '=', ACTIVE_STATUS)
      .orderBy('start_time', 'desc').executeTakeFirst();
    return r ? this.punch(r) : null;
  }

  async technicianExists(ctx: TimeClockContext, technicianId: string): Promise<boolean> {
    const row = await this.scope(this.db.selectFrom('technicians'), ctx, 'tenant_id', 'branch_id')
      .where('id', '=', technicianId).select(['id']).executeTakeFirst().catch(() => undefined);
    return !!row;
  }

  async insertPunch(ctx: TimeClockContext, technicianId: string, dateStr: string, startIso: string): Promise<{ punch: ShiftPunch; created: boolean }> {
    const branchId = ctx.branchId || (await this.techBranch(ctx, technicianId));
    // ON CONFLICT on the partial unique index (580): a racing second clock-in inserts NOTHING instead of raising inside
    // the transaction — the existing open punch is returned (created=false). The outbox fact is recorded only for a
    // real insert, in the same transaction.
    const row = await this.db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('technician_shifts').values({
        tenant_id: ctx.tenantId, branch_id: branchId, technician_id: technicianId, shift_date: dateStr,
        start_time: new Date(startIso), end_time: null, status: ACTIVE_STATUS, updated_at: new Date(),
      }).onConflict((oc) => oc.columns(['tenant_id', 'technician_id']).where('end_time', 'is', null).where('status', '=', ACTIVE_STATUS).doNothing())
        .returning(['id', 'technician_id', 'shift_date', 'start_time', 'end_time', 'status']).executeTakeFirst();
      if (r) await this.clockFact(trx, ctx, DOMAIN_EVENTS.TECHNICIAN_CLOCKED_IN, String(r.id), branchId, { technicianId, shiftDate: dateStr, startTime: startIso });
      return r;
    });
    if (row) return { punch: this.punch(row), created: true };
    const open = await this.findOpenPunch(ctx, technicianId);   // the other writer won — return their punch
    if (!open) throw new Error('Clock-in did not insert and no open punch exists');
    return { punch: open, created: false };
  }

  async closePunch(ctx: TimeClockContext, punchId: string, endIso: string): Promise<ShiftPunch | null> {
    const updated = await this.db.transaction().execute(async (trx) => {
      const u: any = await trx.updateTable('technician_shifts')
        .set({ end_time: new Date(endIso), status: CLOCKED_OUT_STATUS, updated_at: new Date() })
        .where('tenant_id', '=', ctx.tenantId).where('id', '=', punchId).where('end_time', 'is', null)   // CAS: only if still open
        .returning(['id', 'technician_id', 'branch_id', 'shift_date', 'start_time', 'end_time', 'status']).executeTakeFirst();
      if (u) await this.clockFact(trx, ctx, DOMAIN_EVENTS.TECHNICIAN_CLOCKED_OUT, String(u.id), String(u.branch_id ?? ''), { technicianId: String(u.technician_id), endTime: endIso });
      return u;
    });
    return updated ? this.punch(updated) : null;
  }

  async openBreak(ctx: TimeClockContext, technicianId: string, shiftId: string | null, startIso: string, by: string, kind: string, reason?: string | null): Promise<{ brk: BreakRow; created: boolean }> {
    const row = await this.db.insertInto('technician_breaks').values({
      tenant_id: ctx.tenantId, branch_id: isUuid(ctx.branchId) ? ctx.branchId : null, technician_id: technicianId, shift_id: shiftId, kind, reason: reason ?? null,
      started_at: new Date(startIso), ended_at: null, started_by: by, ended_by: null,
    } as any).onConflict((oc) => oc.columns(['tenant_id', 'technician_id']).where('ended_at', 'is', null).doNothing())   // one OPEN break (580)
      .returning([...KyselyTimeClockRepository.BREAK_COLS]).executeTakeFirst();
    if (row) return { brk: this.brk(row), created: true };
    const open = await this.db.selectFrom('technician_breaks').select([...KyselyTimeClockRepository.BREAK_COLS]).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('ended_at', 'is', null).executeTakeFirst();
    if (!open) throw new Error('Break did not insert and no open break exists');
    return { brk: this.brk(open), created: false };
  }

  async closeBreak(ctx: TimeClockContext, technicianId: string, endIso: string, by: string): Promise<BreakRow | null> {
    const row = await this.db.updateTable('technician_breaks').set({ ended_at: new Date(endIso), ended_by: by })
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('ended_at', 'is', null)
      .returning([...KyselyTimeClockRepository.BREAK_COLS]).executeTakeFirst();
    return row ? this.brk(row) : null;
  }

  // ── Fair Turn Engine §31–40 (603) ──
  async breakPolicyLayers(ctx: TimeClockContext): Promise<{ salon: unknown; branch: unknown; version: number }> {
    const rows: any[] = await this.db.selectFrom('time_clock_break_policies').select(['branch_id', 'policy', 'version']).where('tenant_id', '=', ctx.tenantId).execute();
    const salon = rows.find((r) => !r.branch_id); const branch = isUuid(ctx.branchId) ? rows.find((r) => r.branch_id === ctx.branchId) : undefined;
    return { salon: salon?.policy ?? null, branch: branch?.policy ?? null, version: Number(branch?.version ?? salon?.version ?? 0) };
  }
  async saveBreakPolicy(ctx: TimeClockContext, scope: 'salon' | 'branch', policy: Record<string, unknown>, reason: string | null): Promise<{ version: number }> {
    const branchId = scope === 'branch' && isUuid(ctx.branchId) ? ctx.branchId : null;
    return this.db.transaction().execute(async (trx) => {
      let q = trx.selectFrom('time_clock_break_policies').select(['id', 'version']).where('tenant_id', '=', ctx.tenantId);
      q = branchId ? q.where('branch_id', '=', branchId) : q.where('branch_id', 'is', null);
      const cur: any = await q.forUpdate().executeTakeFirst();
      const actor = isUuid(ctx.userId) ? ctx.userId : null;
      let version: number;
      if (cur) { version = Number(cur.version) + 1; await trx.updateTable('time_clock_break_policies').set({ policy: JSON.stringify(policy), version, reason, updated_at: new Date(), updated_by: actor } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', cur.id).execute(); }
      else { version = 1; await trx.insertInto('time_clock_break_policies').values({ tenant_id: ctx.tenantId, branch_id: branchId, version, policy: JSON.stringify(policy), reason, updated_by: actor }).execute(); }
      await new KyselyAuditRepository(trx).record({ tenantId: ctx.tenantId, branchId, userId: actor, role: ctx.role ?? 'MANAGER' },
        { module: 'workforce', action: 'time_clock_break_policy_changed', resourceType: 'time_clock_break_policy', resourceId: branchId ?? ctx.tenantId, reason: reason ?? undefined, after: { version, policy } });
      return { version };
    });
  }
  async classifyBreak(ctx: TimeClockContext, breakId: string, c: { classification: string; paidMinutes: number; unpaidMinutes: number; policyVersion: number }): Promise<void> {
    await this.db.updateTable('technician_breaks').set({ classification: c.classification, paid_minutes: c.paidMinutes, unpaid_minutes: c.unpaidMinutes, policy_version: c.policyVersion })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', breakId).execute();
  }
  async interruptBreak(ctx: TimeClockContext, technicianId: string, endIso: string, by: string, reason: string): Promise<BreakRow | null> {
    const row = await this.db.updateTable('technician_breaks').set({ ended_at: new Date(endIso), ended_by: by, interrupted_at: new Date(endIso), interrupted_by: by, interruption_reason: reason.slice(0, 500) })
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('ended_at', 'is', null)
      .returning([...KyselyTimeClockRepository.BREAK_COLS]).executeTakeFirst();
    return row ? this.brk(row) : null;
  }

  async listBreaksForDate(ctx: TimeClockContext, dateStr: string, tz: string, technicianId?: string): Promise<BreakRow[]> {
    // A break belongs to the salon-local day it STARTED on; open breaks are always included.
    let q = this.db.selectFrom('technician_breaks').select([...KyselyTimeClockRepository.BREAK_COLS]).where('tenant_id', '=', ctx.tenantId)
      .where((eb) => eb.or([eb('ended_at', 'is', null), eb('started_at', '>=', new Date(Date.now() - 48 * 3_600_000) as any)]));
    if (technicianId) q = q.where('technician_id', '=', technicianId);
    const rows = await q.execute().catch(() => [] as any[]);
    return rows.map((r) => this.brk(r)).filter((b) => !b.endedAt || businessDate(tz, new Date(b.startedAt)) === dateStr);
  }

  private async techBranch(ctx: TimeClockContext, technicianId: string): Promise<string> {
    const row = await this.db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId)
      .select(['branch_id']).executeTakeFirst().catch(() => undefined);
    return row?.branch_id || ctx.tenantId; // fallback keeps NOT NULL satisfied; tenant-scoped either way
  }
}
