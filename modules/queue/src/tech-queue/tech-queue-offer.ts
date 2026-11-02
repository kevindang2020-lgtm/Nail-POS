// tech-queue-offer.ts — the ONE accept / decline write for a tech-queue offer (pos_tech_queue_tickets) — merge Oct 12 2026
// (other-chat Technician Profile phase 1).
//
// The Technician App (tech/tech.kysely.repository.ts) and the POS Tech Queue (tech-queue.kysely.repository.ts) each had their
// own accept and decline UPDATEs; the POS decline went through a plain status write with NO version guard and recorded no
// reason. Both paths are status-guarded (only a pending offer flips — the TECH_QUEUE_TICKET state machine is enforced IN the
// write), version-guarded when the caller passes the version it last saw (optimistic concurrency, migration 155), bump the
// version, and the decline reason is appended to the ticket notes so it is never lost. A write that matches 0 rows lost the
// race — the caller reports a stale state / conflict, never a silent success.
import { sql, type Kysely, type Transaction } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { TECH_QUEUE_TICKET } from '@aipowersalon/appointments';

type Db = Kysely<DB> | Transaction<DB>;
export const PENDING_OFFER_STATUSES = ['assigned', 'waiting_for_acceptance'] as const;

export async function acceptOffer(db: Db, a: { tenantId: string; ticketId: string; expectedVersion?: number | null; readyToStart?: boolean }): Promise<{ accepted: boolean }> {
  const to = a.readyToStart ? 'ready_to_start' : 'accepted';
  let q = db.updateTable('pos_tech_queue_tickets')
    .set({ status: to, accepted_at: sql`now()`, updated_at: sql`now()`, version: sql`version + 1` })
    .where('tenant_id', '=', a.tenantId).where('id', '=', a.ticketId).where('status', 'in', [...PENDING_OFFER_STATUSES]).where(canMoveToSql(TECH_QUEUE_TICKET, to) as any);
  if (typeof a.expectedVersion === 'number') q = q.where('version', '=', a.expectedVersion);
  const res: any = await q.executeTakeFirst();
  return { accepted: Number(res?.numUpdatedRows ?? 0) > 0 };
}

export async function declineOffer(db: Db, d: { tenantId: string; ticketId: string; reason: string; expectedVersion?: number | null }): Promise<{ declined: boolean }> {
  const reason = String(d.reason || '').trim() || 'No reason given';
  const row: any = await db.selectFrom('pos_tech_queue_tickets').select('notes').where('tenant_id', '=', d.tenantId).where('id', '=', d.ticketId).executeTakeFirst();
  const next = `${row?.notes ? row.notes + '\n' : ''}[${new Date().toISOString()}] (declined) ${reason}`;
  let q = db.updateTable('pos_tech_queue_tickets')
    .set({ status: 'declined', notes: next, updated_at: sql`now()`, version: sql`version + 1` })
    .where('tenant_id', '=', d.tenantId).where('id', '=', d.ticketId).where('status', 'in', [...PENDING_OFFER_STATUSES]).where(canMoveToSql(TECH_QUEUE_TICKET, 'declined') as any);
  if (typeof d.expectedVersion === 'number') q = q.where('version', '=', d.expectedVersion);
  const res: any = await q.executeTakeFirst();
  return { declined: Number(res?.numUpdatedRows ?? 0) > 0 };
}
