// workforce-status.kysely.repository.ts — Postgres adapter over technician_workforce_state (579). Every write is
// `UPDATE … WHERE technician_id = ? AND tenant_id = ? AND version = ?` (compare-and-set) and ALSO upserts the legacy
// technician_statuses compatibility row (update-then-insert — see cas()) in the same transaction, so
// the readers that have not been switched yet keep seeing a consistent value.
//
// Legacy readers still on technician_statuses (switch them to listBranchStates / getTechnicianState):
//   overview, dashboard, owner (3 reads), pos-team (2 reads), checkout, service-done, check-in, queue, tech-queue,
//   serving (2 reads), tech-appointments, tech (dashboardRaw/breakContext).
import { sql, type Kysely } from 'kysely';
import { assertTransition, type DB } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { TECH_WORKFORCE_CLOCK, TECH_WORKFORCE_SHIFT, TECH_WORKFORCE_QUEUE } from '../workforce-lifecycles';
import type { WorkforceStateStore, WorkforceRow, SeedFacts, WorkforceCasHook } from './workforce-status.repository';
import { normalizeEmployment, deriveQueue, type WorkforceFacts, type ClockStatus, type ServiceState, type EmploymentStatus } from './workforce-status-core';

/** The columns a WorkforceRow is built from (explicit columns — the response-exposure ratchet). */
const COLS = ['tenant_id', 'branch_id', 'technician_id', 'employment_status', 'clock_status', 'shift_status', 'queue_status', 'service_state',
  'current_ticket_id', 'manual_unavailable', 'open_shift_id', 'break_started_at', 'updated_at', 'version'] as const;
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

function toRow(r: any): WorkforceRow {
  return {
    tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, technicianId: String(r.technician_id),
    employment: normalizeEmployment(r.employment_status) as EmploymentStatus,
    clock: String(r.clock_status) as ClockStatus, service: String(r.service_state) as ServiceState,
    currentTicketId: r.current_ticket_id ? String(r.current_ticket_id) : null, manualUnavailable: !!r.manual_unavailable,
    openShiftId: r.open_shift_id ? String(r.open_shift_id) : null, breakStartedAt: iso(r.break_started_at),
    updatedAt: iso(r.updated_at) || new Date().toISOString(), version: Number(r.version || 1),
  };
}

export class KyselyWorkforceStateStore implements WorkforceStateStore {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter | null) {}
  /** Will a state change reach the boards through the realtime projection? (outbox AND publisher on — §343) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }

  async get(tenantId: string, technicianId: string): Promise<WorkforceRow | null> {
    const r = await this.db.selectFrom('technician_workforce_state').select([...COLS])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).executeTakeFirst();
    return r ? toRow(r) : null;
  }

  async seedFacts(tenantId: string, technicianId: string): Promise<SeedFacts | null> {
    const t: any = await this.db.selectFrom('technicians').select(['id', 'branch_id', 'status', 'is_active', 'archived_at'])
      .where('tenant_id', '=', tenantId).where('id', '=', technicianId).executeTakeFirst();
    if (!t) return null;
    const open: any = await this.db.selectFrom('technician_shifts').select(['id'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('end_time', 'is', null).where('status', '=', 'active')
      .orderBy('start_time', 'desc').executeTakeFirst().catch(() => undefined);
    const legacy: any = await this.db.selectFrom('technician_statuses').select(['status'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).orderBy('changed_at', 'desc').executeTakeFirst().catch(() => undefined);
    return { branchId: t.branch_id ? String(t.branch_id) : null, employment: normalizeEmployment(t.status, t.is_active, t.archived_at), legacyStatus: legacy?.status ?? null, openShiftId: open?.id ? String(open.id) : null };
  }

  async create(row: Omit<WorkforceRow, 'updatedAt' | 'version'>): Promise<WorkforceRow> {
    await this.db.insertInto('technician_workforce_state').values({
      tenant_id: row.tenantId, branch_id: row.branchId, technician_id: row.technicianId,
      employment_status: row.employment, clock_status: row.clock, shift_status: row.clock === 'CLOCKED_OUT' ? 'OFF_SHIFT' : 'ON_SHIFT',
      queue_status: deriveQueue(row), service_state: row.service, manual_unavailable: row.manualUnavailable,
      current_ticket_id: row.currentTicketId, open_shift_id: row.openShiftId, break_started_at: row.breakStartedAt, updated_at: new Date(),
    } as any).onConflict((oc) => oc.columns(['tenant_id', 'technician_id']).doNothing()).execute();   // 585: tenant-keyed
    return (await this.get(row.tenantId, row.technicianId))!;
  }

  async cas(tenantId: string, technicianId: string, expectedVersion: number, next: WorkforceFacts, extra: { openShiftId?: string | null; breakStartedAt?: string | null; branchId?: string | null }, legacyStatus: string, hook?: WorkforceCasHook): Promise<WorkforceRow | null> {
    return this.db.transaction().execute(async (trx) => {
      // The row this CAS replaces (same version) — its clock / shift / queue must be allowed to move to the new ones.
      const cur: any = await trx.selectFrom('technician_workforce_state').select(['clock_status', 'shift_status', 'queue_status'])
        .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('version', '=', expectedVersion).executeTakeFirst();
      if (!cur) return null;   // VERSION_CONFLICT
      const nextShift = next.clock === 'CLOCKED_OUT' ? 'OFF_SHIFT' : 'ON_SHIFT';
      const nextQueue = deriveQueue(next);
      assertTransition(TECH_WORKFORCE_CLOCK, cur.clock_status, next.clock);
      assertTransition(TECH_WORKFORCE_SHIFT, cur.shift_status, nextShift);
      assertTransition(TECH_WORKFORCE_QUEUE, cur.queue_status, nextQueue);
      const patch: Record<string, unknown> = {
        employment_status: next.employment, clock_status: next.clock, shift_status: nextShift,
        queue_status: nextQueue, service_state: next.service, manual_unavailable: next.manualUnavailable,
        current_ticket_id: next.currentTicketId, updated_at: new Date(), version: sql`version + 1`,
      };
      if (extra.openShiftId !== undefined) patch.open_shift_id = extra.openShiftId;
      if (extra.breakStartedAt !== undefined) patch.break_started_at = extra.breakStartedAt ? new Date(extra.breakStartedAt) : null;
      if (extra.branchId !== undefined) patch.branch_id = extra.branchId;
      const upd = await trx.updateTable('technician_workforce_state').set(patch)
        .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('version', '=', expectedVersion)
        .returning([...COLS]).executeTakeFirst();
      if (!upd) return null;   // VERSION_CONFLICT — the caller re-reads and decides
      const branchId = upd.branch_id;
      // Compatibility row for the legacy readers. technician_statuses has NO unique key (579 de-duplicates it but adds
      // no index — modules/queue/src/tech still appends rows), so this is update-then-insert, tenant-scoped, inside the
      // same transaction. branch_id is NOT NULL on the legacy table, so a technician with no branch falls back to the
      // tenant id (tenant-scoped either way).
      const legacyUpd: any = await trx.updateTable('technician_statuses').set({ status: legacyStatus, changed_at: new Date(), branch_id: branchId || tenantId })
        .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).executeTakeFirst();
      if (!Number(legacyUpd?.numUpdatedRows ?? 0)) {
        await trx.insertInto('technician_statuses').values({ tenant_id: tenantId, branch_id: branchId || tenantId, technician_id: technicianId, status: legacyStatus, changed_at: new Date() }).execute();
      }
      const row = toRow(upd);
      // §343: the boards (Staff on Duty, Live Operations) and the technician's own app learn through the projection.
      // M4: recorded BEFORE the turn hook — the hook takes the branch's turn lock, held to commit, so everything after it
      // is paid in series by every technician of a clock-in burst (same transaction, same commit, either order).
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_STATUS_CHANGED, tenantId, branchId: isUuid(row.branchId) ? row.branchId : undefined,
          aggregateType: 'technician', aggregateId: technicianId, actorType: 'system',
          payload: { technicianId, branchId: row.branchId, employment: row.employment, clock: row.clock, shift: nextShift, queue: nextQueue, service: row.service, version: row.version } }));
      }
      // Fair Turn Engine: the turn queue moves with the clock, in this transaction (clock-in joins, clock-out leaves, …)
      if (hook) await hook(trx, row);
      return row;
    });
  }

  async turnSync(row: WorkforceRow, hook: WorkforceCasHook): Promise<void> {
    await this.db.transaction().execute(async (trx) => { await hook(trx, row); });
  }

  async listBranch(tenantId: string, branchId: string | null): Promise<WorkforceRow[]> {
    let q = this.db.selectFrom('technician_workforce_state').select([...COLS]).where('tenant_id', '=', tenantId);
    if (branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    const rows = await q.execute();
    return rows.map(toRow);
  }
}
