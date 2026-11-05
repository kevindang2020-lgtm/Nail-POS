// technician-tips-supersede.ts — G4 Split Tips (Nov 5 2026, migration 817).
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { CHECKOUT_TIP_SELECTION } from './checkout-lifecycles';
const N = (v: unknown) => Number(v ?? 0) || 0;

/** The front desk changed the ticket's total tip on the POS: a customer-directed split that no longer adds up is
 *  superseded (its rows removed — the payment-time snapshot then follows the salon's tip policy) and the history says so.
 *  Called from the checkout repository's setTip; best-effort-free: it runs on the caller's handle. */
export async function supersedeCustomerTipsIfChanged(db: Kysely<any>, tenantId: string, ticketId: string, newTipCents: number): Promise<boolean> {
  const s = (await sql<any>`select version, total_tip_cents, state from checkout_tip_selections where tenant_id = ${tenantId} and ticket_id = ${ticketId}`.execute(db)).rows[0];
  if (!s || s.state === 'SUPERSEDED' || N(s.total_tip_cents) === Math.round(newTipCents)) return false;
  await sql`delete from ticket_tip_allocations where tenant_id = ${tenantId} and ticket_id = ${ticketId} and source = 'customer_display'`.execute(db);
  await sql`update checkout_tip_selections set state = 'SUPERSEDED', superseded_reason = 'The front desk changed the total tip.', updated_at = now() where tenant_id = ${tenantId} and ticket_id = ${ticketId} and ${canMoveToSql(CHECKOUT_TIP_SELECTION, 'SUPERSEDED')}`.execute(db);
  await sql`insert into checkout_tip_selection_events (tenant_id, ticket_id, version, action, detail) values (${tenantId}, ${ticketId}, ${N(s.version)}, 'SUPERSEDED', ${JSON.stringify({ previousTotalCents: N(s.total_tip_cents), newTotalCents: Math.round(newTipCents) })}::jsonb)`.execute(db);
  return true;
}
