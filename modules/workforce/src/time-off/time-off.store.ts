// time-off.store.ts — the ONE persistence layer for the time-off REQUEST workflow on technician_time_off (528 + 582).
// Merge Oct 12 2026 (the other chat's live-technician-schedule/schedule-store.kysely.ts, time-off half; their 465 → our
// 528 table + 582 columns). Vocabulary is OURS (lowercase, 528): their REQUESTED → 'pending', APPROVED → 'approved',
// REJECTED → 'rejected'; a withdrawn request is 'cancelled' (theirs deleted the row — ours keeps it, audited).
// Every status write goes through the TECHNICIAN_TIME_OFF machine (workforce-lifecycles.ts) as a compare-and-set, so two
// managers cannot both decide and a decided request cannot be withdrawn. The weekly schedule + blocked time writers stay
// in technicians.kysely.repository (setSchedule: transactional + version) and the live schedule (blockTime) — not here.
import type { Kysely, Transaction } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { TECHNICIAN_TIME_OFF } from '../workforce-lifecycles';

/** Every writer takes the database OR a transaction (the service writes the row and its outbox event in one). */
export type TimeOffDb = Kysely<DB> | Transaction<DB>;

export type TimeOffKind = 'VACATION' | 'SICK' | 'PERSONAL' | 'UNAVAILABLE';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export const TIME_OFF_KINDS: TimeOffKind[] = ['VACATION', 'SICK', 'PERSONAL', 'UNAVAILABLE'];
export const TIME_OFF_STATUSES: TimeOffStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export interface TimeOffRow {
  id: string; tenantId: string; branchId: string | null; technicianId: string; startsAt: string; endsAt: string;
  kind: TimeOffKind; status: TimeOffStatus; reason: string | null; requestedBy: string | null; approvedBy: string | null;
  decidedAt: string | null; decisionNote: string | null; createdAt: string;
}
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const uuidOrNull = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);

/** The columns a TimeOffRow needs — never a whole-row read (check:response-exposure). */
const COLS = ['id', 'tenant_id', 'branch_id', 'technician_id', 'starts_at', 'ends_at', 'kind', 'status', 'reason', 'requested_by', 'approved_by', 'decided_at', 'decision_note', 'created_at'] as const;

function toRow(r: any): TimeOffRow {
  return { id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, technicianId: String(r.technician_id), startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), kind: r.kind, status: r.status, reason: r.reason ?? null, requestedBy: r.requested_by ?? null, approvedBy: r.approved_by ?? null, decidedAt: r.decided_at ? iso(r.decided_at) : null, decisionNote: r.decision_note ?? null, createdAt: iso(r.created_at) };
}

export async function listTimeOff(db: TimeOffDb, tenantId: string, technicianId: string | null, f: { status?: TimeOffStatus; from?: string; to?: string; branchId?: string | null; limit?: number } = {}): Promise<TimeOffRow[]> {
  let q = db.selectFrom('technician_time_off').select(COLS).where('tenant_id', '=', tenantId);
  if (technicianId) q = q.where('technician_id', '=', technicianId);
  if (f.status) q = q.where('status', '=', f.status);
  if (f.from) q = q.where('ends_at', '>', new Date(f.from));
  if (f.to) q = q.where('starts_at', '<', new Date(f.to));
  if (f.branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', f.branchId!), eb('branch_id', 'is', null)]));
  const rows = await q.orderBy('starts_at', 'asc').limit(Math.min(Math.max(f.limit ?? 200, 1), 500)).execute();
  return rows.map(toRow);
}

export async function getTimeOff(db: TimeOffDb, tenantId: string, id: string): Promise<TimeOffRow | null> {
  if (!uuidOrNull(id)) return null;
  const r = await db.selectFrom('technician_time_off').select(COLS).where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
  return r ? toRow(r) : null;
}

export async function insertTimeOff(db: TimeOffDb, input: { tenantId: string; branchId: string | null; technicianId: string; startsAt: string; endsAt: string; kind: TimeOffKind; reason?: string | null; requestedBy: string | null; status: 'pending' | 'approved'; approvedBy?: string | null }): Promise<TimeOffRow> {
  const approved = input.status === 'approved';
  const row = await db.insertInto('technician_time_off').values({
    tenant_id: input.tenantId, branch_id: input.branchId, technician_id: input.technicianId, starts_at: new Date(input.startsAt), ends_at: new Date(input.endsAt),
    kind: input.kind, status: input.status, reason: input.reason ?? null, requested_by: input.requestedBy, created_by_user_id: uuidOrNull(input.requestedBy),
    approved_by: approved ? uuidOrNull(input.approvedBy) : null, decided_at: approved ? new Date() : null, updated_at: new Date(),
  } as any).returning(COLS).executeTakeFirstOrThrow();
  return toRow(row);
}

/** Decide a pending request: compare-and-set through the machine (only `pending` → approved | rejected). null = not pending. */
export async function decideTimeOff(db: TimeOffDb, tenantId: string, id: string, decision: 'approved' | 'rejected', by: string, note?: string | null): Promise<TimeOffRow | null> {
  const row = await db.updateTable('technician_time_off')
    .set({ status: decision, approved_by: uuidOrNull(by), decided_at: new Date(), decision_note: note ?? null, updated_at: new Date(), updated_by: uuidOrNull(by) } as any)
    .where('tenant_id', '=', tenantId).where('id', '=', id).where('status', '=', 'pending').where(canMoveToSql(TECHNICIAN_TIME_OFF, decision) as any)
    .returning(COLS).executeTakeFirst();
  return row ? toRow(row) : null;
}

/** A technician withdraws her OWN pending request (pending → cancelled; a decided one is never withdrawn here). */
export async function withdrawTimeOff(db: TimeOffDb, tenantId: string, technicianId: string, id: string, by: string): Promise<boolean> {
  if (!uuidOrNull(id)) return false;
  const r = await db.updateTable('technician_time_off').set({ status: 'cancelled', updated_at: new Date(), updated_by: uuidOrNull(by) } as any)
    .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('id', '=', id).where('status', '=', 'pending')
    .where(canMoveToSql(TECHNICIAN_TIME_OFF, 'cancelled') as any).returning(['id']).executeTakeFirst();
  return !!r;
}

/** Branch-scoped existence check (same rule as the POS technicians repository: this branch, or a tenant-wide row). */
export async function technicianInScope(db: TimeOffDb, ctx: { tenantId: string; branchId?: string | null }, technicianId: string): Promise<{ id: string; branchId: string | null } | null> {
  if (!uuidOrNull(technicianId)) return null;
  let q = db.selectFrom('technicians').select(['id', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId);
  if (ctx.branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', ctx.branchId!), eb('branch_id', 'is', null)]));
  const r: any = await q.executeTakeFirst();
  return r ? { id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null } : null;
}
