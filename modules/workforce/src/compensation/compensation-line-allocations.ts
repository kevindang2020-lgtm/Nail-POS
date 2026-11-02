/**
 * compensation-line-allocations.ts — multi-technician per-line allocation (migration 587, ticket_service_line_allocations;
 * Payroll mandate §132–§135). A service line may be performed by a PRIMARY technician plus HELPER(s). Shares are integer
 * basis points and MUST sum to 10000 per line. The engine consumes these rows as
 * `technicians: [{technicianId, method:'percent', value}]`; a line with no allocation rows falls back to its technician_id
 * at 100% (unchanged behaviour for every existing ticket, including the Phase 15 per-line technician split).
 *
 * The helper flow writes allocations EXPLICITLY (never by reassigning technician_id, which erased the primary's share).
 * Ported from the other chat's Technician Profile phase 2 (Oct 12 2026).
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export type AllocationRole = 'PRIMARY' | 'HELPER';
export interface LineAllocation { technicianId: string; shareBps: number; role: AllocationRole }

/** PURE: validate a set of allocations for one line. */
export function validateAllocations(allocs: LineAllocation[]): string[] {
  const errors: string[] = [];
  if (!allocs.length) errors.push('At least one allocation is required.');
  const seen = new Set<string>();
  let sum = 0;
  for (const a of allocs) {
    if (!a.technicianId) errors.push('technicianId is required.');
    if (seen.has(a.technicianId)) errors.push(`Technician ${a.technicianId} appears twice.`);
    seen.add(a.technicianId);
    if (!Number.isInteger(a.shareBps) || a.shareBps <= 0 || a.shareBps > 10000) errors.push(`share_bps must be an integer in 1..10000 (got ${a.shareBps}).`);
    if (a.role !== 'PRIMARY' && a.role !== 'HELPER') errors.push('role must be PRIMARY or HELPER.');
    sum += a.shareBps;
  }
  if (allocs.length && sum !== 10000) errors.push(`Shares must total 10000 bps (got ${sum}).`);
  if (allocs.length && allocs.filter((a) => a.role === 'PRIMARY').length !== 1) errors.push('Exactly one PRIMARY allocation is required.');
  return errors;
}

/** PURE: the default primary+helper split (50/50) used by the Request-Help flow (spec: helper tip/earnings 50/50). */
export function primaryHelperSplit(primaryId: string, helperId: string, helperBps = 5000): LineAllocation[] {
  const h = Math.max(1, Math.min(9999, Math.round(helperBps)));
  if (primaryId === helperId) return [{ technicianId: primaryId, shareBps: 10000, role: 'PRIMARY' }];
  return [
    { technicianId: primaryId, shareBps: 10000 - h, role: 'PRIMARY' },
    { technicianId: helperId, shareBps: h, role: 'HELPER' },
  ];
}

/** Run `fn` in a transaction (or inside the caller's). Allocation writes are delete + insert of a WHOLE set, so they must
 *  never interleave: every writer first locks the line row FOR UPDATE (pay-merge.postgres-race: two helpers accepted on one
 *  line at once used to fail one of them on the unique key). */
async function inLineTx<T>(db: Kysely<DB>, fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  if (db.isTransaction) return fn(db);
  return db.transaction().execute((trx: Kysely<DB>) => fn(trx));
}

/** Replace a line's allocation set atomically (line row locked; delete + insert in one transaction). Validates. */
export async function writeLineAllocations(
  db: Kysely<DB>, args: { tenantId: string; branchId: string | null; ticketId: string; lineId: string; allocations: LineAllocation[]; byUserId?: string | null },
): Promise<void> {
  const errors = validateAllocations(args.allocations);
  if (errors.length) throw new Error('Invalid line allocations: ' + errors.join(' '));
  await inLineTx(db, async (trx) => {
    await trx.selectFrom('ticket_service_lines').select(['id']).where('tenant_id', '=', args.tenantId).where('id', '=', args.lineId).forUpdate().executeTakeFirst();
    await trx.deleteFrom('ticket_service_line_allocations').where('tenant_id', '=', args.tenantId).where('line_id', '=', args.lineId).execute();
    await trx.insertInto('ticket_service_line_allocations').values(args.allocations.map((a) => ({
      tenant_id: args.tenantId, branch_id: args.branchId, ticket_id: args.ticketId, line_id: args.lineId,
      technician_id: a.technicianId, share_bps: a.shareBps, role: a.role, created_by_user_id: args.byUserId ?? null,
    }))).execute();
  });
}

/**
 * Helper flow entry point: keep the PRIMARY on the line's technician_id, add the HELPER as an explicit allocation
 * (default 50/50). Replaces the old "reassign technician_id" behaviour of migration 400's accept path.
 */
export async function allocateHelperOnLine(
  db: Kysely<DB>, args: { tenantId: string; ticketId: string; lineId: string; helperTechnicianId: string; helperBps?: number; byUserId?: string | null },
): Promise<LineAllocation[] | null> {
  return inLineTx(db, async (trx) => {
    // the line row is locked for the whole read-decide-write, so a concurrent accept waits and then re-reads
    const line: any = await trx.selectFrom('ticket_service_lines').select(['id', 'branch_id', 'technician_id'])
      .where('tenant_id', '=', args.tenantId).where('id', '=', args.lineId).where('ticket_id', '=', args.ticketId).forUpdate().executeTakeFirst();
    if (!line) return null;
    const primary = line.technician_id as string | null;
    if (!primary) {
      // no primary yet — the helper becomes the (sole) technician on the line
      await trx.updateTable('ticket_service_lines').set({ technician_id: args.helperTechnicianId }).where('tenant_id', '=', args.tenantId).where('id', '=', args.lineId).execute();
      return [{ technicianId: args.helperTechnicianId, shareBps: 10000, role: 'PRIMARY' as const }];
    }
    const allocs = primaryHelperSplit(primary, args.helperTechnicianId, args.helperBps);
    await writeLineAllocations(trx, { tenantId: args.tenantId, branchId: line.branch_id ?? null, ticketId: args.ticketId, lineId: args.lineId, allocations: allocs, byUserId: args.byUserId });
    return allocs;
  });
}

/** Allocation rows for every line of a ticket, keyed by line id. Best-effort (empty map on error). */
export async function loadTicketAllocations(db: Kysely<DB>, tenantId: string, ticketId: string): Promise<Map<string, LineAllocation[]>> {
  const out = new Map<string, LineAllocation[]>();
  const rows: any[] = await db.selectFrom('ticket_service_line_allocations').select(['line_id', 'technician_id', 'share_bps', 'role'])
    .where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId).orderBy('role', 'desc').execute().catch(() => []);
  for (const r of rows) {
    const list = out.get(r.line_id) ?? [];
    list.push({ technicianId: r.technician_id, shareBps: Number(r.share_bps), role: r.role === 'HELPER' ? 'HELPER' : 'PRIMARY' });
    out.set(r.line_id, list);
  }
  return out;
}
